const mongoose = require('mongoose');

const themeSchema = {
    preset: { type: String, default: 'default' }
};

const settingsSchema = new mongoose.Schema({
    siteName: { type: String, default: 'RecordRanger' },
    theme: {
        home:    { type: Object, default: themeSchema },
        music:   { type: Object, default: themeSchema }
    },
    statsWidgets: {
        type: [String],
        default: ['total', 'vinyl', 'artist']
    },
    visibility: {
        applyToAdmin: { type: Boolean, default: false },
        hiddenItems: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Item' }],
        hiddenGenres: [{ type: String }],
        hiddenTypes: [{ type: String }]
    }
});

module.exports = mongoose.model('Settings', settingsSchema);