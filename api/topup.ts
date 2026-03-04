import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const midtransServerKey = process.env.MIDTRANS_SERVER_KEY!;
const midtransClientKey = process.env.MIDTRANS_CLIENT_KEY!;
const midtransIsProd = process.env.MIDTRANS_IS_PROD === 'true';

let supabase: ReturnType<typeof createClient>;

export default async function handler(req: VercelRequest, res: VercelResponse) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        if (!supabaseUrl || !supabaseServiceKey) {
            console.error('Missing Supabase Environment Variables in Vercel');
            return res.status(500).json({ error: 'Server configuration error: Missing Supabase keys.' });
        }
        if (!supabase) {
            supabase = createClient(supabaseUrl, supabaseServiceKey);
        }
        // Verify auth
        const authHeader = req.headers.authorization;
        if (!authHeader?.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Missing auth token' });
        }
        const token = authHeader.split(' ')[1];
        const { data: { user }, error: authError } = await supabase.auth.getUser(token);
        if (authError || !user) {
            return res.status(401).json({ error: 'Invalid auth token' });
        }

        const uid = user.id;
        const { creditsQty } = req.body;

        if (!creditsQty || creditsQty < 1) {
            return res.status(400).json({ error: 'Invalid creditsQty. Minimum 1.' });
        }

        // Get user info
        const { data: userData } = await supabase
            .from('users')
            .select('email, username')
            .eq('id', uid)
            .single();

        const email = userData?.email || user.email || 'unknown@flowgen.com';
        const username = userData?.username || 'Flowgen User';

        const totalPrice = creditsQty * 2000;
        const orderId = `FLG-TOPUP-${Date.now()}-${Math.floor(Math.random() * 100000)}`;

        // Create Midtrans Snap token
        const midtransBaseUrl = midtransIsProd
            ? 'https://app.midtrans.com/snap/v1/transactions'
            : 'https://app.sandbox.midtrans.com/snap/v1/transactions';

        const midtransAuth = Buffer.from(`${midtransServerKey}:`).toString('base64');

        const snapResponse = await fetch(midtransBaseUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Basic ${midtransAuth}`,
            },
            body: JSON.stringify({
                transaction_details: {
                    order_id: orderId,
                    gross_amount: totalPrice,
                },
                item_details: [{
                    id: `FLOWGEN_TOPUP_${creditsQty}`,
                    price: totalPrice,
                    quantity: 1,
                    name: `Flowgen Topup - ${creditsQty} Credits`,
                }],
                customer_details: {
                    first_name: username,
                    email: email,
                },
                custom_expiry: {
                    expiry_duration: 15,
                    unit: 'minute',
                },
            }),
        });

        if (!snapResponse.ok) {
            const errText = await snapResponse.text();
            console.error('Midtrans Snap error:', errText);
            return res.status(500).json({ error: 'Failed to create topup transaction.' });
        }

        const snapData = await snapResponse.json();
        const snapToken = snapData.token;

        // Save to transactions
        await supabase.from('transactions').insert({
            app: 'FLG',
            order_id: orderId,
            type: 'TOPUP',
            user_id: uid,
            email,
            credits_to_add: creditsQty,
            amount: totalPrice,
            snap_token: snapToken,
            status: 'pending',
            credited: false,
        } as any);

        return res.status(200).json({
            snapToken,
            orderId,
            totalPrice,
            clientKey: midtransClientKey,
            isProduction: midtransIsProd,
        });

    } catch (err: any) {
        console.error('Topup error:', err);
        return res.status(500).json({ error: 'Failed to create topup transaction.' });
    }
}
