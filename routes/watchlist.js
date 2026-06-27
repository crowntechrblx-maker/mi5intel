const express = require('express');
const router = express.Router();
const db = require('../db/database');
const { requireAuth } = require('../middleware/auth');
const { logAudit } = require('../middleware/auth');
const { fullProfileFetch } = require('../services/roblox');

function actor(req) { return req.session.user.username; }

function buildFilters(query) {
  const { q, severity, status, category } = query;
  const conditions = ['1=1'];
  const params = [];
  if (q) {
    params.push(`%${q}%`);
    conditions.push(`(username ILIKE $${params.length} OR display_name ILIKE $${params.length} OR roblox_id ILIKE $${params.length} OR category ILIKE $${params.length})`);
  }
  if (severity) { params.push(severity);         conditions.push(`severity = $${params.length}`); }
  if (status)   { params.push(status);           conditions.push(`status = $${params.length}`); }
  if (category) { params.push(`%${category}%`);  conditions.push(`category ILIKE $${params.length}`); }
  return { where: conditions.join(' AND '), params };
}

// ── List (paginated, batch tag fetch — no N+1) ────────────────
router.get('/', requireAuth, async (req, res) => {
  const limit   = 25;
  const pageNum = Math.max(1, parseInt(req.query.page) || 1);
  const offset  = (pageNum - 1) * limit;
  const { where, params } = buildFilters(req.query);

  const [entities, totalRow] = await Promise.all([
    db.all(
      `SELECT id, roblox_id, username, display_name, avatar_url, severity, status, category, added_at
       FROM roblox_entities WHERE ${where} ORDER BY added_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    ),
    db.get(`SELECT COUNT(*) AS cnt FROM roblox_entities WHERE ${where}`, params),
  ]);

  // Single batch query for all tags — eliminates N+1
  const entityIds = entities.map(e => e.id);
  const tagMap = {};
  if (entityIds.length > 0) {
    const allTags = await db.all(
      'SELECT entity_id, tag FROM entity_tags WHERE entity_id = ANY($1::int[])',
      [entityIds]
    );
    for (const t of allTags) {
      if (!tagMap[t.entity_id]) tagMap[t.entity_id] = [];
      tagMap[t.entity_id].push(t.tag);
    }
  }
  for (const e of entities) e.tags = tagMap[e.id] || [];

  res.render('watchlist/index', {
    user: req.session.user,
    entities,
    total: parseInt(totalRow.cnt),
    limit,
    offset,
    pageNum,
    filters: { q: req.query.q, severity: req.query.severity, status: req.query.status, category: req.query.category },
    page: 'watchlist',
  });
});

// ── CSV Export ────────────────────────────────────────────────
router.get('/export', requireAuth, async (req, res) => {
  const { where, params } = buildFilters(req.query);
  const entities = await db.all(
    `SELECT id, roblox_id, username, display_name, category, severity, status, added_by, added_at, last_fetched, notes
     FROM roblox_entities WHERE ${where} ORDER BY added_at DESC`,
    params
  );
  const header = ['ID','Roblox ID','Username','Display Name','Category','Severity','Status','Added By','Added At','Last Fetched','Notes'];
  const rows = entities.map(e => [
    e.id, e.roblox_id,
    `"${(e.username     || '').replace(/"/g, '""')}"`,
    `"${(e.display_name || '').replace(/"/g, '""')}"`,
    `"${(e.category     || '').replace(/"/g, '""')}"`,
    e.severity, e.status, e.added_by,
    new Date(e.added_at).toISOString(),
    e.last_fetched ? new Date(e.last_fetched).toISOString() : '',
    `"${(e.notes || '').replace(/"/g, '""')}"`,
  ]);
  const csv = [header.join(','), ...rows.map(r => r.join(','))].join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="mi5-watchlist-${Date.now()}.csv"`);
  res.send(csv);
});

// ── Add form ──────────────────────────────────────────────────
router.get('/add', requireAuth, (req, res) => {
  res.render('watchlist/add', { user: req.session.user, error: null, page: 'watchlist' });
});

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

  await db.run(
    'INSERT INTO entity_snapshots (entity_id, fetched_by, diff, snapshot) VALUES ($1,$2,$3,$4)',
    [lastInsertId, actor(req), null, JSON.stringify(profile)]
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

// ── Batch form ────────────────────────────────────────────────
router.get('/batch', requireAuth, (req, res) => {
  res.render('watchlist/batch', { user: req.session.user, results: null, error: null, page: 'watchlist' });
});

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
    await db.run('INSERT INTO entity_snapshots (entity_id, fetched_by, diff, snapshot) VALUES ($1,$2,$3,$4)',
      [lastInsertId, actor(req), null, JSON.stringify(profile)]);
    await logAudit(actor(req), 'ADD_ENTITY', profile.username, 'entity', `Batch-added ${profile.username}`, req.ip);
    results.push({ identifier, status: 'added', id: lastInsertId, username: profile.username, avatar_url: profile.avatar_url });
  }
  res.render('watchlist/batch', { user: req.session.user, results, error: null, page: 'watchlist' });
});

// ── View profile ──────────────────────────────────────────────
router.get('/:id', requireAuth, async (req, res) => {
  const entity = await db.get('SELECT * FROM roblox_entities WHERE id=$1', [req.params.id]);
  if (!entity) return res.status(404).render('error', { user: req.session.user, code: 404, message: 'Entity not found in registry.' });

  const [tags, auditHistory, caseNotes, snapshots, entitiesWithGroups] = await Promise.all([
    db.all('SELECT * FROM entity_tags WHERE entity_id=$1 ORDER BY created_at DESC', [entity.id]),
    db.all('SELECT * FROM audit_logs WHERE target=$1 ORDER BY created_at DESC LIMIT 20', [entity.username]),
    db.all('SELECT * FROM entity_notes WHERE entity_id=$1 ORDER BY created_at DESC', [entity.id]),
    db.all('SELECT id, fetched_at, fetched_by, diff FROM entity_snapshots WHERE entity_id=$1 ORDER BY fetched_at DESC LIMIT 30', [entity.id]),
    // Only entities that have groups — much cheaper than SELECT * FROM all entities
    db.all(
      `SELECT id, username, display_name, avatar_url, severity, status,
              profile_data->'groups' AS groups
       FROM roblox_entities
       WHERE id != $1
         AND profile_data IS NOT NULL
         AND jsonb_array_length(COALESCE(profile_data->'groups', '[]'::jsonb)) > 0`,
      [entity.id]
    ),
  ]);

  entity.tags = tags;
  entity.profile = entity.profile_data;

  const myGroupIds = (entity.profile?.groups || []).map(g => g.group?.id).filter(Boolean);
  const sharedWith = [];
  if (myGroupIds.length > 0) {
    for (const other of entitiesWithGroups) {
      const theirGroupIds = (other.groups || []).map(g => g.group?.id).filter(Boolean);
      const sharedIds = myGroupIds.filter(id => theirGroupIds.includes(id));
      if (sharedIds.length > 0) {
        const sharedGroupNames = (entity.profile.groups || [])
          .filter(g => sharedIds.includes(g.group?.id))
          .map(g => g.group?.name)
          .filter(Boolean);
        sharedWith.push({ entity: other, count: sharedIds.length, groupNames: sharedGroupNames });
      }
    }
    sharedWith.sort((a, b) => b.count - a.count);
  }

  const refreshDiff = req.session.refreshDiff || null;
  if (req.session.refreshDiff) delete req.session.refreshDiff;

  await logAudit(actor(req), 'VIEW_ENTITY', entity.username, 'entity', null, req.ip);
  res.render('watchlist/profile', {
    user: req.session.user,
    entity,
    auditHistory,
    caseNotes,
    snapshots,
    sharedWith,
    refreshDiff,
    info: req.query.info || null,
    added: req.query.added || null,
    page: 'watchlist',
  });
});

// ── Refresh (with diff + snapshot) ───────────────────────────
router.post('/:id/refresh', requireAuth, async (req, res) => {
  const entity = await db.get('SELECT * FROM roblox_entities WHERE id=$1', [req.params.id]);
  if (!entity) return res.status(404).end();

  const oldP = entity.profile_data || {};
  const newP = await fullProfileFetch(entity.roblox_id);
  if (newP.error) return res.redirect(`/watchlist/${entity.id}?refreshError=1`);

  const diff = {};
  for (const [key, label] of [['friends_count','Friends'],['followers_count','Followers'],['following_count','Following']]) {
    if ((oldP[key] ?? null) !== (newP[key] ?? null)) {
      diff[label] = { from: oldP[key] ?? '—', to: newP[key] ?? '—' };
    }
  }
  const oldGroups = (oldP.groups || []).length;
  const newGroups = (newP.groups || []).length;
  if (oldGroups !== newGroups) diff['Groups'] = { from: oldGroups, to: newGroups };
  if (!!oldP.is_banned !== !!newP.is_banned) {
    diff['Account banned'] = { from: oldP.is_banned ? 'Yes' : 'No', to: newP.is_banned ? 'Yes' : 'No' };
  }
  if (oldP.description !== newP.description) diff['Bio'] = { from: 'changed', to: 'updated' };

  const hasDiff = Object.keys(diff).length > 0;
  await Promise.all([
    db.run(
      'UPDATE roblox_entities SET username=$1, display_name=$2, avatar_url=$3, profile_data=$4, last_fetched=NOW() WHERE id=$5',
      [newP.username, newP.display_name, newP.avatar_url, JSON.stringify(newP), entity.id]
    ),
    db.run(
      'INSERT INTO entity_snapshots (entity_id, fetched_by, diff, snapshot) VALUES ($1,$2,$3,$4)',
      [entity.id, actor(req), JSON.stringify(hasDiff ? diff : null), JSON.stringify(newP)]
    ),
  ]);

  await logAudit(actor(req), 'REFRESH_ENTITY', newP.username, 'entity',
    hasDiff
      ? 'Changes: ' + Object.entries(diff).map(([k, v]) => `${k}: ${v.from}→${v.to}`).join(', ')
      : 'No changes detected',
    req.ip
  );

  req.session.refreshDiff = hasDiff ? diff : null;
  res.redirect(`/watchlist/${entity.id}`);
});

// ── Update metadata ───────────────────────────────────────────
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

// ── Add case note ─────────────────────────────────────────────
router.post('/:id/notes', requireAuth, async (req, res) => {
  const { note } = req.body;
  if (!note || !note.trim()) return res.redirect(`/watchlist/${req.params.id}`);
  await db.run(
    'INSERT INTO entity_notes (entity_id, author, note) VALUES ($1,$2,$3)',
    [req.params.id, actor(req), note.trim()]
  );
  res.redirect(`/watchlist/${req.params.id}#case-log`);
});

