// Licensed under MIT

/**
 * app.js
 *
 * Express application entrypoint. Sets up i18n, global middleware,
 * route mounting, database connection and sockets. Intended for local
 * development and small deployments; review security settings for
 * production use.
 */
require('dotenv').config();

// A publicly known signing secret would let anyone forge an admin login
const EXAMPLE_SECRETS = ['SomeComplexPassword', 'ChangeThisToAComplexPassword'];
if (!process.env.PASSJWT || EXAMPLE_SECRETS.includes(process.env.PASSJWT)) {
  console.error('❌ PASSJWT is missing or still the example value. Set it to a long random secret, e.g. the output of: openssl rand -hex 32');
  process.exit(1);
}

const express = require('express');
const jwt = require('jsonwebtoken');
const path = require('path');
const { checkUser, isTokenCurrent } = require('./middleware/authMiddleware.js');
const cookieParser = require('cookie-parser');
const mongoose = require('mongoose');
const http = require('http');
const { Server } = require("socket.io");

const i18next = require('i18next');
const i18nMiddleware = require('i18next-http-middleware');

const clientIp = require('./utils/clientIp');
const settingsMiddleware = require('./middleware/settingsMiddleware');
const { BASE_URL } = require('./config/constants');

// Models
const User = require('./models/User.js');
const BlockedIP = require('./models/blockedIP.js');

// Routes imports
const setupRoutes = require('./routes/setupRoutes');
const authRoutes = require('./routes/authRoutes.js');
const albumRoutes = require('./routes/albumRoutes.js');
const adminRoutes = require('./routes/adminRoutes.js');
const settingsRoutes = require('./routes/settingsRoutes.js');
const backupRoutes = require('./routes/backupRoutes.js');

// A forgotten await must not take the whole app down
process.on('unhandledRejection', (reason) => {
  console.error('[ERR] Unhandled rejection:', reason);
});

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  path: BASE_URL + '/socket.io',
});


i18next
  .use(i18nMiddleware.LanguageDetector) // Detect language via query/cookie/header
  .init({
    fallbackLng: 'en',
    preload: ['fr', 'en', 'es', 'it', 'de'],
    resources: {
      en: { translation: require('./locales/en.json') },
      fr: { translation: require('./locales/fr.json') },
      es: { translation: require('./locales/es.json') },
      it: { translation: require('./locales/it.json') },
      de: { translation: require('./locales/de.json') }
    },
    detection: {
      order: ['querystring', 'cookie', 'header'], // detection order
      caches: ['cookie']
    }
  });


// Basic configuration
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('io', io); // Expose io to routes

// Sockets only carry admin progress events, so only admins may connect
io.engine.use(cookieParser());
io.use(async (socket, next) => {
  try {
    const decodedToken = jwt.verify(socket.request.cookies.jwt, process.env.PASSJWT);
    const user = await User.findById(decodedToken.id);
    if (user && user.isAdmin === true && isTokenCurrent(user, decodedToken)) return next();
  } catch (err) {
    // Handled below like any other rejected connection
  }
  next(new Error('unauthorized'));
});

// Global middlewares
// Avatars are user uploads: never serve anything but images from there
app.use(BASE_URL + '/uploads/avatars', (req, res, next) => {
  if (!/\.(jpe?g|png|gif|webp)$/i.test(req.path)) return res.status(404).end();
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
});
app.use(BASE_URL, express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(cookieParser());


app.use(i18nMiddleware.handle(i18next));


if (process.env.PROD === 'true') {
  app.set('trust proxy', 1); // Trust first proxy
}

const pkg = require('./package.json');

// Incext BASE_URL in each res.redirect call
app.use((req, res, next) => {
  const redirect = res.redirect;

  res.redirect = function (url) {
    if (url.startsWith('/') && !url.startsWith(BASE_URL)) {
      return redirect.call(this, `${BASE_URL}${url}`);
    } else {
      return redirect.call(this, url);
    }
  };

  next();
});

// Without a database no page can work: answer right away instead of hanging
app.use((req, res, next) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).send(req.t('errors.database_unavailable'));
  }
  next();
});

