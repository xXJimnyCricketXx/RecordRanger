const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const { requireAuth } = require('../middleware/authMiddleware');

/**
 * routes/settingsRoutes.js
 *
 * User settings routes: avatar upload, username/theme/language updates
 * and password changes. Uses Multer for avatar uploads with local storage.
 */

const AVATAR_EXTENSIONS = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp'
};
const SUPPORTED_LANGUAGES = ['en', 'fr', 'de', 'es', 'it'];

// The browser-supplied mimetype can be faked, so check the file signature too
const isImageFile = (filePath) => {
    const fd = fs.openSync(filePath, 'r');
    const b = Buffer.alloc(12);
    fs.readSync(fd, b, 0, 12, 0);
    fs.closeSync(fd);
    return (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF)
        || b.subarray(0, 4).toString('hex') === '89504e47'
        || b.subarray(0, 4).toString('latin1') === 'GIF8'
        || (b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP');
};

const parseUsername = (value) => (typeof value === 'string' ? value.trim() : '');

// Multer configuration (image uploads)
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../public/uploads/avatars');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
        // Keep a timestamp to avoid browser cache and include user ID for clarity
        const ext = AVATAR_EXTENSIONS[file.mimetype];
        const userId = req.user ? req.user._id : 'unknown'; // req.user is available via requireAuth
        cb(null, `avatar-${userId}-${Date.now()}${ext}`);
  }
});

// Note: Multer runs before route handlers so accessing res.locals.user can be tricky.
// We include the user id in the filename (or use a wrapper) to associate uploads.
const upload = multer({
    storage: storage,
    fileFilter: (req, file, cb) => {
        if (AVATAR_EXTENSIONS[file.mimetype]) cb(null, true);
        else cb(new Error('Format non supporté (JPG, PNG, GIF, WEBP uniquement).'));
    },
    limits: { fileSize: 5 * 1024 * 1024 },
});

const handleAvatarUpload = (req, res, next) => {
    upload.single('avatar')(req, res, (err) => {
        if (err) return res.status(400).json({ success: false, message: req.t('messages.avatar_upload_error') });
        next();
    });
};


// Routes

// Render settings page
router.get('/', requireAuth, (req, res) => {
    res.render('settings', { user: res.locals.user });
});

// Check whether a username is available
router.post('/check-username', requireAuth, async (req, res) => {
    const username = parseUsername(req.body.username);
    if (!username) return res.status(400).json({ success: false, message: req.t('auth.username_required') });
    try {
        // If user checks their current username, consider it available
        if (username === res.locals.user.username) {
            return res.json({ success: true, message: req.t('messages.username_current') });
        }

        const userExists = await User.findOne({ username: username });
        if (userExists) {
            return res.status(400).json({ success: false, message: req.t('errors.username_taken') });
        }
        res.json({ success: true, message: req.t('messages.username_available') });
    } catch (error) {
        res.status(500).json({ success: false, message: req.t('messages.generic_error') });
    }
});

// Update username
router.post('/update-username', requireAuth, async (req, res) => {
    const username = parseUsername(req.body.username);
    if (!username) return res.status(400).json({ success: false, message: req.t('auth.username_required') });
    try {
        const userExists = await User.findOne({ username: username });
        if (userExists && userExists._id.toString() !== res.locals.user._id.toString()) {
            return res.status(400).json({ success: false, message: req.t('errors.username_taken') });
        }
        await User.findByIdAndUpdate(res.locals.user._id, { username: username });
        res.redirect('/settings');
    } catch (error) {
        res.status(500).json({ success: false, message: req.t('messages.generic_error') });
    }
});

