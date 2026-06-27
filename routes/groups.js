const express = require('express');
const router = express.Router();
const db = require('../db/database');
const { requireAuth } = require('../middleware/auth');
const { logAudit } = require('../middleware/auth');
const { fullProfileFetch, getGroupInfo, getGroupIcon, getGroupMembers } = require('../services/roblox');

function actor(req) { return req.session.user.username; }

const ADD_ALL_CAP = 200;

// ── List ──────────────────────────────────────────────────────
router.get('/', requireAuth, async (req, res) => {
  const groups = await db.all('SELECT * FROM groups_of_interest ORDER BY added_at DESC');

  // For each group, count how many watchlist entities are flagged members
  for (const g of groups) {
    const row = await db.get(
      `SELECT COUNT(*) AS cnt FROM roblox_entities
       WHERE profile_data->'groups' @> $1::jsonb`,
      [JSON.stringify([{ group: { id: parseInt(g.group_id) } }])]
    );
    g.flagged_count = parseInt(row?.cnt || 0);
  }

  res.render('groups/index', { user: req.session.user, groups, page: 'groups' });
});

// ── Register form ─────────────────────────────────────────────
router.get('/add', requireAuth, (req, res) => {
  res.render('groups/add', { user: req.session.user, error: null, page: 'groups' });
});

// ── Register group ────────────────────────────────────────────
router.post('/add', requireAuth, async (req, res) => {
  const { group_id } = req.body;
  const gid = String(group_id || '').trim();
  if (!gid || !/^\d+$/.test(gid)) {
    return res.render('groups/add', { user: req.session.user, error: 'A valid numeric Roblox Group ID is required.', page: 'groups' });
  }

  const existing = await db.get('SELECT id FROM groups_of_interest WHERE group_id=$1', [gid]);
  if (existing) return res.redirect(`/groups/${existing.id}?info=already_exists`);

  const [info, icon] = await Promise.all([getGroupInfo(gid), getGroupIcon(gid)]);
  if (!info || !info.id) {
    return res.render('groups/add', { user: req.session.user, error: `No Roblox group found with ID ${gid}.`, page: 'groups' });
  }

  const { lastInsertId } = await db.run(
    `INSERT INTO groups_of_interest (group_id, group_name, description, member_count, icon_url, group_data, added_by, last_fetched)
     VALUES ($1,$2,$3,$4,$5,$6,$7,NOW()) RETURNING id`,
    [gid, info.name, info.description || null, info.memberCount || 0, icon, JSON.stringify(info), actor(req)]
  );

  await logAudit(actor(req), 'ADD_GROUP', info.name, 'group', `Registered group ${info.name} (ID: ${gid})`, req.ip);
  res.redirect(`/groups/${lastInsertId}?added=1`);
});

// ── Group detail ──────────────────────────────────────────────
router.get('/:id', requireAuth, async (req, res) => {
  const group = await db.get('SELECT * FROM groups_of_interest WHERE id=$1', [req.params.id]);
  if (!group) return res.status(404).render('error', { user: req.session.user, code: 404, message: 'Group not found.' });

  // Watchlist entities that are members of this group — uses GIN index
  const flagged = await db.all(
    `SELECT id, username, display_name, avatar_url, severity, status, category,
            profile_data->'groups' AS groups
     FROM roblox_entities
     WHERE profile_data->'groups' @> $1::jsonb
     ORDER BY severity DESC, username ASC`,
    [JSON.stringify([{ group: { id: parseInt(group.group_id) } }])]
  );

  // Extract the entity's role in this group from their profile_data
  for (const e of flagged) {
    const match = (e.groups || []).find(g => g.group?.id === parseInt(group.group_id));
    e.role_in_group = match?.role?.name || '—';
  }

  const addResult = req.session.groupAddResult || null;
  if (req.session.groupAddResult) delete req.session.groupAddResult;

  res.render('groups/detail', {
    user: req.session.user,
    group,
    flagged,
    addResult,
    addAllCap: ADD_ALL_CAP,
    info: req.query.info || null,
    added: req.query.added || null,
    page: 'groups',
  });
});

