import { onCall, HttpsError } from "firebase-functions/https";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";

const db = getFirestore();

interface ReserveRequest {
  qty: number;
  ratio: string;
  preset?: string;
  customPrompt?: string;
  compositionMode: string;
}

export const createJobAndReserveCredits = onCall(
  { region: "asia-southeast1", maxInstances: 10, timeoutSeconds: 30 },
  async (request) => {
    // ── Auth check ─────────────────────────────────────
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Sign in required.");
    }
    const uid = request.auth.uid;
    const data = request.data as ReserveRequest;

    // ── Input validation ───────────────────────────────
    const qty = Number(data.qty);
    if (!qty || qty < 1 || qty > 10) {
      throw new HttpsError("invalid-argument", "qty must be 1–10.");
    }

    const userRef = db.collection("users").doc(uid);

    // ── Rate limit: max 2 active jobs ──────────────────
    const activeJobsSnap = await db
      .collection("jobs")
      .where("uid", "==", uid)
      .where("status", "in", ["QUEUED", "RUNNING"])
      .get();

    if (activeJobsSnap.size >= 2) {
      throw new HttpsError(
        "resource-exhausted",
        "Max 2 active jobs. Please wait for current jobs to finish."
      );
    }

    // ── Generate deterministic jobId ────────────────────
    const jobRef = db.collection("jobs").doc(); // auto-id
    const jobId = jobRef.id;
    const ledgerId = `reserve_${jobId}`;
    const ledgerRef = userRef.collection("ledger").doc(ledgerId);

    // ── Firestore Transaction ──────────────────────────
    await db.runTransaction(async (tx) => {
      const userSnap = await tx.get(userRef);

      if (!userSnap.exists) {
        throw new HttpsError("not-found", "User profile not found. Please sign in again.");
      }

      const userData = userSnap.data()!;
      const credits = userData.credits ?? 0;
      const reservedCredits = userData.reservedCredits ?? 0;
      const available = credits - reservedCredits;

      if (available < qty) {
        throw new HttpsError(
          "failed-precondition",
          `Insufficient credits. Available: ${available}, required: ${qty}.`
        );
      }

      // ── Idempotency: if ledger entry exists, skip ────
      const ledgerSnap = await tx.get(ledgerRef);
      if (ledgerSnap.exists) {
        logger.warn(`Idempotent skip: reserve ledger ${ledgerId} already exists`, { jobId, uid });
        return;
      }

      const now = Timestamp.now();

      // Reserve credits
      tx.update(userRef, {
        reservedCredits: FieldValue.increment(qty),
        updatedAt: now,
      });

      // Create job document
      tx.set(jobRef, {
        uid,
        status: "QUEUED",
        qty,
        ratio: data.ratio || "1:1",
        preset: data.preset || null,
        customPrompt: data.customPrompt || null,
        compositionMode: data.compositionMode || "batch",
        // productImages and referenceImage are explicitly excluded to avoid 1MB Firestore limit
        outputs: [],
        successCount: 0,
        failedCount: 0,
        error: null,
        createdAt: now,
        updatedAt: now,
        timings: null,
      });

      // Ledger entry
      tx.set(ledgerRef, {
        type: "RESERVE",
        amount: qty,
        jobId,
        createdAt: now,
        note: null,
      });
    });

    logger.info("Job reserved", { jobId, uid, qty });
    return { jobId };
  }
);
