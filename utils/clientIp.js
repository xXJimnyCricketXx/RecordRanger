/**
 * utils/clientIp.js
 *
 * The client's IP address as used for logging, blocking and login throttling.
 * req.ip only honours X-Forwarded-For when 'trust proxy' is set, so a client
 * can't choose its own address by sending that header.
 */
module.exports = (req) => (req.ip || '').replace(/^::ffff:/i, '');
