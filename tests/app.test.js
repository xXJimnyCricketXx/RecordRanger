// End-to-end tests against the running app and a real MongoDB. The tests build on
// each other and run in file order; login throttling comes last on purpose.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const mongoose = require('mongoose');
const { io } = require('socket.io-client');
const {
    BACKUP_DIR, BASE, MONGODB_URL, ROOT,
    startApp, stopApp, sleep, request, waitForStatus, waitUntil, jwtCookie
} = require('./helpers/app');
const { isBackupDue } = require('../utils/backupScheduler');

const { MongoClient, ObjectId } = mongoose.mongo;

const OWNER = { email: 'owner@example.test', password: 'ownerpass1' };
const GUEST = { email: 'guest@example.test', password: 'guestpass1' };
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

let app, client, albums, users;
let admin, guest, ownerId;

const login = async ({ email, password }) => jwtCookie(await request('/login', { json: { email, password } }));
const save = (fields) => request('/save-vinyl', { cookie: admin, form: { in_wishlist: 'false', ...fields } });
const byTitle = (title) => albums.find({ title }).toArray();
const duplicates = async (query) =>
    (await request(`/api/check-duplicate?${new URLSearchParams(query)}`, { cookie: admin })).json();
const insertRecord = async (fields) => albums.insertOne({ kind: 'Music', artist: 'Band', owner: ownerId, in_wishlist: false, quantity: 1, ...fields });
const backupFiles = () => fs.readdirSync(BACKUP_DIR).filter((f) => f.endsWith('.json'));

function inlineScriptErrors(html) {
    const blocks = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    const errors = [];
    for (const block of blocks) {
        try {
            new vm.Script(block);
        } catch (err) {
            errors.push(err.message);
        }
    }
    return errors;
}

const socketConnects = (cookie) => new Promise((resolve) => {
    const socket = io(BASE, {
        transports: ['websocket'],
        reconnection: false,
        extraHeaders: cookie ? { cookie } : {}
    });
    socket.on('connect', () => { socket.close(); resolve(true); });
    socket.on('connect_error', () => { socket.close(); resolve(false); });
});

before(async () => {
    client = new MongoClient(MONGODB_URL, { serverSelectionTimeoutMS: 5000 });
    await client.connect();
    await client.db().dropDatabase();
    albums = client.db().collection('albums');
    users = client.db().collection('users');
});

after(async () => {
    if (app) await stopApp(app);
    if (client) await client.close();
    fs.rmSync(BACKUP_DIR, { recursive: true, force: true });
});

// --- Startup

test('refuses to start with the example signing secret', async () => {
    for (const PASSJWT of ['SomeComplexPassword', 'ChangeThisToAComplexPassword', '']) {
        const child = startApp({ PASSJWT });
        const exitCode = await new Promise((resolve) => child.once('exit', resolve));
        assert.equal(exitCode, 1);
        assert.match(child.output, /PASSJWT/);
    }
});

test('answers with 503 while the database is unreachable', async () => {
    const child = startApp({ MONGODB_URL: 'mongodb://127.0.0.1:1/recordranger_test' });
    try {
        assert.ok(await waitForStatus('/login', 503));
        assert.match(await (await request('/login')).text(), /database is currently unavailable/);
        assert.equal(child.exitCode, null);
    } finally {
        await stopApp(child);
    }
});

test('starts against the test database', async () => {
    app = startApp();
    assert.ok(await waitForStatus('/setup', 200), app.output);
});

// --- Setup

test('setup creates the admin and the session works immediately', async () => {
    const response = await request('/setup', { form: { username: 'owner', ...OWNER, language: 'en' } });
    admin = jwtCookie(response);
    assert.ok(admin);
    assert.equal((await request('/', { cookie: admin })).status, 200);

    const owner = await users.findOne({ email: OWNER.email });
    ownerId = owner._id;
    await users.updateOne({ _id: ownerId }, { $set: { currency: 'EUR' } });
});

test('setup is locked once an admin exists', async () => {
    const response = await request('/setup', { form: { username: 'intruder', email: 'intruder@example.test', password: 'intruder1', language: 'en' } });
    assert.equal(jwtCookie(response), '');
    assert.equal(await users.countDocuments({ email: 'intruder@example.test' }), 0);
});

