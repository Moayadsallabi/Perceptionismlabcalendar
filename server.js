const express = require('express');
const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const cookieParser = require('cookie-parser');

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

const DB_PATH = path.join(__dirname, 'data.db');
const PORT = process.env.PORT || 3000;
const ADMIN_PASS = process.env.ADMIN_PASS || 'perceptionism2024';

let db;

// ═══ DATABASE SETUP ═══
async function initDB() {
  const SQL = await initSqlJs();
  if (fs.existsSync(DB_PATH)) {
    const buf = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buf);
  } else {
    db = new SQL.Database();
  }

  db.run(`CREATE TABLE IF NOT EXISTS clients (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    color TEXT DEFAULT '#c9a84c',
    token TEXT UNIQUE NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS month_data (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id TEXT NOT NULL,
    platform TEXT NOT NULL,
    month_key TEXT NOT NULL,
    weeks TEXT DEFAULT '[]',
    goals TEXT DEFAULT '[]',
    UNIQUE(client_id, platform, month_key),
    FOREIGN KEY(client_id) REFERENCES clients(id) ON DELETE CASCADE
  )`);

  // Default settings
  const hasSettings = db.exec("SELECT COUNT(*) FROM settings WHERE key='tracks'");
  if (!hasSettings.length || hasSettings[0].values[0][0] === 0) {
    const defaultTracks = JSON.stringify([
      { id: "t1", l: "Volume Illusion", c: "#5b8dd9" },
      { id: "t2", l: "Proof Paradox", c: "#c9a84c" },
      { id: "t3", l: "Magnetism Myth", c: "#5cb85c" },
      { id: "t4", l: "Closer Illusion", c: "#c44e4e" },
      { id: "t5", l: "Authority Timeline", c: "#a06cd5" }
    ]);
    db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('tracks', ?)", [defaultTracks]);
    db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('slk', '')", []);
    db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('admin_hash', ?)", [bcrypt.hashSync(ADMIN_PASS, 10)]);
  }

  // Create default client if none exist
  const clientCount = db.exec("SELECT COUNT(*) FROM clients");
  if (!clientCount.length || clientCount[0].values[0][0] === 0) {
    const token = crypto.randomBytes(16).toString('hex');
    db.run("INSERT INTO clients (id, name, color, token) VALUES (?, ?, ?, ?)",
      ['zennbott', 'Zennbott', '#c9a84c', token]);
    console.log(`Default client "Zennbott" created with token: ${token}`);
  }

  saveDB();
  console.log('Database initialized');
}

function saveDB() {
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buffer);
}

// ═══ AUTH MIDDLEWARE ═══
function adminAuth(req, res, next) {
  const token = req.cookies?.admin_token || req.headers['x-admin-token'];
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  const stored = db.exec("SELECT value FROM settings WHERE key='admin_session'");
  if (!stored.length || stored[0].values[0][0] !== token) {
    return res.status(401).json({ error: 'Invalid session' });
  }
  req.isAdmin = true;
  next();
}

function clientAuth(req, res, next) {
  const token = req.cookies?.client_token || req.headers['x-client-token'] || req.query.token;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  const result = db.exec("SELECT id, name, color FROM clients WHERE token = ?", [token]);
  if (!result.length || !result[0].values.length) {
    return res.status(401).json({ error: 'Invalid token' });
  }
  req.clientId = result[0].values[0][0];
  req.clientName = result[0].values[0][1];
  req.clientColor = result[0].values[0][2];
  next();
}

function anyAuth(req, res, next) {
  // Try admin first
  const adminToken = req.cookies?.admin_token || req.headers['x-admin-token'];
  if (adminToken) {
    const stored = db.exec("SELECT value FROM settings WHERE key='admin_session'");
    if (stored.length && stored[0].values[0][0] === adminToken) {
      req.isAdmin = true;
      return next();
    }
  }
  // Try client
  const clientToken = req.cookies?.client_token || req.headers['x-client-token'] || req.query.token;
  if (clientToken) {
    const result = db.exec("SELECT id, name, color FROM clients WHERE token = ?", [clientToken]);
    if (result.length && result[0].values.length) {
      req.clientId = result[0].values[0][0];
      req.clientName = result[0].values[0][1];
      req.clientColor = result[0].values[0][2];
      return next();
    }
  }
  return res.status(401).json({ error: 'Not authenticated' });
}

