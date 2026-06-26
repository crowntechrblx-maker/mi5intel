const express = require('express');
const router = express.Router();
const db = require('../db/database');
const { requireAuth } = require('../middleware/auth');
const { logAudit } = require('../middleware/auth');
const { fullProfileFetch } = require('../services/roblox');

function actor(req) { return req.session.user.username; }

// List
router.get('/', requireAuth, async (req, res) => {
  const { q, severity, status, category } = req.query;
  const conditions = ['1=1'];
  const params = [];

  if (q) {
    const i = params.length + 1;
    conditions.push(`(username ILIKE $${i} OR display_name ILIKE $${i} OR roblox_id ILIKE $${i} OR category ILIKE $${i})`);
    params.push(`%${q}%`);
  }
  if (severity) { params.push(severity); conditions.push(`severity = $${params.length}`); }
  if (status)   { params.push(status);   conditions.push(`status = $${params.length}`); }
  if (category) { params.push(`%${category}%`); conditions.push(`category ILIKE $${params.length}`); }

  const entities = await db.all(
    `SELECT * FROM roblox_entities WHERE ${conditions.join(' AND ')} ORDER BY added_at DESC`,
    params
  );

  for (const e of entities) {
    const tags = await db.all('SELECT tag FROM entity_tags WHERE entity_id=$1', [e.id]);
    e.tags = tags.map(t => t.tag);
  }

  res.render('watchlist/index', { user: req.session.user, entities, filters: { q, severity, status, category }, page: 'watchlist' });
});

// Add form
router.get('/add', requireAuth, (req, res) => {
  res.render('watchlist/add', { user: req.session.user, error: null, page: 'watchlist' });
});

// Add single
router.post('/add', requireAuth, async (req, res) => {
  const { identifier, severity, category, notes, tags } = req.body;
  if (!identifier) {
    return res.render('watchlist/add', { user: req.session.user, error: 'An identifier (username or user ID) is required.', page: 'watchlist' });
  }
  const profile = await fullProfileFetch(identifier.trim());
  if (profile.error) {
    return res.render('watchlist/add', { user: req.session.user, error: profile.error, page: 'watchlist' });
  }
  const existing = await db.get('SELECT id FROM roblox_entities WHERE roblox_id=$1', [profile.roblox_id]);
  if (existing) return res.redirect(`/watchlist/${existing.id}?info=already_exists`);

  const { lastInsertId } = await db.run(
    `INSERT INTO roblox_entities (roblox_id, username, display_name, avatar_url, profile_data, last_fetched, added_by, severity, category, notes)
     VALUES ($1,$2,$3,$4,$5,NOW(),$6,$7,$8,$9) RETURNING id`,
    [profile.roblox_id, profile.username, profile.display_name, profile.avatar_url, JSON.stringify(profile),
     actor(req), (severity || 'LOW').toUpperCase(), category || 'UNCATEGORISED', notes || null]
  );

  if (tags) {
    const tagList = tags.split(',').map(t => t.trim().toUpperCase()).filter(Boolean);
    for (const tag of tagList) {
      await db.run('INSERT INTO entity_tags (entity_id, tag, created_by) VALUES ($1,$2,$3)', [lastInsertId, tag, actor(req)]);
    }
  }

  await logAudit(actor(req), 'ADD_ENTITY', profile.username, 'entity', `Added ${profile.username} (ID: ${profile.roblox_id})`, req.ip);
  res.redirect(`/watchlist/${lastInsertId}?added=1`);
});

// Batch form
router.get('/batch', requireAuth, (req, res) => {
  res.render('watchlist/batch', { user: req.session.user, results: null, error: null, page: 'watchlist' });
});

// Batch process
router.post('/batch', requireAuth, async (req, res) => {
  const { identifiers, severity, category } = req.body;
  if (!identifiers) {
    return res.render('watchlist/batch', { user: req.session.user, results: null, error: 'No identifiers provided.', page: 'watchlist' });
  }
  const lines = identifiers.split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
  if (lines.length > 50) {
    return res.render('watchlist/batch', { user: req.session.user, results: null, error: 'Maximum 50 entities per batch.', page: 'watchlist' });
  }

  const results = [];
  for (const identifier of lines) {
    const profile = await fullProfileFetch(identifier);
    if (profile.error) { results.push({ identifier, status: 'error', message: profile.error }); continue; }

    const existing = await db.get('SELECT id FROM roblox_entities WHERE roblox_id=$1', [profile.roblox_id]);
    if (existing) { results.push({ identifier, status: 'exists', message: 'Already in registry', id: existing.id, username: profile.username }); continue; }

    const { lastInsertId } = await db.run(
      `INSERT INTO roblox_entities (roblox_id, username, display_name, avatar_url, profile_data, last_fetched, added_by, severity, category)
       VALUES ($1,$2,$3,$4,$5,NOW(),$6,$7,$8) RETURNING id`,
      [profile.roblox_id, profile.username, profile.display_name, profile.avatar_url, JSON.stringify(profile),
       actor(req), (severity || 'LOW').toUpperCase(), category || 'UNCATEGORISED']
    );
    await logAudit(actor(req), 'ADD_ENTITY', profile.username, 'entity', `Batch-added ${profile.username}`, req.ip);
    results.push({ identifier, status: 'added', id: lastInsertId, username: profile.username, avatar_url: profile.avatar_url });
  }

  res.render('watchlist/batch', { user: req.session.user, results, error: null, page: 'watchlist' });
});

