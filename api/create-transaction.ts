import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';

const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

const midtransServerKey = process.env.MIDTRANS_SERVER_KEY!;
const midtransClientKey = process.env.MIDTRANS_CLIENT_KEY!;
const midtransIsProd = process.env.MIDTRANS_IS_PROD === 'true';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        if (!supabase) {
            console.error('Missing Supabase Client Configuration');
            return res.status(500).json({ error: 'Server configuration error: Missing Supabase keys.' });
        }


        let { email, username, password } = req.body;

        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Missing or invalid Authorization header' });
        }
        const token = authHeader.split(' ')[1];

        // Verify user
        const { data: { user }, error: authError } = await supabase.auth.getUser(token);
        if (authError || !user) {
            console.error('Create Tx Auth Error:', authError?.message);
            return res.status(401).json({ error: 'Unauthorized: Invalid token' });
        }

        // Override payload email with verified user email for safety
        email = user.email;

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

        // Ensure user exists in users table to prevent FK violations
        // @ts-ignore
        const { error: userInsertErr } = await supabase.from('users').upsert({
            id: user.id,
            app: 'FLG',
            email: email,
            username: username,
            credits: 0,
            pro_active: false
        }, { onConflict: 'id', ignoreDuplicates: true });

        if (userInsertErr) {
            console.error('Failed to upsert user for draft:', userInsertErr);
            // Optionally log but continue, hoping FK cascade handles it, or return error. 
            // Better to return error if strict FK exists.
            // return res.status(500).json({ error: 'Failed to initialize user data.' });
        }

        // Save to transactions
        const { error: txInsertErr } = await supabase.from('transactions').insert({
            app: 'FLG',
            order_id: orderId,
            type: 'SIGNUP',
            user_id: user.id, // Strictly bind to authenticated user
            email,
            username,
            password: password || null,
            credits_to_add: 60,
            amount: basePrice,
            snap_token: snapToken,
            status: 'pending',
            credited: false,
        } as any);

        if (txInsertErr) {
            console.error('Failed to create transaction draft:', txInsertErr);
            return res.status(500).json({ error: 'Failed to save transaction draft.' });
        }

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
