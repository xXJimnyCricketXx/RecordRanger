/**
 * controllers/authController.js
 *
 * Authentication controller: handles rendering the login page, processing
 * login submissions, creating a JWT cookie on success, logging login
 * attempts, rate-limiting repeated failures and logging out users.
 */
const User = require("../models/User");
const jwt = require('jsonwebtoken');
const LoginLog = require("../models/LoginLog");
const geoip = require('geoip-lite');
const clientIp = require('../utils/clientIp');

// In-memory tracking of failed logins to throttle brute-force attempts. Counting
// per IP and email keeps an attacker from locking the owner out from elsewhere;
// the higher limit per IP stops trying many addresses from one place.
const loginFailures = new Map(); // key -> { count, resetAt }
const MAX_ATTEMPTS = 4;
const MAX_ATTEMPTS_PER_IP = 20;
const BLOCK_TIME = 5 * 60 * 1000; // 5 minutes (can be adjusted as needed)
const MAX_EMAIL_LENGTH = 254;

const secondsBlocked = (key, limit, now) => {
  const entry = loginFailures.get(key);
  if (!entry || entry.count < limit || entry.resetAt <= now) return 0;
  return Math.ceil((entry.resetAt - now) / 1000);
};

const recordFailure = (key, now) => {
  const previous = loginFailures.get(key);
  const count = previous && previous.resetAt > now ? previous.count + 1 : 1;
  loginFailures.set(key, { count, resetAt: now + BLOCK_TIME });
  return count;
};

const pruneFailures = (now) => {
  for (const [key, entry] of loginFailures) {
    if (entry.resetAt <= now) loginFailures.delete(key);
  }
};

/**
 * Translate known errors into i18n keys returned to the client.
 * This function handles both manual logic errors and Mongoose validation errors.
 * @param {Error} err - Error thrown by model operations
 * @returns {{login: string}} Object containing the i18n key for the error
 */
const handleErrors = (err) => {
  let errors = { login: '' };

  // Manual check for login logic (custom errors thrown by User.login static method)
  if (err.message === 'incorrect email' || err.message === 'incorrect password') {
    errors.login = 'errors.invalid_credentials';
  }

  // If the error is a validation error, we extract the key defined in the User Schema.
  if (err.message.includes('user validation failed')) {
    Object.values(err.errors).forEach(({ properties }) => {
      // The properties.message contains the i18n key (e.g., "auth.email_required")
      errors.login = properties.message;
    });
  }

  return errors;
};

/**
 * GET /login
 * Render the login page.
 */
module.exports.login_get = (req, res) => {
  res.render('login');
};

/**
 * POST /login
 * Process login form submissions. Implements simple in-memory rate limiting
 * and logs each attempt (success or failure) with geolocation information.
 */
module.exports.login_post = async (req, res) => {
  const { email, password } = req.body;
  const now = Date.now();

  if (typeof email !== 'string' || typeof password !== 'string' || email.length > MAX_EMAIL_LENGTH) {
    return res.status(400).json({ errors: { login: req.t('errors.invalid_credentials') } });
  }

  const ip = clientIp(req);
  const attemptKey = `${ip}|${email.toLowerCase()}`;

  // Check whether this client is temporarily blocked due to repeated failures.
  const secondsLeft = Math.max(
    secondsBlocked(attemptKey, MAX_ATTEMPTS, now),
    secondsBlocked(ip, MAX_ATTEMPTS_PER_IP, now)
  );
  if (secondsLeft > 0) {
    return res.status(429).json({
      errors: { login: req.t('errors.too_many_attempts_timed', { seconds: secondsLeft }) }
    });
  }

  try {
    const user = await User.login(email, password);

    const geo = geoip.lookup(ip) || {};

    await LoginLog.create({
      user: user._id,
      username: user.username,
      email: user.email,
      ip,
      country: geo.country || 'XX',
      city: geo.city || req.t('common.unknown'),
      userAgent: req.headers['user-agent'],
      status: 'success'
    });

    // Clear failed attempts on successful login.
    loginFailures.delete(attemptKey);

    const token = jwt.sign({ id: user._id }, process.env.PASSJWT, { expiresIn: '3d' });

    res.cookie('jwt', token, { 
        httpOnly: true, 
        maxAge: 3 * 24 * 60 * 60 * 1000,
        secure: process.env.PROD === 'true', // Only send cookie over HTTPS in production
        sameSite: 'lax' // Mitigate CSRF
    });
    res.status(200).json({ user: user._id });

  } catch (err) {
    // Only wrong credentials count: a database outage must not lock anyone out.
    if (err.message !== 'incorrect email' && err.message !== 'incorrect password') throw err;

    pruneFailures(now);
    const failures = recordFailure(attemptKey, now);
    const ipFailures = recordFailure(ip, now);

    // If a threshold is reached, the block window starts now.
    if (failures >= MAX_ATTEMPTS || ipFailures >= MAX_ATTEMPTS_PER_IP) {
      return res.status(429).json({
        errors: { login: req.t('errors.too_many_attempts_blocked') }
      });
    }

    // Retrieve the error key from handleErrors.
    const errorKeys = handleErrors(err);
    
    // Translate the key returned by the model using the current request language.
    res.status(400).json({
      errors: { login: req.t(errorKeys.login) }
    });
  }
};

/**
 * GET /logout
 */
module.exports.logout_get = (req, res) => {
  res.cookie('jwt', '', { maxAge: 1 });
  res.redirect('/');
};
