const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const User = require('../models/User');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Configure multer for avatar uploads with advanced settings
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadPath = 'uploads/avatars/';
        if (!fs.existsSync(uploadPath)) {
            fs.mkdirSync(uploadPath, { recursive: true });
        }
        cb(null, uploadPath);
    },
    filename: function (req, file, cb) {
        // Create unique filename with timestamp
        const uniqueName = `avatar-${req.user.id}-${Date.now()}${path.extname(file.originalname)}`;
        cb(null, uniqueName);
    }
});

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 2 * 1024 * 1024, // 2MB limit
        files: 1 // Only one file
    },
    fileFilter: function (req, file, cb) {
        // Check file type
        const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
        if (allowedTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Only image files (JPEG, PNG, GIF, WebP) are allowed!'));
        }
    }
});

// Get comprehensive user profile with stats
router.get('/profile', auth, async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select('-password');

        // Calculate user statistics (you'll need Post model imported)
        // For now, basic stats
        const userStats = {
            joinDate: user.createdAt,
            lastActive: new Date(),
            postsCount: 0, // Will be calculated when Post model is available
            commentsCount: 0,
            likesReceived: 0,
            reputation: 0
        };

        res.json({
            ...user.toObject(),
            stats: userStats
        });
    } catch (error) {
        console.error(error.message);
        res.status(500).send('Server error');
    }
});

// Comprehensive profile update with validation
router.put('/profile', auth, async (req, res) => {
    try {
        const {
            username,
            email,
            phone,
            farmSize,
            location,
            farmDescription,
            primaryCrops,
            farmingType,
            experience,
            soilType,
            profileImage,
            // New advanced fields
            farmingGoals,
            preferredCrops,
            farmingChallenges,
            bio,
            website,
            socialLinks
        } = req.body;

        const user = await User.findById(req.user.id);

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        // Validate unique fields
        if (username && username !== user.username) {
            const existingUser = await User.findOne({ username });
            if (existingUser) {
                return res.status(400).json({ message: 'Username already taken' });
            }
        }

        if (email && email !== user.email) {
            const existingEmail = await User.findOne({ email });
            if (existingEmail) {
                return res.status(400).json({ message: 'Email already in use' });
            }
        }

        // Update all provided fields
        if (username !== undefined) user.username = username.trim();
        if (email !== undefined) user.email = email.toLowerCase().trim();
        if (phone !== undefined) user.phone = phone.trim();
        if (farmSize !== undefined) user.farmSize = parseFloat(farmSize) || 0;
        if (location !== undefined) user.location = location.trim();
        if (farmDescription !== undefined) user.farmDescription = farmDescription.trim();
        if (primaryCrops !== undefined) user.primaryCrops = primaryCrops.trim();
        if (farmingType !== undefined) user.farmingType = farmingType;
        if (experience !== undefined) user.experience = parseInt(experience) || 0;
        if (soilType !== undefined) user.soilType = soilType;

        // Advanced fields
        if (farmingGoals !== undefined) user.farmingGoals = farmingGoals;
        if (preferredCrops !== undefined) user.preferredCrops = preferredCrops;
        if (farmingChallenges !== undefined) user.farmingChallenges = farmingChallenges;
        if (bio !== undefined) user.bio = bio.trim();
        if (website !== undefined) user.website = website.trim();
        if (socialLinks !== undefined) user.socialLinks = socialLinks;

        // Handle base64 profile image with advanced processing
        if (profileImage && profileImage.startsWith('data:image')) {
            try {
                const base64Data = profileImage.replace(/^data:image\/\w+;base64,/, '');
                const buffer = Buffer.from(base64Data, 'base64');

                // Validate image size
                if (buffer.length > 2 * 1024 * 1024) {
                    return res.status(400).json({ message: 'Image file too large (max 2MB)' });
                }

                const filename = `avatar-${req.user.id}-${Date.now()}.jpg`;
                const uploadDir = path.join(__dirname, '../uploads/avatars');
                const uploadPath = path.join(uploadDir, filename);

                // Ensure directory exists
                if (!fs.existsSync(uploadDir)) {
                    fs.mkdirSync(uploadDir, { recursive: true });
                }

                // Delete old avatar if exists
                if (user.profileImage) {
                    const oldPath = path.join(__dirname, '..', user.profileImage);
                    if (fs.existsSync(oldPath)) {
                        fs.unlinkSync(oldPath);
                    }
                }

                // Save new image
                fs.writeFileSync(uploadPath, buffer);
                user.profileImage = `/uploads/avatars/${filename}`;

                console.log(`✅ Profile image saved for ${user.username}: ${filename}`);

            } catch (imageError) {
                console.error('Error saving profile image:', imageError);
                return res.status(400).json({ message: 'Failed to process profile image' });
            }
        }

        // Update last modified
        user.updatedAt = new Date();

        await user.save();

        // Return updated user (without password)
        const updatedUser = await User.findById(req.user.id).select('-password');

        console.log(`✅ Profile updated for user: ${user.username}`);

        res.json({
            success: true,
            message: 'Profile updated successfully',
            user: updatedUser
        });

    } catch (error) {
        console.error('Profile update error:', error);
        res.status(500).json({ message: 'Failed to update profile' });
    }
});

