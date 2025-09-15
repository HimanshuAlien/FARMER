const express = require('express');
const router = express.Router();
const { GoogleGenerativeAI } = require('@google/generative-ai');
const auth = require('../middleware/auth');
const Query = require('../models/Query'); // ADD THIS
const User = require('../models/User'); // ADD THIS

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Language configurations
const languages = {
    'en': {
        name: 'English',
        prompt: 'Answer in English with clear formatting using bullet points and short paragraphs'
    },
    'hi': {
        name: 'Hindi',
        prompt: 'जवाब हिंदी में दें और स्पष्ट बुलेट पॉइंट्स का उपयोग करें'
    },
    'ml': {
        name: 'Malayalam',
        prompt: 'മലയാളത്തിൽ ഉത്തരം നൽകുക, വ്യക്തമായ പോയിന്റുകൾ ഉപയോഗിച്ച്'
    }
};

// UPDATED: Your existing ask route with database saving
router.post('/ask', auth, async (req, res) => {
    try {
        const { question, language = 'en' } = req.body;
        const userId = req.user.id;

        console.log('Question:', question);
        console.log('Language:', language);

        // Use Gemini 1.5 Flash
        const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

        // Create language-specific prompt
        const languageInstruction = languages[language]?.prompt || languages['en'].prompt;

        const prompt = `You are an expert agricultural advisor for Kerala, India farmers. 

${languageInstruction}

Format your response with:
- Clear headings using **bold text**
- Bullet points for lists
- Short paragraphs (2-3 lines max)
- Practical, actionable advice
- Specific to Kerala's climate

Question: "${question}"

Provide helpful farming advice:`;

        console.log('Calling Gemini 1.5 Flash...');

        const result = await model.generateContent(prompt);
        const response = await result.response;
        let text = response.text();

        // Clean and format the response
        text = formatResponse(text);

        console.log('✅ Formatted AI response ready');

        // NEW: Save query to database
        try {
            const newQuery = new Query({
                userId: userId,
                question: question.trim(),
                response: text,
                category: detectCategory(question),
                language: language,
                resolved: false
            });

            await newQuery.save();
            console.log('✅ Query saved to database');

            // Clean up old queries (keep only last 100 per user)
            const userQueries = await Query.find({ userId }).sort({ createdAt: -1 }).skip(100);
            if (userQueries.length > 0) {
                const oldQueryIds = userQueries.map(q => q._id);
                await Query.deleteMany({ _id: { $in: oldQueryIds } });
                console.log(`🧹 Cleaned up ${userQueries.length} old queries`);
            }

        } catch (dbError) {
            console.error('Database save error:', dbError);
            // Don't fail the request if database save fails
        }

        res.json({
            response: text,
            timestamp: new Date().toISOString(),
            language: language
        });

    } catch (error) {
        console.error('AI Error:', error.message);
        res.status(500).json({
            message: 'AI service error',
            error: error.message
        });
    }
});

// NEW: Get recent queries (last 5)
router.get('/recent', auth, async (req, res) => {
    try {
        const userId = req.user.id;

        const recentQueries = await Query.find({ userId })
            .sort({ createdAt: -1 })
            .limit(5)
            .select('question response category createdAt resolved rating');

        res.json({
            success: true,
            queries: recentQueries.map(query => ({
                id: query._id,
                question: query.question,
                response: query.response,
                category: query.category,
                timestamp: query.createdAt.toISOString(),
                timeAgo: getTimeAgo(query.createdAt),
                resolved: query.resolved,
                rating: query.rating
            }))
        });

    } catch (error) {
        console.error('Error fetching recent queries:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch recent queries'
        });
    }
});

// NEW: Get user query statistics for dashboard
router.get('/stats', auth, async (req, res) => {
    try {
        const userId = req.user.id;

        const totalQueries = await Query.countDocuments({ userId });
        const resolvedQueries = await Query.countDocuments({ userId, resolved: true });
        const thisWeekQueries = await Query.countDocuments({
            userId,
            createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
        });
        const thisMonthQueries = await Query.countDocuments({
            userId,
            createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
        });

        // Category breakdown
        const categoryStats = await Query.aggregate([
            { $match: { userId: userId } },
            { $group: { _id: '$category', count: { $sum: 1 } } }
        ]);

        res.json({
            success: true,
            stats: {
                total: totalQueries,
                resolved: resolvedQueries,
                thisWeek: thisWeekQueries,
                thisMonth: thisMonthQueries,
                categories: categoryStats.reduce((acc, cat) => {
                    acc[cat._id] = cat.count;
                    return acc;
                }, {})
            }
        });

    } catch (error) {
        console.error('Error fetching query stats:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch query statistics'
        });
    }
});

// NEW: Mark query as resolved
router.put('/:id/resolve', auth, async (req, res) => {
    try {
        const queryId = req.params.id;
        const userId = req.user.id;
        const { rating } = req.body;

        const query = await Query.findOne({ _id: queryId, userId });
        if (!query) {
            return res.status(404).json({ message: 'Query not found' });
        }

        query.resolved = true;
        if (rating && rating >= 1 && rating <= 5) {
            query.rating = rating;
        }

        await query.save();

        res.json({
            success: true,
            message: 'Query marked as resolved',
            query: {
                id: query._id,
                resolved: query.resolved,
                rating: query.rating
            }
        });

    } catch (error) {
        console.error('Error resolving query:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to resolve query'
        });
    }
});

// EXISTING: Your formatting function (unchanged)
function formatResponse(text) {
    // Clean up the text
    text = text
        .replace(/\*\*(.*?)\*\*/g, '**$1**') // Keep bold formatting
        .replace(/\* /g, '• ') // Convert asterisks to bullets
        .replace(/\n{3,}/g, '\n') // Remove excessive line breaks - FIXED
        .trim();

    // Add minimal spacing around headers
    text = text.replace(/\*\*(.*?)\*\*/g, '**$1**\n');

    // Clean up any formatting issues
    text = text
        .replace(/\n{2,}/g, '\n') // FIXED: Only single line breaks
        .replace(/^\n+/, '') // Remove leading line breaks
        .replace(/\n+$/, ''); // Remove trailing line breaks

    return text;
}

// NEW: Detect category from question
function detectCategory(question) {
    const lowercaseQuestion = question.toLowerCase();

    if (lowercaseQuestion.includes('disease') || lowercaseQuestion.includes('pest') ||
        lowercaseQuestion.includes('fungus') || lowercaseQuestion.includes('insect')) {
        return 'disease';
    }

    if (lowercaseQuestion.includes('weather') || lowercaseQuestion.includes('rain') ||
        lowercaseQuestion.includes('season') || lowercaseQuestion.includes('climate')) {
        return 'weather';
    }

    if (lowercaseQuestion.includes('price') || lowercaseQuestion.includes('market') ||
        lowercaseQuestion.includes('sell') || lowercaseQuestion.includes('cost')) {
        return 'market';
    }

    if (lowercaseQuestion.includes('crop') || lowercaseQuestion.includes('seed') ||
        lowercaseQuestion.includes('fertilizer') || lowercaseQuestion.includes('harvest')) {
        return 'farming';
    }

    return 'general';
}

// NEW: Helper function for time formatting
function getTimeAgo(date) {
    const now = new Date();
    const diffInSeconds = Math.floor((now - date) / 1000);

    if (diffInSeconds < 60) return 'Just now';
    if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m ago`;
    if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h ago`;
    if (diffInSeconds < 2592000) return `${Math.floor(diffInSeconds / 86400)}d ago`;
    return date.toLocaleDateString();
}

module.exports = router;