// Upload avatar
router.post('/upload-avatar', requireAuth, handleAvatarUpload, async (req, res) => {
    // Multer error handling
    if (!req.file) return res.status(400).json({ success: false, message: req.t('messages.avatar_upload_error') });

    try {
        if (!isImageFile(req.file.path)) {
            fs.unlinkSync(req.file.path);
            return res.status(400).json({ success: false, message: req.t('messages.avatar_upload_error') });
        }

        const userId = res.locals.user._id;

        // Retrieve previous avatar to remove it from disk
        const currentUser = await User.findById(userId);
        const oldAvatarPath = currentUser.img; // e.g. "/uploads/avatars/avatar-123.jpg"

        // Remove old file from disk if not the default image
        if (oldAvatarPath && !oldAvatarPath.includes('no-pp.jpg')) {
            const absoluteOldPath = path.join(__dirname, '../public', oldAvatarPath);

            if (fs.existsSync(absoluteOldPath)) {
                fs.unlinkSync(absoluteOldPath);
                console.log(`🗑️ Removed old avatar: ${absoluteOldPath}`);
            }
        }

        // Update DB with new path
        const newAvatarPath = `/uploads/avatars/${req.file.filename}`;
        await User.findByIdAndUpdate(userId, { img: newAvatarPath });

        res.json({ success: true, message: req.t('messages.avatar_updated'), avatarPath: newAvatarPath });

    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: req.t('messages.generic_error') });
    }
});

// Update Password
router.post('/update-password', requireAuth, async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    if (typeof currentPassword !== 'string' || typeof newPassword !== 'string') {
        return res.status(400).json({ success: false, message: req.t('auth.password_required') });
    }
    try {
        // Verify current password
        const user = await User.findById(res.locals.user._id);
        
        const isMatch = await bcrypt.compare(currentPassword, user.password);
        if (!isMatch) {
            return res.status(400).json({ success: false, message: req.t('errors.current_password_incorrect') });
        }
        
        if (newPassword.length < 6) {
            return res.status(400).json({ success: false, message: req.t('auth.password_too_short') });
        }

        const hashedPassword = await bcrypt.hash(newPassword, 10);
        await User.findByIdAndUpdate(res.locals.user._id, { 
            password: hashedPassword, 
            lastChange: Date.now() 
        });
        
        res.json({ success: true, message: req.t('messages.password_updated') });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: req.t('messages.generic_error') });
    }
});

// Update Theme
router.post('/update-theme', requireAuth, async (req, res) => {
    const { theme } = req.body;
    
    if (!['light', 'dark'].includes(theme)) {
        return res.status(400).json({ success: false, message: req.t('errors.invalid_theme') });
    }

    try {
        await User.findByIdAndUpdate(res.locals.user._id, { theme: theme });
        res.json({ success: true, message: req.t('messages.theme_updated') });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: req.t('messages.generic_error') });
    }
});

// Update Language
router.post('/update-language', requireAuth, async (req, res) => {
  const { language } = req.body;
  const userId = res.locals.user._id;

  if (!SUPPORTED_LANGUAGES.includes(language)) {
    return res.status(400).send(req.t('errors.lang_change_error'));
  }

  try {
    // Update language in DB
    await User.findByIdAndUpdate(userId, { language });

    // Update i18n language for current session
    await req.i18n.changeLanguage(language);

    // Redirect back or to settings page
    // Only keep the path of the referer so this can't redirect to another site
    let backURL = '/settings';
    try {
      const referer = new URL(req.header('Referer'));
      backURL = (referer.pathname + referer.search).replace(/^\/+/, '/');
    } catch (e) { /* missing or invalid referer */ }
    res.redirect(backURL);

  } catch (err) {
    console.error(err);
    res.status(500).send(req.t('errors.lang_change_error'));
  }
});

router.post('/update-currency', requireAuth, async (req, res) => {
    const { currency } = req.body;
    const userId = res.locals.user._id;

    if (!['EUR', 'USD', 'GBP'].includes(currency)) {
        return res.status(400).send('Devise non supportée');
    }

    try {
        await User.findByIdAndUpdate(userId, { currency });
        res.redirect('/settings');
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: req.t('messages.generic_error') });
    }
});

module.exports = router;