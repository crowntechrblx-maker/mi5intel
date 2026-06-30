const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const db = require('../db/database');
const { logAudit } = require('../middleware/auth');

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  skipSuccessfulRequests: true,
  handler: (req, res) => {
    res.status(429).render('login', {
      error: 'Too many failed attempts — try again in 15 minutes.',
      next: req.body.next || '/',
      setupDone: false,
    });
  },
});

router.get('/login', (req, res) => {
  if (req.session?.user) return res.redirect('/');
  const error = req.query.timeout === '1'
    ? 'Your session expired due to inactivity.'
    : req.query.suspended === '1'
    ? 'This account has been suspended. Contact an administrator.'
    : req.query.reason === 'screenshot'
    ? 'Session terminated: attempted screen capture detected.'
    : null;
  res.render('login', { error, next: req.query.next || '/', setupDone: req.query.setup === '1' });
});

router.post('/login', loginLimiter, async (req, res) => {
  const { username, password, next } = req.body;
  if (!username || !password) {
    return res.render('login', { error: 'Username and password are required.', next: next || '/', setupDone: false });
  }
  const user = await db.get('SELECT * FROM admin_users WHERE LOWER(username) = LOWER($1)', [username.trim()]);
  if (!user || !user.password_hash || !await bcrypt.compare(password, user.password_hash)) {
    await logAudit(username.trim(), 'FAILED_LOGIN', username.trim(), 'auth', 'Invalid credentials', req.ip);
    return res.render('login', { error: 'Invalid credentials.', next: next || '/', setupDone: false });
  }
  if (user.suspended) {
    await logAudit(user.username, 'BLOCKED_LOGIN', user.username, 'auth', 'Login attempt on suspended account', req.ip);
    return res.render('login', { error: 'This account has been suspended.', next: next || '/', setupDone: false });
  }
  await db.run('UPDATE admin_users SET last_login=NOW() WHERE id=$1', [user.id]);
  await logAudit(user.username, 'LOGIN', user.username, 'auth', 'Successful login', req.ip);
  req.session.user = {
    id: user.id, username: user.username,
    display_name: user.display_name || user.username,
    role: user.role, permissions: user.permissions || [],
    suspended: user.suspended || false,
    clearance_level: user.clearance_level || 1,
  };
  req.session.lastActivity = Date.now();
  const redirectTo = (next && next.startsWith('/') && !next.startsWith('//')) ? next : '/';
  res.redirect(redirectTo);
});

router.post('/logout', async (req, res) => {
  const username = req.session?.user?.username;
  req.session.destroy(async () => {
    if (username) await logAudit(username, 'LOGOUT', username, 'auth', 'Session terminated', req.ip);
    res.redirect('/login');
  });
});

router.get('/setup', async (req, res) => {
  const row = await db.get('SELECT COUNT(*) AS cnt FROM admin_users');
  if (parseInt(row.cnt) > 0) return res.redirect('/login');
  res.render('setup', { error: null });
});

router.post('/setup', async (req, res) => {
  const row = await db.get('SELECT COUNT(*) AS cnt FROM admin_users');
  if (parseInt(row.cnt) > 0) return res.redirect('/login');
  const { token, username, password, display_name } = req.body;
  if (token !== process.env.SETUP_TOKEN) return res.render('setup', { error: 'Invalid setup token.' });
  if (!username || !password || password.length < 8) return res.render('setup', { error: 'Username required, password min 8 chars.' });
  const hash = await bcrypt.hash(password, 12);
  await db.run(
    "INSERT INTO admin_users (username, password_hash, display_name, role, created_by) VALUES ($1,$2,$3,'admin','SETUP')",
    [username.trim(), hash, display_name?.trim() || username.trim()]
  );
  res.redirect('/login?setup=1');
});

module.exports = router;
