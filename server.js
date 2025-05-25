const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const cors = require('cors');
const fs = require('fs'); // Make sure fs is imported
const path = require('path'); // Make sure path is imported

const app = express();
const port = process.env.PORT || 3000;

// --- IMPORTANT: Configure Static File Serving ---
// This line makes the 'public_uploads' directory accessible publicly.
// The URL path will be like: http://your-domain.com/uploads/your-image.jpg
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

// Configure multer for file uploads directly to disk for public serving
// We'll use diskStorage for the /api/upload_public endpoint
const publicStorage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadsDir); // Save to the public_uploads directory
    },
    filename: function (req, file, cb) {
        // Create a unique filename (e.g., timestamp-original_filename)
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


// ... (Your existing helper functions: getSharpFormat, detectImageFormat, estimateTextWidth, wrapText, breakLongWord, calculateOptimalFontSize, createTextSVG, applySharpFormat) ...


// --- NEW: API endpoint to upload an image and get a public URL ---
app.post('/api/upload_public', publicUpload.single('image'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No image file provided' });
        }

        // The image is already saved to 'public_uploads' by multer.diskStorage
        const fileUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;

        res.json({
            success: true,
            message: 'Image uploaded publicly',
            filename: req.file.filename,
            fileUrl: fileUrl,
            size: req.file.size
        });

    } catch (error) {
        console.error('Error uploading image publicly:', error);
        res.status(500).json({ error: 'Failed to upload image publicly', details: error.message });
    }
});
// -----------------------------------------------------------------


// --- Modify your existing /api/overlay endpoint to save and return a public URL ---
// You would modify this endpoint to save the *processed* image to the public_uploads folder.
// For this, you'll need to use `fs.writeFileSync` after Sharp processing.
app.post('/api/overlay', upload.single('image'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No image file provided' });
        }

        const {
            text = '',
            fontSize = 32,
            fontFamily = 'Arial',
            fontWeight = 'normal',
            color = '#ffffff',
            textAlign = 'center',
            positionX = 50,
            positionY = 50,
            outputFormat = 'auto',
            autoResize = true,
            maxFontSize = 100,
            minFontSize = 12,
            paddingPercent = 10,
            lineHeightMultiplier = 1.3,
            shadowEnabled = true,
            shadowColor = 'rgba(0,0,0,0.7)',
            shadowBlur = 4,
            shadowOffset = 2,
            strokeEnabled = false,
            strokeColor = '#000000',
            strokeWidth = 1,
            savePublicly = false // Add this new parameter
        } = req.body;

        if (!text) {
            return res.status(400).json({ error: 'Text is required' });
        }

        const imageBuffer = req.file.buffer;
        const metadata = await sharp(imageBuffer).metadata();

        let finalFormat = outputFormat;
        if (outputFormat === 'auto') {
            finalFormat = metadata.format || detectImageFormat(imageBuffer) || 'png';
        }

        const textSVG = createTextSVG(text, {
            fontSize: parseInt(fontSize),
            fontFamily,
            fontWeight,
            color,
            textAlign,
            positionX: parseInt(positionX),
            positionY: parseInt(positionY),
            imageWidth: metadata.width,
            imageHeight: metadata.height,
            autoResize: autoResize !== 'false' && autoResize !== false,
            maxFontSize: parseInt(maxFontSize) || Math.min(metadata.width, metadata.height) * 0.15,
            minFontSize: parseInt(minFontSize) || Math.max(12, Math.min(metadata.width, metadata.height) * 0.02),
            paddingPercent: parseInt(paddingPercent),
            lineHeightMultiplier: parseFloat(lineHeightMultiplier),
            shadowEnabled: shadowEnabled !== 'false' && shadowEnabled !== false,
            shadowColor,
            shadowBlur: parseInt(shadowBlur),
            shadowOffset: parseInt(shadowOffset),
            strokeEnabled: strokeEnabled === 'true' || strokeEnabled === true,
            strokeColor,
            strokeWidth: parseInt(strokeWidth)
        });

        let sharpInstance = sharp(imageBuffer)
            .composite([{
                input: Buffer.from(textSVG),
                top: 0,
                left: 0
            }]);

        sharpInstance = applySharpFormat(sharpInstance, finalFormat, metadata);
        const outputBuffer = await sharpInstance.toBuffer();

        if (savePublicly === 'true' || savePublicly === true) {
            // Save the processed image to the public_uploads folder
            const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
            const outputFilename = `overlayed-image-${uniqueSuffix}.${getSharpFormat(finalFormat, metadata)}`;
            const outputPath = path.join(uploadsDir, outputFilename);
            fs.writeFileSync(outputPath, outputBuffer);

            const publicImageUrl = `${req.protocol}://${req.get('host')}/uploads/${outputFilename}`;
            return res.json({
                success: true,
                message: 'Image processed and saved publicly',
                filename: outputFilename,
                fileUrl: publicImageUrl,
                size: outputBuffer.length,
                format: getSharpFormat(finalFormat, metadata)
            });
        } else {
            // Original behavior: send as binary attachment
            res.set({
                'Content-Type': `image/${getSharpFormat(finalFormat, metadata)}`,
                'Content-Length': outputBuffer.length,
                'Content-Disposition': `attachment; filename="image-with-overlay.${getSharpFormat(finalFormat, metadata)}"`
            });
            res.send(outputBuffer);
        }

    } catch (error) {
        console.error('Error processing image:', error);
        res.status(500).json({ error: 'Failed to process image', details: error.message });
    }
});

// ... (Your existing /api/overlay-base64 endpoint - you can add savePublicly option here too) ...
// ... (Health check endpoint) ...
// ... (API documentation endpoint) ...

app.listen(port, () => {
    console.log(`Enhanced Image Overlay API running on port ${port}`);
    console.log(`API Documentation: http://localhost:${port}/api/docs`);
    console.log('✨ New features: Enhanced typography, smart sizing, better text layout');
});

module.exports = app;
