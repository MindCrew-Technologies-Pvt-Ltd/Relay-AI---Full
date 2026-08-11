/**
 * Relay AI — enquiry backend
 *
 * Serves the static site and accepts enquiry submissions.
 * Storage: PostgreSQL when DATABASE_URL is set (Railway), otherwise a local
 * JSON file so the app still runs in development.
 */
const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH || "";
const SESSION_SECRET = process.env.SESSION_SECRET || ADMIN_TOKEN || "dev-secret";
const SESSION_HOURS = 12;
const DATA_FILE = path.join(__dirname, "data", "enquiries.json");

app.set("trust proxy", 1);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* ---------------------------------------------------------------- storage */
let pool = null;

async function initDb() {
  if (!process.env.DATABASE_URL) {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, "[]");
    console.log("No DATABASE_URL — storing enquiries in data/enquiries.json");
    return;
  }
  const { Pool } = require("pg");
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.PGSSL === "disable" ? false : { rejectUnauthorized: false },
  });
  await pool.query(`
    CREATE TABLE IF NOT EXISTS enquiries (
      id           SERIAL PRIMARY KEY,
      full_name    TEXT        NOT NULL,
      email        TEXT        NOT NULL,
      country_code TEXT,
      phone        TEXT        NOT NULL,
      requirement  TEXT        NOT NULL,
      source       TEXT,
      ip           TEXT,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  console.log("Connected to PostgreSQL — enquiries table ready");
}

async function saveEnquiry(rec) {
  if (pool) {
    const { rows } = await pool.query(
      `INSERT INTO enquiries (full_name, email, country_code, phone, requirement, source, ip)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, created_at`,
      [rec.fullName, rec.email, rec.countryCode, rec.phone, rec.requirement, rec.source, rec.ip]
    );
    return { id: rows[0].id, createdAt: rows[0].created_at };
  }
  const all = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  const row = { id: all.length + 1, ...rec, createdAt: new Date().toISOString() };
  all.push(row);
  fs.writeFileSync(DATA_FILE, JSON.stringify(all, null, 2));
  return { id: row.id, createdAt: row.createdAt };
}

async function listEnquiries() {
  if (pool) {
    const { rows } = await pool.query(
      `SELECT id, full_name AS "fullName", email, country_code AS "countryCode",
              phone, requirement, source, created_at AS "createdAt"
         FROM enquiries ORDER BY id DESC`
    );
    return rows;
  }
  return JSON.parse(fs.readFileSync(DATA_FILE, "utf8")).reverse();
}

/* ------------------------------------------------------ email notification */
async function notify(rec) {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, NOTIFY_TO, NOTIFY_FROM } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS || !NOTIFY_TO) return;
  const nodemailer = require("nodemailer");
  const transport = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT) || 587,
    secure: Number(SMTP_PORT) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
  await transport.sendMail({
    from: NOTIFY_FROM || SMTP_USER,
    to: NOTIFY_TO,
    replyTo: rec.email,
    subject: `New Relay AI enquiry — ${rec.fullName} (${rec.requirement})`,
    text: [
      `Name:        ${rec.fullName}`,
      `Email:       ${rec.email}`,
      `Phone:       ${rec.countryCode || ""} ${rec.phone}`,
      `Requirement: ${rec.requirement}`,
      `Received:    ${new Date().toISOString()}`,
    ].join("\n"),
  });
}

/* ------------------------------------------------------------- validation */
function validate(body) {
  const errors = {};
  const fullName = String(body.fullName || "").trim();
  const email = String(body.email || "").trim();
  const phone = String(body.phone || "").trim();
  const requirement = String(body.requirement || "").trim().toLowerCase();

  if (fullName.length < 2) errors.fullName = "Please enter your name.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) errors.email = "Please enter a valid email address.";
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 6 || digits.length > 14) errors.phone = "Please enter a valid phone number.";
  if (requirement !== "development" && requirement !== "marketing") {
    errors.requirement = "Please select Development or Marketing.";
  }
  return { errors, value: { fullName, email, phone, requirement } };
}

/* ---------------------------------------------------------------- rate cap */
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const windowMs = 60 * 60 * 1000;
  const list = (hits.get(ip) || []).filter((t) => now - t < windowMs);
  list.push(now);
  hits.set(ip, list);
  return list.length > 10; // max 10 submissions per IP per hour
}

/* ------------------------------------------------------------------ routes */
app.post("/api/enquiry", async (req, res) => {
  try {
    // honeypot: bots fill hidden fields, people don't
    if (String(req.body.website || "").trim() !== "") {
      return res.status(200).json({ ok: true });
    }
    const ip = req.ip || "";
    if (rateLimited(ip)) {
      return res.status(429).json({ ok: false, message: "Too many submissions. Please try again later." });
    }

    const { errors, value } = validate(req.body);
    if (Object.keys(errors).length) return res.status(400).json({ ok: false, errors });

    const rec = {
      ...value,
      countryCode: String(req.body.countryCode || "").trim(),
      source: String(req.body.source || "website"),
      ip,
    };
    const saved = await saveEnquiry(rec);

    notify(rec).catch((err) => console.error("Email notification failed:", err.message));

    res.status(201).json({ ok: true, id: saved.id });
  } catch (err) {
    console.error("Enquiry save failed:", err);
    res.status(500).json({ ok: false, message: "Something went wrong. Please try again." });
  }
});

/* ------------------------------------------------------------------- auth */
/** Hash a password as salt:hash using scrypt. */
function hashPassword(password, salt) {
  const s = salt || crypto.randomBytes(16).toString("hex");
  const derived = crypto.scryptSync(String(password), s, 64).toString("hex");
  return `${s}:${derived}`;
}

function verifyPassword(password, stored) {
  if (!stored || !stored.includes(":")) return false;
  const [salt] = stored.split(":");
  const a = Buffer.from(hashPassword(password, salt));
  const b = Buffer.from(stored);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function signSession(expiresAt) {
  const payload = String(expiresAt);
  const sig = crypto.createHmac("sha256", SESSION_SECRET).update(payload).digest("hex");
  return `${payload}.${sig}`;
}

function validSession(cookie) {
  if (!cookie || !cookie.includes(".")) return false;
  const [payload, sig] = cookie.split(".");
  const expected = crypto.createHmac("sha256", SESSION_SECRET).update(payload).digest("hex");
  const a = Buffer.from(sig || "");
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  return Number(payload) > Date.now();
}

function readCookie(req, name) {
  const raw = req.headers.cookie || "";
  const hit = raw.split(";").map((c) => c.trim()).find((c) => c.startsWith(name + "="));
  return hit ? decodeURIComponent(hit.slice(name.length + 1)) : "";
}

/** Session cookie, or ?token= for programmatic access. */
function isAuthed(req) {
  if (validSession(readCookie(req, "relay_admin"))) return true;
  const token = req.query.token || (req.headers.authorization || "").replace("Bearer ", "");
  return Boolean(ADMIN_TOKEN) && token === ADMIN_TOKEN;
}

function checkToken(req, res) {
  if (isAuthed(req)) return true;
  if (req.path.startsWith("/api/")) {
    res.status(401).json({ ok: false, message: "Unauthorized. Sign in at /admin." });
  } else {
    res.redirect("/admin/login");
  }
  return false;
}

function loginPage(message) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Relay AI — Admin sign in</title>
<style>
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:#101412;
    font:15px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;color:#101412;padding:1.5rem}
  form{background:#fff;padding:2rem;border-radius:16px;width:min(380px,100%);
    box-shadow:0 30px 60px rgba(0,0,0,.4)}
  h1{font-size:1.25rem;margin:0 0 .35rem}
  p.sub{margin:0 0 1.5rem;color:#68706C;font-size:.9rem}
  label{display:block;font-size:.75rem;font-weight:600;text-transform:uppercase;
    letter-spacing:.05em;color:#68706C;margin-bottom:.4rem}
  input{width:100%;padding:.7rem .85rem;border:1px solid #CDCABF;border-radius:10px;
    font-size:.95rem;margin-bottom:1rem}
  input:focus{outline:none;border-color:#0F8B6D;box-shadow:0 0 0 3px rgba(15,139,109,.16)}
  button{width:100%;padding:.8rem;border:0;border-radius:999px;background:#101412;color:#fff;
    font-weight:600;font-size:.95rem;cursor:pointer}
  button:hover{background:#0F8B6D}
  .err{background:#FDECEA;border:1px solid #F5C2BC;color:#A93226;padding:.6rem .8rem;
    border-radius:8px;font-size:.85rem;margin-bottom:1rem}
</style></head><body>
<form method="POST" action="/admin/login">
  <h1>Relay AI</h1><p class="sub">Sign in to view enquiries</p>
  ${message ? `<div class="err">${message}</div>` : ""}
  <label for="email">Email</label>
  <input id="email" name="email" type="email" autocomplete="username" required autofocus>
  <label for="password">Password</label>
  <input id="password" name="password" type="password" autocomplete="current-password" required>
  <button type="submit">Sign in</button>
</form></body></html>`;
}

