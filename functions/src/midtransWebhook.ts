import { onRequest } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import * as logger from "firebase-functions/logger";
import { defineSecret } from "firebase-functions/params";
import * as crypto from "crypto";

const db = getFirestore();

const MIDTRANS_SERVER_KEY_SANDBOX = defineSecret("MIDTRANS_SERVER_KEY_SANDBOX");
const MIDTRANS_SERVER_KEY_PROD = defineSecret("MIDTRANS_SERVER_KEY_PROD");
const MIDTRANS_IS_PRODUCTION = defineSecret("MIDTRANS_IS_PRODUCTION");

/**
 * Single webhook endpoint for ALL Midtrans notifications.
 * Routes by order_id prefix: FLG- = Flowgen, SP- = StudioPocket, else = ignored.
 * 
 * Must be publicly accessible (no auth required) so Midtrans can POST here.
 * Set this URL in Midtrans dashboard → Settings → Payment → Notification URL:
 *   https://asia-southeast1-flowgen-studio.cloudfunctions.net/midtransWebhookFlowgen
 */
export const midtransWebhookFlowgen = onRequest(
    {
        region: "asia-southeast1",
        maxInstances: 10,
        // Allow unauthenticated invocations (critical for Midtrans webhook)
        invoker: "public",
        secrets: [
            MIDTRANS_SERVER_KEY_SANDBOX, MIDTRANS_SERVER_KEY_PROD,
            MIDTRANS_IS_PRODUCTION
        ]
    },
    async (req, res) => {
        // Always return 200 to Midtrans to prevent infinite retries.
        // Even on errors, log them and return 200.
        try {
            if (req.method === 'OPTIONS') {
                res.status(200).send("OK");
                return;
            }

            const notification = req.body;
            if (!notification || !notification.order_id) {
                logger.warn("webhook_bad_request", { body: notification });
                res.status(200).send("OK: Ignored (no order_id)");
                return;
            }

            const {
                order_id: rawOrderId,
                transaction_status: transactionStatus,
                fraud_status: fraudStatus,
                gross_amount: grossAmountRaw,
                status_code: statusCode,
                signature_key: signatureKey
            } = notification;

            logger.info("webhook_received", {
                orderId: rawOrderId,
                status: transactionStatus,
                gross_amount: grossAmountRaw,
                fraud_status: fraudStatus
            });

            // ─── ROUTER: dispatch by order_id prefix ───────────────
            if (rawOrderId.startsWith("FLG-")) {
                await handleFlowgenTransaction(rawOrderId, notification, transactionStatus, fraudStatus, grossAmountRaw, statusCode, signatureKey);
            } else if (rawOrderId.startsWith("SP-")) {
                // Future: StudioPocket handler
                logger.info("SP_prefix_ignored_for_now", { orderId: rawOrderId });
            } else {
                logger.info("unknown_prefix_ignored", { orderId: rawOrderId });
            }

            res.status(200).send("OK");
        } catch (globalErr: any) {
            logger.error("webhook_global_error", { error: globalErr.message, stack: globalErr.stack });
            // Still return 200 so Midtrans doesn't keep retrying
            res.status(200).send("OK: Error logged");
        }
    }
);

/**
 * Handle Flowgen transactions (FLG-ORDER-xxx and FLG-TOPUP-xxx).
 * Supports retry order IDs like FLG-ORDER-xxx-Rxxxx from recreateSnapToken.
 */