test('a guest account can log in', async () => {
    const html = await (await request('/admin/add-user', { cookie: admin, form: { username: 'guest', email: GUEST.email } })).text();
    const generated = html.match(/select-all[^>]*>([^<]+)</)[1].trim().replace(/&amp;/g, '&').replace(/&#39;/g, "'");
    await sleep(1100); // The new account's token must be issued after its lastChange second
    guest = await login({ email: GUEST.email, password: generated });
    assert.ok(guest);

    const change = await request('/settings/update-password', { cookie: guest, json: { currentPassword: generated, newPassword: GUEST.password } });
    assert.equal(change.status, 200);
    await sleep(1100);
    guest = await login(GUEST);
    assert.ok(guest);
});

// --- Login input and sockets

test('login rejects operators and overly long addresses', async () => {
    let response = await request('/login', { json: { email: { $ne: null }, password: OWNER.password } });
    assert.equal(response.status, 400);
    assert.equal(jwtCookie(response), '');
    response = await request('/login', { json: { email: `${'a'.repeat(300)}@example.test`, password: 'x' } });
    assert.equal(response.status, 400);
});

test('only admins can open a live connection', async () => {
    assert.equal(await socketConnects(admin), true);
    assert.equal(await socketConnects(guest), false);
    assert.equal(await socketConnects(null), false);
    assert.equal(await socketConnects('jwt=forged.token.value'), false);
});

test('broken JSON gets no technical details', async () => {
    const response = await request('/login', { body: '{bad json', headers: { 'content-type': 'application/json' } });
    const text = await response.text();
    assert.equal(response.status, 400);
    assert.doesNotMatch(text, /SyntaxError|node_modules|\.js:\d+/);
});

// --- Avatars and settings

test('avatars only accept real images', async () => {
    const upload = (name, type, content) => {
        const form = new FormData();
        form.append('avatar', new File([content], name, { type }));
        return fetch(`${BASE}/settings/upload-avatar`, { method: 'POST', headers: { cookie: guest, 'accept-language': 'en' }, body: form });
    };

    assert.equal((await upload('x.html', 'image/png', '<script>1</script>')).status, 400);
    assert.equal((await upload('x.txt', 'text/plain', 'x')).status, 400);

    const response = await upload('evil.html', 'image/png', PNG);
    const { avatarPath } = await response.json();
    assert.match(avatarPath, /\.png$/);
    const served = await fetch(BASE + avatarPath);
    assert.equal(served.headers.get('content-type'), 'image/png');
    assert.equal(served.headers.get('x-content-type-options'), 'nosniff');
    fs.rmSync(path.join(ROOT, 'public', avatarPath), { force: true });

    const legacyFile = path.join(ROOT, 'public', 'uploads', 'avatars', 'test-legacy.html');
    fs.writeFileSync(legacyFile, '<script>1</script>');
    try {
        assert.equal((await fetch(`${BASE}/uploads/avatars/test-legacy.html`)).status, 404);
    } finally {
        fs.rmSync(legacyFile);
    }
});

test('settings validate their input', async () => {
    assert.equal((await request('/settings/update-username', { cookie: guest, form: { username: '   ' } })).status, 400);
    assert.equal((await request('/settings/update-language', { cookie: guest, form: { language: 'xx' } })).status, 400);
    assert.equal((await request('/settings/update-password', { cookie: guest, json: { currentPassword: GUEST.password, newPassword: 'a' } })).status, 400);
    assert.equal((await request('/settings/update-password', { cookie: guest, json: { currentPassword: { $ne: 1 }, newPassword: 'abcdefgh' } })).status, 400);

    const response = await request('/settings/update-language', {
        cookie: guest,
        form: { language: 'en' },
        headers: { referer: 'https://evil.example//evil.example/x' }
    });
    assert.match(response.headers.get('location'), /^\/(?!\/)/);
});

// --- Saving and duplicates

test('a new entry never overwrites, only an edit changes an entry', async () => {
    await save({ title: 'Blue Album', artist: 'Band', discogs_id: '111', year: '1999' });
    await save({ title: 'Blue Album', artist: 'Band', discogs_id: '111', year: '1999' });
    const entries = await byTitle('Blue Album');
    assert.equal(entries.length, 2);
    assert.ok(entries.every((e) => e.discogs_id === 111));

    await save({ mongo_id: String(entries[0]._id), title: 'Blue Album', artist: 'Band', discogs_id: '111', year: '2000' });
    const edited = await byTitle('Blue Album');
    assert.equal(edited.length, 2);
    assert.equal(edited.find((e) => e._id.equals(entries[0]._id)).year, '2000');
    assert.equal(edited.find((e) => e._id.equals(entries[1]._id)).year, '1999');
    assert.ok(edited.every((e) => e.discogs_id === 111));

    await save({ title: 'Blue Album', artist: 'Band', discogs_id: '111' });
    assert.equal((await byTitle('Blue Album')).length, 3);
});

test('invalid saves are refused', async () => {
    const badId = await save({ title: 'Bad ID', artist: 'Band', discogs_id: 'abc' });
    assert.equal(badId.status, 400);
    assert.equal((await byTitle('Bad ID')).length, 0);

    const ghost = await save({ mongo_id: String(new ObjectId()), title: 'Ghost', artist: 'Band' });
    assert.equal(ghost.status, 404);
    assert.equal((await byTitle('Ghost')).length, 0);

    await save({ title: 'No ID', artist: 'Band', discogs_id: '' });
    assert.ok(!(await byTitle('No ID'))[0].discogs_id);
});

test('duplicates are found by title and artist or by Discogs ID', async () => {
    assert.equal((await duplicates({ title: 'Blue Album', artist: 'Band' })).matches.length, 3);
    assert.equal((await duplicates({ title: 'blue album', artist: 'BAND (2)' })).matches.length, 3);
    assert.equal((await duplicates({ title: 'Renamed', artist: 'Someone', discogsId: '111' })).matches.length, 3);
    assert.equal((await duplicates({ discogsId: '111' })).duplicate, true);
    assert.equal((await duplicates({ title: 'Other Pressing', artist: 'Band', discogsId: '222' })).duplicate, false);

    const malformed = await request('/api/check-duplicate?title[$ne]=x&artist=y', { cookie: admin });
    assert.equal((await malformed.json()).duplicate, false);
});

test('quantity can be raised', async () => {
    const [entry] = await byTitle('No ID');
    const response = await request(`/api/increment-quantity/${entry._id}`, { cookie: admin, method: 'POST' });
    assert.equal((await response.json()).quantity, 2);
});

test('estimates reach every entry of a release', async () => {
    const result = await (await request('/api/estimate/111', { cookie: admin })).json();
    assert.equal(result.success, true);
    const entries = await byTitle('Blue Album');
    assert.ok(entries.every((e) => e.estimated_price.value === 12));
    await albums.updateMany({}, { $unset: { estimated_price: '' } });
});

// --- Imports

test('CSV import skips existing records but keeps pressings within the file', async () => {
    const csv = 'Künstler/Band,Albumtitel\nCsvBand,Same Title\nCsvBand,Same Title\nBand,Blue Album\n';
    await request('/import/musik-sammler', { cookie: admin, json: { csv } });
    assert.ok(await waitUntil(async () => await albums.countDocuments({ artist: 'CsvBand' }) === 2));
    await sleep(300);
    assert.equal((await byTitle('Blue Album')).length, 3);

    await request('/import/musik-sammler', { cookie: admin, json: { csv } });
    await sleep(1000);
    assert.equal(await albums.countDocuments({ artist: 'CsvBand' }), 2);
});

test('Discogs import follows the same rules', async () => {
    await save({ title: 'Idless Match', artist: 'Y' });
    await save({ title: 'Other Pressing', artist: 'Z', discogs_id: '9999' });
    const discogsUrl = 'https://www.discogs.com/user/mockuser/collection';

    await request('/import/discogs', { cookie: admin, json: { discogsUrl, type: 'collection' } });
    assert.ok(await waitUntil(async () => await albums.countDocuments({ discogs_id: 5001 }) === 2));
    await sleep(300);
    assert.equal((await byTitle('Other Pressing')).length, 2);
    assert.equal((await byTitle('Idless Match')).length, 1);

    const count = await albums.countDocuments();
    await request('/import/discogs', { cookie: admin, json: { discogsUrl, type: 'collection' } });
    await sleep(1000);
    assert.equal(await albums.countDocuments(), count);
});

// --- Visibility and permissions

test('hidden records and genres stay hidden from guests', async () => {
    await save({ title: 'Secret Album', artist: 'Hidden Band', discogs_id: '222', genre: 'Rock', location: 'SecretShelf' });
    await save({ title: 'Public Album', artist: 'Band', discogs_id: '333', genre: 'Rock', location: 'Shelf A' });
    await save({ title: 'Genre Album', artist: 'G', genre: 'HiddenGenre' });
    const [secret] = await byTitle('Secret Album');

    await request('/admin/visibility/save', {
        cookie: admin,
        form: { hiddenItems: JSON.stringify([String(secret._id)]), hiddenGenres: 'HiddenGenre', applyToAdmin: 'false' }
    });

    for (const url of ['/collection', '/', '/stats', '/print/collection', `/album/${secret._id}`]) {
        const text = await (await request(url, { cookie: guest })).text();
        assert.doesNotMatch(text, /Secret Album/, url);
    }
    const collection = await (await request('/collection', { cookie: guest })).text();
    assert.ok(!collection.includes('HiddenGenre'));
    assert.ok(!collection.includes('SecretShelf'));
    assert.ok(collection.includes('Public Album'));

    const adminView = await (await request(`/album/${secret._id}`, { cookie: admin })).text();
    assert.ok(adminView.includes('Secret Album'));
});

test('admin routes are closed to guests and anonymous visitors', async () => {
    const [record] = await byTitle('Public Album');
    const guarded = [
        ['GET', `/album/edit/${record._id}`], ['GET', '/confirm-vinyl/111'], ['GET', '/api/estimate/111'],
        ['GET', '/api/collection/ids'], ['GET', '/api/check-duplicate?title=x&artist=y'],
        ['POST', '/import/discogs', { json: { discogsUrl: 'https://www.discogs.com/user/x' } }]
    ];
    for (const [method, url, options] of guarded) {
        const response = await request(url, { cookie: guest, method, ...options });
        assert.equal(response.status, 302, url);
        assert.equal(response.headers.get('location'), '/', url);
    }
    for (const url of ['/collection', '/stats', `/album/${record._id}`, '/api/collection/ids']) {
        const response = await request(url);
        assert.equal(response.headers.get('location'), '/login', url);
    }
    assert.equal((await request('/backup/import', { json: { users: [], albums: [] } })).status, 403);
});

// --- Output safety and pages

test('stored values cannot break out of pages', async () => {
    await save({ title: 'Evil', artist: 'E', genre: '</script><script>window.pwn=1</script>' });
    const stats = await (await request('/stats', { cookie: admin })).text();
    assert.ok(!stats.includes('</script><script>window.pwn=1</script>'));
    assert.deepEqual(inlineScriptErrors(stats), []);

    const name = "x');document.title='pwn';//";
    await request('/settings/update-username', { cookie: guest, form: { username: name } });
    const adminPage = await (await request('/admin', { cookie: admin })).text();
    assert.doesNotMatch(adminPage, /onsubmit="[^"]*pwn/);
    assert.deepEqual(inlineScriptErrors(adminPage), []);
    await request('/settings/update-username', { cookie: guest, form: { username: 'guest' } });
});

