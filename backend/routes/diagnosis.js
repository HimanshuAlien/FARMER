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

// Configure multer for memory storage
const storage = multer.memoryStorage();

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

// AI-powered crop analysis using Gemini Vision (Buffer-based)
async function analyzeCropImage(buffer) {
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

        // Process image from buffer
        const processedImage = await sharp(buffer)
            .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: 90 })
            .toBuffer();

        // Convert to base64
        const base64Image = processedImage.toString('base64');

        // Create the analysis prompt
        const prompt = `
You are an expert agricultural pathologist specializing in crop diseases and plant health analysis. Analyze this crop/plant image and provide a clear, structured report.

Return your answer ONLY in the following format (use these exact headings):

Diagnosis:
- Plant/Crop Identification: <short name>
- Health Status: <healthy / unhealthy with short reason>
- Disease/Problem Identification: <disease name / pest / deficiency / stress, or "None clearly visible">
- Symptoms: <short description of visible symptoms>

Treatment:
- Immediate Actions:
- Recommended Treatments/Chemicals:
- Organic/Natural Options:
- Expected Time to See Improvement:

Prevention:
- Cultural/Field Practices:
- Monitoring & Early Detection:
- Long-term Soil/Plant Health Tips:

Severity: Mild / Moderate / Severe

Guidelines:
- Keep language simple and farmer-friendly.
- Make Diagnosis, Treatment, and Prevention roughly similar in length.
- Do NOT add extra sections or headings outside the format above.
`;

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

// Upload and analyze crop image (Memory -> Base64 -> return)
router.post('/analyze', auth, upload.single('cropImage'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ message: 'Please upload a crop image' });
        }

        const { cropType, symptoms, location } = req.body;

        console.log(`Analyzing crop image (memory buffer): ${req.file.originalname}`);
        console.log(`Crop type: ${cropType}, Location: ${location}`);

        // Analyze image with AI
        const analysisResult = await analyzeCropImage(req.file.buffer);

        // Convert original/processed image to base64 for returning to UI if needed
        // For diagnosis, we usually just return the analysis result and the image preview
        const imageBase64 = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;

        console.log('Diagnosis completed for user:', req.user.id);

        res.json({
            success: true,
            diagnosis: analysisResult,
            imageUrl: imageBase64, // Return Base64 instead of URL
            metadata: {
                cropType,
                symptoms,
                location,
                uploadTime: new Date().toISOString()
            }
        });

    } catch (error) {
        console.error('Crop analysis error:', error);
        res.status(500).json({
            message: 'Failed to analyze crop image. Please try again.',
            error: error.message
        });
    }
});

// Get analysis history (Mock data updated with Base64 placeholder or URLs)
router.get('/history', auth, (req, res) => {
    // Mock history data
    const mockHistory = [
        {
            id: 1,
            cropType: 'Tomato',
            diagnosis: 'Early Blight Disease detected',
            severity: 'Moderate',
            date: '2025-09-10',
            imageUrl: 'https://via.placeholder.com/150'
        },
        {
            id: 2,
            cropType: 'Rice',
            diagnosis: 'Healthy plant with good growth',
            severity: 'None',
            date: '2025-09-08',
            imageUrl: 'https://via.placeholder.com/150'
        }
    ];

    res.json({
        success: true,
        history: mockHistory
    });
});

module.exports = router;