app.get("/admin/login", (req, res) => {
  if (isAuthed(req)) return res.redirect("/admin");
  res.send(loginPage(""));
});

const loginAttempts = new Map();
app.post("/admin/login", (req, res) => {
  const ip = req.ip || "";
  const now = Date.now();
  const recent = (loginAttempts.get(ip) || []).filter((t) => now - t < 15 * 60 * 1000);
  if (recent.length >= 8) {
    return res.status(429).send(loginPage("Too many attempts. Try again in 15 minutes."));
  }

  if (!ADMIN_EMAIL || !ADMIN_PASSWORD_HASH) {
    return res.status(503).send(loginPage("Admin login is not configured on the server."));
  }

  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  if (email !== ADMIN_EMAIL || !verifyPassword(password, ADMIN_PASSWORD_HASH)) {
    recent.push(now);
    loginAttempts.set(ip, recent);
    return res.status(401).send(loginPage("Incorrect email or password."));
  }

  loginAttempts.delete(ip);
  const expiresAt = now + SESSION_HOURS * 60 * 60 * 1000;
  res.cookie("relay_admin", signSession(expiresAt), {
    httpOnly: true,
    sameSite: "lax",
    secure: req.protocol === "https" || req.get("x-forwarded-proto") === "https",
    maxAge: SESSION_HOURS * 60 * 60 * 1000,
  });
  res.redirect("/admin");
});

