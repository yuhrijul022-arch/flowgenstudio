import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const midtransServerKey = process.env.MIDTRANS_SERVER_KEY!;
const midtransClientKey = process.env.MIDTRANS_CLIENT_KEY!;
const midtransIsProd = process.env.MIDTRANS_IS_PROD === 'true';

let supabase: ReturnType<typeof createClient>;

export default async function handler(req: VercelRequest, res: VercelResponse) {
    // CORS
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


        const { email, username, password } = req.body;

        if (!email || !username) {
            return res.status(400).json({ error: 'Missing required fields: email, username' });
        }

        const basePrice = 99000;
        const orderId = `FLG-SIGNUP-${Date.now()}-${Math.floor(Math.random() * 100000)}`;

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
                    gross_amount: basePrice,
                },
                item_details: [{
                    id: 'PRO_60_ADS',
                    price: basePrice,
                    quantity: 1,
                    name: 'Lifetime Akses Flowgen Studio',
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
            return res.status(500).json({ error: 'Failed to create transaction with payment gateway.' });
        }

        const snapData = await snapResponse.json();
        const snapToken = snapData.token;

        // Save to transactions
        await supabase.from('transactions').insert({
            app: 'FLG',
            order_id: orderId,
            type: 'SIGNUP',
            user_id: null, // Will be set by webhook on payment success
            email,
            username,
            password: password || null, // Stored for user creation on webhook
            credits_to_add: 60,
            amount: basePrice,
            snap_token: snapToken,
            status: 'pending',
            credited: false,
        } as any);

        return res.status(200).json({
            data: {
                snapToken,
                orderId,
                totalPrice: basePrice,
                clientKey: midtransClientKey,
                isProduction: midtransIsProd,
            }
        });

    } catch (err: any) {
        console.error('Create transaction error:', err);
        return res.status(500).json({ error: 'Failed to create transaction.' });
    }
}
