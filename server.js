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

// Improved text width estimation with better font metrics
function estimateTextWidth(text, fontSize, fontFamily = 'Arial', fontWeight = 'normal') {
    // More accurate character width multipliers for common fonts
    const fontMetrics = {
        'Arial': { normal: 0.52, bold: 0.58 },
        'Helvetica': { normal: 0.52, bold: 0.58 },
        'Times': { normal: 0.48, bold: 0.54 },
        'Times New Roman': { normal: 0.48, bold: 0.54 },
        'Georgia': { normal: 0.51, bold: 0.57 },
        'Courier': { normal: 0.6, bold: 0.6 },
        'Courier New': { normal: 0.6, bold: 0.6 },
        'Verdana': { normal: 0.58, bold: 0.64 },
        'Impact': { normal: 0.48, bold: 0.48 },
        'Comic Sans MS': { normal: 0.55, bold: 0.61 }
    };
    
    const metrics = fontMetrics[fontFamily] || { normal: 0.52, bold: 0.58 };
    const weightMultiplier = fontWeight === 'bold' ? metrics.bold : metrics.normal;
    
    // Account for character variations
    let totalWidth = 0;
    for (const char of text) {
        let charMultiplier = weightMultiplier;
        
        // Adjust for specific characters
        if ('iIl1'.includes(char)) charMultiplier *= 0.4;
        else if ('fjtJ'.includes(char)) charMultiplier *= 0.5;
        else if ('rF'.includes(char)) charMultiplier *= 0.65;
        else if ('mwMW'.includes(char)) charMultiplier *= 1.5;
        else if (' '.includes(char)) charMultiplier *= 0.3;
        else if ('.,;:!|'.includes(char)) charMultiplier *= 0.35;
        
        totalWidth += fontSize * charMultiplier;
    }
    
    return totalWidth;
}

// Improved text wrapping with better word breaking
function wrapText(text, maxWidth, fontSize, fontFamily = 'Arial', fontWeight = 'normal') {
    // Handle explicit line breaks first
    const paragraphs = text.split('\n');
    const allLines = [];
    
    for (const paragraph of paragraphs) {
        if (!paragraph.trim()) {
            allLines.push(''); // Preserve empty lines
            continue;
        }
        
        const words = paragraph.split(/\s+/);
        const lines = [];
        let currentLine = '';

        for (const word of words) {
            const testLine = currentLine ? `${currentLine} ${word}` : word;
            const testWidth = estimateTextWidth(testLine, fontSize, fontFamily, fontWeight);
            
            if (testWidth <= maxWidth) {
                currentLine = testLine;
            } else {
                if (currentLine) {
                    lines.push(currentLine);
                    currentLine = word;
                    
                    // Check if single word is still too long
                    if (estimateTextWidth(word, fontSize, fontFamily, fontWeight) > maxWidth) {
                        // Break long word with hyphen
                        const brokenWords = breakLongWord(word, maxWidth, fontSize, fontFamily, fontWeight);
                        if (brokenWords.length > 1) {
                            lines.push(brokenWords[0]);
                            currentLine = brokenWords.slice(1).join(' ');
                        } else {
                            currentLine = word; // Keep as is if can't break
                        }
                    }
                } else {
                    // Single word is too long, try to break it
                    const brokenWords = breakLongWord(word, maxWidth, fontSize, fontFamily, fontWeight);
                    lines.push(...brokenWords.slice(0, -1));
                    currentLine = brokenWords[brokenWords.length - 1];
                }
            }
        }
        
        if (currentLine) {
            lines.push(currentLine);
        }
        
        allLines.push(...lines);
    }
    
    return allLines;
}

// Helper function to break long words intelligently
function breakLongWord(word, maxWidth, fontSize, fontFamily, fontWeight) {
    const wordWidth = estimateTextWidth(word, fontSize, fontFamily, fontWeight);
    if (wordWidth <= maxWidth) return [word];
    
    const parts = [];
    let currentPart = '';
    
    for (let i = 0; i < word.length; i++) {
        const char = word[i];
        const testPart = currentPart + char;
        const testWidth = estimateTextWidth(testPart + '-', fontSize, fontFamily, fontWeight);
        
        if (testWidth <= maxWidth && i < word.length - 1) {
            currentPart = testPart;
        } else {
            if (currentPart) {
                parts.push(currentPart + '-');
                currentPart = char;
            } else {
                // Even single character is too wide, just add it
                parts.push(char);
                currentPart = '';
            }
        }
    }
    
    if (currentPart) {
        parts.push(currentPart);
    }
    
    return parts;
}

