const express = require('express');
const router = express.Router();
const db = require('../db/database');
const { requireAuth, requireClearance, logAudit } = require('../middleware/auth');

const PSD = requireClearance(5);

function makeRef() {
  const d = new Date();
  const dd   = String(d.getDate()).padStart(2, '0');
  const mm   = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  const rand = String(Math.floor(1000 + Math.random() * 9000));
  return `${dd}${mm}${yyyy}RPT-${rand}`;
}

router.get('/', requireAuth, PSD, async (req, res) => {
  const cases = await db.all(`SELECT * FROM psd_case_reports ORDER BY created_at DESC`);
  res.render('psd/index', { user: req.session.user, cases, page: 'psd' });
});

router.get('/new', requireAuth, PSD, (req, res) => {
  res.render('psd/new', { user: req.session.user, page: 'psd', error: null });
});

router.post('/new', requireAuth, PSD, async (req, res) => {
  const { accused_officer, investigating_officer, misconduct_level, disciplinary_decision, doc_url, notes } = req.body;

  if (!accused_officer || !investigating_officer || !misconduct_level || !disciplinary_decision || !doc_url) {
    return res.render('psd/new', { user: req.session.user, page: 'psd', error: 'All required fields must be completed.' });
  }

  // Only allow Google Docs URLs
  if (!doc_url.startsWith('https://docs.google.com/')) {
    return res.render('psd/new', { user: req.session.user, page: 'psd', error: 'Document URL must be a Google Docs link.' });
  }

  const reference = makeRef();
  await db.run(
    `INSERT INTO psd_case_reports
       (reference, accused_officer, investigating_officer, misconduct_level, disciplinary_decision, doc_url, notes, filed_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [reference, accused_officer.trim(), investigating_officer.trim(), misconduct_level,
     disciplinary_decision.trim(), doc_url.trim(), notes?.trim() || null, req.session.user.username]
  );
  await logAudit(req, 'PSD_CASE_FILED', accused_officer.trim(), 'psd', `Reference: ${reference}`);
  res.redirect(`/psd/${reference}`);
});

router.get('/:ref', requireAuth, PSD, async (req, res) => {
  const report = await db.get(`SELECT * FROM psd_case_reports WHERE reference = $1`, [req.params.ref]);
  if (!report) return res.status(404).render('error', { user: req.session.user, code: 404, message: 'Case report not found.' });
  res.render('psd/view', { user: req.session.user, report, page: 'psd' });
});

router.post('/:ref/delete', requireAuth, PSD, async (req, res) => {
  if (req.session.user.role !== 'admin') return res.status(403).end();
  const report = await db.get(`SELECT * FROM psd_case_reports WHERE reference = $1`, [req.params.ref]);
  if (!report) return res.status(404).end();
  await db.run(`DELETE FROM psd_case_reports WHERE reference = $1`, [req.params.ref]);
  await logAudit(req, 'PSD_CASE_DELETED', report.accused_officer, 'psd', `Reference: ${req.params.ref}`);
  res.redirect('/psd');
});

module.exports = router;
