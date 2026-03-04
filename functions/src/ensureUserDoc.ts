import { onCall, HttpsError } from "firebase-functions/https";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";

const db = getFirestore();

interface UserProfileData {
    email?: string;
    displayName?: string;
    photoURL?: string;
}

export const ensureUserDoc = onCall(
    { region: "asia-southeast1", maxInstances: 10, timeoutSeconds: 10 },
    async (request) => {
        if (!request.auth) {
            throw new HttpsError("unauthenticated", "Sign in required.");
        }
        const uid = request.auth.uid;
        const data = (request.data || {}) as UserProfileData;
        const userRef = db.collection("users").doc(uid);
        const now = Timestamp.now();

        return await db.runTransaction(async (t) => {
            const userSnap = await t.get(userRef);

            if (userSnap.exists) {
                // User exists — update lastLoginAt + profile info, never overwrite credits
                t.update(userRef, {
                    lastLoginAt: FieldValue.serverTimestamp(),
                    ...(data.email ? { email: data.email } : {}),
                    ...(data.displayName ? { displayName: data.displayName } : {}),
                    ...(data.photoURL ? { photoURL: data.photoURL } : {}),
                    updatedAt: FieldValue.serverTimestamp(),
                });

                const freshData = userSnap.data()!;
                logger.info("Existing user login via transaction", { uid, credits: freshData.credits });
                return { created: false, credits: freshData.credits ?? 0 };
            }

            // First-time organic user: create with 0 credits and Free plan
            t.set(userRef, {
                uid,
                email: data.email || null,
                displayName: data.displayName || null,
                photoURL: data.photoURL || null,
                credits: 0,
                reservedCredits: 0,
                plan: "Free",
                role: "user",
                source: "organic",
                createdAt: now,
                updatedAt: now,
                lastLoginAt: now,
            });

            logger.info("New organic user doc created via transaction", { uid });
            return { created: true, credits: 0 };
        });
    }
);
