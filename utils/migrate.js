const Item = require('../models/Item');

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

    } catch (error) {
        console.error('[MIGRATION] ERROR :', error);
    }
};

module.exports = migrateDatabase;