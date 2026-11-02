const Item = require('../models/Item');
const Settings = require('../models/Settings');
const PRESETS = require('../config/themes');

const migrateDatabase = async () => {
    try {
        const oldItemsCount = await Item.countDocuments({ kind: { $exists: false } });

        if (oldItemsCount > 0) {
            console.log(`[MIGRATION] : Found ${oldItemsCount} old items...`);
            console.log('[MIGRATION] Updating...');
            const result = await Item.updateMany(
                { kind: { $exists: false } },
                { $set: { kind: 'Music' } }
            );

            console.log(`[MIGRATION] ${result.modifiedCount} old items updated.`);
        }

        // Older versions stored the Discogs ID as text after an edit. Use the
        // raw driver: the base Item schema does not know this field.
        const textIds = await Item.collection
            .find({ discogs_id: { $type: 'string' } }, { projection: { discogs_id: 1 } })
            .toArray();

        if (textIds.length > 0) {
            await Item.collection.bulkWrite(textIds.map(({ _id, discogs_id }) => {
                const id = discogs_id.trim();
                return {
                    updateOne: {
                        filter: { _id },
                        update: /^\d+$/.test(id) ? { $set: { discogs_id: Number(id) } } : { $unset: { discogs_id: '' } }
                    }
                };
            }));
            console.log(`[MIGRATION] ${textIds.length} Discogs IDs converted to numbers.`);
        }

        // Consolidate the old per-page-type theme (theme.home.preset /
        // theme.music.preset) into a single theme.preset now that the app
        // only has one content type left. Also remaps any preset key that
        // was since removed from config/themes.js back to the default.
        const settingsDoc = await Settings.findOne();
        if (settingsDoc) {
            const rawTheme = settingsDoc.toObject().theme || {};
            const hasLegacyFields = rawTheme.home !== undefined || rawTheme.music !== undefined;

            if (hasLegacyFields) {
                const legacyPreset = rawTheme.home?.preset || rawTheme.music?.preset;
                const presetKey = rawTheme.preset || (PRESETS[legacyPreset] ? legacyPreset : 'ranger');
                console.log(`[MIGRATION] Consolidating legacy theme.home/music into theme.preset ("${presetKey}")`);
                // Use the raw driver: Mongoose silently drops $unset targets
                // that are no longer declared on the schema (theme.home/music
                // were removed from models/Settings.js), so a normal
                // Settings.updateOne() here would leave the old fields in place.
                await Settings.collection.updateOne(
                    { _id: settingsDoc._id },
                    { $set: { 'theme.preset': presetKey }, $unset: { 'theme.home': '', 'theme.music': '' } }
                );
            } else if (rawTheme.preset && !PRESETS[rawTheme.preset]) {
                console.log(`[MIGRATION] Preset "${rawTheme.preset}" no longer exists, falling back to "ranger"`);
                await Settings.updateOne({ _id: settingsDoc._id }, { $set: { 'theme.preset': 'ranger' } });
            }
        }

    } catch (error) {
        console.error('[MIGRATION] ERROR :', error);
    }
};

module.exports = migrateDatabase;