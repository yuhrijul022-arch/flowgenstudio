import { onCall, HttpsError } from "firebase-functions/https";
import { onRequest } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import { defineSecret } from "firebase-functions/params";

const midtransClient = require('midtrans-client');

const db = getFirestore();

const MIDTRANS_SERVER_KEY_SANDBOX = defineSecret("MIDTRANS_SERVER_KEY_SANDBOX");
const MIDTRANS_SERVER_KEY_PROD = defineSecret("MIDTRANS_SERVER_KEY_PROD");
const MIDTRANS_CLIENT_KEY_SANDBOX = defineSecret("MIDTRANS_CLIENT_KEY_SANDBOX");
const MIDTRANS_CLIENT_KEY_PROD = defineSecret("MIDTRANS_CLIENT_KEY_PROD");
const MIDTRANS_IS_PRODUCTION = defineSecret("MIDTRANS_IS_PRODUCTION");

interface CreateOrderSnapTokenData {
    email: string;
    username: string;
    password?: string;
    promoCode?: string;
    entry?: string;
}

interface CreateTopupSnapTokenData {
    creditsQty: number;
}

const getMidtransConfig = () => {
    const isProduction = MIDTRANS_IS_PRODUCTION.value() === "true";
    const serverKey = isProduction ? MIDTRANS_SERVER_KEY_PROD.value() : MIDTRANS_SERVER_KEY_SANDBOX.value();
    const clientKey = isProduction ? MIDTRANS_CLIENT_KEY_PROD.value() : MIDTRANS_CLIENT_KEY_SANDBOX.value();

    logger.info("Midtrans config terpilih:", {
        isProd: isProduction,
        hasServerKey: !!serverKey,
        hasClientKey: !!clientKey
    });

    if (!serverKey || !clientKey) {
        throw new HttpsError("failed-precondition", "Payment gateway not configured properly.");
    }
    return { isProduction, serverKey, clientKey };
};

const corsLib = require("cors");
const corsHandler = corsLib({
    origin: ["https://flowgen-studio.web.app", "http://localhost:5173", "https://flowgenstudio.web.app"],
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"]
});

export const createOrderSnapToken = onRequest(
    {
        region: "asia-southeast1",
        maxInstances: 10,
        timeoutSeconds: 30,
        secrets: [
            MIDTRANS_SERVER_KEY_SANDBOX, MIDTRANS_SERVER_KEY_PROD,
            MIDTRANS_CLIENT_KEY_SANDBOX, MIDTRANS_CLIENT_KEY_PROD,
            MIDTRANS_IS_PRODUCTION
        ]
    },
    (req, res) => {
        corsHandler(req, res, async () => {
            if (req.method === 'OPTIONS') {
                res.status(204).send('');
                return;
            }

            try {
                // Determine `data` payload similar to onCall, since fetch sends { data: { ... } } or just body { ... }
                // For safety, we check both req.body.data and req.body
                const data = (req.body && req.body.data) ? req.body.data : (req.body || {}) as CreateOrderSnapTokenData;
                const { email, username } = data;

                if (!email || !username) {
                    res.status(400).json({ data: null, error: { message: "Missing required fields." } });
                    return;
                }

                const { isProduction, serverKey, clientKey } = getMidtransConfig();

                const basePrice = 99000;
                const totalPrice = basePrice;

                const orderId = `FLG-ORDER-${Date.now()}-${Math.floor(Math.random() * 100000)}`;

                const snap = new midtransClient.Snap({
                    isProduction,
                    serverKey,
                    clientKey
                });

                const customerDetails = {
                    first_name: username,
                    email: email,
                };

                const itemDetails = [
                    {
                        id: "PRO_60_ADS",
                        price: basePrice,
                        quantity: 1,
                        name: "Lifetime Akses Flowgen Studio"
                    }
                ];

                const parameter = {
                    transaction_details: {
                        order_id: orderId,
                        gross_amount: totalPrice
                    },
                    item_details: itemDetails,
                    customer_details: customerDetails,
                    custom_expiry: {
                        expiry_duration: 15,
                        unit: "minute"
                    }
                };

                const transactionToken = await snap.createTransactionToken(parameter);

                const orderRef = db.collection('transactions').doc(orderId);
                await orderRef.set({
                    orderId,
                    type: "signup_pro",
                    uid: null, // Always null for ads entry, webhook maps this.
                    email,
                    username: username || null,
                    password: data.password || null, // Stored so webhook can create Auth user
                    creditsToAdd: 60,
                    amount: totalPrice,
                    snapToken: transactionToken,
                    status: "pending",
                    credited: false,
                    createdAt: FieldValue.serverTimestamp(),
                    updatedAt: FieldValue.serverTimestamp(),
                    entry: data.entry || "ads",
                    provider: "midtrans"
                });

                logger.info("Snap transaction created", { orderId, email, totalPrice, type: "signup_pro" });

                // Return payload wrapped in data for easy fetch parsing or callable parsing
                res.status(200).json({
                    data: {
                        snapToken: transactionToken,
                        orderId,
                        totalPrice,
                        clientKey,
                        isProduction
                    }
                });
            } catch (error: any) {
                logger.error("Error creating Midtrans transaction", {
                    message: error.message,
                    httpStatusCode: error.httpStatusCode,
                    apiResponse: error.ApiResponse,
                    stack: error.stack
                });
                res.status(500).json({ data: null, error: { message: "Failed to create transaction with payment gateway." } });
            }
        });
    }
);

