const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Configure multer for file uploads with broader file type acceptance
const storage = multer.memoryStorage();
const upload = multer({ 
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
    fileFilter: (req, file, cb) => {
        // Accept any image format that Sharp can handle
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

// Helper function to get appropriate Sharp format method
function getSharpFormat(format, metadata) {
    const normalizedFormat = format.toLowerCase();
    
    switch (normalizedFormat) {
        case 'jpg':
        case 'jpeg':
            return 'jpeg';
        case 'png':
            return 'png';
        case 'webp':
            return 'webp';
        case 'gif':
            return 'gif';
        case 'tiff':
        case 'tif':
            return 'tiff';
        case 'bmp':
            return 'png'; // Sharp doesn't have native BMP output, convert to PNG
        case 'avif':
            return 'avif';
        case 'heif':
        case 'heic':
            return 'heif';
        default:
            // If format not recognized, use original format or default to PNG
            if (metadata && metadata.format) {
                return metadata.format === 'jpeg' ? 'jpeg' : metadata.format;
            }
            return 'png';
    }
}

// Helper function to detect format from buffer
function detectImageFormat(buffer) {
    // Check magic bytes to determine format
    if (buffer[0] === 0xFF && buffer[1] === 0xD8) return 'jpeg';
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) return 'png';
    if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) return 'gif';
    if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46) return 'webp';
    if (buffer[0] === 0x42 && buffer[1] === 0x4D) return 'bmp';
    
    return null; // Unknown format, let Sharp auto-detect
}

// Helper function to create SVG text overlay
function createTextSVG(text, options = {}) {
    const {
        fontSize = 32,
        fontFamily = 'Arial',
        color = '#ffffff',
        textAlign = 'center',
        positionX = 50,
        positionY = 50,
        imageWidth = 800,
        imageHeight = 600
    } = options;

    const x = (imageWidth * positionX) / 100;
    const y = (imageHeight * positionY) / 100;
    
    let anchor = 'middle';
    if (textAlign === 'left') anchor = 'start';
    if (textAlign === 'right') anchor = 'end';

    // Handle multi-line text
    const lines = text.split('\n');
    const lineHeight = fontSize * 1.2;
    const startY = y - ((lines.length - 1) * lineHeight) / 2;

    const textElements = lines.map((line, index) => 
        `<text x="${x}" y="${startY + (index * lineHeight)}" 
               font-family="${fontFamily}" 
               font-size="${fontSize}" 
               fill="${color}" 
               text-anchor="${anchor}"
               dominant-baseline="middle"
               style="filter: drop-shadow(2px 2px 4px rgba(0,0,0,0.5));">
            ${line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}
        </text>`
    ).join('');

    return `<svg width="${imageWidth}" height="${imageHeight}" xmlns="http://www.w3.org/2000/svg">
        ${textElements}
    </svg>`;
}

// Helper function to apply Sharp format with appropriate options
function applySharpFormat(sharpInstance, format, metadata) {
    const sharpFormat = getSharpFormat(format, metadata);
    
    switch (sharpFormat) {
        case 'jpeg':
            return sharpInstance.jpeg({ quality: 90 });
        case 'png':
            return sharpInstance.png({ compressionLevel: 6 });
        case 'webp':
            return sharpInstance.webp({ quality: 90 });
        case 'gif':
            return sharpInstance.gif();
        case 'tiff':
            return sharpInstance.tiff({ compression: 'lzw' });
        case 'avif':
            return sharpInstance.avif({ quality: 90 });
        case 'heif':
            return sharpInstance.heif({ quality: 90 });
        default:
            return sharpInstance.png();
    }
}

