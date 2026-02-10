const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const User = require('../models/User');
const multer = require('multer');
const path = require('path');
const mongoose = require('mongoose');
const cache = require('../utils/cache'); // Import cache utility

// Configure multer for memory storage (for Vercel/MongoDB consistency)
const storage = multer.memoryStorage();

const upload = multer({
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
    fileFilter: function (req, file, cb) {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Only image files are allowed!'));
        }
    }
});

// Advanced Post Model with full features
const commentSchema = new mongoose.Schema({
    author: { type: String, required: true },
    authorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    content: { type: String, required: true },
    likes: { type: Number, default: 0 },
    likedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    replies: [{
        author: String,
        authorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        content: String,
        createdAt: { type: Date, default: Date.now }
    }],
    createdAt: { type: Date, default: Date.now }
});

const postSchema = new mongoose.Schema({
    title: { type: String, required: true },
    content: { type: String, required: true },
    author: { type: String, required: true },
    authorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    image: { type: String }, // Stores Base64 string directly
    likes: { type: Number, default: 0 },
    likedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    comments: [commentSchema],
    tags: [String],
    views: { type: Number, default: 0 },
    solved: { type: Boolean, default: false },
    category: { type: String, enum: ['question', 'tip', 'discussion', 'help'], default: 'discussion' },
    location: String,
    cropType: String,
    season: String,
    featured: { type: Boolean, default: false }
}, { timestamps: true });

// Add indexes for better performance
postSchema.index({ createdAt: -1 });
postSchema.index({ authorId: 1 });
postSchema.index({ tags: 1 });
postSchema.index({ category: 1 });
// Text index for search
postSchema.index({ title: 'text', content: 'text', tags: 'text' });
// Compound indexes for common filters
postSchema.index({ category: 1, createdAt: -1 });
postSchema.index({ tags: 1, createdAt: -1 });
postSchema.index({ authorId: 1, createdAt: -1 });
postSchema.index({ solved: 1, createdAt: -1 });

const Post = mongoose.models.Post || mongoose.model('Post', postSchema);

// FIXED: Get all posts with profile images for comments too
router.get('/posts', auth, async (req, res) => {
    try {
        const {
            page = 1,
            limit = 20,
            category,
            tags,
            author,
            search,
            sortBy = 'createdAt',
            order = 'desc'
        } = req.query;

        // Create a unique cache key based on query parameters
        const cacheKey = `posts_${page}_${limit}_${category || 'all'}_${tags || 'all'}_${author || 'all'}_${search || 'none'}_${sortBy}_${order}`;

        // Check cache first
        const cachedData = cache.get(cacheKey);
        if (cachedData) {
            return res.json(cachedData);
        }

        // Build filter object
        const filter = {};
        if (category) filter.category = category;
        if (author) filter.authorId = author;
        if (tags) filter.tags = { $in: tags.split(',') };
        if (search) {
            filter.$or = [
                { title: { $regex: search, $options: 'i' } },
                { content: { $regex: search, $options: 'i' } },
                { tags: { $regex: search, $options: 'i' } }
            ];
        }

        // Build sort object
        const sort = {};
        sort[sortBy] = order === 'desc' ? -1 : 1;

        // Optimization: Use .lean() for faster execution and .select() to limit fields if needed
        // We need most fields here, but lean() helps significantly with read performance
        const posts = await Post.find(filter)
            .populate('authorId', 'username profileImage location')
            .populate('comments.authorId', 'username profileImage')
            .sort(sort)
            .limit(parseInt(limit))
            .skip((parseInt(page) - 1) * parseInt(limit))
            .lean(); // Convert to plain JS objects

        const totalPosts = await Post.countDocuments(filter);
        const userId = req.user.id;

        // FIXED: Format posts with profile images for comments
        const formattedPosts = posts.map(post => ({
            id: post._id.toString(),
            title: post.title,
            content: post.content,
            author: post.author, // Fallback if populate fails
            authorId: post.authorId?._id || post.authorId, // Handle populated or raw ID
            authorProfileImage: post.authorId?.profileImage || null,
            authorLocation: post.authorId?.location || null,
            timestamp: post.createdAt.toISOString(),
            image: post.image,
            tags: post.tags,
            likes: post.likes,
            liked: post.likedBy ? post.likedBy.some(id => id.toString() === userId) : false, // Check if user liked
            views: post.views,
            solved: post.solved,
            category: post.category,
            featured: post.featured,
            commentsCount: post.comments ? post.comments.length : 0,
            comments: post.comments ? post.comments.map(comment => ({
                id: comment._id.toString(),
                author: comment.author,
                authorId: comment.authorId?._id || comment.authorId,
                // FIXED: Include profile image from populated data
                authorProfileImage: comment.authorId?.profileImage || null,
                content: comment.content,
                timestamp: comment.createdAt.toISOString(),
                likes: comment.likes,
                liked: comment.likedBy ? comment.likedBy.some(id => id.toString() === userId) : false,
                repliesCount: comment.replies?.length || 0
            })) : []
        }));

        const responseData = {
            success: true,
            posts: formattedPosts,
            pagination: {
                currentPage: parseInt(page),
                totalPages: Math.ceil(totalPosts / parseInt(limit)),
                totalPosts: totalPosts,
                hasNext: parseInt(page) < Math.ceil(totalPosts / parseInt(limit)),
                hasPrev: parseInt(page) > 1
            },
        };

        // Cache the response for 30 seconds (short cache for fresh content)
        cache.set(cacheKey, responseData, 30);

        res.json(responseData);
    } catch (error) {
        console.error('Error fetching posts:', error);
        res.status(500).json({ message: 'Failed to fetch posts' });
    }
});