// ═══ AUTH ROUTES ═══
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  const stored = db.exec("SELECT value FROM settings WHERE key='admin_hash'");
  if (!stored.length) return res.status(500).json({ error: 'No admin configured' });
  const hash = stored[0].values[0][0];
  if (!bcrypt.compareSync(password, hash)) return res.status(401).json({ error: 'Wrong password' });
  const session = crypto.randomBytes(32).toString('hex');
  db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('admin_session', ?)", [session]);
  saveDB();
  res.cookie('admin_token', session, { httpOnly: true, maxAge: 30 * 24 * 60 * 60 * 1000, sameSite: 'lax' });
  res.json({ ok: true });
});

app.post('/api/admin/logout', (req, res) => {
  db.run("DELETE FROM settings WHERE key='admin_session'");
  saveDB();
  res.clearCookie('admin_token');
  res.json({ ok: true });
});

app.post('/api/admin/change-password', adminAuth, (req, res) => {
  const { password } = req.body;
  if (!password || password.length < 6) return res.status(400).json({ error: 'Min 6 characters' });
  db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('admin_hash', ?)", [bcrypt.hashSync(password, 10)]);
  saveDB();
  res.json({ ok: true });
});

app.post('/api/client/login', (req, res) => {
  const { token } = req.body;
  const result = db.exec("SELECT id, name, color FROM clients WHERE token = ?", [token]);
  if (!result.length || !result[0].values.length) return res.status(401).json({ error: 'Invalid access code' });
  res.cookie('client_token', token, { httpOnly: true, maxAge: 30 * 24 * 60 * 60 * 1000, sameSite: 'lax' });
  res.json({ ok: true, client: { id: result[0].values[0][0], name: result[0].values[0][1], color: result[0].values[0][2] } });
});

app.get('/api/me', anyAuth, (req, res) => {
  if (req.isAdmin) return res.json({ role: 'admin' });
  res.json({ role: 'client', clientId: req.clientId, clientName: req.clientName, clientColor: req.clientColor });
});

// ═══ SETTINGS (admin only) ═══
app.get('/api/settings', adminAuth, (req, res) => {
  const rows = db.exec("SELECT key, value FROM settings WHERE key IN ('tracks', 'slk', 'fmts_instagram', 'fmts_youtube')");
  const settings = {};
  if (rows.length) rows[0].values.forEach(([k, v]) => {
    settings[k] = (k === 'tracks' || k.startsWith('fmts_')) ? JSON.parse(v) : v;
  });
  res.json(settings);
});

app.put('/api/settings', adminAuth, (req, res) => {
  const { tracks, slk, fmts_instagram, fmts_youtube } = req.body;
  if (tracks !== undefined) db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('tracks', ?)", [JSON.stringify(tracks)]);
  if (slk !== undefined) db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('slk', ?)", [slk]);
  if (fmts_instagram !== undefined) db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('fmts_instagram', ?)", [JSON.stringify(fmts_instagram)]);
  if (fmts_youtube !== undefined) db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('fmts_youtube', ?)", [JSON.stringify(fmts_youtube)]);
  saveDB();
  res.json({ ok: true });
});

// Tracks + formats endpoint for clients too (read-only)
app.get('/api/tracks', anyAuth, (req, res) => {
  const rows = db.exec("SELECT key, value FROM settings WHERE key IN ('tracks', 'fmts_instagram', 'fmts_youtube')");
  const result = { tracks: [], fmts_instagram: null, fmts_youtube: null };
  if (rows.length) rows[0].values.forEach(([k, v]) => { result[k] = JSON.parse(v); });
  res.json(result);
});

// ═══ CLIENTS (admin only) ═══
app.get('/api/clients', adminAuth, (req, res) => {
  const rows = db.exec("SELECT id, name, color, token FROM clients ORDER BY created_at");
  if (!rows.length) return res.json([]);
  res.json(rows[0].values.map(([id, name, color, token]) => ({ id, name, color, token })));
});