// Advanced avatar upload with image processing
router.post('/avatar', auth, upload.single('avatar'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ message: 'No image file provided' });
        }

        const user = await User.findById(req.user.id);

        // Delete old avatar if exists
        if (user.profileImage) {
            const oldPath = path.join(__dirname, '..', user.profileImage);
            if (fs.existsSync(oldPath)) {
                fs.unlinkSync(oldPath);
                console.log('✅ Old avatar deleted');
            }
        }

        const avatarUrl = `/uploads/avatars/${req.file.filename}`;
        user.profileImage = avatarUrl;
        await user.save();

        console.log(`✅ Avatar uploaded for ${user.username}: ${req.file.filename}`);

        res.json({
            success: true,
            message: 'Avatar updated successfully',
            avatarUrl: avatarUrl,
            fileInfo: {
                filename: req.file.filename,
                size: req.file.size,
                mimetype: req.file.mimetype
            }
        });

    } catch (error) {
        console.error('Avatar upload error:', error);
        res.status(500).json({ message: 'Failed to upload avatar' });
    }
});

// Advanced user statistics
router.get('/stats', auth, async (req, res) => {
    try {
        const user = await User.findById(req.user.id);

        // Advanced stats calculation
        // Note: You'll need to import Post model and calculate real stats
        const stats = {
            profile: {
                completeness: calculateProfileCompleteness(user),
                joinDate: user.createdAt,
                lastUpdated: user.updatedAt
            },
            activity: {
                posts: 0, // Calculate from Post model
                comments: 0, // Calculate from Post model
                likes: 0, // Calculate from Post model
                reputation: 0 // Calculate based on activity
            },
            farming: {
                experience: user.experience || 0,
                farmSize: user.farmSize || 0,
                cropTypes: user.primaryCrops ? user.primaryCrops.split(',').length : 0,
                farmingType: user.farmingType || 'Not specified'
            }
        };

        res.json(stats);
    } catch (error) {
        console.error('Get stats error:', error);
        res.status(500).json({ message: 'Failed to get user stats' });
    }
});

// Calculate profile completeness
function calculateProfileCompleteness(user) {
    const fields = [
        'username', 'email', 'phone', 'location', 'farmSize',
        'farmDescription', 'primaryCrops', 'farmingType',
        'experience', 'soilType', 'profileImage'
    ];

    let completed = 0;
    fields.forEach(field => {
        if (user[field] && user[field] !== '') completed++;
    });

    return Math.round((completed / fields.length) * 100);
}

// Get user preferences
router.get('/preferences', auth, async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select('language preferences');
        res.json(user.preferences || {});
    } catch (error) {
        console.error('Get preferences error:', error);
        res.status(500).json({ message: 'Failed to get preferences' });
    }
});

// Update user preferences
router.put('/preferences', auth, async (req, res) => {
    try {
        const { language, notifications, privacy, display } = req.body;

        const user = await User.findById(req.user.id);
        if (!user.preferences) user.preferences = {};

        if (language) user.preferences.language = language;
        if (notifications) user.preferences.notifications = notifications;
        if (privacy) user.preferences.privacy = privacy;
        if (display) user.preferences.display = display;

        await user.save();

        res.json({
            success: true,
            message: 'Preferences updated successfully',
            preferences: user.preferences
        });

    } catch (error) {
        console.error('Update preferences error:', error);
        res.status(500).json({ message: 'Failed to update preferences' });
    }
});

// Delete user account with safety checks
router.delete('/delete', auth, async (req, res) => {
    try {
        const { confirmation } = req.body;

        if (confirmation !== 'DELETE') {
            return res.status(400).json({ message: 'Invalid confirmation' });
        }

        const user = await User.findById(req.user.id);

        // Delete user's avatar if exists
        if (user.profileImage) {
            const avatarPath = path.join(__dirname, '..', user.profileImage);
            if (fs.existsSync(avatarPath)) {
                fs.unlinkSync(avatarPath);
            }
        }

        // Note: You should also delete user's posts, comments, etc.
        // This requires Post model integration

        await User.findByIdAndDelete(req.user.id);

        console.log(`✅ User account deleted: ${user.username}`);

        res.json({
            success: true,
            message: 'Account deleted successfully'
        });

    } catch (error) {
        console.error('Delete account error:', error);
        res.status(500).json({ message: 'Failed to delete account' });
    }
});

// Check authentication with additional info
router.get('/check-auth', auth, (req, res) => {
    res.json({
        authenticated: true,
        userId: req.user.id,
        timestamp: new Date().toISOString()
    });
});

module.exports = router;