app.use(checkUser);

app.use(async (req, res, next) => {
  // If the user is authenticated and has a language preference, enforce it
  if (req.user && req.user.language) {
    await req.i18n.changeLanguage(req.user.language);
  }

  // Make translation helper and current language available to all EJS views
  res.locals.t = req.t;
  // JSON for inline <script> blocks: "<" must not be able to close the script tag
  res.locals.safeJson = (value) => JSON.stringify(value).replace(/</g, '\\u003c');
  res.locals.currentLng = req.language;
  res.locals.appVersion = pkg.version;
  res.locals.baseUrl = BASE_URL;
  req.io = io;
  next();
});


// Security: IP blocking middleware
app.use(async (req, res, next) => {
  const ip = clientIp(req);
  try {
    const blocked = await BlockedIP.findOne({ ip: { $in: [ip, `::ffff:${ip}`] } });
    if (blocked) return res.status(403).send(req.t('common.forbidden'));
    next();
  } catch (err) {
    console.error('IP error:', err);
    next();
  }
});

// Check user middleware (populate res.locals.user for all views)
app.use(settingsMiddleware);

// Installation gatekeeper middleware
app.use(async (req, res, next) => {
    // Ignore paths that should not be redirected during setup
    if (req.path.startsWith(BASE_URL + '/setup') || 
      req.path.startsWith(BASE_URL + '/ressources') || 
      req.path.startsWith(BASE_URL + '/styles') ||
      req.path.startsWith(BASE_URL + '/login') ||
      req.path.startsWith(BASE_URL + '/backup') ) { // allow login and backup import while setting up
        return next();
    }

    try {
        const count = await User.countDocuments();
        if (count === 0) {
            return res.redirect(BASE_URL + '/setup');
        }
    } catch (e) {
        console.error("Check setup error:", e);
    }
    
    next();
});

// Dynamic manifest.json endpoint - injects BASE_URL
app.get(BASE_URL + '/manifest.json', (req, res) => {
    res.set('Content-Type', 'application/json');
    res.render(path.join(__dirname, 'public-tpl', 'manifest.json.ejs'));
});

// Dynamic service worker endpoint - injects BASE_URL
app.get(BASE_URL + '/sw.js', (req, res) => {
    res.set('Content-Type', 'application/javascript');
    res.set('Service-Worker-Allowed', BASE_URL || '/');
    res.render(path.join(__dirname, 'public-tpl', 'sw.js.ejs'));
});


// Route mounting
app.use(BASE_URL + '/setup', setupRoutes);
app.use(BASE_URL, authRoutes);
app.use(BASE_URL, albumRoutes);
app.use(BASE_URL + '/admin', adminRoutes);
app.use(BASE_URL + '/settings', settingsRoutes);
app.use(BASE_URL + '/backup', backupRoutes);

app.use((req, res) => {
    res.status(404).render('404');
});

// Last resort: log the details, never send a stack trace to the browser
app.use((err, req, res, next) => {
    console.error('[ERR]', req.method, req.originalUrl, err);
    if (res.headersSent) return next(err);
    res.status(err.status || err.statusCode || 500)
        .send(req.t ? req.t('errors.generic_server_error') : 'Internal server error.');
});

const connectDB = require('./config/db.js');
const migrateDatabase = require('./utils/migrate.js');
const { startScheduler } = require('./utils/backupScheduler.js');
// The database may start later than the app (e.g. after a server reboot), so keep trying
const connectWithRetry = async () => {
  for (;;) {
    try {
      await connectDB();
      return;
    } catch (err) {
      console.log('❌DB Error:', err.message);
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
};

// Server start and database connection
const port = process.env.VINYL_PORT || 3099;
server.listen(port, () => {
    console.log(`🚀 Server started on port ${port}`);
});

connectWithRetry()
  .then(async () => {
    await migrateDatabase();
    startScheduler();
  })
  .catch((err) => console.error('[ERR] Startup:', err));