app.post('/api/clients', adminAuth, (req, res) => {
  const { name, color } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  const id = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  const token = crypto.randomBytes(16).toString('hex');
  try {
    db.run("INSERT INTO clients (id, name, color, token) VALUES (?, ?, ?, ?)", [id, name, color || '#c9a84c', token]);
    saveDB();
    res.json({ id, name, color: color || '#c9a84c', token });
  } catch (e) {
    res.status(400).json({ error: 'Client already exists' });
  }
});

app.delete('/api/clients/:id', adminAuth, (req, res) => {
  db.run("DELETE FROM month_data WHERE client_id = ?", [req.params.id]);
  db.run("DELETE FROM clients WHERE id = ?", [req.params.id]);
  saveDB();
  res.json({ ok: true });
});

app.post('/api/clients/:id/regenerate-token', adminAuth, (req, res) => {
  const token = crypto.randomBytes(16).toString('hex');
  db.run("UPDATE clients SET token = ? WHERE id = ?", [token, req.params.id]);
  saveDB();
  res.json({ token });
});

// ═══ MONTH DATA ═══
app.get('/api/data/:clientId/:platform/:monthKey', anyAuth, (req, res) => {
  const { clientId, platform, monthKey } = req.params;
  // Client can only access their own data
  if (!req.isAdmin && req.clientId !== clientId) return res.status(403).json({ error: 'Forbidden' });
  const rows = db.exec("SELECT weeks, goals FROM month_data WHERE client_id = ? AND platform = ? AND month_key = ?",
    [clientId, platform, monthKey]);
  if (!rows.length || !rows[0].values.length) return res.json({ weeks: null, goals: null });
  const [weeks, goals] = rows[0].values[0];
  res.json({ weeks: JSON.parse(weeks), goals: JSON.parse(goals) });
});

app.put('/api/data/:clientId/:platform/:monthKey', anyAuth, (req, res) => {
  const { clientId, platform, monthKey } = req.params;
  if (!req.isAdmin && req.clientId !== clientId) return res.status(403).json({ error: 'Forbidden' });
  const { weeks, goals } = req.body;

  const existing = db.exec("SELECT id FROM month_data WHERE client_id = ? AND platform = ? AND month_key = ?",
    [clientId, platform, monthKey]);

  if (existing.length && existing[0].values.length) {
    const sets = [];
    const vals = [];
    if (weeks !== undefined) { sets.push("weeks = ?"); vals.push(JSON.stringify(weeks)); }
    if (goals !== undefined) { sets.push("goals = ?"); vals.push(JSON.stringify(goals)); }
    if (sets.length) {
      vals.push(clientId, platform, monthKey);
      db.run(`UPDATE month_data SET ${sets.join(', ')} WHERE client_id = ? AND platform = ? AND month_key = ?`, vals);
    }
  } else {
    db.run("INSERT INTO month_data (client_id, platform, month_key, weeks, goals) VALUES (?, ?, ?, ?, ?)",
      [clientId, platform, monthKey, JSON.stringify(weeks || []), JSON.stringify(goals || [])]);
  }
  saveDB();
  res.json({ ok: true });
});

// ═══ BULK EXPORT/IMPORT (admin) ═══
app.get('/api/export', adminAuth, (req, res) => {
  const clients = db.exec("SELECT id, name, color, token FROM clients");
  const settings = db.exec("SELECT key, value FROM settings WHERE key IN ('tracks', 'slk')");
  const data = db.exec("SELECT client_id, platform, month_key, weeks, goals FROM month_data");
  res.json({ clients: clients[0]?.values || [], settings: settings[0]?.values || [], data: data[0]?.values || [] });
});

// ═══ SPA ROUTING ═══
app.get('/c/:clientSlug', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  }
});

// ═══ START ═══
initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`Perceptionism Lab running on http://localhost:${PORT}`);
    // Show client tokens on startup
    const clients = db.exec("SELECT name, token FROM clients");
    if (clients.length) {
      console.log('\nClient access codes:');
      clients[0].values.forEach(([name, token]) => {
        console.log(`  ${name}: ${token}`);
      });
    }
    console.log(`\nAdmin password: ${ADMIN_PASS}`);
    console.log('Set ADMIN_PASS env var to change it\n');
  });
});
