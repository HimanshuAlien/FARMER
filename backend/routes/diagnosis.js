const express = require('express');
const router = express.Router();
const multer = require('multer');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs-extra');
const auth = require('../middleware/auth');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Configure multer for image upload
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadPath = path.join(__dirname, '../uploads/crop-images');
        fs.ensureDirSync(uploadPath);
        cb(null, uploadPath);
    },
    filename: (req, file, cb) => {
        const uniqueName = `crop-${Date.now()}-${Math.round(Math.random() * 1E9)}${path.extname(file.originalname)}`;
        cb(null, uniqueName);
    }
});

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB limit
    },
    fileFilter: (req, file, cb) => {
        const allowedMimes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
        if (allowedMimes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Only JPEG, PNG, and WebP images are allowed'));
        }
    }
});

// AI-powered crop analysis using Gemini Vision
async function analyzeCropImage(imagePath) {
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

        // Read and process image
        const imageBuffer = await fs.readFile(imagePath);
        const processedImage = await sharp(imageBuffer)
            .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: 90 })
            .toBuffer();

        // Convert to base64
        const base64Image = processedImage.toString('base64');

        // Create the analysis prompt
        const prompt = `You are an expert agricultural pathologist specializing in crop diseases and plant health analysis. Analyze this crop/plant image and provide a detailed diagnosis.

Please provide:

1. **Plant/Crop Identification**: What type of plant/crop is this?

2. **Health Status**: Is the plant healthy or showing signs of disease/stress?

3. **Disease/Problem Identification**: If there are issues, identify:
   - Disease name (if applicable)
   - Pest infestation (if applicable)
   - Nutrient deficiencies (if applicable)
   - Environmental stress factors

4. **Symptoms Description**: Describe the visible symptoms you can observe

5. **Treatment Recommendations**: Provide specific, actionable treatment suggestions including:
   - Immediate actions to take
   - Recommended treatments/chemicals
   - Preventive measures
   - Organic/natural treatment options

6. **Severity Level**: Rate the severity (Mild/Moderate/Severe)

7. **Prognosis**: What is the expected outcome with proper treatment?

Format your response in a clear, structured manner that a farmer can easily understand and act upon.`;

        const result = await model.generateContent([
            prompt,
            {
                inlineData: {
                    mimeType: "image/jpeg",
                    data: base64Image
                }
            }
        ]);

        const response = await result.response;
        return response.text();

    } catch (error) {
        console.error('Gemini Vision API Error:', error);

        // Fallback analysis based on common patterns
        return `**Crop Health Analysis**

**Plant Identification**: Unable to process image with AI at the moment.

**General Recommendations for Crop Health:**

1. **Common Issues to Check:**
   - Yellowing leaves may indicate nutrient deficiency or overwatering
   - Brown spots could suggest fungal diseases
   - Wilting might indicate watering issues or root problems
   - Holes in leaves often indicate pest damage

2. **General Treatment Steps:**
   - Ensure proper watering (not too much, not too little)
   - Check for pests on both sides of leaves
   - Apply balanced fertilizer if nutrient deficiency is suspected
   - Improve air circulation around plants
   - Remove affected leaves to prevent spread

3. **Preventive Measures:**
   - Regular inspection of plants
   - Proper spacing between plants
   - Clean gardening tools
   - Crop rotation practices

**Recommendation**: For accurate diagnosis, please consult with a local agricultural expert or extension officer with the physical sample.`;
    }
}

// Upload and analyze crop image
router.post('/analyze', auth, upload.single('cropImage'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ message: 'Please upload a crop image' });
        }

        const { cropType, symptoms, location } = req.body;
        const imagePath = req.file.path;

        console.log(`Analyzing crop image: ${req.file.filename}`);
        console.log(`Crop type: ${cropType}, Location: ${location}`);

        // Analyze image with AI
        const analysisResult = await analyzeCropImage(imagePath);

        // Save analysis record (you can create a model for this)
        const diagnosisRecord = {
            userId: req.user.id,
            imagePath: req.file.filename,
            cropType: cropType || 'Unknown',
            symptoms: symptoms || 'Not specified',
            location: location || 'Not specified',
            analysis: analysisResult,
            timestamp: new Date()
        };

        // Here you would typically save to database
        console.log('Diagnosis completed for user:', req.user.id);

        res.json({
            success: true,
            diagnosis: analysisResult,
            imageUrl: `/uploads/crop-images/${req.file.filename}`,
            metadata: {
                cropType,
                symptoms,
                location,
                uploadTime: new Date().toISOString()
            }
        });

    } catch (error) {
        console.error('Crop analysis error:', error);

        // Clean up uploaded file on error
        if (req.file && req.file.path) {
            fs.removeSync(req.file.path).catch(console.error);
        }

        res.status(500).json({
            message: 'Failed to analyze crop image. Please try again.',
            error: error.message
        });
    }
});

// Get analysis history
router.get('/history', auth, (req, res) => {
    // Mock history data - replace with database query
    const mockHistory = [
        {
            id: 1,
            cropType: 'Tomato',
            diagnosis: 'Early Blight Disease detected',
            severity: 'Moderate',
            date: '2025-09-10',
            imageUrl: '/uploads/sample-tomato.jpg'
        },
        {
            id: 2,
            cropType: 'Rice',
            diagnosis: 'Healthy plant with good growth',
            severity: 'None',
            date: '2025-09-08',
            imageUrl: '/uploads/sample-rice.jpg'
        }
    ];

    res.json({
        success: true,
        history: mockHistory
    });
});

module.exports = router;