// Enhanced function to calculate optimal font size with better constraints
function calculateOptimalFontSize(text, imageWidth, imageHeight, options = {}) {
    const {
        maxFontSize = Math.min(imageWidth, imageHeight) * 0.15, // More reasonable max based on image size
        minFontSize = Math.max(12, Math.min(imageWidth, imageHeight) * 0.02), // Scale min with image
        fontFamily = 'Arial',
        fontWeight = 'normal',
        paddingPercent = 10, // Padding as percentage
        lineHeightMultiplier = 1.3,
        maxLines = 10 // Prevent too many lines
    } = options;
    
    const padding = Math.min(imageWidth, imageHeight) * (paddingPercent / 100);
    const maxTextWidth = imageWidth - (padding * 2);
    const maxTextHeight = imageHeight - (padding * 2);
    
    // Binary search for optimal font size
    let low = minFontSize;
    let high = maxFontSize;
    let bestResult = null;
    
    while (high - low > 1) {
        const fontSize = Math.round((low + high) / 2);
        const lineHeight = fontSize * lineHeightMultiplier;
        const wrappedLines = wrapText(text, maxTextWidth, fontSize, fontFamily, fontWeight);
        const totalTextHeight = wrappedLines.length * lineHeight;
        
        if (totalTextHeight <= maxTextHeight && wrappedLines.length <= maxLines) {
            bestResult = { fontSize, wrappedLines, lineHeight };
            low = fontSize;
        } else {
            high = fontSize - 1;
        }
    }
    
    // If binary search didn't find a result, try the minimum
    if (!bestResult) {
        const fontSize = minFontSize;
        const lineHeight = fontSize * lineHeightMultiplier;
        const wrappedLines = wrapText(text, maxTextWidth, fontSize, fontFamily, fontWeight);
        bestResult = { fontSize, wrappedLines, lineHeight };
    }
    
    return bestResult;
}

// Enhanced SVG text creation with better positioning and styling
function createTextSVG(text, options = {}) {
    const {
        fontSize = 32,
        fontFamily = 'Arial',
        fontWeight = 'normal',
        color = '#ffffff',
        textAlign = 'center',
        positionX = 50,
        positionY = 50,
        imageWidth = 800,
        imageHeight = 600,
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
        strokeWidth = 1
    } = options;

    let finalFontSize = fontSize;
    let lines = [];
    let lineHeight = fontSize * lineHeightMultiplier;

    if (autoResize) {
        // Auto-calculate font size and wrap text
        const result = calculateOptimalFontSize(text, imageWidth, imageHeight, {
            maxFontSize,
            minFontSize,
            fontFamily,
            fontWeight,
            paddingPercent,
            lineHeightMultiplier
        });
        finalFontSize = result.fontSize;
        lines = result.wrappedLines;
        lineHeight = result.lineHeight;
    } else {
        // Manual wrapping with specified font size
        const padding = Math.min(imageWidth, imageHeight) * (paddingPercent / 100);
        const maxWidth = imageWidth - (padding * 2);
        lines = wrapText(text, maxWidth, fontSize, fontFamily, fontWeight);
        lineHeight = fontSize * lineHeightMultiplier;
    }

    // Calculate text positioning
    const totalTextHeight = lines.length * lineHeight;
    let x, y, anchor;
    
    // Handle horizontal alignment
    switch (textAlign) {
        case 'left':
            anchor = 'start';
            x = imageWidth * (paddingPercent / 100);
            break;
        case 'right':
            anchor = 'end';
            x = imageWidth - (imageWidth * (paddingPercent / 100));
            break;
        default: // center
            anchor = 'middle';
            x = (imageWidth * positionX) / 100;
    }
    
    // Handle vertical positioning
    if (positionY <= 25) {
        // Top alignment
        y = (imageHeight * (paddingPercent / 100)) + lineHeight;
    } else if (positionY >= 75) {
        // Bottom alignment
        y = imageHeight - (imageHeight * (paddingPercent / 100)) - totalTextHeight + lineHeight;
    } else {
        // Center alignment
        y = ((imageHeight * positionY) / 100) - (totalTextHeight / 2) + lineHeight;
    }

    // Create text styling
    let textStyle = `font-family="${fontFamily}" font-size="${finalFontSize}" font-weight="${fontWeight}" fill="${color}" text-anchor="${anchor}" dominant-baseline="middle"`;
    
    if (shadowEnabled) {
        textStyle += ` style="filter: drop-shadow(${shadowOffset}px ${shadowOffset}px ${shadowBlur}px ${shadowColor});"`;
    }
    
    if (strokeEnabled) {
        textStyle += ` stroke="${strokeColor}" stroke-width="${strokeWidth}"`;
    }

    // Generate text elements
    const textElements = lines.map((line, index) => {
        const lineY = y + (index * lineHeight);
        const escapedLine = line
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
            
        return `<text x="${x}" y="${lineY}" ${textStyle}>${escapedLine}</text>`;
    }).join('');

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
            strokeWidth = 1
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
            finalFormat = metadata.format || detectImageFormat(imageBuffer) || 'jpg';
        }

        // Create text overlay SVG with enhanced options
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
            fontWeight = 'normal',
            color = '#ffffff',
            textAlign = 'center',
            positionX = 50,
            positionY = 50,
            outputFormat = 'auto',
            returnBase64 = false,
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
            strokeWidth = 1
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
            finalFormat = detectedFormat || metadata.format || detectImageFormat(imageBuffer) || 'jpg';
        }

        // Create text overlay SVG with enhanced options
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

