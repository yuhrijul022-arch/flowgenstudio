import { onRequest } from "firebase-functions/v2/https";

export const warmup = onRequest(
    { region: "asia-southeast1", maxInstances: 5, timeoutSeconds: 5 },
    (request, response) => {
        // Set CORS headers so frontend can call it if needed
        response.set("Access-Control-Allow-Origin", "*");
        response.set("Access-Control-Allow-Methods", "GET");

        response.status(200).json({ status: "warm", message: "Successfully warmed up" });
    }
);
