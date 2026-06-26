# HM Government Intelligence Database
### Roblox Entity Registry — Internal Use Only

---

## Deployment Guide

### 1. Get a free PostgreSQL database (Neon)

1. Go to [neon.tech](https://neon.tech) and sign up (free)
2. Create a new project (any name)
3. Copy the **Connection string** — it looks like:
   ```
   postgresql://username:password@ep-xxx.us-east-2.aws.neon.tech/neondb?sslmode=require
   ```

---

### 2. Deploy to Render

1. Push this repo to GitHub
2. Go to [render.com](https://render.com) → **New → Web Service**
3. Connect your GitHub repo
4. Set the following **Environment Variables** in Render:
   | Key | Value |
   |-----|-------|
   | `DATABASE_URL` | your Neon connection string |
   | `SESSION_SECRET` | any long random string (32+ chars) |
   | `SETUP_TOKEN` | a secret token you'll use to create the first admin |
   | `NODE_ENV` | `production` |

5. Build command: `npm install`
6. Start command: `node server.js`
7. Deploy

---

### 3. Create your first admin account

After deployment, visit:
```
https://your-app.onrender.com/setup
```

Enter your `SETUP_TOKEN` and create the first admin account.

**After setup is complete, `/setup` is permanently disabled.** Additional accounts are managed via the User Management panel inside the app.

---

### 4. Add more operators

Inside the app → **User Management** → Register New Operator.

Three clearance levels:
- **ADMIN** — full access including user management
- **ANALYST** — can add, edit, and view all entities
- **VIEWER** — read-only access

---

## Local Development

```bash
# Copy env file
cp .env.example .env
# Fill in DATABASE_URL with your Neon connection string

npm install
npm run dev
# → http://localhost:3000
```

---

## Features

- **Watchlist registry** — search, filter by severity/status/category
- **Single & batch entity registration** — paste up to 50 usernames or IDs
- **Full Roblox profile fetch**: avatar, bio, past usernames, groups (with roles), friends list, followers/following, created games, Roblox badges
- **Classification** — severity (LOW/MEDIUM/HIGH/CRITICAL), status, category, tags, analyst notes
- **Network view** — visual grid of all registered entities
- **Audit logs** — every action logged with actor, timestamp, and IP
- **User management** — admin panel for operators
- **Session auth** — PostgreSQL-backed sessions, 8-hour expiry