export const createTopupSnapToken = onCall(
    {
        region: "asia-southeast1",
        maxInstances: 10,
        timeoutSeconds: 30,
        secrets: [
            MIDTRANS_SERVER_KEY_SANDBOX, MIDTRANS_SERVER_KEY_PROD,
            MIDTRANS_CLIENT_KEY_SANDBOX, MIDTRANS_CLIENT_KEY_PROD,
            MIDTRANS_IS_PRODUCTION
        ]
    },
    async (request) => {
        const uid = request.auth?.uid;
        if (!uid) {
            throw new HttpsError('unauthenticated', 'User must be logged in.');
        }

        const data = (request.data || {}) as CreateTopupSnapTokenData;
        const { creditsQty } = data;

        if (!creditsQty || creditsQty < 1) {
            throw new HttpsError('invalid-argument', 'Invalid or missing fields. creditsQty minimum 1.');
        }

        const userDoc = await db.collection('users').doc(uid).get();
        const userData = userDoc.data();
        if (!userDoc.exists) {
            throw new HttpsError('not-found', 'User not found.');
        }

        const email = userData?.email || "unknown@flowgen.com";
        const username = userData?.displayName || "Flowgen User";

        const { isProduction, serverKey, clientKey } = getMidtransConfig();

        // Price = creditsQty * 2000
        const totalPrice = creditsQty * 2000;
        const orderId = `FLG-TOPUP-${Date.now()}-${Math.floor(Math.random() * 100000)}`;

        const snap = new midtransClient.Snap({
            isProduction,
            serverKey,
            clientKey
        });

        const customerDetails = {
            first_name: username,
            email: email,
        };

        const itemDetails = [
            {
                id: `FLOWGEN_TOPUP_${creditsQty}`,
                price: totalPrice,
                quantity: 1,
                name: `Flowgen Topup - ${creditsQty} Credits`
            }
        ];

        const parameter = {
            transaction_details: {
                order_id: orderId,
                gross_amount: totalPrice
            },
            item_details: itemDetails,
            customer_details: customerDetails,
            custom_expiry: {
                expiry_duration: 15,
                unit: "minute"
            }
        };

        try {
            const transactionToken = await snap.createTransactionToken(parameter);

            const orderRef = db.collection('transactions').doc(orderId);
            await orderRef.set({
                orderId,
                type: "topup",
                uid,
                email,
                creditsToAdd: creditsQty,
                amount: totalPrice,
                snapToken: transactionToken,
                status: "pending",
                credited: false,
                createdAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
                entry: "topup",
                provider: "midtrans"
            });

            logger.info("Snap topup transaction created", { orderId, email, totalPrice, type: "topup" });

            return {
                snapToken: transactionToken,
                orderId,
                totalPrice,
                clientKey,
                isProduction
            };
        } catch (error: any) {
            logger.error("Error creating Midtrans topup transaction", {
                message: error.message,
                httpStatusCode: error.httpStatusCode,
                apiResponse: error.ApiResponse,
                stack: error.stack
            });
            throw new HttpsError('internal', "Failed to create topup transaction.");
        }
    }
);

