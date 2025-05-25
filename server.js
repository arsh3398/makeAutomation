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

// Helper function to estimate text width (more accurate approximation)
function estimateTextWidth(text, fontSize, fontFamily = 'Arial') {
    // More accurate character width multipliers for common fonts
    const fontMultipliers = {
        'Arial': 0.52,
        'Helvetica': 0.52,
        'Times': 0.48,
        'Georgia': 0.51,
        'Courier': 0.6,
        'Verdana': 0.58,
        'Impact': 0.45,
        'Comic Sans MS': 0.55,
        'Roboto': 0.51,
        'Open Sans': 0.50
    };
    
    const multiplier = fontMultipliers[fontFamily] || 0.52;
    
    // Account for different character widths
    let adjustedLength = 0;
    for (let char of text) {
        if (char === ' ') adjustedLength += 0.3;
        else if ('iIl1'.includes(char)) adjustedLength += 0.4;
        else if ('mwMW'.includes(char)) adjustedLength += 1.2;
        else if ('fjtJ'.includes(char)) adjustedLength += 0.5;
        else adjustedLength += 1;
    }
    
    return adjustedLength * fontSize * multiplier;
}

// Helper function to wrap text to fit within image width
function wrapText(text, maxWidth, fontSize, fontFamily = 'Arial') {
    const words = text.split(' ');
    const lines = [];
    let currentLine = '';

    for (const word of words) {
        const testLine = currentLine ? `${currentLine} ${word}` : word;
        const testWidth = estimateTextWidth(testLine, fontSize, fontFamily);
        
        if (testWidth <= maxWidth) {
            currentLine = testLine;
        } else {
            if (currentLine) {
                lines.push(currentLine);
                currentLine = word;
            } else {
                // Single word is too long, break it up
                const chars = word.split('');
                let charLine = '';
                for (const char of chars) {
                    const testCharLine = charLine + char;
                    if (estimateTextWidth(testCharLine, fontSize, fontFamily) <= maxWidth) {
                        charLine = testCharLine;
                    } else {
                        if (charLine) lines.push(charLine);
                        charLine = char;
                    }
                }
                if (charLine) currentLine = charLine;
            }
        }
    }
    
    if (currentLine) {
        lines.push(currentLine);
    }
    
    return lines;
}

// Helper function to auto-adjust font size to fit text within image
function calculateOptimalFontSize(text, imageWidth, imageHeight, maxFontSize = 100, minFontSize = 12) {
    const maxTextWidth = imageWidth * 0.9; // 90% of image width for padding
    const maxTextHeight = imageHeight * 0.8; // 80% of image height for padding
    
    for (let fontSize = maxFontSize; fontSize >= minFontSize; fontSize -= 2) {
        const wrappedLines = wrapText(text, maxTextWidth, fontSize);
        const lineHeight = fontSize * 1.2;
        const totalTextHeight = wrappedLines.length * lineHeight;
        
        if (totalTextHeight <= maxTextHeight) {
            return { fontSize, wrappedLines };
        }
    }
    
    // If we can't fit even with minimum font size, use minimum and wrap anyway
    const wrappedLines = wrapText(text, maxTextWidth, minFontSize);
    return { fontSize: minFontSize, wrappedLines };
}

