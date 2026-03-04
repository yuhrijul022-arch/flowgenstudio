import { onCall, HttpsError } from "firebase-functions/https";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";

const db = getFirestore();

interface AdjustRequest {
    targetUid: string;
    deltaCredits: number;
    note?: string;
}

export const adminAdjustCredits = onCall(
    { region: "asia-southeast1", maxInstances: 5, timeoutSeconds: 15 },
    async (request) => {
        if (!request.auth) {
            throw new HttpsError("unauthenticated", "Sign in required.");
        }
        const callerUid = request.auth.uid;
        const data = request.data as AdjustRequest;

        // ── Validate input ─────────────────────────────────
        if (!data.targetUid || typeof data.targetUid !== "string") {
            throw new HttpsError("invalid-argument", "targetUid is required.");
        }
        const delta = Number(data.deltaCredits);
        if (!delta || delta === 0) {
            throw new HttpsError("invalid-argument", "deltaCredits must be non-zero.");
        }

        // ── Verify caller is admin ─────────────────────────
        const callerSnap = await db.collection("users").doc(callerUid).get();
        if (!callerSnap.exists || callerSnap.data()?.role !== "admin") {
            throw new HttpsError("permission-denied", "Admin access required.");
        }

        // ── Verify target user exists ──────────────────────
        const targetRef = db.collection("users").doc(data.targetUid);
        const targetSnap = await targetRef.get();
        if (!targetSnap.exists) {
            throw new HttpsError("not-found", "Target user not found.");
        }

        const now = Timestamp.now();
        const ledgerId = `adjust_${now.toMillis()}_${data.targetUid}`;
        const ledgerRef = targetRef.collection("ledger").doc(ledgerId);

        // ── Transaction: adjust credits ────────────────────
        await db.runTransaction(async (tx) => {
            // Idempotency check
            const ledgerSnap = await tx.get(ledgerRef);
            if (ledgerSnap.exists) {
                logger.warn("Idempotent skip: adjust ledger already exists", { ledgerId });
                return;
            }

            tx.update(targetRef, {
                credits: FieldValue.increment(delta),
                updatedAt: now,
            });

            tx.set(ledgerRef, {
                type: "ADJUST",
                amount: delta,
                jobId: null,
                createdAt: now,
                note: data.note || `Admin adjust by ${callerUid}`,
            });
        });

        logger.info("Admin credit adjustment", {
            callerUid,
            targetUid: data.targetUid,
            delta,
        });

        return { success: true, targetUid: data.targetUid, deltaCredits: delta };
    }
);