test('all main pages render and their scripts parse', async () => {
    const [record] = await byTitle('Public Album');
    const pages = {
        admin: ['/', '/stats', '/collection', '/wishlist', '/print/collection', '/print/wishlist', '/settings', '/admin',
            '/admin/personnalisation', '/add-vinyl', '/add-vinyl/manual', '/manifest.json', '/sw.js', `/album/${record._id}`, `/album/edit/${record._id}`],
        guest: ['/', '/stats', '/collection', '/wishlist', '/print/collection', '/print/wishlist', '/settings', `/album/${record._id}`]
    };
    for (const [who, urls] of Object.entries(pages)) {
        for (const url of urls) {
            const response = await request(url, { cookie: who === 'admin' ? admin : guest });
            assert.equal(response.status, 200, `${who} ${url}`);
            if (response.headers.get('content-type').includes('html')) {
                assert.deepEqual(inlineScriptErrors(await response.text()), [], `${who} ${url}`);
            }
        }
    }
});

// --- Collection value

test('the total converts currencies and leaves out what it cannot convert', async () => {
    const total = async () => {
        const text = await (await request('/stats', { cookie: admin })).text();
        return text.match(/([\d.,]+)\s*€/)[1];
    };
    await insertRecord({ title: 'Ten', artist: 'Cur', estimated_price: { value: 10, currency: 'EUR' } });
    await insertRecord({ title: 'Five', artist: 'Cur', quantity: 2, estimated_price: { value: 5, currency: 'EUR' } });
    await insertRecord({ title: 'Unknown', artist: 'Cur', estimated_price: { value: 1000, currency: 'XXX' } });
    assert.equal(await total(), '20');

    await insertRecord({ title: 'Dollars', artist: 'Cur', estimated_price: { value: 100, currency: 'USD' } });
    assert.equal(await total(), '70');
    await albums.deleteMany({ artist: 'Cur' });
});