// FIXED: Create new post with profile image (MongoDB Base64 Storage)
router.post('/posts', auth, upload.single('image'), async (req, res) => {
    try {
        const {
            title,
            content,
            image,
            tags,
            category = 'discussion',
            cropType,
            season
        } = req.body;
        const userId = req.user.id;

        // Get user info with profile image
        const user = await User.findById(userId).select('-password');
        const userName = user.username || user.email || `User ${userId}`;

        if (!title || !content) {
            return res.status(400).json({
                success: false,
                message: 'Title and content are required'
            });
        }

        // Handle image (from file upload or base64)
        let imageBase64 = null;

        if (req.file) {
            // Check file size (double check)
            if (req.file.size > 5 * 1024 * 1024) {
                return res.status(400).json({
                    success: false,
                    message: 'Image size too large (max 5MB)'
                });
            }
            // Convert buffer to base64
            imageBase64 = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
        } else if (image && image.startsWith('data:image')) {
            // Client sent base64 directly
            if (image.length > 7 * 1024 * 1024) {
                return res.status(400).json({
                    success: false,
                    message: 'Image size too large'
                });
            }
            imageBase64 = image;
        }

        // Process tags
        const processedTags = tags ?
            (typeof tags === 'string' ? tags.split(',').map(tag => tag.trim()) : tags) : [];

        // Create new post with advanced features
        const newPost = new Post({
            title: title.trim(),
            content: content.trim(),
            author: userName,
            authorId: userId,
            image: imageBase64, // Store base64 string directly
            tags: processedTags,
            category: category,
            cropType: cropType,
            season: season,
            location: user.location,
            likes: 0,
            likedBy: [],
            comments: [],
            views: 0,
            solved: false
        });

        await newPost.save();

        // Clear posts cache when new post is created
        cache.del('posts_1_20_all_all_all_none_createdAt_desc'); // Clear default view
        cache.flush(); // Simple strategy: flush all community caches to ensure freshness

        console.log(`✅ MongoDB Post created by ${userName}: "${title}" (${category})`);

        // FIXED: Return formatted post with profile image
        res.status(201).json({
            success: true,
            post: {
                id: newPost._id.toString(),
                title: newPost.title,
                content: newPost.content,
                author: newPost.author,
                authorId: newPost.authorId,
                // FIXED: Include current user's profile image
                authorProfileImage: user.profileImage || null,
                authorLocation: user.location || null,
                timestamp: newPost.createdAt.toISOString(),
                image: newPost.image,
                tags: newPost.tags,
                category: newPost.category,
                likes: 0,
                liked: false,
                views: 0,
                solved: false,
                comments: []
            }
        });

    } catch (error) {
        console.error('Error creating post:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to create post. Please try again.'
        });
    }
});

