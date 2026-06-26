const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const db = require('../db/database');
const { logAudit } = require('../middleware/auth');

router.get('/login', (req, res) => {
  if (req.session?.user) return res.redirect('/');
  res.render('login', { error: null, next: req.query.next || '/', setupDone: req.query.setup === '1' });
});

router.post('/login', async (req, res) => {
  const { username, password, next } = req.body;
  if (!username || !password) {
    return res.render('login', { error: 'Username and password are required.', next: next || '/', setupDone: false });
  }
  const user = await db.get('SELECT * FROM admin_users WHERE LOWER(username) = LOWER($1)', [username.trim()]);
  if (!user || !await bcrypt.compare(password, user.password_hash)) {
    await logAudit(username.trim(), 'FAILED_LOGIN', username.trim(), 'auth', 'Invalid credentials', req.ip);
    return res.render('login', { error: 'Invalid credentials.', next: next || '/', setupDone: false });
  }
  await db.run('UPDATE admin_users SET last_login=NOW() WHERE id=$1', [user.id]);
  await logAudit(user.username, 'LOGIN', user.username, 'auth', 'Successful login', req.ip);
  req.session.user = { id: user.id, username: user.username, display_name: user.display_name || user.username, role: user.role };
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
  if (!username || !password || password.length < 8) {
    return res.render('setup', { error: 'Username required and password must be at least 8 characters.' });
  }
  const hash = await bcrypt.hash(password, 12);
  await db.run(
    "INSERT INTO admin_users (username, password_hash, display_name, role, created_by) VALUES ($1,$2,$3,'admin','SETUP')",
    [username.trim(), hash, (display_name?.trim() || username.trim())]
  );
  res.redirect('/login?setup=1');
});

module.exports = router;
