const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

// ====== Config ======
const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || "change_me_please";
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || "admin@example.com").toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "Admin12345!";

// Storage (simple JSON DB)
const DB_PATH = path.join(__dirname, "db.json");

function ensureDB() {
  if (!fs.existsSync(DB_PATH)) {
    const init = { users: [], tours: [], bookings: [] };
    fs.writeFileSync(DB_PATH, JSON.stringify(init, null, 2), "utf8");
  }
}

function readDB() {
  ensureDB();
  return JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
}

function writeDB(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), "utf8");
}

function uid(prefix = "id") {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

// ====== Session ======
app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true }
  })
);

// ====== Seed admin user if not exists ======
(function seedAdmin() {
  const db = readDB();
  const exists = db.users.find(u => u.email === ADMIN_EMAIL);
  if (!exists) {
    const hash = bcrypt.hashSync(ADMIN_PASSWORD, 10);
    db.users.push({
      id: uid("user"),
      email: ADMIN_EMAIL,
      pass_hash: hash,
      role: "admin", // admin | staff
      created_at: new Date().toISOString()
    });
    writeDB(db);
    console.log("✅ Admin user created:", ADMIN_EMAIL);
  }
})();

// ====== Auth helpers ======
function requireLogin(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: "Unauthorized" });
  next();
}
function requireAdmin(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: "Unauthorized" });
  if (req.session.user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
  next();
}

// ====== Static ======
app.use(express.static(path.join(__dirname, "public")));

// ====== Auth routes ======
app.post("/api/login", (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");

  const db = readDB();
  const user = db.users.find(u => u.email === email);
  if (!user) return res.status(400).json({ error: "Неверный логин/пароль" });

  const ok = bcrypt.compareSync(password, user.pass_hash);
  if (!ok) return res.status(400).json({ error: "Неверный логин/пароль" });

  req.session.user = { id: user.id, email: user.email, role: user.role };
  res.json({ ok: true, user: req.session.user });
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get("/api/me", (req, res) => {
  res.json({ user: req.session.user || null });
});

// ====== Tours (public) ======
app.get("/api/tours", (req, res) => {
  const db = readDB();
  res.json(db.tours.filter(t => t.is_active));
});

app.get("/api/tours/:id", (req, res) => {
  const db = readDB();
  const tour = db.tours.find(t => t.id === req.params.id);
  if (!tour) return res.status(404).json({ error: "Not found" });
  res.json(tour);
});

// ====== Booking (public) ======
app.post("/api/bookings", (req, res) => {
  const db = readDB();
  const { tour_id, name, phone, date_iso, people, lang, comment } = req.body || {};

  if (!tour_id || !name || !phone || !date_iso) {
    return res.status(400).json({ error: "Заполни: экскурсия, имя, телефон, дата" });
  }

  const tour = db.tours.find(t => t.id === tour_id && t.is_active);
  if (!tour) return res.status(400).json({ error: "Экскурсия не найдена" });

  const booking = {
    id: uid("booking"),
    tour_id,
    name: String(name).trim(),
    phone: String(phone).trim(),
    date_iso: String(date_iso),
    people: Number(people || 1),
    lang: lang === "HE" ? "HE" : "RU",
    comment: String(comment || "").trim(),
    status: "new", // new | confirmed | declined | paid
    created_at: new Date().toISOString()
  };

  db.bookings.unshift(booking);
  writeDB(db);
  res.json({ ok: true, booking });
});

// ====== Admin: tours CRUD ======
app.get("/api/admin/tours", requireLogin, (req, res) => {
  const db = readDB();
  res.json(db.tours);
});

app.post("/api/admin/tours", requireLogin, (req, res) => {
  const db = readDB();
  const {
    title_ru, title_he,
    desc_ru, desc_he,
    price_ils, duration_min,
    image_url,
    is_active
  } = req.body || {};

  if (!title_ru || !title_he) return res.status(400).json({ error: "Нужно название RU и HE" });

  const tour = {
    id: uid("tour"),
    title_ru: String(title_ru).trim(),
    title_he: String(title_he).trim(),
    desc_ru: String(desc_ru || "").trim(),
    desc_he: String(desc_he || "").trim(),
    price_ils: Number(price_ils || 0),
    duration_min: Number(duration_min || 0),
    image_url: String(image_url || "").trim(),
    is_active: Boolean(is_active ?? true),
    created_at: new Date().toISOString()
  };

  db.tours.unshift(tour);
  writeDB(db);
  res.json({ ok: true, tour });
});

app.put("/api/admin/tours/:id", requireLogin, (req, res) => {
  const db = readDB();
  const tour = db.tours.find(t => t.id === req.params.id);
  if (!tour) return res.status(404).json({ error: "Not found" });

  const patch = req.body || {};
  const fields = ["title_ru","title_he","desc_ru","desc_he","price_ils","duration_min","image_url","is_active"];
  for (const f of fields) {
    if (patch[f] !== undefined) tour[f] = patch[f];
  }

  writeDB(db);
  res.json({ ok: true, tour });
});

app.delete("/api/admin/tours/:id", requireLogin, (req, res) => {
  const db = readDB();
  db.tours = db.tours.filter(t => t.id !== req.params.id);
  writeDB(db);
  res.json({ ok: true });
});

// ====== Admin: bookings ======
app.get("/api/admin/bookings", requireLogin, (req, res) => {
  const db = readDB();
  const toursById = Object.fromEntries(db.tours.map(t => [t.id, t]));
  res.json(db.bookings.map(b => ({ ...b, tour: toursById[b.tour_id] || null })));
});

app.put("/api/admin/bookings/:id/status", requireLogin, (req, res) => {
  const db = readDB();
  const booking = db.bookings.find(b => b.id === req.params.id);
  if (!booking) return res.status(404).json({ error: "Not found" });

  const { status } = req.body || {};
  if (!["new","confirmed","declined","paid"].includes(status)) {
    return res.status(400).json({ error: "Bad status" });
  }
  booking.status = status;
  writeDB(db);
  res.json({ ok: true, booking });
});

// ====== Admin ONLY: create staff users ======
app.post("/api/admin/users", requireAdmin, (req, res) => {
  const db = readDB();
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const role = (req.body.role === "admin") ? "admin" : "staff";

  if (!email || password.length < 6) {
    return res.status(400).json({ error: "Нужен email и пароль (мин 6 символов)" });
  }
  if (db.users.some(u => u.email === email)) {
    return res.status(400).json({ error: "Такой пользователь уже есть" });
  }

  db.users.push({
    id: uid("user"),
    email,
    pass_hash: bcrypt.hashSync(password, 10),
    role,
    created_at: new Date().toISOString()
  });
  writeDB(db);

  res.json({ ok: true });
});

// ====== Pages ======
app.get("/admin", (req, res) => res.sendFile(path.join(__dirname, "public", "admin.html")));
app.get("/health", (req, res) => res.json({ ok: true }));

app.listen(PORT, () => console.log("✅ Server on port", PORT));
