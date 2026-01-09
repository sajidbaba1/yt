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
app.use(cors({ origin: '*' })); // Allow all origins for the Vercel frontend
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

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
    tags: { type: DataTypes.TEXT }, // JSON string of tags
    hashtags: { type: DataTypes.TEXT }, // JSON string of hashtags
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

async function sendDiscordNotification(status, videoTitle, details = '') {
    const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
    if (!webhookUrl) return;

    const embeds = [{
        title: status === 'Success' ? '🚀 Video Uploaded!' : '❌ Upload Failed',
        color: status === 'Success' ? 2263842 : 15749300,
        fields: [
            { name: 'Video', value: videoTitle, inline: true },
            { name: 'Details', value: details || 'No extra details', inline: false }
        ],
        timestamp: new Date().toISOString()
    }];

    try {
        await axios.post(webhookUrl, { embeds });
    } catch (e) {
        console.error('Discord webhook error:', e.message);
    }
}

async function generateMetadata(filename) {
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
        const prompt = `Act as a viral YouTube growth expert. Analyze the filename: "${filename}". 
        Create:
        1. A high-CTR catchy title.
        2. A brief SEO-optimized description with a call to action.
        3. A list of 15 viral tags (comma-separated list).
        4. A list of 5 trending hashtags.
        Return ONLY valid JSON: 
        { 
          "title": "...", 
          "description": "...", 
          "tags": ["tag1", "tag2"], 
          "hashtags": ["#h1", "#h2"] 
        }`;

        const result = await model.generateContent(prompt);
        const text = result.response.text().replace(/```json|```/g, '').trim();
        const data = JSON.parse(text);
        return data;
    } catch (error) {
        console.error('Gemini error:', error);
        return {
            title: filename,
            description: "Uploaded via V-UPLOAD AI",
            tags: ["automation", "uploader"],
            hashtags: ["#VUpload", "#Automation"]
        };
    }
}

async function processUpload(fileId, title, description, thumbnailData, firstComment, tagsStr, hashtagsStr) {
    const tokens = await getStoredTokens();
    if (!tokens) throw new Error('No tokens found. Please connect Google account.');
    oauth2Client.setCredentials(tokens);

    const drive = google.drive({ version: 'v3', auth: oauth2Client });
    const youtube = google.youtube({ version: 'v3', auth: oauth2Client });

    let finalDescription = description || 'Uploaded via V-UPLOAD AI';
    let tags = [];
    try {
        if (tagsStr) tags = JSON.parse(tagsStr);
        if (hashtagsStr) {
            const hs = JSON.parse(hashtagsStr);
            finalDescription += '\n\n' + hs.join(' ');
        }
    } catch (e) {
        console.log("Tag parsing error, using defaults");
    }

    console.log(`[Drive] Starting download for fileId: ${fileId}`);
    const driveRes = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'stream' });

    console.log(`[YouTube] Starting upload for: ${title}`);
    const youtubeRes = await youtube.videos.insert({
        part: 'snippet,status',
        requestBody: {
            snippet: {
                title: (title || 'Untitled Video').substring(0, 100),
                description: finalDescription,
                tags: tags.slice(0, 50), // YT limit is usually 500 chars total, but 50 items
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

            console.log(`[YouTube] Comment successfully posted!`);
        } catch (commentError) {
            console.error('[YouTube] Comment Error:', commentError.message);
        }
    }

    return videoId;
}

// Routes
app.get('/api/auth/url', (req, res) => {
    const url = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: [
            'https://www.googleapis.com/auth/drive.readonly',
            'https://www.googleapis.com/auth/youtube.upload',
            'https://www.googleapis.com/auth/youtube.force-ssl'
        ],
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
        const { driveFileId, title, description, thumbnail, firstComment, tags, hashtags, scheduledTime } = req.body;
        const video = await Video.create({
            driveFileId, title, description, thumbnail, firstComment,
            tags: JSON.stringify(tags || []),
            hashtags: JSON.stringify(hashtags || []),
            scheduledTime
        });
        res.json(video);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/schedule/bulk', async (req, res) => {
    try {
        const { schedules } = req.body;
        const formattedSchedules = schedules.map(s => ({
            ...s,
            tags: JSON.stringify(s.tags || []),
            hashtags: JSON.stringify(s.hashtags || [])
        }));
        const videos = await Video.bulkCreate(formattedSchedules);
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
                    nextJob.firstComment,
                    nextJob.tags,
                    nextJob.hashtags
                );
                nextJob.status = 'Done';
                nextJob.youtubeId = ytId;
                nextJob.error = null;
                await sendDiscordNotification('Success', nextJob.title, `Live at: https://youtu.be/${ytId}`);
            } catch (e) {
                console.error('[Job Manager] Upload Error:', e);
                nextJob.status = 'Failed';
                nextJob.error = e.message;
                await sendDiscordNotification('Failed', nextJob.title, e.message);
            }
            await nextJob.save();
        }
    } catch (error) {
        console.error('Interval Loop Error:', error);
    }
}, 15000);



// Health Check for UptimeRobot (Keeps Render instance awake)
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'V-UPLOAD AI Backend is running', timestamp: new Date() });
});

app.listen(PORT, () => console.log(`Server running Port ${PORT}`));
