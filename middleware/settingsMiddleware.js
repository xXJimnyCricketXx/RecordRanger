const Settings = require('../models/Settings');
const themesConfig = require('../config/themes');
const { BASE_URL } = require('../config/constants');

module.exports = async (req, res, next) => {
    try {
        res.locals.allThemes = themesConfig;

        let settings = await Settings.findOne().lean();
        if (!settings) {
            settings = {
                siteName: 'RecordRanger!',
                statsWidgets: ['total', 'vinyl', 'artist'],
                theme: { preset: 'ranger' }
            };
        } else if (!settings.statsWidgets) {
            settings.statsWidgets = ['total', 'vinyl', 'artist'];
        }

        res.locals.settings = settings;

        res.locals.currentLng = res.locals.user?.language || req.language || 'fr';
        res.locals.isDark = res.locals.user ? (res.locals.user.theme === 'dark') : true;

        const fullPath = req.path.toLowerCase();
        // Strip BASE_URL from path to avoid false positives if BASE_URL contains keywords like "vinyl"
        const path = fullPath.startsWith(BASE_URL.toLowerCase()) 
            ? fullPath.slice(BASE_URL.length) 
            : fullPath;

        const queryType = req.query.type;

        let detectedType = 'home';

        if (path.includes('vinyl') || path.includes('search-discogs') || path.includes('album') || path.includes('music')) {
            detectedType = 'music';
        }

        res.locals.detectedType = detectedType;
        res.locals.currentType = queryType || detectedType;

        next();
    } catch (err) {
        console.error("[ERR] SettingsMiddleware:", err);
        res.locals.isDark = true;
        res.locals.currentLng = 'fr';
        res.locals.settings = { theme: { preset: 'ranger' } };
        next();
    }
};