// Enhanced API documentation endpoint
app.get('/api/docs', (req, res) => {
    res.json({
        title: 'Enhanced Image Text Overlay API',
        version: '2.0.0',
        supportedFormats: [
            'JPEG/JPG', 'PNG', 'WebP', 'GIF', 'TIFF/TIF', 
            'BMP (output as PNG)', 'AVIF', 'HEIC/HEIF'
        ],
        endpoints: {
            'POST /api/overlay': {
                description: 'Add text overlay to uploaded image file with enhanced typography',
                contentType: 'multipart/form-data',
                parameters: {
                    image: 'File (required) - Image file to overlay',
                    text: 'String (required) - Text to overlay (supports \\n for line breaks)',
                    fontSize: 'Number (optional, default: 32) - Base font size in pixels',
                    fontFamily: 'String (optional, default: Arial) - Font family',
                    fontWeight: 'String (optional, default: normal) - Font weight (normal|bold)',
                    color: 'String (optional, default: #ffffff) - Text color in hex',
                    textAlign: 'String (optional, default: center) - Text alignment (left|center|right)',
                    positionX: 'Number (optional, default: 50) - Horizontal position (0-100%)',
                    positionY: 'Number (optional, default: 50) - Vertical position (0-100%)',
                    outputFormat: 'String (optional, default: auto) - Output format',
                    autoResize: 'Boolean (optional, default: true) - Auto-resize text to fit image',
                    maxFontSize: 'Number (optional, auto-calculated) - Maximum font size',
                    minFontSize: 'Number (optional, auto-calculated) - Minimum font size',
                    paddingPercent: 'Number (optional, default: 10) - Padding as percentage of image size',
                    lineHeightMultiplier: 'Number (optional, default: 1.3) - Line height multiplier',
                    shadowEnabled: 'Boolean (optional, default: true) - Enable text shadow',
                    shadowColor: 'String (optional, default: rgba(0,0,0,0.7)) - Shadow color',
                    shadowBlur: 'Number (optional, default: 4) - Shadow blur radius',
                    shadowOffset: 'Number (optional, default: 2) - Shadow offset distance',
                    strokeEnabled: 'Boolean (optional, default: false) - Enable text stroke',
                    strokeColor: 'String (optional, default: #000000) - Stroke color',
                    strokeWidth: 'Number (optional, default: 1) - Stroke width'
                },
                response: 'Binary image data in specified format'
            },
            'POST /api/overlay-base64': {
                description: 'Add text overlay to base64 encoded image with enhanced typography',
                contentType: 'application/json',
                parameters: '(Same as /api/overlay but with imageBase64 and returnBase64 options)'
            }
        },
        improvements: [
            "✅ Dynamic font sizing based on image dimensions",
            "✅ Improved text wrapping with intelligent word breaking",
            "✅ Better character width estimation for accurate layout",
            "✅ Support for explicit line breaks (\\n)",
            "✅ Smarter positioning (top, center, bottom alignment)",
            "✅ Enhanced typography options (font weight, shadows, strokes)",
            "✅ Configurable padding and line height",
            "✅ Binary search algorithm for optimal font size",
            "✅ Prevention of text overflow and poor layout"
        ],
        examples: {
            improved_auto_sizing: `curl -X POST http://localhost:3000/api/overlay \\
  -F "image=@/path/to/image.jpg" \\
  -F "text=This long text will automatically size and wrap perfectly within the image boundaries without any overflow issues" \\
  -F "autoResize=true" \\
  -F "paddingPercent=15" \\
  --output result.jpg`,
            custom_typography: `curl -X POST http://localhost:3000/api/overlay \\
  -F "image=@/path/to/image.jpg" \\
  -F "text=BOLD HEADLINE" \\
  -F "fontWeight=bold" \\
  -F "shadowEnabled=true" \\
  -F "strokeEnabled=true" \\
  -F "strokeColor=#000000" \\
  --output result.jpg`
        }
    });
});

app.listen(port, () => {
    console.log(`Enhanced Image Overlay API running on port ${port}`);
    console.log(`API Documentation: http://localhost:${port}/api/docs`);
    console.log('✨ New features: Enhanced typography, smart sizing, better text layout');
});

module.exports = app;
