import express from 'express';
import { google } from 'googleapis';
import cors from 'cors';
import dotenv from 'dotenv';
import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Sequelize, DataTypes } from 'sequelize';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;

// Database Setup
const sequelize = new Sequelize(process.env.NEON_DATABASE_URL, {
    dialect: 'postgres',
    dialectOptions: {
        ssl: { require: true, rejectUnauthorized: false }
    },
    logging: false
});

const Video = sequelize.define('Video', {
    driveFileId: { type: DataTypes.STRING, allowNull: false },
    title: { type: DataTypes.STRING },
    description: { type: DataTypes.TEXT },
    thumbnail: { type: DataTypes.TEXT }, // Custom thumbnail URL or base64
    firstComment: { type: DataTypes.TEXT }, // The comment to post and pin
    scheduledTime: { type: DataTypes.DATE, allowNull: false },
    status: { type: DataTypes.STRING, defaultValue: 'Pending' },
    youtubeId: { type: DataTypes.STRING },
    error: { type: DataTypes.TEXT }
});

const Favorite = sequelize.define('Favorite', {
    driveFileId: { type: DataTypes.STRING, unique: true },
    name: { type: DataTypes.STRING },
    thumbnailLink: { type: DataTypes.TEXT }
});

const Setting = sequelize.define('Setting', {
    key: { type: DataTypes.STRING, unique: true },
    value: { type: DataTypes.TEXT }
});


async function initDB() {
    try {
        await sequelize.authenticate();
        await sequelize.sync({ alter: true });
        console.log('Database connected and synced');

        // Reset stuck uploads on startup
        const stuckJobs = await Video.update(
            { status: 'Pending', error: 'Server restarted during upload' },
            { where: { status: 'Uploading' } }
        );
        if (stuckJobs[0] > 0) console.log(`Reset ${stuckJobs[0]} stuck upload(s) to Pending`);
    } catch (err) {
        console.error('DB Sync Error:', err);
    }
}
initDB();

const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
);

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function getStoredTokens() {
    const s = await Setting.findOne({ where: { key: 'google_tokens' } });
    return s ? JSON.parse(s.value) : null;
}

async function saveTokens(tokens) {
    await Setting.upsert({ key: 'google_tokens', value: JSON.stringify(tokens) });
}

async function generateMetadata(filename) {
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
        const prompt = `Create a catchy YouTube title and a brief SEO-optimized description for a video named: "${filename}". Return only valid JSON: { "title": "...", "description": "..." }`;
        const result = await model.generateContent(prompt);
        const text = result.response.text().replace(/```json|```/g, '').trim();
        return JSON.parse(text);
    } catch (error) {
        console.error('Gemini error:', error);
        return { title: filename, description: "Uploaded via V-UPLOAD AI" };
    }
}

async function processUpload(fileId, title, description, thumbnailData, firstComment) {
    const tokens = await getStoredTokens();
    if (!tokens) throw new Error('No tokens found. Please connect Google account.');
    oauth2Client.setCredentials(tokens);

    const drive = google.drive({ version: 'v3', auth: oauth2Client });
    const youtube = google.youtube({ version: 'v3', auth: oauth2Client });

    console.log(`[Drive] Starting download for fileId: ${fileId}`);
    const driveRes = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'stream' });

    console.log(`[YouTube] Starting upload for: ${title}`);
    const youtubeRes = await youtube.videos.insert({
        part: 'snippet,status',
        requestBody: {
            snippet: {
                title: (title || 'Untitled Video').substring(0, 100),
                description: description || 'Uploaded via V-UPLOAD AI',
                categoryId: '22'
            },
            status: { privacyStatus: 'private' },
        },
        media: { body: driveRes.data },
    }, {
        // Increase timeout for large files
        onUploadProgress: (evt) => {
            const progress = (evt.bytesRead / 1024 / 1024).toFixed(2);
            console.log(`[YouTube] Upload Progress: ${progress} MB uploaded`);
        }
    });

    const videoId = youtubeRes.data.id;
    console.log(`[YouTube] Video uploaded! ID: ${videoId}`);

    // Handle Thumbnail if provided
    if (thumbnailData) {
        try {
            console.log(`[YouTube] Setting custom thumbnail for: ${videoId}`);
            const base64Data = thumbnailData.split(',')[1];
            if (base64Data) {
                const buffer = Buffer.from(base64Data, 'base64');
                await youtube.thumbnails.set({
                    videoId: videoId,
                    media: {
                        mimeType: 'image/jpeg',
                        body: buffer
                    }
                });
                console.log(`[YouTube] Custom thumbnail set for: ${videoId}`);
            }
        } catch (thumbError) {
            console.error('[YouTube] Thumbnail Set Error:', thumbError.message);
        }
    }

    // Handle First Comment and Pin
    if (firstComment) {
        try {
            console.log(`[YouTube] Posting first comment for: ${videoId}`);
            const commentRes = await youtube.commentThreads.insert({
                part: 'snippet',
                requestBody: {
                    snippet: {
                        videoId: videoId,
                        topLevelComment: {
                            snippet: { textOriginal: firstComment }
                        }
                    }
                }
            });

            const commentId = commentRes.data.snippet.topLevelComment.id;
            console.log(`[YouTube] Comment posted! ID: ${commentId}. Pinning...`);

            await youtube.comments.setManagementStatus({
                id: commentId,
                moderationStatus: 'published',
                banStatus: 'none',
                pin: true
            });
            console.log(`[YouTube] Comment successfully pinned!`);
        } catch (commentError) {
            console.error('[YouTube] Comment/Pin Error:', commentError.message);
        }
    }

    return videoId;
}