export const recreateSnapToken = onCall(
    {
        region: "asia-southeast1",
        maxInstances: 10,
        timeoutSeconds: 30,
        secrets: [
            MIDTRANS_SERVER_KEY_SANDBOX, MIDTRANS_SERVER_KEY_PROD,
            MIDTRANS_CLIENT_KEY_SANDBOX, MIDTRANS_CLIENT_KEY_PROD,
            MIDTRANS_IS_PRODUCTION
        ]
    },
    async (request) => {
        const uid = request.auth?.uid;
        if (!uid) {
            throw new HttpsError('unauthenticated', 'User must be logged in.');
        }

        const data = request.data || {};
        const { orderId } = data;

        if (!orderId) {
            throw new HttpsError('invalid-argument', 'Missing orderId.');
        }

        const txRef = db.collection('transactions').doc(orderId);
        const txSnap = await txRef.get();

        if (!txSnap.exists) {
            throw new HttpsError('not-found', 'Transaction not found.');
        }

        const txData = txSnap.data()!;

        if (txData.uid !== uid) {
            throw new HttpsError('permission-denied', 'Not authorized to recreate this transaction.');
        }

        if (txData.credited || txData.status === 'success' || txData.status === 'paid' || txData.status === 'settlement' || txData.status === 'capture') {
            throw new HttpsError('failed-precondition', 'Transaction already fulfilled.');
        }

        const { isProduction, serverKey, clientKey } = getMidtransConfig();
        const snap = new midtransClient.Snap({ isProduction, serverKey, clientKey });

        const customerDetails: any = {
            email: txData.email,
        };
        // Retrieve name if available for topup, else fallback
        const userDoc = await db.collection('users').doc(uid).get();
        if (userDoc.exists) customerDetails.first_name = userDoc.data()?.displayName || "Flowgen User";

        const creditsVal = txData.creditsToAdd || txData.credits || 0;
        const amountVal = txData.amount || txData.grossAmount || 0;

        const itemDetails = [
            {
                id: txData.type === 'signup_pro' ? "PRO_60_ADS" : `FLOWGEN_TOPUP_${creditsVal}`,
                price: amountVal,
                quantity: 1,
                name: txData.type === 'signup_pro' ? "Lifetime Akses Flowgen Studio" : `Flowgen Topup - ${creditsVal} Credits`
            }
        ];

        // Midtrans requires a unique order_id per payload retry if it previously failed fully natively.
        // But for simply an expired snapToken, sometimes we can re-request with the exact same orderId if 
        // it was never actually hit on midtrans side, or we just generate a sibling orderId.
        // The safest robust Midtrans way to resume an expired order is to generate a new order_id and link it, 
        // OR if it's just a snapToken that was lost on frontend but still pending, we can try to re-request.
        // If it throws duplicate_order_id, the order is actually stuck pending on Midtrans side, meaning user can't re-checkout 
        // with the exact same order_id. So we will append a `-R` retry suffix to the real midtrans order_id, while mapping it back to our own.

        const midtransRetryOrderId = `${orderId}-R${Date.now().toString().slice(-4)}`;

        const parameter = {
            transaction_details: {
                order_id: midtransRetryOrderId,
                gross_amount: amountVal
            },
            item_details: itemDetails,
            customer_details: customerDetails,
            custom_expiry: {
                expiry_duration: 15,
                unit: "minute"
            }
        };

        try {
            const transactionToken = await snap.createTransactionToken(parameter);

            // Update local DB to map the new midtrans sibling ID and the fresh snap tool.
            await txRef.update({
                snapToken: transactionToken,
                midtransTransactionId: midtransRetryOrderId, // Track the actual payload ID we sent this time
                updatedAt: FieldValue.serverTimestamp(),
                status: 'pending'
            });

            logger.info("Snap transaction token recreated", { orderId, midtransRetryOrderId });

            return {
                snapToken: transactionToken,
                orderId,
                totalPrice: amountVal,
                clientKey,
                isProduction
            };
        } catch (error: any) {
            logger.error("Error recreating Midtrans transaction token", { error });
            throw new HttpsError('internal', "Failed to recreate transaction token.");
        }
    }
);
