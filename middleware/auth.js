const db = require('../db/database');

// IP allowlist — set ALLOWED_IPS in env as comma-separated list, e.g. "1.2.3.4,5.6.7.8"
const ALLOWED_IPS = process.env.ALLOWED_IPS
  ? process.env.ALLOWED_IPS.split(',').map(s => s.trim()).filter(Boolean)
  : [];

function getClientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || '';
}

function requireIp(req, res, next) {
  if (ALLOWED_IPS.length === 0) return next(); // not configured → no restriction
  const ip = getClientIp(req);
  if (ALLOWED_IPS.includes(ip)) return next();
  return res.status(403).render('error', {
    user: req.session?.user || null,
    code: 403,
    message: 'ACCESS DENIED — Your network address is not authorised to access this resource.'
  });
}

const SESSION_TIMEOUT_MS = (parseInt(process.env.SESSION_TIMEOUT_MINUTES) || 60) * 60 * 1000;

function requireAuth(req, res, next) {
  if (!req.session?.user) {
    return res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
  }
  // Session idle timeout
  const now = Date.now();
  if (req.session.lastActivity && (now - req.session.lastActivity) > SESSION_TIMEOUT_MS) {
    return req.session.destroy(() => {
      res.redirect('/login?timeout=1');
    });
  }
  req.session.lastActivity = now;
  // Suspended account check
  if (req.session.user.suspended) {
    return req.session.destroy(() => {
      res.redirect('/login?suspended=1');
    });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session?.user) return res.redirect('/login');
  if (req.session.user.suspended) {
    return req.session.destroy(() => res.redirect('/login?suspended=1'));
  }
  if (req.session.user.role !== 'admin') {
    return res.status(403).render('error', { user: req.session.user, code: 403, message: 'ACCESS DENIED — Administrator clearance required.' });
  }
  next();
}

async function logAudit(actor, action, target, targetType, details, ip) {
  try {
    await db.run(
      'INSERT INTO audit_logs (action, actor, target, target_type, details, ip_address) VALUES ($1,$2,$3,$4,$5,$6)',
      [action, actor, target || null, targetType || null, details || null, ip || 'unknown']
    );
  } catch {}
}

function requireClearance(level) {
  return function(req, res, next) {
    const userLevel = req.session?.user?.clearance_level || 1;
    if (userLevel < level) {
      return res.status(403).render('error', {
        user: req.session?.user || null,
        code: 403,
        message: `ACCESS DENIED — Clearance level ${level} required. Your current clearance is level ${userLevel}.`
      });
    }
    next();
  };
}

module.exports = { requireAuth, requireAdmin, requireIp, requireClearance, logAudit };
