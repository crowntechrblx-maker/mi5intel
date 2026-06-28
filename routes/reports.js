const express = require('express');
const router = express.Router();
const db = require('../db/database');
const { requireAuth } = require('../middleware/auth');
const { logAudit } = require('../middleware/auth');

function actor(req) { return req.session.user.username; }

function genRef(type) {
  const now = new Date();
  const yr = now.getFullYear();
  const seq = Math.floor(Math.random() * 9000) + 1000;
  return `${type}/ITRVW/${yr}-${seq}`;
}

// ── List ──────────────────────────────────────────────────────
router.get('/', requireAuth, async (req, res) => {
  const reports = await db.all(`
    SELECT r.*, e.username AS entity_username, e.avatar_url AS entity_avatar
    FROM interview_reports r
    LEFT JOIN roblox_entities e ON e.id = r.entity_id
    ORDER BY r.created_at DESC
  `);
  res.render('reports/index', { user: req.session.user, reports, page: 'reports' });
});

// ── New report form ───────────────────────────────────────────
router.get('/new', requireAuth, (req, res) => {
  const type = (req.query.type || 'POI').toUpperCase();
  if (!['OCG','POI'].includes(type)) return res.redirect('/reports/new?type=POI');
  const entityId = req.query.entity_id || null;
  res.render('reports/new', { user: req.session.user, type, entityId, error: null, page: 'reports' });
});

// ── Submit report ─────────────────────────────────────────────
router.post('/new', requireAuth, async (req, res) => {
  const { report_type, subject_name, status, summary, reliability_rating } = req.body;
  const entity_id = req.body.entity_id || null;
  const type = (report_type || 'POI').toUpperCase();

  if (!subject_name?.trim()) {
    return res.render('reports/new', { user: req.session.user, type, entityId: entity_id, error: 'Subject name is required.', page: 'reports' });
  }

  // Collect answers — all fields prefixed with q_
  const answers = {};
  for (const [key, val] of Object.entries(req.body)) {
    if (key.startsWith('q_')) answers[key.slice(2)] = val;
  }

  const reference = genRef(type);
  const { lastInsertId } = await db.run(
    `INSERT INTO interview_reports (report_type, reference, entity_id, subject_name, case_officer, status, answers, summary, reliability_rating)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [type, reference, entity_id || null, subject_name.trim(), actor(req), status || 'COOPERATING', JSON.stringify(answers), summary || null, reliability_rating || null]
  );

  await logAudit(actor(req), 'FILE_REPORT', subject_name.trim(), 'report', `${type} interview report filed — ${reference}`, req.ip);
  res.redirect(`/reports/${lastInsertId}`);
});

// ── View report ───────────────────────────────────────────────
router.get('/:id', requireAuth, async (req, res) => {
  const report = await db.get(`
    SELECT r.*, e.username AS entity_username, e.roblox_id AS entity_roblox_id, e.avatar_url AS entity_avatar
    FROM interview_reports r
    LEFT JOIN roblox_entities e ON e.id = r.entity_id
    WHERE r.id=$1
  `, [req.params.id]);
  if (!report) return res.status(404).render('error', { user: req.session.user, code: 404, message: 'Report not found.' });
  res.render('reports/view', { user: req.session.user, report, page: 'reports' });
});

// ── Delete report (admin only) ────────────────────────────────
router.post('/:id/delete', requireAuth, async (req, res) => {
  if (req.session.user.role !== 'admin') return res.status(403).end();
  const report = await db.get('SELECT * FROM interview_reports WHERE id=$1', [req.params.id]);
  if (report) {
    await db.run('DELETE FROM interview_reports WHERE id=$1', [report.id]);
    await logAudit(actor(req), 'DELETE_REPORT', report.subject_name, 'report', `Deleted ${report.report_type} report ${report.reference}`, req.ip);
  }
  res.redirect('/reports');
});

module.exports = router;
