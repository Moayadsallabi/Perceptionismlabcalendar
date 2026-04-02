# Perceptionism Lab — Hosted Version

## What's in the box

- `server.js` — Node.js + Express + SQLite backend
- `public/index.html` — Full React frontend with admin/client role separation
- `Dockerfile` — Ready for Railway/Render
- `railway.toml` — Railway deployment config

## Quick Start (Local)

```bash
npm install
node server.js
```

Opens on `http://localhost:3000`

Default admin password: `perceptionism2024`
Set `ADMIN_PASS` env var to change it.

## Deploy to Railway

1. Push to a GitHub repo
2. Go to [railway.app](https://railway.app), create new project → Deploy from GitHub
3. Set environment variable: `ADMIN_PASS=your-secure-password`
4. Railway will auto-detect the Dockerfile and deploy
5. Add a custom domain in Railway settings

## Deploy to Render

1. Push to GitHub
2. Go to [render.com](https://render.com), create new Web Service
3. Set build command: `npm install`
4. Set start command: `node server.js`
5. Add env var: `ADMIN_PASS=your-secure-password`

## How It Works

### Admin View (you)
- URL: `yourdomain.com`
- Login with admin password
- See all clients, switch between them
- Full editing: hooks, captions, direction, internal notes, tracks, goals
- Add/remove clients, manage settings
- Each client gets a unique access token (shown in Settings → Clients → 🔑)

### Client View
- URL: `yourdomain.com/c/clientname`
- Login with their access token (you give this to them)
- See ONLY their data — no other clients visible
- Can: mark reels as recorded, add Drive links, approve/reject scripts, enter analytics
- Cannot: edit hooks/captions, see internal notes, access settings, add/delete reels

### Giving a Client Access
1. Go to Settings → Clients
2. Click 🔑 next to their name to copy their access token
3. Send them: `yourdomain.com/c/clientname` + their access token
4. They paste the token on the login screen, that's it

### Data
- SQLite database stored as `data.db` in the project root
- Persists across deploys on Railway (use a volume) or Render (use a disk)
- Export all data as JSON from Settings → Data → Export All

## Important: Persistent Storage

SQLite needs a persistent disk. Without it, your data resets on each deploy.

**Railway:** Add a volume, mount at `/app/data`, then change `DB_PATH` in server.js to `/app/data/data.db`

**Render:** Add a disk, mount at `/app/data`, same change to `DB_PATH`