async function handleFlowgenTransaction(
    rawOrderId: string,
    notification: any,
    transactionStatus: string,
    fraudStatus: string,
    grossAmountRaw: any,
    statusCode: string,
    signatureKey: string
) {
    const grossAmountStr = String(grossAmountRaw);

    // ─── Verify Midtrans Signature ─────────────────────────
    const isProduction = MIDTRANS_IS_PRODUCTION.value() === "true";
    const serverKey = isProduction ? MIDTRANS_SERVER_KEY_PROD.value() : MIDTRANS_SERVER_KEY_SANDBOX.value();

    const stringToSign = `${rawOrderId}${statusCode}${grossAmountStr}${serverKey}`;
    const expectedSignature = crypto.createHash('sha512').update(stringToSign).digest('hex');

    if (signatureKey !== expectedSignature) {
        logger.error("signature_fail", { orderId: rawOrderId });
        return; // silently fail, still return 200 to Midtrans
    }

    logger.info("signature_ok", { orderId: rawOrderId });

    // ─── Resolve the canonical orderId ─────────────────────
    // recreateSnapToken appends "-Rxxxx" to the order_id for Midtrans.
    // The Firestore doc is stored under the original orderId (without the -R suffix).
    // Check if this is a retry order_id and map it back.
    let firestoreDocId = rawOrderId;

    // Try to find the doc directly first
    let orderRef = db.collection('transactions').doc(firestoreDocId);
    let orderSnap = await orderRef.get();

    // If not found, check if this is a retry ID (contains -R at the end)
    if (!orderSnap.exists) {
        // Try stripping the retry suffix: FLG-ORDER-123456-78901-R1234 -> FLG-ORDER-123456-78901
        const retryMatch = rawOrderId.match(/^(.+)-R\d+$/);
        if (retryMatch) {
            firestoreDocId = retryMatch[1];
            orderRef = db.collection('transactions').doc(firestoreDocId);
            orderSnap = await orderRef.get();
            logger.info("retry_order_mapped", { rawOrderId, firestoreDocId });
        }
    }

    if (!orderSnap.exists) {
        logger.warn("order_not_found", { rawOrderId, firestoreDocId });
        return;
    }

    const orderData = orderSnap.data()!;

    // ─── Determine transaction outcome ─────────────────────
    let isSuccess = false;
    let finalStatus = transactionStatus;

    if (transactionStatus === 'capture') {
        if (fraudStatus === 'accept') isSuccess = true;
    } else if (transactionStatus === 'settlement') {
        isSuccess = true;
    } else if (['cancel', 'deny', 'expire'].includes(transactionStatus)) {
        finalStatus = 'expired';
    }

    // ─── SUCCESS: Apply credits ────────────────────────────
    if (isSuccess) {
        // Idempotency guard: already credited → skip
        if (orderData.credited) {
            logger.info("already_credited", { orderId: firestoreDocId });
            return;
        }

        let finalUid = orderData.uid;

        // For signup_pro: create or find the Auth user
        if (!finalUid && orderData.type === 'signup_pro') {
            finalUid = await resolveOrCreateUser(orderData);
        }

        // For topup: uid must already exist
        if (!finalUid) {
            logger.error("no_uid_for_order", { orderId: firestoreDocId, type: orderData.type });
            return;
        }

        // Atomic transaction: increment credits + mark credited
        await db.runTransaction(async (t) => {
            const txOrderSnap = await t.get(orderRef);
            const txOrderData = txOrderSnap.data()!;

            // Double-check inside transaction
            if (txOrderData.credited) {
                logger.info("already_credited_in_tx", { orderId: firestoreDocId });
                return;
            }

            const creditsToAdd = txOrderData.creditsToAdd || txOrderData.credits || 0;
            const userDocRef = db.collection('users').doc(finalUid);
            const userSnap = await t.get(userDocRef);

            if (!userSnap.exists) {
                t.set(userDocRef, {
                    uid: finalUid,
                    email: txOrderData.email,
                    displayName: txOrderData.username || null,
                    credits: creditsToAdd,
                    plan: txOrderData.type === 'signup_pro' ? "Pro" : "Free",
                    source: txOrderData.type === 'signup_pro' ? "ads" : "organic",
                    createdAt: FieldValue.serverTimestamp(),
                    updatedAt: FieldValue.serverTimestamp(),
                });
            } else {
                t.update(userDocRef, {
                    credits: FieldValue.increment(creditsToAdd),
                    ...(txOrderData.type === 'signup_pro' && { plan: "Pro" }),
                    updatedAt: FieldValue.serverTimestamp()
                });
            }

            // Credit ledger entry
            const ledgerRef = db.collection('users').doc(finalUid).collection('credit_ledger').doc(firestoreDocId);
            t.set(ledgerRef, {
                delta: creditsToAdd,
                orderId: firestoreDocId,
                reason: txOrderData.type,
                createdAt: FieldValue.serverTimestamp()
            });

            // Mark transaction as fulfilled
            t.update(orderRef, {
                status: "settlement",
                credited: true,
                uid: finalUid,
                fulfilledAt: FieldValue.serverTimestamp(),
                midtransResponse: notification,
                updatedAt: FieldValue.serverTimestamp(),
            });
        });

        logger.info("credit_applied", {
            orderId: firestoreDocId,
            uid: finalUid,
            creditsAdded: orderData.creditsToAdd || orderData.credits
        });

    } else {
        // ─── NOT SUCCESS: update status only ───────────────
        await orderRef.update({
            status: finalStatus,
            midtransResponse: notification,
            updatedAt: FieldValue.serverTimestamp()
        });
        logger.info("status_updated", { orderId: firestoreDocId, status: finalStatus });
    }
}

/**
 * For signup_pro: find existing Auth user by email, or create one.
 * Uses the password stored in the transaction doc (from /formorder checkout).
 */
async function resolveOrCreateUser(orderData: any): Promise<string> {
    const adminAuth = getAuth();
    const email = orderData.email;

    try {
        // Check if user already exists (e.g. Google signup)
        const existing = await adminAuth.getUserByEmail(email);
        logger.info("user_exists_for_checkout", { email, uid: existing.uid });
        return existing.uid;
    } catch (err: any) {
        if (err.code !== 'auth/user-not-found') throw err;
    }

    // User doesn't exist — create with the password from checkout
    const password = orderData.password;
    if (!password) {
        // Fallback: create with random password (user must reset)
        logger.warn("no_password_in_order_creating_random", { email });
    }

    const newUser = await adminAuth.createUser({
        email,
        password: password || crypto.randomBytes(12).toString('hex'),
        displayName: orderData.username || undefined,
    });

    logger.info("user_created_for_checkout", { email, uid: newUser.uid });
    return newUser.uid;
}
