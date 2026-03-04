import { onRequest } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';

export const downloadImage = onRequest({ region: 'asia-southeast1', cors: true }, async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            res.status(401).send('Unauthorized');
            return;
        }

        const idToken = authHeader.split('Bearer ')[1];
        let decodedToken;
        try {
            decodedToken = await admin.auth().verifyIdToken(idToken);
            if (!decodedToken || !decodedToken.uid) throw new Error("Invalid token payload");
        } catch (error) {
            console.error('Error verifying auth token', error);
            res.status(401).send('Unauthorized');
            return;
        }

        const path = req.query.path as string;
        const name = req.query.name as string || 'download.png';

        if (!path || path.includes('..') || path.startsWith('/')) {
            res.status(400).send('Invalid path parameter');
            return;
        }

        const bucket = admin.storage().bucket();
        const file = bucket.file(path);

        const [exists] = await file.exists();
        if (!exists) {
            res.status(404).send('File not found');
            return;
        }

        const [metadata] = await file.getMetadata();

        res.set({
            'Content-Type': metadata.contentType || 'application/octet-stream',
            'Content-Disposition': `attachment; filename="${name}"`,
            'Cache-Control': 'private, max-age=0, no-store',
            'Access-Control-Allow-Origin': 'https://flowgen-studio.web.app',
            'Access-Control-Allow-Methods': 'GET',
            'Access-Control-Allow-Headers': 'Authorization',
        });

        // Handle preflight
        if (req.method === 'OPTIONS') {
            res.status(204).send('');
            return;
        }

        const readStream = file.createReadStream();
        readStream.on('error', (err) => {
            console.error('Stream error:', err);
            if (!res.headersSent) {
                res.status(500).send('Error reading file');
            }
        });

        readStream.pipe(res);

    } catch (err) {
        console.error('Error in downloadImage function:', err);
        res.status(500).send('Internal Server Error');
    }
});