// Advanced like/unlike with activity tracking
router.post('/posts/:id/like', auth, async (req, res) => {
    try {
        const postId = req.params.id;
        const userId = req.user.id;

        const post = await Post.findById(postId);
        if (!post) {
            return res.status(404).json({ message: 'Post not found' });
        }

        const isLiked = post.likedBy.includes(userId);

        if (isLiked) {
            post.likedBy.pull(userId);
            post.likes = Math.max(0, post.likes - 1);
        } else {
            post.likedBy.push(userId);
            post.likes += 1;
        }

        await post.save();

        // Log activity (you can expand this for notifications)
        console.log(`User ${userId} ${isLiked ? 'unliked' : 'liked'} post ${postId}`);

        res.json({
            success: true,
            liked: !isLiked,
            likes: post.likes,
            message: `Post ${isLiked ? 'unliked' : 'liked'} successfully`
        });

    } catch (error) {
        console.error('Error toggling like:', error);
        res.status(500).json({ message: 'Failed to toggle like' });
    }
});

// FIXED: Advanced comment system with profile images
router.post('/posts/:id/comments', auth, async (req, res) => {
    try {
        const postId = req.params.id;
        const { content, parentCommentId } = req.body;
        const userId = req.user.id;

        const user = await User.findById(userId).select('-password');
        const userName = user.username || user.email || `User ${userId}`;

        const post = await Post.findById(postId);
        if (!post) {
            return res.status(404).json({ message: 'Post not found' });
        }

        if (!content || content.trim().length === 0) {
            return res.status(400).json({ message: 'Comment content is required' });
        }

        if (parentCommentId) {
            // Reply to existing comment
            const parentComment = post.comments.id(parentCommentId);
            if (!parentComment) {
                return res.status(404).json({ message: 'Parent comment not found' });
            }

            parentComment.replies.push({
                author: userName,
                authorId: userId,
                content: content.trim()
            });
        } else {
            // New top-level comment
            post.comments.push({
                author: userName,
                authorId: userId,
                content: content.trim(),
                likes: 0,
                likedBy: [],
                replies: []
            });
        }

        await post.save();

        const savedComment = parentCommentId ?
            post.comments.id(parentCommentId).replies[post.comments.id(parentCommentId).replies.length - 1] :
            post.comments[post.comments.length - 1];

        console.log(`✅ Comment added by ${userName} to post ${postId}`);

        res.status(201).json({
            success: true,
            comment: {
                id: savedComment._id.toString(),
                author: savedComment.author,
                authorId: savedComment.authorId,
                // FIXED: Include commenter's profile image
                authorProfileImage: user.profileImage || null,
                content: savedComment.content,
                timestamp: savedComment.createdAt.toISOString(),
                likes: savedComment.likes || 0,
                liked: false,
                isReply: !!parentCommentId
            }
        });

    } catch (error) {
        console.error('Error adding comment:', error);
        res.status(500).json({ message: 'Failed to add comment' });
    }
});

// Like/unlike comment
router.post('/comments/:commentId/like', auth, async (req, res) => {
    try {
        const commentId = req.params.commentId;
        const userId = req.user.id;

        // Find post containing the comment
        const post = await Post.findOne({ 'comments._id': commentId });
        if (!post) {
            return res.status(404).json({ message: 'Comment not found' });
        }

        const comment = post.comments.id(commentId);
        if (!comment) {
            return res.status(404).json({ message: 'Comment not found' });
        }

        const isLiked = comment.likedBy.includes(userId);

        if (isLiked) {
            // Unlike
            comment.likedBy.pull(userId);
            comment.likes = Math.max(0, comment.likes - 1);
        } else {
            // Like
            comment.likedBy.push(userId);
            comment.likes += 1;
        }

        await post.save();

        res.json({
            success: true,
            liked: !isLiked,
            likes: comment.likes
        });

    } catch (error) {
        console.error('Error toggling comment like:', error);
        res.status(500).json({ message: 'Failed to toggle comment like' });
    }
});

