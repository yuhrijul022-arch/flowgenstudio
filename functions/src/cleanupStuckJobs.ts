import { onSchedule } from "firebase-functions/scheduler";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";

const db = getFirestore();

// Timeout threshold: 10 minutes
const TIMEOUT_MS = 10 * 60 * 1000;

export const cleanupStuckJobs = onSchedule(
    { region: "asia-southeast1", schedule: "every 5 minutes", timeoutSeconds: 60, maxInstances: 1 },
    async () => {
        const cutoff = Timestamp.fromMillis(Date.now() - TIMEOUT_MS);

        // Find stuck RUNNING jobs older than cutoff
        const stuckJobsSnap = await db
            .collection("jobs")
            .where("status", "==", "RUNNING")
            .where("updatedAt", "<", cutoff)
            .get();

        if (stuckJobsSnap.empty) {
            logger.info("No stuck jobs found.");
            return;
        }

        logger.warn(`Found ${stuckJobsSnap.size} stuck jobs. Cleaning up...`);

        for (const jobDoc of stuckJobsSnap.docs) {
            const job = jobDoc.data();
            const jobId = jobDoc.id;
            const uid = job.uid as string;
            const qty = job.qty as number;
            const successCount = (job.successCount as number) || 0;
            const refundAmount = qty - successCount;

            if (refundAmount <= 0) {
                // Already captured, just mark as failed
                await jobDoc.ref.update({
                    status: "FAILED_TIMEOUT",
                    error: "Job timed out after 10 minutes.",
                    updatedAt: Timestamp.now(),
                });
                continue;
            }

            const userRef = db.collection("users").doc(uid);
            const refundLedgerId = `refund_${jobId}`;
            const refundRef = userRef.collection("ledger").doc(refundLedgerId);
            const now = Timestamp.now();

            try {
                await db.runTransaction(async (tx) => {
                    // Idempotency
                    const ledgerSnap = await tx.get(refundRef);
                    if (ledgerSnap.exists) {
                        logger.warn(`Refund already exists for stuck job ${jobId}, skipping`);
                        // Still update job status
                        tx.update(jobDoc.ref, {
                            status: "FAILED_TIMEOUT",
                            error: "Job timed out after 10 minutes.",
                            updatedAt: now,
                        });
                        return;
                    }

                    // Release reserved credits
                    tx.update(userRef, {
                        reservedCredits: FieldValue.increment(-qty),
                        updatedAt: now,
                    });

                    // Refund ledger
                    tx.set(refundRef, {
                        type: "REFUND",
                        amount: refundAmount,
                        jobId,
                        createdAt: now,
                        note: "Automatic refund: job timed out after 10 minutes.",
                    });

                    // Mark job failed
                    tx.update(jobDoc.ref, {
                        status: "FAILED_TIMEOUT",
                        failedCount: refundAmount,
                        error: "Job timed out after 10 minutes.",
                        updatedAt: now,
                    });
                });

                logger.info(`Cleaned up stuck job ${jobId}, refunded ${refundAmount} credits`);
            } catch (err: any) {
                logger.error(`Failed to cleanup job ${jobId}`, { error: err.message });
            }
        }
    }
);
