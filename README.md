# MI5 Intel Portal
### Military Intelligence Section 5 — Roblox Threat Intelligence Platform

> **RESTRICTED — INTERNAL USE ONLY**
> Unauthorised access is a criminal offence under the Computer Misuse Act 1990.

---

## Overview

The MI5 Intel Portal is a classified intelligence management system for tracking, classifying, and monitoring Roblox entities of interest. Built to GOV.UK design standards, it provides a structured operations environment for intelligence analysts — covering entity registration, threat assessment, group monitoring, automated surveillance, and cross-entity relationship mapping.

---

## Feature Overview

### Intelligence Registry (Watchlist)

- **Single entity registration** — look up any Roblox user by username or numeric ID; full profile is fetched and stored instantly
- **Batch upload** — register up to 50 entities at once by pasting usernames or IDs
- **CSV export** — export the current filtered view as a spreadsheet, respecting all active filters
- **Pagination** — 25 entities per page with prev/next controls
- **Advanced filtering** — filter by free-text search, severity, status, and category simultaneously
- **Clickable rows** — click anywhere on a watchlist row to open the dossier

### Entity Dossier (Profile Page)

Each entity has a full intelligence dossier containing:

| Section | Data |
|---------|------|
| Identity | Username, display name, Roblox ID, account creation date, avatar (head & body) |
| Social stats | Friends count, followers, following |
| Past usernames | Full rename history |
| Group affiliations | All groups with member's role and group size |
| Known associates | Friends list (up to 50 shown) |
| Created experiences | Games with visit counts and creation dates |
| Roblox badges | Official account badges |
| Bio | Profile description |

### Classification & Tagging

- **Severity levels** — `LOW` / `MEDIUM` / `HIGH` / `CRITICAL`
- **Status** — `ACTIVE` / `INACTIVE` / `ARCHIVED` / `BANNED`
- **Category** — free-text field for operational grouping
- **Tags** — multiple per entity, colour-coded, add/remove inline
- **Case log** — timestamped intelligence notes with operator attribution; replaces single-note model with a proper case log. Individual entries can be deleted by their author or an admin.

### Threat Timeline

Every time an entity's profile is refreshed (manually or by the auto-scheduler), a snapshot is saved. The threat timeline panel on the dossier shows:

- Timestamp and operator for every refresh
- Exact field-level changes: friends count, followers, following, group count, ban status, bio changes
- Blue dot for refreshes with detected changes; grey dot for no-change refreshes

### Entity Relationship Mapping

- **Shared group affiliations** — automatically surfaces all other watchlist entities who share one or more Roblox groups with the current entity. Sorted by number of shared groups. Shows group names and severity badges.
- **Manual entity links** — analysts can explicitly link any two watchlist entities with a typed relationship:

| Link type | Meaning |
|-----------|---------|
| `ALT_ACCOUNT` | Confirmed secondary account |
| `SUSPECTED_ALT` | Unconfirmed secondary account |
| `ASSOCIATE` | Known association |
| `KNOWN_CONTACT` | Documented contact |
| `HANDLER` | Operational handler relationship |

Links are bidirectional — visible on both entities' dossiers. Optional notes per link. Full audit trail on creation and removal.

### API Refresh & Diff

- **Manual refresh** — re-fetches live Roblox API data for any entity on demand
- **Diff banner** — after a refresh, a one-time banner shows exactly what changed (old value → new value) for every affected field
- **Diff stored in timeline** — the change set is persisted in the snapshot record for future reference

---

## Groups of Interest

A dedicated group monitoring module for tracking Roblox groups at an organisational level.

- **Register a group** — enter a Roblox group ID; the portal fetches the group's name, icon, description, and member count
- **Live cross-reference** — the group detail page instantly shows every watchlist entity that is a member of that group, along with their role (Member, Admin, Owner etc.), severity, and status. Uses a PostgreSQL GIN index for fast JSONB lookups.
- **Bulk enrolment** — fetch up to 200 group members from the Roblox API and add them to the watchlist in one operation. Existing entities are skipped automatically. Post-add results show added / skipped / failed counts.
- **Refresh group data** — re-fetch group name, description, icon, and member count
- **Flagged count** — the groups list shows how many watchlist entities are flagged per group at a glance
- **Deregister** — remove a group from monitoring without affecting enrolled entities

---

## Automated Surveillance (Scheduler)

A background auto-refresh scheduler runs continuously without operator intervention.

| Severity | Refresh threshold |
|----------|------------------|
| CRITICAL | Every 12 hours |
| HIGH | Every 24 hours |
| MEDIUM | Every 72 hours |
| LOW | Not auto-refreshed |

