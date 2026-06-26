const db = require('../db/database');

function requireAuth(req, res, next) {
  if (!req.session?.user) {
    return res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session?.user) return res.redirect('/login');
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

module.exports = { requireAuth, requireAdmin, logAudit };
