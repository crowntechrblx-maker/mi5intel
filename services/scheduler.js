const cron = require('node-cron');
const db   = require('../db/database');
const { fullProfileFetch } = require('./roblox');

// How stale before auto-refresh kicks in
const THRESHOLDS = {
  CRITICAL: 12 * 60 * 60 * 1000,
  HIGH:     24 * 60 * 60 * 1000,
  MEDIUM:   72 * 60 * 60 * 1000,
};

const MAX_PER_RUN = 20;

const state = {
  running:       false,
  lastRun:       null,
  lastRefreshed: 0,
  lastDiffs:     0,
  log:           [],  // last 20 run summaries
};

async function runRefresh() {
  if (state.running) return;
  state.running = true;
  let refreshed = 0;
  let diffs = 0;

  try {
    const candidates = [];
    for (const [severity, threshold] of Object.entries(THRESHOLDS)) {
      if (candidates.length >= MAX_PER_RUN) break;
      const staleTime = new Date(Date.now() - threshold).toISOString();
      const rows = await db.all(
        `SELECT id, roblox_id, username, profile_data FROM roblox_entities
         WHERE severity=$1 AND (last_fetched IS NULL OR last_fetched < $2)
         ORDER BY last_fetched ASC NULLS FIRST
         LIMIT $3`,
        [severity, staleTime, MAX_PER_RUN - candidates.length]
      );
      candidates.push(...rows);
    }

    // Load monitored group IDs for join/leave detection
    const monitoredGroups = await db.all('SELECT group_id, group_name FROM groups_of_interest');
    const monitoredIds = new Set(monitoredGroups.map(g => String(g.group_id)));
    const monitoredNameMap = Object.fromEntries(monitoredGroups.map(g => [String(g.group_id), g.group_name]));

    for (const entity of candidates) {
      const oldP = entity.profile_data || {};
      const newP = await fullProfileFetch(entity.roblox_id);
      if (newP.error) continue;

      const diff = {};
      for (const [key, label] of [
        ['friends_count','Friends'], ['followers_count','Followers'], ['following_count','Following'],
      ]) {
        if ((oldP[key] ?? null) !== (newP[key] ?? null)) {
          diff[label] = { from: oldP[key] ?? '—', to: newP[key] ?? '—' };
        }
      }
      if (!!oldP.is_banned !== !!newP.is_banned)
        diff['Banned'] = { from: oldP.is_banned ? 'Yes':'No', to: newP.is_banned ? 'Yes':'No' };

      // Username alias detection
      if (oldP.username && oldP.username !== newP.username) {
        diff['Username'] = { from: oldP.username, to: newP.username };
        await db.run(
          'INSERT INTO entity_aliases (entity_id, old_username, new_username) VALUES ($1,$2,$3)',
          [entity.id, oldP.username, newP.username]
        );
      }

      // Group join/leave detection (monitored groups only)
      const oldGroupIds = new Set((oldP.groups || []).map(g => String(g.group?.id)));
      const newGroupIds = new Set((newP.groups || []).map(g => String(g.group?.id)));

      for (const gid of newGroupIds) {
        if (!oldGroupIds.has(gid) && monitoredIds.has(gid)) {
          await db.run(
            'INSERT INTO group_events (entity_id, group_id, group_name, event_type) VALUES ($1,$2,$3,$4)',
            [entity.id, gid, monitoredNameMap[gid] || gid, 'JOINED']
          );
          diff[`Group:${gid}`] = { from: 'Not member', to: `Joined ${monitoredNameMap[gid] || gid}` };
        }
      }
      for (const gid of oldGroupIds) {
        if (!newGroupIds.has(gid) && monitoredIds.has(gid)) {
          await db.run(
            'INSERT INTO group_events (entity_id, group_id, group_name, event_type) VALUES ($1,$2,$3,$4)',
            [entity.id, gid, monitoredNameMap[gid] || gid, 'LEFT']
          );
          diff[`Group:${gid}`] = { from: `Member of ${monitoredNameMap[gid] || gid}`, to: 'Left' };
        }
      }

      // Track total group count change
      if (oldGroupIds.size !== newGroupIds.size)
        diff['Groups'] = { from: oldGroupIds.size, to: newGroupIds.size };

      const hasDiff = Object.keys(diff).length > 0;

      await Promise.all([
        db.run(
          'UPDATE roblox_entities SET username=$1, display_name=$2, avatar_url=$3, profile_data=$4, last_fetched=NOW() WHERE id=$5',
          [newP.username, newP.display_name, newP.avatar_url, JSON.stringify(newP), entity.id]
        ),
        db.run(
          'INSERT INTO entity_snapshots (entity_id, fetched_by, diff, snapshot) VALUES ($1,$2,$3,$4)',
          [entity.id, 'SYSTEM', JSON.stringify(hasDiff ? diff : null), JSON.stringify(newP)]
        ),
        db.run(
          `INSERT INTO audit_logs (action, actor, target, target_type, details) VALUES ($1,$2,$3,$4,$5)`,
          [
            'AUTO_REFRESH', 'SYSTEM', newP.username, 'entity',
            hasDiff
              ? 'Auto: ' + Object.entries(diff).map(([k,v]) => `${k}: ${v.from}→${v.to}`).join(', ')
              : 'Auto: no changes',
          ]
        ),
      ]);

      refreshed++;
      if (hasDiff) diffs++;
    }
  } catch (err) {
    console.error('[Scheduler] Error:', err.message);
  }

  state.running       = false;
  state.lastRun       = new Date();
  state.lastRefreshed = refreshed;
  state.lastDiffs     = diffs;
  state.log.unshift({ time: state.lastRun, refreshed, diffs });
  if (state.log.length > 20) state.log.pop();

  if (refreshed > 0)
    console.log(`[Scheduler] Refreshed ${refreshed} entities, ${diffs} with changes`);
}

function start() {
  // Every 30 minutes
  cron.schedule('*/30 * * * *', runRefresh);
  console.log('[Scheduler] Auto-refresh started — every 30 min (CRITICAL <12h, HIGH <24h, MEDIUM <72h)');
  // First run 15s after boot (let DB settle)
  setTimeout(runRefresh, 15000);
}

function getState() { return state; }

module.exports = { start, getState, runRefresh };