// ── Refresh group data ────────────────────────────────────────
router.post('/:id/refresh', requireAuth, async (req, res) => {
  const group = await db.get('SELECT * FROM groups_of_interest WHERE id=$1', [req.params.id]);
  if (!group) return res.status(404).end();

  const [info, icon] = await Promise.all([getGroupInfo(group.group_id), getGroupIcon(group.group_id)]);
  if (!info) return res.redirect(`/groups/${group.id}?refreshError=1`);

  await db.run(
    'UPDATE groups_of_interest SET group_name=$1, description=$2, member_count=$3, icon_url=$4, group_data=$5, last_fetched=NOW() WHERE id=$6',
    [info.name, info.description || null, info.memberCount || 0, icon, JSON.stringify(info), group.id]
  );
  await logAudit(actor(req), 'REFRESH_GROUP', info.name, 'group', `Refreshed group data`, req.ip);
  res.redirect(`/groups/${group.id}`);
});

// ── Add all members to watchlist ──────────────────────────────
router.post('/:id/add-members', requireAuth, async (req, res) => {
  const group = await db.get('SELECT * FROM groups_of_interest WHERE id=$1', [req.params.id]);
  if (!group) return res.status(404).end();

  const { severity, category } = req.body;
  const sev = (severity || 'LOW').toUpperCase();
  const cat = category || group.group_name;

  // Fetch up to ADD_ALL_CAP members (2 pages of 100)
  const pages = Math.ceil(ADD_ALL_CAP / 100);
  const members = await getGroupMembers(group.group_id, pages);
  const capped = members.slice(0, ADD_ALL_CAP);

  const results = { added: 0, skipped: 0, failed: 0, total: capped.length };

  for (const member of capped) {
    const userId = String(member.user?.userId || member.userId || '');
    if (!userId) { results.failed++; continue; }

    const existing = await db.get('SELECT id FROM roblox_entities WHERE roblox_id=$1', [userId]);
    if (existing) { results.skipped++; continue; }

    const profile = await fullProfileFetch(userId);
    if (profile.error) { results.failed++; continue; }

    const { lastInsertId } = await db.run(
      `INSERT INTO roblox_entities (roblox_id, username, display_name, avatar_url, profile_data, last_fetched, added_by, severity, category)
       VALUES ($1,$2,$3,$4,$5,NOW(),$6,$7,$8) RETURNING id`,
      [profile.roblox_id, profile.username, profile.display_name, profile.avatar_url,
       JSON.stringify(profile), actor(req), sev, cat]
    );
    await db.run('INSERT INTO entity_snapshots (entity_id, fetched_by, diff, snapshot) VALUES ($1,$2,$3,$4)',
      [lastInsertId, actor(req), null, JSON.stringify(profile)]);
    results.added++;
  }

  await logAudit(actor(req), 'BULK_ADD_GROUP', group.group_name, 'group',
    `Added ${results.added}, skipped ${results.skipped}, failed ${results.failed} from group ${group.group_name}`, req.ip);

  req.session.groupAddResult = results;
  res.redirect(`/groups/${group.id}`);
});

// ── Bulk delete groups (admin only) ──────────────────────────
router.post('/bulk', requireAuth, async (req, res) => {
  if (req.session.user.role !== 'admin') return res.status(403).end();
  const ids = [].concat(req.body.ids || []).map(Number).filter(Boolean);
  if (!ids.length) return res.redirect('/groups');
  for (const id of ids) {
    const g = await db.get('SELECT * FROM groups_of_interest WHERE id=$1', [id]);
    if (g) {
      await db.run('DELETE FROM groups_of_interest WHERE id=$1', [id]);
      await logAudit(actor(req), 'DELETE_GROUP', g.group_name, 'group', `Bulk-deleted group ${g.group_name}`, req.ip);
    }
  }
  res.redirect('/groups');
});

// ── Delete group ──────────────────────────────────────────────
router.post('/:id/delete', requireAuth, async (req, res) => {
  const group = await db.get('SELECT * FROM groups_of_interest WHERE id=$1', [req.params.id]);
  if (group) {
    await db.run('DELETE FROM groups_of_interest WHERE id=$1', [group.id]);
    await logAudit(actor(req), 'DELETE_GROUP', group.group_name, 'group', `Removed group ${group.group_name}`, req.ip);
  }
  res.redirect('/groups');
});

module.exports = router;