// Routes
app.get('/api/auth/url', (req, res) => {
    const url = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: ['https://www.googleapis.com/auth/drive.readonly', 'https://www.googleapis.com/auth/youtube.upload'],
        prompt: 'consent'
    });
    res.json({ url });
});

app.post('/api/auth/exchange', async (req, res) => {
    try {
        const { code } = req.body;
        const { tokens } = await oauth2Client.getToken(code);
        await saveTokens(tokens);
        res.json({ success: true });
    } catch (error) {
        console.error('Exchange error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/drive/videos', async (req, res) => {
    try {
        const tokens = await getStoredTokens();
        if (!tokens) return res.status(401).json({ error: 'Auth required' });
        oauth2Client.setCredentials(tokens);
        const drive = google.drive({ version: 'v3', auth: oauth2Client });
        const response = await drive.files.list({
            q: "mimeType contains 'video/'",
            fields: 'files(id, name, thumbnailLink, size)',
            orderBy: 'createdTime desc'
        });
        res.json(response.data.files);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/metadata/suggest', async (req, res) => {
    try {
        const metadata = await generateMetadata(req.query.filename);
        res.json(metadata);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/schedule', async (req, res) => {
    try {
        const videos = await Video.findAll({ order: [['scheduledTime', 'DESC']], limit: 50 });
        res.json(videos);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/schedule', async (req, res) => {
    try {
        const { driveFileId, title, description, thumbnail, firstComment, scheduledTime } = req.body;
        const video = await Video.create({ driveFileId, title, description, thumbnail, firstComment, scheduledTime });
        res.json(video);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/schedule/bulk', async (req, res) => {
    try {
        const { schedules } = req.body; // Array entries with firstComment
        const videos = await Video.bulkCreate(schedules);
        res.json(videos);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/favorites', async (req, res) => {
    try {
        const favorites = await Favorite.findAll();
        res.json(favorites);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/favorites', async (req, res) => {
    try {
        const { driveFileId, name, thumbnailLink } = req.body;
        const fav = await Favorite.create({ driveFileId, name, thumbnailLink });
        res.json(fav);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/favorites/:driveFileId', async (req, res) => {
    try {
        await Favorite.destroy({ where: { driveFileId: req.params.driveFileId } });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/schedule/:id', async (req, res) => {

    try {
        await Video.destroy({ where: { id: req.params.id, status: 'Pending' } });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Scheduling Loop
setInterval(async () => {
    try {
        // Check if any job is currently uploading
        const activeJob = await Video.findOne({ where: { status: 'Uploading' } });
        if (activeJob) return;

        const nextJob = await Video.findOne({
            where: {
                status: 'Pending',
                scheduledTime: { [Sequelize.Op.lte]: new Date() }
            },
            order: [['scheduledTime', 'ASC']]
        });

        if (nextJob) {
            console.log(`[Job Manager] Picked job: ${nextJob.title} (${nextJob.id})`);
            nextJob.status = 'Uploading';
            await nextJob.save();

            try {
                const ytId = await processUpload(
                    nextJob.driveFileId,
                    nextJob.title,
                    nextJob.description,
                    nextJob.thumbnail,
                    nextJob.firstComment
                );
                nextJob.status = 'Done';
                nextJob.youtubeId = ytId;
                nextJob.error = null;
            } catch (e) {
                console.error('[Job Manager] Upload Error:', e);
                nextJob.status = 'Failed';
                nextJob.error = e.message;
            }
            await nextJob.save();
        }
    } catch (error) {
        console.error('Interval Loop Error:', error);
    }
}, 15000);



app.listen(PORT, () => console.log(`Server running Port ${PORT}`));
