const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const db = require('../db/database');
const { requireAdmin } = require('../middleware/auth');
const { logAudit } = require('../middleware/auth');

function actor(req) { return req.session.user.username; }

async function getUsers() {
  return db.all('SELECT id, username, display_name, role, last_login, created_at, created_by FROM admin_users ORDER BY created_at DESC');
}

router.get('/', requireAdmin, async (req, res) => {
  const users = await getUsers();
  res.render('admin', { user: req.session.user, users, error: req.query.error || null, success: req.query.deleted === '1' ? 'Operator deleted.' : null, page: 'admin' });
});

router.post('/users/add', requireAdmin, async (req, res) => {
  const { username, password, display_name, role } = req.body;
  const users = await getUsers();

  if (!username || !password) {
    return res.render('admin', { user: req.session.user, users, error: 'Username and password required.', success: null, page: 'admin' });
  }
  if (password.length < 8) {
    return res.render('admin', { user: req.session.user, users, error: 'Password must be at least 8 characters.', success: null, page: 'admin' });
  }
  const existing = await db.get('SELECT id FROM admin_users WHERE LOWER(username)=LOWER($1)', [username.trim()]);
  if (existing) {
    return res.render('admin', { user: req.session.user, users, error: `Username "${username}" already exists.`, success: null, page: 'admin' });
  }

  const validRoles = ['admin', 'analyst', 'viewer'];
  const assignedRole = validRoles.includes(role) ? role : 'analyst';
  const hash = await bcrypt.hash(password, 12);
  await db.run(
    'INSERT INTO admin_users (username, password_hash, display_name, role, created_by) VALUES ($1,$2,$3,$4,$5)',
    [username.trim(), hash, display_name?.trim() || username.trim(), assignedRole, actor(req)]
  );
  await logAudit(actor(req), 'CREATE_USER', username.trim(), 'admin', `Created with role: ${assignedRole}`, req.ip);

  const updatedUsers = await getUsers();
  res.render('admin', { user: req.session.user, users: updatedUsers, error: null, success: `Operator "${username}" created.`, page: 'admin' });
});

router.post('/users/:id/reset-password', requireAdmin, async (req, res) => {
  const { new_password } = req.body;
  const target = await db.get('SELECT * FROM admin_users WHERE id=$1', [req.params.id]);
  const users = await getUsers();

  if (!target) return res.render('admin', { user: req.session.user, users, error: 'User not found.', success: null, page: 'admin' });
  if (!new_password || new_password.length < 8) return res.render('admin', { user: req.session.user, users, error: 'Password must be at least 8 characters.', success: null, page: 'admin' });

  const hash = await bcrypt.hash(new_password, 12);
  await db.run('UPDATE admin_users SET password_hash=$1 WHERE id=$2', [hash, target.id]);
  await logAudit(actor(req), 'RESET_PASSWORD', target.username, 'admin', 'Password reset by administrator', req.ip);

  const updatedUsers = await getUsers();
  res.render('admin', { user: req.session.user, users: updatedUsers, error: null, success: `Password reset for "${target.username}".`, page: 'admin' });
});

router.post('/users/:id/change-role', requireAdmin, async (req, res) => {
  const { role } = req.body;
  const target = await db.get('SELECT * FROM admin_users WHERE id=$1', [req.params.id]);
  const users = await getUsers();

  if (!target) return res.render('admin', { user: req.session.user, users, error: 'User not found.', success: null, page: 'admin' });
  if (String(target.id) === String(req.session.user.id)) {
    return res.render('admin', { user: req.session.user, users, error: 'You cannot change your own role.', success: null, page: 'admin' });
  }
  const validRoles = ['admin', 'analyst', 'viewer'];
  if (!validRoles.includes(role)) return res.render('admin', { user: req.session.user, users, error: 'Invalid role.', success: null, page: 'admin' });

  await db.run('UPDATE admin_users SET role=$1 WHERE id=$2', [role, target.id]);
  await logAudit(actor(req), 'CHANGE_ROLE', target.username, 'admin', `Role changed to ${role}`, req.ip);

  const updatedUsers = await getUsers();
  res.render('admin', { user: req.session.user, users: updatedUsers, error: null, success: `Role updated for "${target.username}".`, page: 'admin' });
});

router.post('/users/:id/delete', requireAdmin, async (req, res) => {
  const target = await db.get('SELECT * FROM admin_users WHERE id=$1', [req.params.id]);
  if (target && String(target.id) === String(req.session.user.id)) {
    const users = await getUsers();
    return res.render('admin', { user: req.session.user, users, error: 'You cannot delete your own account.', success: null, page: 'admin' });
  }
  if (target) {
    await db.run('DELETE FROM admin_users WHERE id=$1', [target.id]);
    await logAudit(actor(req), 'DELETE_USER', target.username, 'admin', 'Operator account deleted', req.ip);
  }
  res.redirect('/admin?deleted=1');
});

module.exports = router;
