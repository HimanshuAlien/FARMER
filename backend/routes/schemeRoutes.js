const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Helper to find the correct PDF directory (especially for Vercel)
function getPDFDir() {
    const checkPaths = [
        path.join(__dirname, '../../frontend/pdfs'),
        path.join(process.cwd(), 'frontend/pdfs'),
        path.join(process.cwd(), 'backend/frontend/pdfs'),
        path.join(__dirname, '../frontend/pdfs')
    ];

    console.log('🔍 [Schemes] Starting PDF directory discovery...');
    console.log('📂 [Schemes] Current __dirname:', __dirname);
    console.log('📂 [Schemes] Current process.cwd():', process.cwd());

    for (const p of checkPaths) {
        if (fs.existsSync(p)) {
            console.log('✅ [Schemes] Found PDF directory at:', p);
            return p;
        } else {
            console.log('❌ [Schemes] Not found at:', p);
        }
    }

    // Fallback if none found
    const defaultPath = path.join(__dirname, '../../frontend/pdfs');
    console.log('⚠️ [Schemes] No PDF directory found, falling back to default:', defaultPath);
    return defaultPath;
}

const PDF_DIR = getPDFDir();

// Utility to convert filenames to readable titles
function prettifyName(fileName) {
    return fileName
        .replace(/_/g, ' ')
        .replace(/-/g, ' ')
        .replace(/\.pdf$/i, '')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * 🔹 GET /api/schemes
 * Returns list of PDF schemes
 */
router.get('/schemes', async (req, res) => {
    try {
        if (!fs.existsSync(PDF_DIR)) {
            return res.json({ success: true, schemes: [] });
        }

        const pdfFiles = fs.readdirSync(PDF_DIR)
            .filter(f => f.toLowerCase().endsWith('.pdf'))
            .map(f => ({
                _id: f,
                schemeName: prettifyName(f),
                pdfUrl: `/pdfs/${encodeURIComponent(f)}`,
                lastUpdated: fs.statSync(path.join(PDF_DIR, f)).mtime
            }));

        res.json({
            success: true,
            schemes: pdfFiles
        });

    } catch (error) {
        console.error('Error loading schemes:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to load schemes'
        });
    }
});

/**
 * 🔹 GET /api/schemes/:fileName/details
 * Returns simple scheme info (no AI)
 */
router.get('/schemes/:fileName/details', (req, res) => {
    try {
        const file = req.params.fileName;
        const pdfPath = path.join(PDF_DIR, file);

        if (!fs.existsSync(pdfPath)) {
            return res.status(404).json({
                success: false,
                message: 'PDF not found'
            });
        }

        res.json({
            success: true,
            scheme: {
                id: file,
                schemeName: prettifyName(file),
                pdfUrl: `/pdfs/${encodeURIComponent(file)}`
            }
        });

    } catch (error) {
        console.error('Error returning scheme:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch scheme'
        });
    }
});

/**
 * 🔹 GET /api/schemes/:fileName/ai-summary
 * Summarizes the PDF using Gemini
 */
router.get('/schemes/:fileName/ai-summary', async (req, res) => {
    try {
        const raw = req.params.fileName;
        const safeName = path.basename(raw);
        const pdfPath = path.join(PDF_DIR, safeName);

        if (!fs.existsSync(pdfPath)) {
            return res.status(404).json({
                success: false,
                message: 'PDF not found on server'
            });
        }

        if (!process.env.GEMINI_API_KEY) {
            return res.status(500).json({
                success: false,
                message: 'Gemini API key not configured on server'
            });
        }

        // Read PDF
        const buffer = fs.readFileSync(pdfPath);
        const parsed = await pdfParse(buffer);
        const pdfText = (parsed.text || '').slice(0, 15000);

        const schemeName = prettifyName(safeName);

        const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

        const prompt = `
You are "Krishi Mitra", an AI assistant helping Indian farmers understand government schemes.
Return ONLY CLEAN HTML — DO NOT use markdown or backticks.

SCHEME NAME: ${schemeName}

PDF CONTENT BELOW:
${pdfText}

Follow this HTML structure exactly:

<div class="ai-summary">
  <h2 class="ai-title">${schemeName}</h2>

  <section class="ai-section">
    <h3>1. Short Overview</h3>
    <p>(2-3 lines, very simple language)</p>
  </section>

  <section class="ai-section">
    <h3>2. Main Benefits</h3>
    <ul>
      <li><strong>Benefit title:</strong> short explanation with ₹ only if clearly visible in PDF.</li>
    </ul>
  </section>

  <section class="ai-section">
    <h3>3. Who is Eligible</h3>
    <ul></ul>
  </section>

  <section class="ai-section">
    <h3>4. Required Documents</h3>
    <ul></ul>
  </section>

  <section class="ai-section">
    <h3>5. How to Apply</h3>
    <p>(steps if mentioned, otherwise mention PDF/office)</p>
  </section>

  <section class="ai-section">
    <h3>6. Contact / Support</h3>
    <p>(only if present, otherwise nearest Agriculture Office)</p>
  </section>

  <section class="ai-section">
    <h3>7. Important Notes</h3>
    <ul></ul>
  </section>

  <section class="ai-section">
    <h3>8. Final Advice</h3>
    <p>(1–2 lines encouraging farmer to take benefit)</p>
  </section>
</div>

RULES:
- DO NOT write \`\`\`html or \`\`\`
- DO NOT invent information not in text
- Use simple language for farmers.
`;

        const result = await model.generateContent(prompt);
        let summaryHtml = (result.response.text() || '').trim();

        // 🧹 Remove unwanted code block formatting
        summaryHtml = summaryHtml
            .replace(/^```html\s*/i, '')
            .replace(/^```\s*/i, '')
            .replace(/```$/i, '')
            .trim();

        return res.json({
            success: true,
            scheme: {
                id: safeName,
                schemeName,
                pdfUrl: `/pdfs/${encodeURIComponent(safeName)}`
            },
            summaryHtml
        });

    } catch (error) {
        console.error('AI summary error:', error);
        res.status(500).json({
            success: false,
            message: 'Could not generate AI summary for this PDF',
            error: error.message
        });
    }
});

module.exports = router;
