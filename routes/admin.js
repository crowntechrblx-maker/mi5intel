const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const db = require('../db/database');
const { requireAdmin } = require('../middleware/auth');
const { logAudit } = require('../middleware/auth');
const { PERMISSIONS, ROLE_PERMISSIONS } = require('../config/permissions');

function actor(req) { return req.session.user.username; }

async function getUsers() {
  return db.all('SELECT id, username, display_name, role, permissions, last_login, created_at, created_by FROM admin_users ORDER BY created_at DESC');
}

function parsePermissions(body) {
  // Collect checked permission keys from form checkboxes
  const perms = PERMISSIONS.map(p => p.key).filter(key => body['perm_' + key] === 'on' || body['perm_' + key] === '1');
  return perms;
}

router.get('/', requireAdmin, async (req, res) => {
  const users = await getUsers();
  const msg = req.query.deleted === '1' ? 'Operator deleted.' : null;
  res.render('admin', { user: req.session.user, users, PERMISSIONS, ROLE_PERMISSIONS, error: req.query.error || null, success: msg, page: 'admin' });
});

router.post('/users/add', requireAdmin, async (req, res) => {
  const { username, password, display_name, role } = req.body;

  const renderErr = async (error) => {
    const users = await getUsers();
    return res.render('admin', { user: req.session.user, users, PERMISSIONS, ROLE_PERMISSIONS, error, success: null, page: 'admin' });
  };

  if (!username) return renderErr('Username is required.');
  if (!password || password.length < 8) return renderErr('Password must be at least 8 characters.');

  const existing = await db.get('SELECT id FROM admin_users WHERE LOWER(username)=LOWER($1)', [username.trim()]);
  if (existing) return renderErr(`Username "${username}" already taken.`);

  const validRoles = ['admin', 'analyst', 'viewer'];
  const assignedRole = validRoles.includes(role) ? role : 'analyst';

  // Use checkboxes if provided, else fall back to role defaults
  let permissions = parsePermissions(req.body);
  if (permissions.length === 0) permissions = ROLE_PERMISSIONS[assignedRole];

  const hash = await bcrypt.hash(password, 12);
  await db.run(
    'INSERT INTO admin_users (username, password_hash, display_name, role, permissions, created_by) VALUES ($1,$2,$3,$4,$5,$6)',
    [username.trim(), hash, display_name?.trim() || username.trim(), assignedRole, JSON.stringify(permissions), actor(req)]
  );
  await logAudit(actor(req), 'CREATE_USER', username.trim(), 'admin', `Role: ${assignedRole}, permissions: ${permissions.join(',')}`, req.ip);

  const updatedUsers = await getUsers();
  res.render('admin', { user: req.session.user, users: updatedUsers, PERMISSIONS, ROLE_PERMISSIONS, error: null, success: `Operator "${username}" created.`, page: 'admin' });
});

router.post('/users/:id/permissions', requireAdmin, async (req, res) => {
  const target = await db.get('SELECT * FROM admin_users WHERE id=$1', [req.params.id]);
  const renderErr = async (error) => {
    const users = await getUsers();
    return res.render('admin', { user: req.session.user, users, PERMISSIONS, ROLE_PERMISSIONS, error, success: null, page: 'admin' });
  };

  if (!target) return renderErr('Operator not found.');

  const permissions = parsePermissions(req.body);
  await db.run('UPDATE admin_users SET permissions=$1 WHERE id=$2', [JSON.stringify(permissions), target.id]);
  await logAudit(actor(req), 'UPDATE_PERMISSIONS', target.username, 'admin', `Permissions: ${permissions.join(',')}`, req.ip);

  const updatedUsers = await getUsers();
  res.render('admin', { user: req.session.user, users: updatedUsers, PERMISSIONS, ROLE_PERMISSIONS, error: null, success: `Permissions updated for "${target.username}".`, page: 'admin' });
});

router.post('/users/:id/reset-password', requireAdmin, async (req, res) => {
  const { new_password } = req.body;
  const target = await db.get('SELECT * FROM admin_users WHERE id=$1', [req.params.id]);

  const renderErr = async (error) => {
    const users = await getUsers();
    return res.render('admin', { user: req.session.user, users, PERMISSIONS, ROLE_PERMISSIONS, error, success: null, page: 'admin' });
  };

  if (!target) return renderErr('Operator not found.');
  if (!new_password || new_password.length < 8) return renderErr('Password must be at least 8 characters.');

  const hash = await bcrypt.hash(new_password, 12);
  await db.run('UPDATE admin_users SET password_hash=$1 WHERE id=$2', [hash, target.id]);
  await logAudit(actor(req), 'RESET_PASSWORD', target.username, 'admin', 'Password reset by administrator', req.ip);

  const updatedUsers = await getUsers();
  res.render('admin', { user: req.session.user, users: updatedUsers, PERMISSIONS, ROLE_PERMISSIONS, error: null, success: `Password reset for "${target.username}".`, page: 'admin' });
});

router.post('/users/:id/change-role', requireAdmin, async (req, res) => {
  const { role } = req.body;
  const target = await db.get('SELECT * FROM admin_users WHERE id=$1', [req.params.id]);

  const renderErr = async (error) => {
    const users = await getUsers();
    return res.render('admin', { user: req.session.user, users, PERMISSIONS, ROLE_PERMISSIONS, error, success: null, page: 'admin' });
  };

  if (!target) return renderErr('Operator not found.');
  if (String(target.id) === String(req.session.user.id)) return renderErr('You cannot change your own role.');

  const validRoles = ['admin', 'analyst', 'viewer'];
  if (!validRoles.includes(role)) return renderErr('Invalid role.');

  // Sync permissions to new role defaults
  const permissions = ROLE_PERMISSIONS[role];
  await db.run('UPDATE admin_users SET role=$1, permissions=$2 WHERE id=$3', [role, JSON.stringify(permissions), target.id]);
  await logAudit(actor(req), 'CHANGE_ROLE', target.username, 'admin', `Role → ${role}`, req.ip);

  const updatedUsers = await getUsers();
  res.render('admin', { user: req.session.user, users: updatedUsers, PERMISSIONS, ROLE_PERMISSIONS, error: null, success: `Role updated for "${target.username}".`, page: 'admin' });
});

router.post('/users/:id/delete', requireAdmin, async (req, res) => {
  const target = await db.get('SELECT * FROM admin_users WHERE id=$1', [req.params.id]);
  if (target && String(target.id) === String(req.session.user.id)) {
    const users = await getUsers();
    return res.render('admin', { user: req.session.user, users, PERMISSIONS, ROLE_PERMISSIONS, error: 'You cannot delete your own account.', success: null, page: 'admin' });
  }
  if (target) {
    await db.run('DELETE FROM admin_users WHERE id=$1', [target.id]);
    await logAudit(actor(req), 'DELETE_USER', target.username, 'admin', 'Operator account deleted', req.ip);
  }
  res.redirect('/admin?deleted=1');
});

module.exports = router;
