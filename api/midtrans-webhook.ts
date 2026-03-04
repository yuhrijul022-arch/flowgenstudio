import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { createHash } from 'crypto';

const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const midtransServerKey = process.env.MIDTRANS_SERVER_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

export default async function handler(req: VercelRequest, res: VercelResponse) {
    // Midtrans requires 200 response even on errors to prevent retries
    if (req.method === 'OPTIONS') return res.status(200).send('OK');
    if (req.method !== 'POST') return res.status(200).send('OK');

    try {
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

        // Only handle FLG- orders
        if (!rawOrderId.startsWith('FLG-')) {
            return res.status(200).send('OK: Not FLG order');
        }

        // Verify signature
        const grossAmountStr = String(grossAmountRaw);
        const stringToSign = `${rawOrderId}${statusCode}${grossAmountStr}${midtransServerKey}`;
        const expectedSignature = createHash('sha512').update(stringToSign).digest('hex');

        if (signatureKey !== expectedSignature) {
            console.error('Webhook: signature mismatch', { orderId: rawOrderId });
            return res.status(200).send('OK: Invalid signature');
        }

        // Resolve order — handle retry IDs (FLG-xxx-Rxxxx)
        let firestoreDocOrderId = rawOrderId;
        let { data: txData, error: txError } = await supabase
            .from('billing_transactions')
            .select('*')
            .eq('order_id', firestoreDocOrderId)
            .single();

        if (!txData) {
            // Try stripping retry suffix
            const retryMatch = rawOrderId.match(/^(.+)-R\d+$/);
            if (retryMatch) {
                firestoreDocOrderId = retryMatch[1];
                const result = await supabase
                    .from('billing_transactions')
                    .select('*')
                    .eq('order_id', firestoreDocOrderId)
                    .single();
                txData = result.data;
            }
        }

        if (!txData) {
            console.warn('Webhook: order not found', { rawOrderId });
            return res.status(200).send('OK: Order not found');
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
        if (isSuccess) {
            // Idempotency: check if already credited
            if (txData.status === 'success') {
                console.log('Already credited:', firestoreDocOrderId);
                return res.status(200).send('OK: Already processed');
            }

            let userId = txData.user_id;
            const creditsToAdd = txData.credits || 0;

            // For signup_pro: create or find user
            if (!userId && txData.type === 'signup_pro') {
                userId = await resolveOrCreateUser(txData.email, txData.username, txData.password);
            }

            if (!userId) {
                console.error('No user_id for order:', firestoreDocOrderId);
                return res.status(200).send('OK: No user');
            }

            // Get current credits
            const { data: currentUser } = await supabase
                .from('users')
                .select('credits, tier')
                .eq('id', userId)
                .single();

            const newCredits = (currentUser?.credits || 0) + creditsToAdd;
            const updateData: any = { credits: newCredits };

            if (txData.type === 'signup_pro') {
                updateData.tier = 'PRO';
            }

            // Update user credits
            await supabase
                .from('users')
                .update(updateData)
                .eq('id', userId);

            // If user doesn't exist yet, create the row
            if (!currentUser) {
                await supabase.from('users').upsert({
                    id: userId,
                    email: txData.email,
                    username: txData.username,
                    credits: creditsToAdd,
                    tier: txData.type === 'signup_pro' ? 'PRO' : 'FREE',
                });
            }

            // Insert credit ledger
            await supabase.from('credit_ledger').insert({
                user_id: userId,
                amount: creditsToAdd,
                type: txData.type === 'signup_pro' ? 'purchase' : 'topup',
                reference: firestoreDocOrderId,
            });

            // Update transaction
            await supabase
                .from('billing_transactions')
                .update({
                    status: 'success',
                    user_id: userId,
                    payment_type: notification.payment_type || null,
                    midtrans_response: notification,
                })
                .eq('order_id', firestoreDocOrderId);

            console.log('Credits applied:', { orderId: firestoreDocOrderId, userId, creditsToAdd });

        } else {
            // ── NOT SUCCESS ──
            const mappedStatus = finalStatus === 'pending' ? 'pending' : 'failed';
            await supabase
                .from('billing_transactions')
                .update({
                    status: mappedStatus,
                    midtrans_response: notification,
                })
                .eq('order_id', firestoreDocOrderId);

            console.log('Status updated:', { orderId: firestoreDocOrderId, status: mappedStatus });
        }

        return res.status(200).send('OK');

    } catch (err: any) {
        console.error('Webhook global error:', err);
        return res.status(200).send('OK: Error logged');
    }
}

/**
 * For signup_pro: find existing Auth user by email, or create one.
 */
async function resolveOrCreateUser(
    email: string,
    username: string | null,
    password: string | null
): Promise<string> {
    // Try to find existing user by email
    const { data: users } = await supabase.auth.admin.listUsers();
    const existing = users?.users?.find(u => u.email === email);

    if (existing) {
        return existing.id;
    }

    // Create new user
    const { data: newUser, error } = await supabase.auth.admin.createUser({
        email,
        password: password || Math.random().toString(36).substring(2, 14),
        user_metadata: {
            full_name: username || undefined,
        },
        email_confirm: true,
    });

    if (error || !newUser.user) {
        console.error('Failed to create user:', error);
        throw new Error('Failed to create user');
    }

    console.log('User created for checkout:', { email, uid: newUser.user.id });
    return newUser.user.id;
}