app.post("/admin/logout", (req, res) => {
  res.clearCookie("relay_admin");
  res.redirect("/admin/login");
});

app.get("/api/enquiries", async (req, res) => {
  if (!checkToken(req, res)) return;
  res.json(await listEnquiries());
});

app.get("/api/enquiries.csv", async (req, res) => {
  if (!checkToken(req, res)) return;
  const rows = await listEnquiries();
  const esc = (v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
  const csv = [
    ["id", "created_at", "full_name", "email", "country_code", "phone", "requirement"].join(","),
    ...rows.map((r) =>
      [r.id, r.createdAt, r.fullName, r.email, r.countryCode, r.phone, r.requirement].map(esc).join(",")
    ),
  ].join("\n");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="relay-enquiries.csv"');
  res.send(csv);
});

app.get("/admin", async (req, res) => {
  if (!checkToken(req, res)) return;
  const rows = await listEnquiries();
  const esc = (s) =>
    String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  res.send(`<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Relay AI — Enquiries</title>
<style>
  body{font:15px/1.5 system-ui,sans-serif;margin:0;background:#F8F6EF;color:#101412}
  header{display:flex;justify-content:space-between;align-items:center;gap:1rem;
    flex-wrap:wrap;padding:1.25rem 1.5rem;background:#101412;color:#F8F6EF}
  h1{font-size:1.1rem;margin:0}
  .actions{display:flex;gap:.6rem;align-items:center}
  .btn{background:#0F8B6D;color:#fff;padding:.5rem 1rem;border-radius:999px;
    text-decoration:none;font-size:.85rem;border:0;cursor:pointer;font-family:inherit}
  .btn--ghost{background:transparent;border:1px solid rgba(248,246,239,.35);color:#F8F6EF}
  .btn--ghost:hover{background:rgba(248,246,239,.12)}
  .wrap{padding:1.5rem;overflow-x:auto}
  table{border-collapse:collapse;width:100%;background:#fff;border-radius:10px;overflow:hidden;min-width:760px}
  th,td{padding:.7rem .9rem;text-align:left;border-bottom:1px solid #E3E0D5;font-size:.9rem;white-space:nowrap}
  th{background:#F1EFE6;font-size:.75rem;text-transform:uppercase;letter-spacing:.06em;color:#68706C}
  tr:last-child td{border-bottom:0}
  .tag{background:#0F8B6D14;color:#0F8B6D;padding:.2rem .6rem;border-radius:999px;font-size:.8rem}
  .empty{padding:2rem;text-align:center;color:#68706C}
</style></head><body>
<header><h1>Relay AI — Enquiries (${rows.length})</h1>
<div class="actions">
  <a class="btn" href="/api/enquiries.csv${req.query.token ? "?token=" + encodeURIComponent(req.query.token) : ""}">Download CSV</a>
  <form method="POST" action="/admin/logout"><button class="btn btn--ghost" type="submit">Sign out</button></form>
</div></header>
<div class="wrap">${
    rows.length
      ? `<table><thead><tr><th>#</th><th>Received</th><th>Name</th><th>Email</th><th>Phone</th><th>Requirement</th></tr></thead><tbody>${rows
          .map(
            (r) => `<tr><td>${r.id}</td><td>${esc(new Date(r.createdAt).toLocaleString())}</td>
      <td>${esc(r.fullName)}</td><td><a href="mailto:${esc(r.email)}">${esc(r.email)}</a></td>
      <td>${esc((r.countryCode || "") + " " + r.phone)}</td>
      <td><span class="tag">${esc(r.requirement)}</span></td></tr>`
          )
          .join("")}</tbody></table>`
      : `<p class="empty">No enquiries yet.</p>`
  }</div></body></html>`);
});

app.get("/healthz", (_req, res) => res.json({ ok: true }));

/* --------------------------------------------------------- static website */
// "/" must resolve to Version B, so the static handler must not answer it
// with its default index.html (that is Version A).
app.get("/", (_req, res) => res.sendFile(path.join(__dirname, "index-b.html")));
app.use(express.static(__dirname, { index: false, extensions: ["html"] }));

initDb()
  .then(() => app.listen(PORT, () => console.log(`Relay AI running on port ${PORT}`)))
  .catch((err) => {
    console.error("Startup failed:", err);
    process.exit(1);
  });