// ── Delete case note ──────────────────────────────────────────
router.post('/:id/notes/delete', requireAuth, async (req, res) => {
  const note = await db.get('SELECT * FROM entity_notes WHERE id=$1 AND entity_id=$2', [req.body.note_id, req.params.id]);
  if (note && (note.author === actor(req) || req.session.user.role === 'admin')) {
    await db.run('DELETE FROM entity_notes WHERE id=$1', [note.id]);
  }
  res.redirect(`/watchlist/${req.params.id}#case-log`);
});

// ── Add tag ───────────────────────────────────────────────────
router.post('/:id/tags', requireAuth, async (req, res) => {
  const { tag } = req.body;
  if (!tag) return res.redirect(`/watchlist/${req.params.id}`);
  const tagClean = tag.trim().toUpperCase().slice(0, 30);
  const existing = await db.get('SELECT id FROM entity_tags WHERE entity_id=$1 AND tag=$2', [req.params.id, tagClean]);
  if (!existing) await db.run('INSERT INTO entity_tags (entity_id, tag, created_by) VALUES ($1,$2,$3)', [req.params.id, tagClean, actor(req)]);
  res.redirect(`/watchlist/${req.params.id}`);
});

// ── Remove tag ────────────────────────────────────────────────
router.post('/:id/tags/remove', requireAuth, async (req, res) => {
  await db.run('DELETE FROM entity_tags WHERE entity_id=$1 AND tag=$2', [req.params.id, req.body.tag]);
  res.redirect(`/watchlist/${req.params.id}`);
});

// ── Delete entity ─────────────────────────────────────────────
router.post('/:id/delete', requireAuth, async (req, res) => {
  const entity = await db.get('SELECT * FROM roblox_entities WHERE id=$1', [req.params.id]);
  if (entity) {
    await db.run('DELETE FROM roblox_entities WHERE id=$1', [entity.id]);
    await logAudit(actor(req), 'DELETE_ENTITY', entity.username, 'entity', `Removed ${entity.username} (${entity.roblox_id})`, req.ip);
  }
  res.redirect('/watchlist?deleted=1');
});

module.exports = router;