// Helper function to create SVG text overlay with auto-wrapping
function createTextSVG(text, options = {}) {
    const {
        fontSize = ,
        fontFamily = 'Arial',
        color = '#ffffff',
        textAlign = 'center',
        positionX = 50,
        positionY = 50,
        imageWidth = 800,
        imageHeight = 600,
        autoResize = true,
        maxFontSize = 100,
        minFontSize = 12
    } = options;

    const x = (imageWidth * positionX) / 100;
    const y = (imageHeight * positionY) / 100;
    
    let anchor = 'middle';
    if (textAlign === 'left') anchor = 'start';
    if (textAlign === 'right') anchor = 'end';

    let finalFontSize = fontSize;
    let lines = [];

    if (autoResize) {
        // Auto-calculate font size and wrap text
        const result = calculateOptimalFontSize(text, imageWidth, imageHeight, maxFontSize, minFontSize);
        finalFontSize = result.fontSize;
        lines = result.wrappedLines;
    } else {
        // Manual wrapping with specified font size
        const maxWidth = imageWidth * 0.9;
        lines = text.includes('\n') ? 
            text.split('\n').flatMap(line => wrapText(line, maxWidth, fontSize, fontFamily)) :
            wrapText(text, maxWidth, fontSize, fontFamily);
    }

    const lineHeight = finalFontSize * 1.2;
    const totalTextHeight = lines.length * lineHeight;
    const startY = y - (totalTextHeight / 2) + (lineHeight / 2);

    const textElements = lines.map((line, index) => 
        `<text x="${x}" y="${startY + (index * lineHeight)}" 
               font-family="${fontFamily}" 
               font-size="${finalFontSize}" 
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
            outputFormat = 'auto', // 'auto' means keep original format
            autoResize = true, // Auto-resize text to fit
            maxFontSize = 100,
            minFontSize = 12
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
            imageHeight: metadata.height,
            autoResize: autoResize !== 'false' && autoResize !== false,
            maxFontSize: parseInt(maxFontSize),
            minFontSize: parseInt(minFontSize)
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
            returnBase64 = false,
            autoResize = true,
            maxFontSize = 100,
            minFontSize = 12
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
            imageHeight: metadata.height,
            autoResize: autoResize !== 'false' && autoResize !== false,
            maxFontSize: parseInt(maxFontSize),
            minFontSize: parseInt(minFontSize)
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
                    fontSize: 'Number (optional, default: 32) - Font size in pixels (ignored if autoResize=true)',
                    fontFamily: 'String (optional, default: Arial) - Font family',
                    color: 'String (optional, default: #ffffff) - Text color in hex',
                    textAlign: 'String (optional, default: center) - Text alignment (left|center|right)',
                    positionX: 'Number (optional, default: 50) - Horizontal position (0-100%)',
                    positionY: 'Number (optional, default: 50) - Vertical position (0-100%)',
                    outputFormat: 'String (optional, default: auto) - Output format (auto|jpeg|png|webp|gif|tiff|avif|heif)',
                    autoResize: 'Boolean (optional, default: true) - Auto-resize text to fit image',
                    maxFontSize: 'Number (optional, default: 100) - Maximum font size when auto-resizing',
                    minFontSize: 'Number (optional, default: 12) - Minimum font size when auto-resizing'
                },
                response: 'Binary image data in specified format'
            },
            'POST /api/overlay-base64': {
                description: 'Add text overlay to base64 encoded image (supports multiple formats)',
                contentType: 'application/json',
                parameters: {
                    imageBase64: 'String (required) - Base64 encoded image (any supported format)',
                    text: 'String (required) - Text to overlay',
                    fontSize: 'Number (optional, default: 32) - Font size in pixels (ignored if autoResize=true)',
                    fontFamily: 'String (optional, default: Arial) - Font family',
                    color: 'String (optional, default: #ffffff) - Text color in hex',
                    textAlign: 'String (optional, default: center) - Text alignment (left|center|right)',
                    positionX: 'Number (optional, default: 50) - Horizontal position (0-100%)',
                    positionY: 'Number (optional, default: 50) - Vertical position (0-100%)',
                    outputFormat: 'String (optional, default: auto) - Output format (auto|jpeg|png|webp|gif|tiff|avif|heif)',
                    returnBase64: 'Boolean (optional, default: false) - Return base64 encoded result',
                    autoResize: 'Boolean (optional, default: true) - Auto-resize text to fit image',
                    maxFontSize: 'Number (optional, default: 100) - Maximum font size when auto-resizing',
                    minFontSize: 'Number (optional, default: 12) - Minimum font size when auto-resizing'
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
            curl_long_text_auto_resize: `curl -X POST http://localhost:3000/api/overlay \\
  -F "image=@/path/to/image.jpg" \\
  -F "text=This is a very long text that would normally get cut off but will now automatically wrap and resize to fit perfectly within the image boundaries" \\
  -F "autoResize=true" \\
  -F "maxFontSize=60" \\
  --output result.jpg`,
            curl_manual_font_no_resize: `curl -X POST http://localhost:3000/api/overlay \\
  -F "image=@/path/to/image.jpg" \\
  -F "text=Custom sized text with wrapping" \\
  -F "fontSize=24" \\
  -F "autoResize=false" \\
  --output result.jpg`,
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
            "autoResize=true automatically adjusts font size to fit text within image boundaries",
            "Text is automatically wrapped to fit within 90% of image width",
            "Long words are broken if they exceed the available width",
            "All formats support the same text overlay and wrapping features"
        ]
    });
});

app.listen(port, () => {
    console.log(`Image Overlay API running on port ${port}`);
    console.log(`API Documentation: http://localhost:${port}/api/docs`);
    console.log('Supported formats: JPEG, PNG, WebP, GIF, TIFF, BMP, AVIF, HEIC/HEIF');
});

module.exports = app;