// API endpoint for image overlay with file upload
app.post('/api/overlay', upload.single('image'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No image file provided' });
        }

        const {
            text = '',
            fontSize = 32,
            fontFamily = 'Arial',
            color = '#ffffff',
            textAlign = 'center',
            positionX = 50,
            positionY = 50,
            outputFormat = 'auto' // 'auto' means keep original format
        } = req.body;

        if (!text) {
            return res.status(400).json({ error: 'Text is required' });
        }

        // Get image metadata
        const imageBuffer = req.file.buffer;
        const metadata = await sharp(imageBuffer).metadata();
        
        // Determine output format
        let finalFormat = outputFormat;
        if (outputFormat === 'auto') {
            finalFormat = metadata.format || detectImageFormat(imageBuffer) || 'png';
        }

        // Create text overlay SVG
        const textSVG = createTextSVG(text, {
            fontSize: parseInt(fontSize),
            fontFamily,
            color,
            textAlign,
            positionX: parseInt(positionX),
            positionY: parseInt(positionY),
            imageWidth: metadata.width,
            imageHeight: metadata.height
        });

        // Composite image with text overlay and apply format
        let sharpInstance = sharp(imageBuffer)
            .composite([{
                input: Buffer.from(textSVG),
                top: 0,
                left: 0
            }]);

        // Apply the appropriate format
        sharpInstance = applySharpFormat(sharpInstance, finalFormat, metadata);
        const outputBuffer = await sharpInstance.toBuffer();

        // Set response headers
        res.set({
            'Content-Type': `image/${getSharpFormat(finalFormat, metadata)}`,
            'Content-Length': outputBuffer.length,
            'Content-Disposition': `attachment; filename="image-with-overlay.${getSharpFormat(finalFormat, metadata)}"`
        });

        res.send(outputBuffer);

    } catch (error) {
        console.error('Error processing image:', error);
        res.status(500).json({ error: 'Failed to process image', details: error.message });
    }
});

