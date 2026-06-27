require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const { pool, initSchema } = require('./db/database');

async function main() {
  await initSchema();
  console.log('Database schema ready');

  const app = express();
  const PORT = process.env.PORT || 3000;

  const pgSession = require('connect-pg-simple')(session);

  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));
  app.set('trust proxy', 1);

  app.use(express.static(path.join(__dirname, 'public'), {
    maxAge: process.env.NODE_ENV === 'production' ? '7d' : 0,
    etag: true,
    lastModified: true,
  }));
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());

  // Inject footer globals into every view
  const { version } = require('./package.json');
  app.use((req, res, next) => {
    res.locals.appVersion  = version;
    res.locals.appEnv      = process.env.NODE_ENV === 'production' ? 'PROD' : 'DEV';
    res.locals.buildDate   = '27 Jun 2026';
    next();
  });

  app.use(session({
    store: new pgSession({ pool, tableName: 'session' }),
    secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
      maxAge: 8 * 60 * 60 * 1000,
      sameSite: 'lax',
    },
  }));

  app.set('startTime', Date.now());

  const scheduler     = require('./services/scheduler');
  scheduler.start();

  const authRoutes    = require('./routes/auth');
  const watchlistRoutes = require('./routes/watchlist');
  const adminRoutes   = require('./routes/admin');
  const groupsRoutes  = require('./routes/groups');
  const { requireAuth, requireAdmin } = require('./middleware/auth');
  const db = require('./db/database');

  app.use('/', authRoutes);
  app.use('/watchlist', watchlistRoutes);
  app.use('/admin', adminRoutes);
  app.use('/groups', groupsRoutes);

  // Public status page — no auth required
  app.get('/status', async (req, res) => {
    const { version } = require('./package.json');
    const startTime = app.get('startTime');
    const uptimeMs = Date.now() - startTime;

    // DB health check
    let dbOk = false;
    let dbLatency = null;
    try {
      const t0 = Date.now();
      await db.get('SELECT 1');
      dbLatency = Date.now() - t0;
      dbOk = true;
    } catch (_) {}

    // Counts
    let counts = { entities: 0, groups: 0, users: 0, notes: 0 };
    try {
      const [e, g, u, n] = await Promise.all([
        db.get('SELECT COUNT(*) AS c FROM roblox_entities'),
        db.get('SELECT COUNT(*) AS c FROM groups_of_interest'),
        db.get('SELECT COUNT(*) AS c FROM admin_users'),
        db.get('SELECT COUNT(*) AS c FROM entity_notes'),
      ]);
      counts = { entities: +e.c, groups: +g.c, users: +u.c, notes: +n.c };
    } catch (_) {}

    res.render('status', {
      version,
      env:         process.env.NODE_ENV === 'production' ? 'PRODUCTION' : 'DEVELOPMENT',
      buildDate:   '27 Jun 2026',
      uptimeMs,
      dbOk,
      dbLatency,
      counts,
      scheduler:   scheduler.getState(),
      generatedAt: new Date(),
    });
  });

  // Dashboard
  app.get('/', requireAuth, async (req, res) => {
    const [total, critical, high, medium, active, recent, recentLogs] = await Promise.all([
      db.get('SELECT COUNT(*) AS cnt FROM roblox_entities'),
      db.get("SELECT COUNT(*) AS cnt FROM roblox_entities WHERE severity='CRITICAL'"),
      db.get("SELECT COUNT(*) AS cnt FROM roblox_entities WHERE severity='HIGH'"),
      db.get("SELECT COUNT(*) AS cnt FROM roblox_entities WHERE severity='MEDIUM'"),
      db.get("SELECT COUNT(*) AS cnt FROM roblox_entities WHERE status='ACTIVE'"),
      db.all('SELECT * FROM roblox_entities ORDER BY added_at DESC LIMIT 6'),
      db.all('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 12'),
    ]);
    res.render('dashboard', {
      user: req.session.user,
      stats: { total: total.cnt, critical: critical.cnt, high: high.cnt, medium: medium.cnt, active: active.cnt },
      recent,
      recentLogs,
      page: 'dashboard',
    });
  });

  // Global search
  app.get('/search', requireAuth, async (req, res) => {
    const q = (req.query.q || '').trim();
    if (q.length < 2) {
      return res.render('search', { user: req.session.user, q, entities: [], logs: [], page: null });
    }
    const like = `%${q}%`;
    const [entities, logs] = await Promise.all([
      db.all(
        `SELECT * FROM roblox_entities WHERE username ILIKE $1 OR display_name ILIKE $1 OR roblox_id::text ILIKE $1 OR category ILIKE $1 ORDER BY added_at DESC LIMIT 20`,
        [like]
      ),
      db.all(
        `SELECT * FROM audit_logs WHERE actor ILIKE $1 OR target ILIKE $1 OR details ILIKE $1 ORDER BY created_at DESC LIMIT 20`,
        [like]
      ),
    ]);
    res.render('search', { user: req.session.user, q, entities, logs, page: null });
  });

  // Audit logs
  app.get('/audit', requireAuth, async (req, res) => {
    const { actor, action, target, page: pageNum } = req.query;
    const limit = 50;
    const offset = (parseInt(pageNum) - 1 || 0) * limit;
    const conditions = ['1=1'];
    const params = [];
    if (actor)  { conditions.push(`actor ILIKE $${params.length + 1}`);  params.push(`%${actor}%`); }
    if (action) { conditions.push(`action = $${params.length + 1}`);     params.push(action); }
    if (target) { conditions.push(`target ILIKE $${params.length + 1}`); params.push(`%${target}%`); }
    const where = conditions.join(' AND ');
    const [logs, totalRow] = await Promise.all([
      db.all(`SELECT * FROM audit_logs WHERE ${where} ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, [...params, limit, offset]),
      db.get(`SELECT COUNT(*) AS cnt FROM audit_logs WHERE ${where}`, params),
    ]);
    res.render('audit', {
      user: req.session.user,
      logs,
      total: parseInt(totalRow.cnt),
      limit,
      offset,
      filters: { actor, action, target },
      page: 'audit',
    });
  });

  // Network view
  app.get('/network', requireAuth, async (req, res) => {
    const entities = await db.all('SELECT id, roblox_id, username, display_name, avatar_url, severity, status FROM roblox_entities ORDER BY added_at DESC');
    res.render('network', { user: req.session.user, entities, page: 'network' });
  });

  // Settings
  app.get('/settings', requireAuth, (req, res) => {
    res.render('settings', {
      user: req.session.user,
      page: 'settings',
      success: null,
      error: null,
      schedulerState: scheduler.getState(),
    });
  });

  // Manual trigger (admin only)
  app.post('/settings/scheduler/run', requireAuth, async (req, res) => {
    if (req.session.user.role !== 'admin') return res.status(403).end();
    scheduler.runRefresh();
    res.redirect('/settings?schedulerTriggered=1');
  });

  app.post('/settings/password', requireAuth, async (req, res) => {
    const bcrypt = require('bcryptjs');
    const { current_password, new_password, confirm_password } = req.body;
    const userRow = await db.get('SELECT * FROM admin_users WHERE id = $1', [req.session.user.id]);
    if (!await bcrypt.compare(current_password, userRow.password_hash)) {
      return res.render('settings', { user: req.session.user, page: 'settings', success: null, error: 'Current password is incorrect.' });
    }
    if (new_password !== confirm_password) {
      return res.render('settings', { user: req.session.user, page: 'settings', success: null, error: 'New passwords do not match.' });
    }
    if (new_password.length < 8) {
      return res.render('settings', { user: req.session.user, page: 'settings', success: null, error: 'Password must be at least 8 characters.' });
    }
    const hash = await bcrypt.hash(new_password, 12);
    await db.run('UPDATE admin_users SET password_hash=$1 WHERE id=$2', [hash, req.session.user.id]);
    res.render('settings', { user: req.session.user, page: 'settings', success: 'Password updated.', error: null });
  });

  // 404
  app.use((req, res) => {
    res.status(404).render('error', { user: req.session?.user || null, code: 404, message: 'The requested resource was not found.' });
  });

  // Error handler
  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).render('error', { user: req.session?.user || null, code: 500, message: 'An internal server error occurred.' });
  });

  app.listen(PORT, async () => {
    console.log(`Intelligence Database running on port ${PORT}`);
    const row = await db.get('SELECT COUNT(*) AS cnt FROM admin_users');
    if (parseInt(row.cnt) === 0) {
      console.log(`\n>>> No admin accounts found. Visit /setup with token: ${process.env.SETUP_TOKEN || '(SETUP_TOKEN not set)'}\n`);
    }
  });
}

main().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