// --- Backup schedule

test('backup schedule is due once per interval and catches up', () => {
    const lastRunAt = new Date('2026-11-01T03:00:40');
    const due = (now, schedule) => isBackupDue({ time: '03:00', intervalDays: 1, lastRunAt, ...schedule }, new Date(now));

    assert.equal(due('2026-11-02T03:00:20'), true, 'a few seconds under 24 hours');
    assert.equal(due('2026-11-02T10:00:00'), true, 'catches up after downtime');
    assert.equal(due('2026-11-02T02:59:00'), false, 'before the configured time');
    assert.equal(due('2026-11-01T10:00:00'), false, 'already ran today');
    assert.equal(due('2026-11-02T03:00:00', { intervalDays: 2 }), false, 'interval not over');
    assert.equal(due('2026-11-03T03:00:00', { intervalDays: 2 }), true, 'interval over');
});

// --- Restore

test('invalid backups are rejected before anything is deleted', async () => {
    const exported = await (await request('/backup/export', { cookie: admin })).json();
    const count = await albums.countDocuments();
    const files = backupFiles().length;

    const invalid = [
        { foo: 1 },
        { users: [{ username: 'x', email: 'x@example.test', password: 'p' }], albums: [] },
        { ...exported, albums: [{ kind: 'Music', title: 'no artist or owner' }] }
    ];
    for (const json of invalid) {
        assert.equal((await request('/backup/import', { cookie: admin, json })).status, 400);
    }
    assert.equal(await albums.countDocuments(), count);
    assert.equal(backupFiles().length, files);
});