- Processes up to 20 entities per run, prioritising the most stale first
- Runs every 30 minutes; first pass begins 15 seconds after server startup
- Each auto-refresh saves a snapshot and diff, and writes to the audit trail with `actor = SYSTEM`
- **Settings page** shows live scheduler status: running/idle, last run time, entities refreshed, changes detected, and a history of the last 5 runs
- Admins can trigger a manual refresh pass at any time from settings

---

## Global Search

A full-text search bar in the fixed header searches across both the entity registry and the audit log simultaneously.

- Matches against username, display name, Roblox ID, and category for entities
- Matches against actor, target, and details for audit log entries
- Returns up to 20 results per section with links to the full filtered views

---

## Audit Trail

Every action in the portal is logged:

| Action | Logged |
|--------|--------|
| Login / logout / failed login | ✓ |
| View entity dossier | ✓ |
| Add / update / delete entity | ✓ |
| Refresh entity (manual & automated) | ✓ |
| Add / remove tag | ✓ |
| Add / remove entity link | ✓ |
| Add / delete case note | ✓ |
| Register / refresh / delete group | ✓ |
| Bulk enrol group members | ✓ |
| Bulk actions (severity, status, tag, delete) | ✓ |
| Create / delete operator | ✓ |
| Password changes | ✓ |

Audit logs are filterable by **operator**, **action type**, and **target entity**, with 50-per-page pagination.

---

## Admin Capabilities

### Operator Management

Three clearance levels:

| Role | Capabilities |
|------|-------------|
| **ADMIN** | Full access, user management, bulk actions, manual scheduler trigger |
| **ANALYST** | Register, edit, refresh, and view all entities and groups |
| **VIEWER** | Read-only access to all data |

Granular per-user permissions can be assigned independently of role.

### Bulk Select (Admin Only)

Admins can select multiple entities or groups and apply batch operations. A floating action bar slides up from the bottom of the screen when items are selected.

**Watchlist bulk actions:**
- Change severity across all selected entities
- Change status across all selected entities
- Add a tag to all selected entities
- Permanently delete all selected entities

**Groups bulk action:**
- Delete multiple groups at once

---

## Security

- Session-based authentication backed by PostgreSQL (`connect-pg-simple`)
- Sessions expire after 8 hours with `httpOnly` and `SameSite=Lax` cookie flags
- All passwords hashed with `bcryptjs` (cost factor 12)
- Granular permission checks server-side on every route
- All database queries fully parameterised — no SQL injection surface
- IP address captured on every audit log entry
- One-time `/setup` endpoint — permanently disabled after first admin is created
- Login page animates on failed authentication attempt

---

## Performance

| Optimisation | Detail |
|-------------|--------|
| Batch tag query | Single `WHERE entity_id = ANY($1)` replaces N+1 per-entity queries on the watchlist |
| GIN index on `profile_data` | Fast JSONB group-membership lookups using `@>` containment operator |
| 11 standard indexes | Covering severity, status, added_at, username, audit actor/action/target/timestamp |
| Projected list queries | List pages select only required columns, not `SELECT *` |
| Group membership pre-filter | Profile page filters to entities with non-empty groups before comparison |
| Static asset caching | `Cache-Control: max-age=7d` in production |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js |
| Web framework | Express.js |
| Templating | EJS with partials |
| Database | PostgreSQL (via `pg` driver) |
| Sessions | `express-session` + `connect-pg-simple` |
| Auth | `bcryptjs` |
| Scheduler | `node-cron` |
| External API | Roblox public APIs (users, groups, thumbnails, friends, games, badges) |
| Styling | Custom CSS — GOV.UK dark theme, CSS Grid layout |

---

## Deployment

### 1. PostgreSQL database (Neon — free tier)

1. Sign up at [neon.tech](https://neon.tech)
2. Create a new project
3. Copy the connection string:
   ```
   postgresql://username:password@ep-xxx.us-east-2.aws.neon.tech/neondb?sslmode=require
   ```

### 2. Deploy to Render

1. Push the repo to GitHub
2. Go to [render.com](https://render.com) → **New → Web Service** → connect the repo
3. Set environment variables:

| Key | Value |
|-----|-------|
| `DATABASE_URL` | Neon connection string |
| `SESSION_SECRET` | Random string, 32+ characters |
| `SETUP_TOKEN` | Secret token for first-admin creation |
| `NODE_ENV` | `production` |

4. Build command: `npm install`
5. Start command: `node server.js`

### 3. First admin account

Visit `/setup` after deployment. Enter the `SETUP_TOKEN` and create the admin account. The endpoint is permanently disabled once an admin exists.

### 4. Add operators

Inside the app → **User Management** → Register New Operator.

---

## Local Development

```bash
cp .env.example .env
# Set DATABASE_URL to your Neon connection string

npm install
npm run dev
# → http://localhost:3000
```

The database schema and all indexes are created automatically on first run. No migrations required.

---

*All access is logged and monitored. Classified system — authorised personnel only.*
