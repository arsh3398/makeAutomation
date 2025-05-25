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

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({ 
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

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
            outputFormat = 'png'
        } = req.body;

        if (!text) {
            return res.status(400).json({ error: 'Text is required' });
        }

        // Get image metadata
        const imageBuffer = req.file.buffer;
        const metadata = await sharp(imageBuffer).metadata();
        
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
        const outputBuffer = await sharp(imageBuffer)
            .composite([{
                input: Buffer.from(textSVG),
                top: 0,
                left: 0
            }])
            .png()
            .toBuffer();

        // Set response headers
        res.set({
            'Content-Type': `image/${outputFormat}`,
            'Content-Length': outputBuffer.length,
            'Content-Disposition': `attachment; filename="image-with-overlay.${outputFormat}"`
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
            outputFormat = 'png',
            returnBase64 = false
        } = req.body;

        if (!imageBase64) {
            return res.status(400).json({ error: 'imageBase64 is required' });
        }

        if (!text) {
            return res.status(400).json({ error: 'text is required' });
        }

        // Convert base64 to buffer
        const base64Data = imageBase64.replace(/^data:image\/[a-z]+;base64,/, '');
        const imageBuffer = Buffer.from(base64Data, 'base64');

        // Get image metadata
        const metadata = await sharp(imageBuffer).metadata();
        
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
        const outputBuffer = await sharp(imageBuffer)
            .composite([{
                input: Buffer.from(textSVG),
                top: 0,
                left: 0
            }])
            .png()
            .toBuffer();

        if (returnBase64) {
            // Return as base64 string
            const outputBase64 = `data:image/${outputFormat};base64,${outputBuffer.toString('base64')}`;
            res.json({ 
                success: true,
                imageBase64: outputBase64,
                size: outputBuffer.length
            });
        } else {
            // Return as binary
            res.set({
                'Content-Type': `image/${outputFormat}`,
                'Content-Length': outputBuffer.length,
                'Content-Disposition': `attachment; filename="image-with-overlay.${outputFormat}"`
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
        version: '1.0.0',
        endpoints: {
            'POST /api/overlay': {
                description: 'Add text overlay to uploaded image file',
                contentType: 'multipart/form-data',
                parameters: {
                    image: 'File (required) - Image file to overlay',
                    text: 'String (required) - Text to overlay',
                    fontSize: 'Number (optional, default: 32) - Font size in pixels',
                    fontFamily: 'String (optional, default: Arial) - Font family',
                    color: 'String (optional, default: #ffffff) - Text color in hex',
                    textAlign: 'String (optional, default: center) - Text alignment (left|center|right)',
                    positionX: 'Number (optional, default: 50) - Horizontal position (0-100%)',
                    positionY: 'Number (optional, default: 50) - Vertical position (0-100%)',
                    outputFormat: 'String (optional, default: png) - Output format'
                },
                response: 'Binary image data'
            },
            'POST /api/overlay-base64': {
                description: 'Add text overlay to base64 encoded image',
                contentType: 'application/json',
                parameters: {
                    imageBase64: 'String (required) - Base64 encoded image',
                    text: 'String (required) - Text to overlay',
                    fontSize: 'Number (optional, default: 32) - Font size in pixels',
                    fontFamily: 'String (optional, default: Arial) - Font family',
                    color: 'String (optional, default: #ffffff) - Text color in hex',
                    textAlign: 'String (optional, default: center) - Text alignment (left|center|right)',
                    positionX: 'Number (optional, default: 50) - Horizontal position (0-100%)',
                    positionY: 'Number (optional, default: 50) - Vertical position (0-100%)',
                    outputFormat: 'String (optional, default: png) - Output format',
                    returnBase64: 'Boolean (optional, default: false) - Return base64 encoded result'
                },
                response: 'Binary image data or JSON with base64 string'
            }
        },
        examples: {
            curl_file_upload: `curl -X POST http://localhost:3000/api/overlay \\
  -F "image=@/path/to/image.jpg" \\
  -F "text=Hello World" \\
  -F "fontSize=48" \\
  -F "color=#ff0000" \\
  -F "positionX=25" \\
  -F "positionY=75" \\
  --output result.png`,
            curl_base64: `curl -X POST http://localhost:3000/api/overlay-base64 \\
  -H "Content-Type: application/json" \\
  -d '{
    "imageBase64": "data:image/jpeg;base64,/9j/4AAQ...",
    "text": "Hello World",
    "fontSize": 48,
    "color": "#ff0000",
    "positionX": 25,
    "positionY": 75,
    "returnBase64": true
  }'`
        }
    });
});

app.listen(port, () => {
    console.log(`Image Overlay API running on port ${port}`);
    console.log(`API Documentation: http://localhost:${port}/api/docs`);
});

module.exports = app;