test('a failing restore puts the previous data back', async () => {
    const exported = await (await request('/backup/export', { cookie: admin })).json();
    const count = await albums.countDocuments();
    const files = backupFiles().length;

    const colliding = { ...exported, albums: [...exported.albums, { ...exported.albums[0], title: 'collides' }] };
    const response = await request('/backup/import', { cookie: admin, json: colliding });
    assert.equal(response.status, 500);
    assert.match((await response.json()).error, /put back/);
    assert.equal(await albums.countDocuments(), count);
    assert.equal(await users.countDocuments(), exported.users.length);
    assert.equal(backupFiles().length, files + 1);
    assert.equal((await request('/', { cookie: admin })).status, 200);
});

test('a valid restore replaces the data and converts old IDs', async () => {
    const exported = await (await request('/backup/export', { cookie: admin })).json();
    const legacy = structuredClone(exported);
    legacy.albums[0].discogs_id = '4242';
    legacy.albums[1].discogs_id = '';
    delete legacy.albums[2].kind;
    await sleep(1100); // Snapshot files are named by the second
    const files = backupFiles().length;

    assert.equal((await request('/backup/import', { cookie: admin, json: legacy })).status, 200);
    assert.equal(await albums.countDocuments(), exported.albums.length);
    assert.equal(backupFiles().length, files + 1);
    assert.equal((await albums.findOne({ _id: new ObjectId(legacy.albums[0]._id) })).discogs_id, 4242);
    assert.equal(await albums.countDocuments({ discogs_id: { $type: 'string' } }), 0);
    assert.ok(await login(OWNER));
});