// Mark post as solved
router.post('/posts/:id/solve', auth, async (req, res) => {
    try {
        const postId = req.params.id;
        const userId = req.user.id;

        const post = await Post.findById(postId);
        if (!post) {
            return res.status(404).json({ message: 'Post not found' });
        }

        // Only post author can mark as solved
        if (post.authorId.toString() !== userId) {
            return res.status(403).json({ message: 'Only post author can mark as solved' });
        }

        post.solved = !post.solved;
        await post.save();

        res.json({
            success: true,
            solved: post.solved,
            message: `Post marked as ${post.solved ? 'solved' : 'unsolved'}`
        });

    } catch (error) {
        console.error('Error toggling solved status:', error);
        res.status(500).json({ message: 'Failed to update solved status' });
    }
});

// Get trending topics
router.get('/trending', auth, async (req, res) => {
    try {
        // Check cache first
        const cacheKey = 'trending_topics';
        const cachedData = cache.get(cacheKey);
        if (cachedData) {
            return res.json(cachedData);
        }

        // Parallel execution for better performance
        const [trendingTags, popularCategories] = await Promise.all([
            Post.aggregate([
                { $unwind: '$tags' },
                { $group: { _id: '$tags', count: { $sum: 1 }, posts: { $sum: 1 } } },
                { $sort: { count: -1 } },
                { $limit: 10 }
            ]),
            Post.aggregate([
                { $group: { _id: '$category', count: { $sum: 1 } } },
                { $sort: { count: -1 } }
            ])
        ]);

        const responseData = {
            success: true,
            trending: trendingTags.map(tag => ({
                topic: tag._id,
                count: tag.count
            })),
            categories: popularCategories
        };

        // Cache for 10 minutes
        cache.set(cacheKey, responseData, 600);

        res.json(responseData);

    } catch (error) {
        console.error('Error getting trending topics:', error);
        res.status(500).json({ message: 'Failed to get trending topics' });
    }
});

// Advanced search with filters
router.get('/search', auth, async (req, res) => {
    try {
        const {
            q,
            category,
            tags,
            solved,
            dateFrom,
            dateTo,
            sortBy = 'relevance'
        } = req.query;

        if (!q) {
            return res.status(400).json({ message: 'Search query is required' });
        }

        const cacheKey = `search_${q}_${category || 'all'}_${tags || 'all'}_${solved || 'all'}_${sortBy}`;
        const cachedData = cache.get(cacheKey);
        if (cachedData) {
            return res.json(cachedData);
        }

        // Build search filter
        const searchFilter = {
            $or: [
                { title: { $regex: q, $options: 'i' } },
                { content: { $regex: q, $options: 'i' } },
                { tags: { $regex: q, $options: 'i' } }
            ]
        };

        // Add additional filters
        if (category) searchFilter.category = category;
        if (tags) searchFilter.tags = { $in: tags.split(',') };
        if (solved !== undefined) searchFilter.solved = solved === 'true';
        if (dateFrom || dateTo) {
            searchFilter.createdAt = {};
            if (dateFrom) searchFilter.createdAt.$gte = new Date(dateFrom);
            if (dateTo) searchFilter.createdAt.$lte = new Date(dateTo);
        }

        // Build sort
        let sort = {};
        switch (sortBy) {
            case 'date': sort = { createdAt: -1 }; break;
            case 'likes': sort = { likes: -1 }; break;
            case 'comments': sort = { 'comments.length': -1 }; break;
            default: sort = { createdAt: -1 }; // Default relevance
        }

        // Optimization: use .lean() and populate specific fields
        const searchResults = await Post.find(searchFilter)
            .populate('authorId', 'username profileImage')
            .sort(sort)
            .limit(50)
            .lean();

        // FIXED: Format search results with profile images
        const formattedResults = searchResults.map(post => ({
            id: post._id.toString(),
            title: post.title,
            content: post.content,
            author: post.author,
            authorId: post.authorId?._id || post.authorId,
            authorProfileImage: post.authorId?.profileImage || null,
            timestamp: post.createdAt.toISOString(),
            image: post.image,
            tags: post.tags,
            likes: post.likes,
            category: post.category,
            solved: post.solved,
            commentsCount: post.comments ? post.comments.length : 0
        }));

        const responseData = {
            success: true,
            results: formattedResults,
            query: q,
            count: formattedResults.length,
            filters: { category, tags, solved }
        };

        // Cache search results for 2 minutes
        cache.set(cacheKey, responseData, 120);

        res.json(responseData);

    } catch (error) {
        console.error('Error searching posts:', error);
        res.status(500).json({ message: 'Search failed' });
    }
});

module.exports = router;
