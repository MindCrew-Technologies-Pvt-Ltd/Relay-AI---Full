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

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";
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

function checkToken(req, res) {
  if (!ADMIN_TOKEN) {
    res.status(503).send("ADMIN_TOKEN is not set on the server.");
    return false;
  }
  const token = req.query.token || (req.headers.authorization || "").replace("Bearer ", "");
  if (token !== ADMIN_TOKEN) {
    res.status(401).send("Unauthorized — add ?token=YOUR_ADMIN_TOKEN to the URL.");
    return false;
  }
  return true;
}

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
  a.btn{background:#0F8B6D;color:#fff;padding:.5rem 1rem;border-radius:999px;text-decoration:none;font-size:.85rem}
  .wrap{padding:1.5rem;overflow-x:auto}
  table{border-collapse:collapse;width:100%;background:#fff;border-radius:10px;overflow:hidden;min-width:760px}
  th,td{padding:.7rem .9rem;text-align:left;border-bottom:1px solid #E3E0D5;font-size:.9rem;white-space:nowrap}
  th{background:#F1EFE6;font-size:.75rem;text-transform:uppercase;letter-spacing:.06em;color:#68706C}
  tr:last-child td{border-bottom:0}
  .tag{background:#0F8B6D14;color:#0F8B6D;padding:.2rem .6rem;border-radius:999px;font-size:.8rem}
  .empty{padding:2rem;text-align:center;color:#68706C}
</style></head><body>
<header><h1>Relay AI — Enquiries (${rows.length})</h1>
<a class="btn" href="/api/enquiries.csv?token=${encodeURIComponent(req.query.token || "")}">Download CSV</a></header>
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