test('a second restore at the same time is refused', async () => {
    const exported = await (await request('/backup/export', { cookie: admin })).json();
    await sleep(1100);
    const results = await Promise.all([
        request('/backup/import', { cookie: admin, json: exported }),
        request('/backup/import', { cookie: admin, json: exported })
    ]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 400]);
    assert.equal(await albums.countDocuments(), exported.albums.length);
});

// --- Migration

test('text IDs are converted on start', async () => {
    await insertRecord({ title: 'M1', artist: 'Mig', discogs_id: '555' });
    await insertRecord({ title: 'M2', artist: 'Mig', discogs_id: 'garbage' });
    await insertRecord({ title: 'M3', artist: 'Mig', discogs_id: 777000 });

    await stopApp(app);
    app = startApp();
    assert.ok(await waitForStatus('/login', 200));
    assert.ok(await waitUntil(async () => await albums.countDocuments({ discogs_id: { $type: 'string' } }) === 0));

    assert.equal((await byTitle('M1'))[0].discogs_id, 555);
    assert.equal((await byTitle('M2'))[0].discogs_id, undefined);
    assert.equal((await byTitle('M3'))[0].discogs_id, 777000);
    await albums.deleteMany({ artist: 'Mig' });
});

// --- Old tokens

test('a token from before a password change no longer counts', async () => {
    await users.updateOne({ _id: ownerId }, { $set: { lastChange: new Date(Date.now() + 5000) } });
    const token = await request('/', { cookie: admin });
    assert.match(token.headers.get('location'), /login/);
    assert.equal((await request('/backup/import', { cookie: admin, json: { users: [] } })).status, 403);
    assert.equal(await socketConnects(admin), false);
    await users.updateOne({ _id: ownerId }, { $set: { lastChange: new Date(Date.now() - 60000) } });
    assert.equal((await request('/', { cookie: admin })).status, 200);
});

// --- IP handling and throttling

test('a client cannot escape an IP block with a forged header', async () => {
    const blockedIps = client.db().collection('blockedips');
    await blockedIps.insertOne({ ip: '127.0.0.1', createdAt: new Date() });
    const forged = await request('/login', { headers: { 'x-forwarded-for': '203.0.113.9' } });
    assert.equal(forged.status, 403);
    await blockedIps.deleteMany({});

    await blockedIps.insertOne({ ip: '203.0.113.9', createdAt: new Date() });
    const framed = await request('/login', { headers: { 'x-forwarded-for': '203.0.113.9' } });
    assert.equal(framed.status, 200);
    await blockedIps.deleteMany({});
});

test('login attempts are throttled and forged headers do not help', async () => {
    const attempt = (email, password, headers) => request('/login', { json: { email, password }, headers });

    for (let i = 1; i <= 3; i++) {
        assert.equal((await attempt('victim@example.test', 'wrong')).status, 400, `attempt ${i}`);
    }
    assert.equal((await attempt('victim@example.test', 'wrong')).status, 429);
    assert.equal((await attempt('VICTIM@example.test', 'wrong')).status, 429, 'case does not help');
    assert.equal((await attempt('victim@example.test', 'wrong', { 'x-forwarded-for': '203.0.113.7' })).status, 429, 'forged header does not help');
    assert.equal((await attempt('__proto__', 'wrong')).status, 400, 'odd addresses are just addresses');
    assert.ok(await login(OWNER), 'another account is not affected');
});

test('many addresses from one client are throttled too', async () => {
    let lastStatus;
    for (let i = 0; i < 20 && lastStatus !== 429; i++) {
        lastStatus = (await request('/login', { json: { email: `user${i}@example.test`, password: 'wrong' } })).status;
    }
    assert.equal(lastStatus, 429);
    assert.equal((await request('/login', { json: OWNER })).status, 429);
});
