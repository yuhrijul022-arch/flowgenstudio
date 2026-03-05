import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { createHash } from 'crypto';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const midtransServerKey = process.env.MIDTRANS_SERVER_KEY!;

let supabase: ReturnType<typeof createClient>;

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method === 'OPTIONS') return res.status(200).send('OK');
    if (req.method !== 'POST') return res.status(200).send('OK');

    try {
        if (!supabaseUrl || !supabaseServiceKey) {
            console.error('Webhook Error: Missing Supabase Environment Variables in Vercel');
            return res.status(200).send('OK: Missing Config'); // Return 200 to prevent Midtrans retry spam
        }
        if (!supabase) {
            supabase = createClient(supabaseUrl, supabaseServiceKey);
        }
        const notification = req.body;
        if (!notification || !notification.order_id) {
            console.warn('Webhook: missing order_id');
            return res.status(200).send('OK: Ignored');
        }

        const {
            order_id: rawOrderId,
            transaction_status: transactionStatus,
            fraud_status: fraudStatus,
            gross_amount: grossAmountRaw,
            status_code: statusCode,
            signature_key: signatureKey,
        } = notification;

        console.log('Webhook received:', { orderId: rawOrderId, status: transactionStatus });

        // 1. Verify signature
        const grossAmountStr = String(grossAmountRaw);
        const stringToSign = `${rawOrderId}${statusCode}${grossAmountStr}${midtransServerKey}`;
        const expectedSignature = createHash('sha512').update(stringToSign).digest('hex');

        if (signatureKey !== expectedSignature) {
            console.error('Webhook: signature mismatch', { orderId: rawOrderId });
            return res.status(401).send('Unauthorized: Invalid signature');
        }

        // 2. Parse order_id (Format: <APP>-<TYPE>-...)
        const parts = rawOrderId.split('-');
        if (parts.length < 3) {
            console.warn('Webhook: Invalid order_id format', { rawOrderId });
            return res.status(200).send('OK: Invalid format');
        }

        const app = parts[0]; // FLG, VIS, SPK
        const type = parts[1]; // SIGNUP, TOPUP

        if (!['FLG', 'VIS', 'SPK'].includes(app)) {
            console.warn('Webhook: Unknown app code', { app });
            return res.status(200).send('OK: Unknown app');
        }

        // 3. Find transaction
        let { data: txData, error: txError } = await supabase
            .from('transactions')
            .select('*')
            .eq('order_id', rawOrderId)
            .single();

        if (!txData) {
            console.warn('Webhook: missing transaction draft, creating placeholder', { rawOrderId });
            const { data: newTx, error: insertErr } = await supabase.from('transactions').insert({
                app: app,
                order_id: rawOrderId,
                type: type,
                amount: parseInt(grossAmountStr, 10),
                email: 'unknown@webhook.com',  // Placeholder since payload doesn't have email reliably
                credits_to_add: 0, // Cannot assume credits to add if missing!
                status: 'pending',
                raw_notification: notification
            } as any).select().single();

            if (insertErr || !newTx) {
                console.error('Failed to create placeholder tx', insertErr);
                return res.status(200).send('OK');
            }
            txData = newTx;
        }

        // Determine transaction outcome
        let isSuccess = false;
        let finalStatus = transactionStatus;

        if (transactionStatus === 'capture') {
            if (fraudStatus === 'accept') isSuccess = true;
        } else if (transactionStatus === 'settlement') {
            isSuccess = true;
        } else if (['cancel', 'deny', 'expire'].includes(transactionStatus)) {
            finalStatus = 'failed';
        }

        // ── SUCCESS ──
        if (isSuccess || statusCode === '200') {

            // Check Idempotency
            if ((txData as any).status === 'paid' || (txData as any).credited === true) {
                console.log('Already credited:', rawOrderId);
                return res.status(200).send('OK: Already processed');
            }

            // Ensure not processed in processed_notifications table
            const { data: existingNotif } = await supabase
                .from('processed_notifications')
                .select('id')
                .eq('order_id', rawOrderId)
                .single();

            if (existingNotif) {
                console.log('Already processed in notifications table:', rawOrderId);
                return res.status(200).send('OK: Already processed');
            }

            let userId = (txData as any).user_id;
            let creditsToAdd = (txData as any).credits_to_add || 0;

            if (!userId) {
                const emailFallback = (txData as any).email || notification.customer_details?.email;
                if (emailFallback) {
                    console.log('Webhook warning: user_id missing in draft, attempting email fallback', emailFallback);
                    const { data: fallbackUser } = await supabase.from('users').select('id').eq('email', emailFallback).single();
                    if (fallbackUser) {
                        userId = (fallbackUser as any).id;
                    } else {
                        // Fallback 2: Check Supabase Auth
                        const { data: authUsers } = await supabase.auth.admin.listUsers();
                        const foundAuth = authUsers?.users?.find(u => u.email === emailFallback);
                        if (foundAuth) userId = foundAuth.id;
                    }
                }
            }

            if (!userId) {
                // For topup without userId, we can't credit.
                console.error('No user_id for order:', rawOrderId);
                const failPayload: any = {
                    status: 'paid',
                    raw_notification: notification
                };
                // @ts-ignore
                await supabase.from('transactions').update(failPayload).eq('order_id', rawOrderId);
                return res.status(200).send('OK: No user to credit');
            }

            // Get current user credits
            const { data: currentUser } = await supabase
                .from('users')
                .select('credits, pro_active')
                .eq('id', userId)
                .single();

            const newCredits = ((currentUser as any)?.credits || 0) + creditsToAdd;
            const updateData: any = { credits: newCredits, updated_at: new Date().toISOString() };

            if (type === 'SIGNUP') {
                updateData.pro_active = true;
            }

            // Update user
            if (currentUser) {
                // @ts-ignore
                await supabase.from('users').update(updateData as any).eq('id', userId);
            } else {
                const newUserPayload: any = {
                    id: userId,
                    app: app,
                    email: (txData as any).email,
                    username: (txData as any).username,
                    credits: creditsToAdd,
                    pro_active: type === 'SIGNUP' ? true : false,
                };
                // @ts-ignore
                await supabase.from('users').upsert(newUserPayload);
            }

            // Update transaction to paid and credited
            const successPayload: any = {
                status: 'paid',
                credited: true,
                credited_at: new Date().toISOString(),
                user_id: userId,
                payment_type: notification.payment_type || null,
                raw_notification: notification,
            };
            // @ts-ignore
            await supabase
                .from('transactions')
                .update(successPayload as never)
                .eq('order_id', rawOrderId);

            // Insert into processed notifications to guarantee idempotency
            const notifPayload: any = {
                order_id: rawOrderId,
                transaction_id: (txData as any).id,
                payload: notification
            };
            await supabase.from('processed_notifications').insert(notifPayload as never);

            console.log('Credits applied:', { orderId: rawOrderId, userId, creditsToAdd, app, type });

        } else {
            // ── NOT SUCCESS ──
            const mappedStatus = finalStatus === 'pending' ? 'pending' : (finalStatus === 'failed' ? 'failed' : 'expired');
            const errorPayload: any = {
                status: mappedStatus,
                raw_notification: notification,
            };
            // @ts-ignore
            await supabase
                .from('transactions')
                .update(errorPayload as never)
                .eq('order_id', rawOrderId);

            console.log('Status updated:', { orderId: rawOrderId, status: mappedStatus });
        }

        return res.status(200).send('OK');

    } catch (err: any) {
        console.error('Webhook global error:', err);
        return res.status(200).send('OK: Error logged');
    }
}

