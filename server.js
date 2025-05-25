const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

// --- IMPORTANT: Configure Static File Serving ---
app.use('/uploads', express.static(path.join(__dirname, 'public_uploads')));
// --------------------------------------------------

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Ensure the public_uploads directory exists
const uploadsDir = path.join(__dirname, 'public_uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir);
}

// ----------------------------------------------------------------------
// --- DEFINE MULTER INSTANCES HERE, BEFORE ANY ROUTES USE THEM ---
// ----------------------------------------------------------------------

// 1. Configure multer for in-memory file uploads (used by /api/overlay and /api/overlay-base64)
const storage = multer.memoryStorage();
const upload = multer({
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
    fileFilter: (req, file, cb) => {
        const allowedMimes = [
            'image/jpeg', 'image/jpg', 'image/png', 'image/gif',
            'image/webp', 'image/tiff', 'image/tif', 'image/bmp',
            'image/svg+xml', 'image/heic', 'image/heif', 'image/avif'
        ];
        if (allowedMimes.includes(file.mimetype) || file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Only image files are allowed'), false);
        }
    }
});

// 2. Configure multer for disk storage file uploads (used by /api/upload_public)
const publicStorage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadsDir); // Save to the public_uploads directory
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const originalExtension = path.extname(file.originalname);
        cb(null, file.fieldname + '-' + uniqueSuffix + originalExtension);
    }
});
const publicUpload = multer({
    storage: publicStorage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
    fileFilter: (req, file, cb) => {
        const allowedMimes = [
            'image/jpeg', 'image/jpg', 'image/png', 'image/gif',
            'image/webp', 'image/tiff', 'image/tif', 'image/bmp',
            'image/svg+xml', 'image/heic', 'image/heif', 'image/avif'
        ];
        if (allowedMimes.includes(file.mimetype) || file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Only image files are allowed'), false);
        }
    }
});

// ----------------------------------------------------------------------
// --- Now your API routes can be defined ---
// ----------------------------------------------------------------------

// Helper function to get appropriate Sharp format method (keep all your helpers here)
function getSharpFormat(format, metadata) { /* ... */ }
function detectImageFormat(buffer) { /* ... */ }
function estimateTextWidth(text, fontSize, fontFamily = 'Arial', fontWeight = 'normal') { /* ... */ }
function wrapText(text, maxWidth, fontSize, fontFamily = 'Arial', fontWeight = 'normal') { /* ... */ }
function breakLongWord(word, maxWidth, fontSize, fontFamily, fontWeight) { /* ... */ }
function calculateOptimalFontSize(text, imageWidth, imageHeight, options = {}) { /* ... */ }
function createTextSVG(text, options = {}) { /* ... */ }
function applySharpFormat(sharpInstance, format, metadata) { /* ... */ }


// API endpoint for image overlay with file upload
app.post('/api/overlay', upload.single('image'), async (req, res) => {
    // ... your existing /api/overlay logic ...
});

// NEW: API endpoint to upload an image and get a public URL
app.post('/api/upload_public', publicUpload.single('image'), async (req, res) => {
    // ... your /api/upload_public logic ...
});

// API endpoint for image overlay with base64 input
app.post('/api/overlay-base64', async (req, res) => {
    // ... your /api/overlay-base64 logic ...
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Enhanced API documentation endpoint
app.get('/api/docs', (req, res) => {
    // ... your /api/docs logic ...
});

app.listen(port, () => {
    console.log(`Enhanced Image Overlay API running on port ${port}`);
    console.log(`API Documentation: http://localhost:${port}/api/docs`);
    console.log('✨ New features: Enhanced typography, smart sizing, better text layout');
});

module.exports = app;