// API endpoint for image overlay with base64 input
app.post('/api/overlay-base64', async (req, res) => {
    try {
        const {
            imageBase64,
            text = '',
            fontSize = 32,
            fontFamily = 'Arial',
            color = '#ffffff',
            textAlign = 'center',
            positionX = 50,
            positionY = 50,
            outputFormat = 'auto',
            returnBase64 = false
        } = req.body;

        if (!imageBase64) {
            return res.status(400).json({ error: 'imageBase64 is required' });
        }

        if (!text) {
            return res.status(400).json({ error: 'text is required' });
        }

        // Extract format from base64 string if present
        let detectedFormat = null;
        const base64Match = imageBase64.match(/^data:image\/([a-zA-Z]+);base64,/);
        if (base64Match) {
            detectedFormat = base64Match[1];
        }

        // Convert base64 to buffer
        const base64Data = imageBase64.replace(/^data:image\/[a-z]+;base64,/, '');
        const imageBuffer = Buffer.from(base64Data, 'base64');

        // Get image metadata
        const metadata = await sharp(imageBuffer).metadata();
        
        // Determine output format
        let finalFormat = outputFormat;
        if (outputFormat === 'auto') {
            finalFormat = detectedFormat || metadata.format || detectImageFormat(imageBuffer) || 'png';
        }

        // Create text overlay SVG
        const textSVG = createTextSVG(text, {
            fontSize: parseInt(fontSize),
            fontFamily,
            color,
            textAlign,
            positionX: parseInt(positionX),
            positionY: parseInt(positionY),
            imageWidth: metadata.width,
            imageHeight: metadata.height
        });

        // Composite image with text overlay
        let sharpInstance = sharp(imageBuffer)
            .composite([{
                input: Buffer.from(textSVG),
                top: 0,
                left: 0
            }]);

        // Apply the appropriate format
        sharpInstance = applySharpFormat(sharpInstance, finalFormat, metadata);
        const outputBuffer = await sharpInstance.toBuffer();

        if (returnBase64) {
            // Return as base64 string
            const actualFormat = getSharpFormat(finalFormat, metadata);
            const outputBase64 = `data:image/${actualFormat};base64,${outputBuffer.toString('base64')}`;
            res.json({ 
                success: true,
                imageBase64: outputBase64,
                size: outputBuffer.length,
                format: actualFormat
            });
        } else {
            // Return as binary
            const actualFormat = getSharpFormat(finalFormat, metadata);
            res.set({
                'Content-Type': `image/${actualFormat}`,
                'Content-Length': outputBuffer.length,
                'Content-Disposition': `attachment; filename="image-with-overlay.${actualFormat}"`
            });
            res.send(outputBuffer);
        }

    } catch (error) {
        console.error('Error processing image:', error);
        res.status(500).json({ error: 'Failed to process image', details: error.message });
    }
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// API documentation endpoint
app.get('/api/docs', (req, res) => {
    res.json({
        title: 'Image Text Overlay API',
        version: '1.1.0',
        supportedFormats: [
            'JPEG/JPG', 'PNG', 'WebP', 'GIF', 'TIFF/TIF', 
            'BMP (output as PNG)', 'AVIF', 'HEIC/HEIF'
        ],
        endpoints: {
            'POST /api/overlay': {
                description: 'Add text overlay to uploaded image file (supports multiple formats)',
                contentType: 'multipart/form-data',
                parameters: {
                    image: 'File (required) - Image file to overlay (JPEG, PNG, WebP, GIF, TIFF, BMP, AVIF, HEIC)',
                    text: 'String (required) - Text to overlay',
                    fontSize: 'Number (optional, default: 32) - Font size in pixels',
                    fontFamily: 'String (optional, default: Arial) - Font family',
                    color: 'String (optional, default: #ffffff) - Text color in hex',
                    textAlign: 'String (optional, default: center) - Text alignment (left|center|right)',
                    positionX: 'Number (optional, default: 50) - Horizontal position (0-100%)',
                    positionY: 'Number (optional, default: 50) - Vertical position (0-100%)',
                    outputFormat: 'String (optional, default: auto) - Output format (auto|jpeg|png|webp|gif|tiff|avif|heif)'
                },
                response: 'Binary image data in specified format'
            },
            'POST /api/overlay-base64': {
                description: 'Add text overlay to base64 encoded image (supports multiple formats)',
                contentType: 'application/json',
                parameters: {
                    imageBase64: 'String (required) - Base64 encoded image (any supported format)',
                    text: 'String (required) - Text to overlay',
                    fontSize: 'Number (optional, default: 32) - Font size in pixels',
                    fontFamily: 'String (optional, default: Arial) - Font family',
                    color: 'String (optional, default: #ffffff) - Text color in hex',
                    textAlign: 'String (optional, default: center) - Text alignment (left|center|right)',
                    positionX: 'Number (optional, default: 50) - Horizontal position (0-100%)',
                    positionY: 'Number (optional, default: 50) - Vertical position (0-100%)',
                    outputFormat: 'String (optional, default: auto) - Output format (auto|jpeg|png|webp|gif|tiff|avif|heif)',
                    returnBase64: 'Boolean (optional, default: false) - Return base64 encoded result'
                },
                response: 'Binary image data or JSON with base64 string'
            }
        },
        examples: {
            curl_file_upload_webp: `curl -X POST http://localhost:3000/api/overlay \\
  -F "image=@/path/to/image.webp" \\
  -F "text=Hello World" \\
  -F "fontSize=48" \\
  -F "color=#ff0000" \\
  -F "outputFormat=webp" \\
  --output result.webp`,
            curl_jpeg_to_png: `curl -X POST http://localhost:3000/api/overlay \\
  -F "image=@/path/to/image.jpg" \\
  -F "text=Hello World" \\
  -F "outputFormat=png" \\
  --output result.png`,
            curl_base64_auto_format: `curl -X POST http://localhost:3000/api/overlay-base64 \\
  -H "Content-Type: application/json" \\
  -d '{
    "imageBase64": "data:image/webp;base64,UklGR...",
    "text": "Hello World",
    "fontSize": 48,
    "outputFormat": "auto",
    "returnBase64": true
  }'`
        },
        notes: [
            "When outputFormat is 'auto', the API preserves the original image format",
            "BMP files are converted to PNG for output (Sharp limitation)",
            "HEIC/HEIF support depends on Sharp compilation options",
            "All formats support the same text overlay features"
        ]
    });
});

app.listen(port, () => {
    console.log(`Image Overlay API running on port ${port}`);
    console.log(`API Documentation: http://localhost:${port}/api/docs`);
    console.log('Supported formats: JPEG, PNG, WebP, GIF, TIFF, BMP, AVIF, HEIC/HEIF');
});

module.exports = app;
