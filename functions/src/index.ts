import { initializeApp } from "firebase-admin/app";

// Inisialisasi Firebase Admin SDK dengan menyertakan bucket yang baru dibuat
initializeApp({
    storageBucket: "flowgen-studio.firebasestorage.app"
});

// ── Export all Cloud Functions ──────────────────────────
export { createJobAndReserveCredits } from "./createJobAndReserveCredits.js";
export { runGeneration } from "./runGeneration.js";
export { adminAdjustCredits } from "./adminAdjustCredits.js";
export { ensureUserDoc } from "./ensureUserDoc.js";
export { cleanupStuckJobs } from "./cleanupStuckJobs.js";
export { warmup } from "./warmup.js";
export { downloadImage } from "./downloadImage.js";
export { createOrderSnapToken, createTopupSnapToken, recreateSnapToken } from "./midtrans.js";
export { midtransWebhookFlowgen } from "./midtransWebhook.js";