// View profile
router.get('/:id', requireAuth, async (req, res) => {
  const entity = await db.get('SELECT * FROM roblox_entities WHERE id=$1', [req.params.id]);
  if (!entity) return res.status(404).render('error', { user: req.session.user, code: 404, message: 'Entity not found in registry.' });

  const [tags, auditHistory] = await Promise.all([
    db.all('SELECT * FROM entity_tags WHERE entity_id=$1 ORDER BY created_at DESC', [entity.id]),
    db.all('SELECT * FROM audit_logs WHERE target=$1 ORDER BY created_at DESC LIMIT 20', [entity.username]),
  ]);
  entity.tags = tags;
  entity.profile = entity.profile_data;

  await logAudit(actor(req), 'VIEW_ENTITY', entity.username, 'entity', null, req.ip);
  res.render('watchlist/profile', { user: req.session.user, entity, auditHistory, info: req.query.info || null, added: req.query.added || null, page: 'watchlist' });
});

// Refresh from Roblox API
router.post('/:id/refresh', requireAuth, async (req, res) => {
  const entity = await db.get('SELECT * FROM roblox_entities WHERE id=$1', [req.params.id]);
  if (!entity) return res.status(404).end();
  const profile = await fullProfileFetch(entity.roblox_id);
  if (profile.error) return res.redirect(`/watchlist/${entity.id}?refreshError=1`);
  await db.run(
    'UPDATE roblox_entities SET username=$1, display_name=$2, avatar_url=$3, profile_data=$4, last_fetched=NOW() WHERE id=$5',
    [profile.username, profile.display_name, profile.avatar_url, JSON.stringify(profile), entity.id]
  );
  await logAudit(actor(req), 'REFRESH_ENTITY', profile.username, 'entity', 'Profile refreshed from Roblox API', req.ip);
  res.redirect(`/watchlist/${entity.id}`);
});

// Update metadata
router.post('/:id/update', requireAuth, async (req, res) => {
  const { severity, status, category, notes } = req.body;
  const entity = await db.get('SELECT * FROM roblox_entities WHERE id=$1', [req.params.id]);
  if (!entity) return res.status(404).end();
  await db.run(
    'UPDATE roblox_entities SET severity=$1, status=$2, category=$3, notes=$4 WHERE id=$5',
    [severity || entity.severity, status || entity.status, category || entity.category, notes ?? entity.notes, entity.id]
  );
  await logAudit(actor(req), 'UPDATE_ENTITY', entity.username, 'entity', `severity=${severity}, status=${status}`, req.ip);
  res.redirect(`/watchlist/${entity.id}`);
});

// Add tag
router.post('/:id/tags', requireAuth, async (req, res) => {
  const { tag } = req.body;
  if (!tag) return res.redirect(`/watchlist/${req.params.id}`);
  const tagClean = tag.trim().toUpperCase().slice(0, 30);
  const existing = await db.get('SELECT id FROM entity_tags WHERE entity_id=$1 AND tag=$2', [req.params.id, tagClean]);
  if (!existing) {
    await db.run('INSERT INTO entity_tags (entity_id, tag, created_by) VALUES ($1,$2,$3)', [req.params.id, tagClean, actor(req)]);
  }
  res.redirect(`/watchlist/${req.params.id}`);
});

// Remove tag
router.post('/:id/tags/remove', requireAuth, async (req, res) => {
  await db.run('DELETE FROM entity_tags WHERE entity_id=$1 AND tag=$2', [req.params.id, req.body.tag]);
  res.redirect(`/watchlist/${req.params.id}`);
});

// Delete entity
router.post('/:id/delete', requireAuth, async (req, res) => {
  const entity = await db.get('SELECT * FROM roblox_entities WHERE id=$1', [req.params.id]);
  if (entity) {
    await db.run('DELETE FROM roblox_entities WHERE id=$1', [entity.id]);
    await logAudit(actor(req), 'DELETE_ENTITY', entity.username, 'entity', `Removed ${entity.username} (${entity.roblox_id})`, req.ip);
  }
  res.redirect('/watchlist?deleted=1');
});

module.exports = router;
