const fs = require('fs');
const path = require('path');
const Item = require('../models/Item');
const User = require('../models/User');
const LoginLog = require('../models/LoginLog');
const Settings = require('../models/Settings');
const migrateDatabase = require('./migrate');

/**
 * utils/backupScheduler.js
 *
 * Builds/restores full-database JSON backups (same shape as the manual
 * export/import) and, additionally, writes timed snapshots to disk on a
 * schedule read from Settings.backupSchedule, pruning down to the
 * configured retention count.
 */

const BACKUP_DIR = path.join(__dirname, '..', 'backups');
const FILENAME_RE = /^recordranger_backup_[\d-]+T[\d-]+\.json$/;

function ensureDir() {
    if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

function isSafeFilename(name) {
    return typeof name === 'string' && FILENAME_RE.test(name);
}

async function buildBackupData() {
    return {
        users: await User.find({}).lean(),
        albums: await Item.find({}).lean(),
        logs: await LoginLog.find({}).lean(),
        settings: await Settings.findOne().lean(),
        metadata: { version: '2.0.0', date: new Date() }
    };
}

function invalidBackup(message) {
    const err = new Error(message);
    err.invalidBackup = true;
    return err;
}

// Everything that can be checked is checked before the first document is deleted.
function validateBackup(data, albums) {
    if (!data || !Array.isArray(data.users) || !data.users.some(u => u && u.isAdmin === true)
        || (data.albums !== undefined && !Array.isArray(data.albums))
        || (data.logs !== undefined && !Array.isArray(data.logs))) {
        throw invalidBackup('Backup file missing required fields');
    }

    const check = (Model, docs) => docs.forEach((doc) => {
        const error = new Model(doc).validateSync();
        if (error) throw invalidBackup(`Backup contains invalid data: ${error.message}`);
    });

    check(User, data.users);
    check(Item, albums);
    check(LoginLog, data.logs || []);
}

async function wipeCollections() {
    await Promise.all([
        LoginLog.deleteMany({}),
        Item.deleteMany({}),
        User.deleteMany({}),
        Settings.deleteMany({})
    ]);
}

// Writes the snapshot back as it was read, without casting or validation.
async function putBackSnapshot(snapshot) {
    await wipeCollections();
    if (snapshot.users.length > 0) await User.collection.insertMany(snapshot.users);
    if (snapshot.albums.length > 0) await Item.collection.insertMany(snapshot.albums);
    if (snapshot.logs.length > 0) await LoginLog.collection.insertMany(snapshot.logs);
    if (snapshot.settings) await Settings.collection.insertOne(snapshot.settings);
}

let restoreRunning = false;

async function restoreFromData(data) {
    if (restoreRunning) throw invalidBackup('A restore is already running');
    restoreRunning = true;

    try {
        const albums = ((data && data.albums) || []).map(a => (a && a.kind) ? a : { ...a, kind: 'Music' });
        validateBackup(data, albums);

        // Keep the current data, in memory for a rollback and on disk for the user.
        // If the snapshot cannot be written, stop while nothing has been touched.
        const snapshot = await buildBackupData();
        const hasData = snapshot.users.length > 0 || snapshot.albums.length > 0;
        const snapshotFile = hasData ? writeBackupFile(snapshot) : null;

        try {
            await wipeCollections();
            await User.insertMany(data.users);
            if (albums.length > 0) await Item.insertMany(albums);
            if (data.logs && data.logs.length > 0) await LoginLog.insertMany(data.logs);
            await Settings.create(data.settings || {});
        } catch (err) {
            console.error('[Backup] Restore failed, putting previous data back:', err);
            try {
                await putBackSnapshot(snapshot);
            } catch (rollbackErr) {
                console.error('[Backup] Rollback failed:', rollbackErr);
                throw new Error(`Restore failed and the previous data could not be put back. Your data is saved in ${snapshotFile}.`);
            }
            throw new Error(`Restore failed, the previous data was put back: ${err.message}`);
        }

        // Backups from older versions may still hold legacy data
        await migrateDatabase();
    } finally {
        restoreRunning = false;
    }
}

// The temp name does not match FILENAME_RE, so an interrupted write never shows up as a backup.
function writeBackupFile(data) {
    ensureDir();
    const stamp = new Date().toISOString().replace(/:/g, '-').split('.')[0];
    const fileName = `recordranger_backup_${stamp}.json`;
    const tempPath = path.join(BACKUP_DIR, `${fileName}.tmp`);
    fs.writeFileSync(tempPath, JSON.stringify(data, null, 2));
    fs.renameSync(tempPath, path.join(BACKUP_DIR, fileName));
    return fileName;
}

async function createBackup() {
    return writeBackupFile(await buildBackupData());
}

function listBackups() {
    ensureDir();
    return fs.readdirSync(BACKUP_DIR)
        .filter(isSafeFilename)
        .map(name => {
            const stat = fs.statSync(path.join(BACKUP_DIR, name));
            return { name, size: stat.size, createdAt: stat.mtime };
        })
        .sort((a, b) => b.createdAt - a.createdAt);
}

function readBackup(fileName) {
    if (!isSafeFilename(fileName)) throw new Error('Invalid filename');
    const filePath = path.join(BACKUP_DIR, fileName);
    if (!fs.existsSync(filePath)) throw new Error('Backup not found');
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function deleteBackup(fileName) {
    if (!isSafeFilename(fileName)) throw new Error('Invalid filename');
    const filePath = path.join(BACKUP_DIR, fileName);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

async function pruneOldBackups(retention) {
    const excess = listBackups().slice(Math.max(1, retention));
    for (const f of excess) {
        try { fs.unlinkSync(path.join(BACKUP_DIR, f.name)); } catch (e) { /* already gone */ }
    }
}

// Due once the configured time-of-day has passed and the last run was at least
// `intervalDays` calendar days ago. Comparing calendar days keeps a daily backup
// daily even if the last run was a few seconds less than 24 hours ago, and a run
// missed because the app was down is made up for as soon as it is back.
function isBackupDue(schedule, now) {
    const [h, m] = (schedule.time || '03:00').split(':').map(Number);
    const scheduled = new Date(now);
    scheduled.setHours(h, m, 0, 0);
    if (now < scheduled) return false;

    if (!schedule.lastRunAt) return true;

    const startOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const daysSince = Math.round((startOfDay(now) - startOfDay(new Date(schedule.lastRunAt))) / (1000 * 60 * 60 * 24));
    return daysSince >= (schedule.intervalDays || 1);
}

// Checked once a minute. The last run is tracked in Settings so it survives
// restarts. No external cron dependency needed for a once-a-day-at-most schedule.
let schedulerInterval = null;
function startScheduler() {
    if (schedulerInterval) return;
    schedulerInterval = setInterval(async () => {
        try {
            const settings = await Settings.findOne().lean();
            const schedule = settings && settings.backupSchedule;
            if (!schedule || !schedule.enabled) return;

            const now = new Date();
            if (!isBackupDue(schedule, now)) return;

            await createBackup();
            await pruneOldBackups(schedule.retention || 3);
            await Settings.updateOne({}, { $set: { 'backupSchedule.lastRunAt': now } });
            console.log('[Backup] Scheduled backup created');
        } catch (err) {
            console.error('[Backup] Scheduler error:', err.message);
        }
    }, 60 * 1000);
}

module.exports = {
    BACKUP_DIR,
    buildBackupData,
    restoreFromData,
    createBackup,
    listBackups,
    readBackup,
    deleteBackup,
    pruneOldBackups,
    isBackupDue,
    startScheduler
};
