const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true }));

// ====== Config ======
const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || "change_me_please";
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || "admin@example.com").toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "Admin12345!";

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
function normalizeTour(t) {
  // backward compatibility: image_url -> photos[]
  if (!Array.isArray(t.photos)) t.photos = [];
  if (t.image_url && !t.photos.includes(t.image_url)) t.photos.unshift(t.image_url);
  delete t.image_url;
  // defaults
  if (typeof t.is_active !== "boolean") t.is_active = true;
  if (!t.created_at) t.created_at = new Date().toISOString();
  if (!t.updated_at) t.updated_at = t.created_at;
  return t;
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

  // normalize tours for old db versions
  db.tours = (db.tours || []).map(normalizeTour);
  writeDB(db);

  const exists = db.users.find(u => u.email === ADMIN_EMAIL);
  if (!exists) {
    const hash = bcrypt.hashSync(ADMIN_PASSWORD, 10);
    db.users.push({
      id: uid("user"),
      email: ADMIN_EMAIL,
      pass_hash: hash,
      role: "admin", // admin | staff | guide
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
  const tours = (db.tours || []).map(normalizeTour).filter(t => t.is_active);
  res.json(tours);
});

app.get("/api/tours/:id", (req, res) => {
  const db = readDB();
  const tour = (db.tours || []).map(normalizeTour).find(t => t.id === req.params.id);
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

  const tour = (db.tours || []).map(normalizeTour).find(t => t.id === tour_id && t.is_active);
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

  db.bookings = db.bookings || [];
  db.bookings.unshift(booking);
  writeDB(db);
  res.json({ ok: true, booking });
});

// ====== Admin: tours CRUD (posts) ======
app.get("/api/admin/tours", requireLogin, (req, res) => {
  const db = readDB();
  const tours = (db.tours || []).map(normalizeTour);
  res.json(tours);
});

app.post("/api/admin/tours", requireLogin, (req, res) => {
  const db = readDB();
  const {
    title_ru, title_he,
    desc_ru, desc_he,
    price_ils, duration_min,
    photos,
    is_active
  } = req.body || {};

  if (!title_ru || !title_he) return res.status(400).json({ error: "Нужно название RU и HE" });

  const tour = normalizeTour({
    id: uid("tour"),
    title_ru: String(title_ru).trim(),
    title_he: String(title_he).trim(),
    desc_ru: String(desc_ru || "").trim(),
    desc_he: String(desc_he || "").trim(),
    price_ils: Number(price_ils || 0),
    duration_min: Number(duration_min || 0),
    photos: Array.isArray(photos) ? photos.map(String).map(s => s.trim()).filter(Boolean) : [],
    is_active: Boolean(is_active ?? true),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  });

  db.tours = db.tours || [];
  db.tours.unshift(tour);
  writeDB(db);
  res.json({ ok: true, tour });
});

app.put("/api/admin/tours/:id", requireLogin, (req, res) => {
  const db = readDB();
  db.tours = (db.tours || []).map(normalizeTour);

  const tour = db.tours.find(t => t.id === req.params.id);
  if (!tour) return res.status(404).json({ error: "Not found" });

  const patch = req.body || {};
  const fields = ["title_ru","title_he","desc_ru","desc_he","price_ils","duration_min","is_active"];

  for (const f of fields) {
    if (patch[f] !== undefined) tour[f] = patch[f];
  }
  if (patch.photos !== undefined) {
    if (!Array.isArray(patch.photos)) return res.status(400).json({ error: "photos must be array" });
    tour.photos = patch.photos.map(String).map(s => s.trim()).filter(Boolean);
  }

  tour.updated_at = new Date().toISOString();
  writeDB(db);
  res.json({ ok: true, tour });
});

app.delete("/api/admin/tours/:id", requireLogin, (req, res) => {
  const db = readDB();
  db.tours = (db.tours || []).filter(t => t.id !== req.params.id);
  writeDB(db);
  res.json({ ok: true });
});

// ====== Admin: bookings with counts ======
app.get("/api/admin/bookings", requireLogin, (req, res) => {
  const db = readDB();
  const tourId = String(req.query.tour_id || "").trim();
  const toursById = Object.fromEntries((db.tours || []).map(normalizeTour).map(t => [t.id, t]));

  let bookings = db.bookings || [];
  if (tourId) bookings = bookings.filter(b => b.tour_id === tourId);

  res.json(bookings.map(b => ({ ...b, tour: toursById[b.tour_id] || null })));
});

app.put("/api/admin/bookings/:id/status", requireLogin, (req, res) => {
  const db = readDB();
  db.bookings = db.bookings || [];
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

// counts per tour
app.get("/api/admin/tour-stats", requireLogin, (req, res) => {
  const db = readDB();
  const tours = (db.tours || []).map(normalizeTour);

  const bookings = db.bookings || [];
  const stats = tours.map(t => {
    const list = bookings.filter(b => b.tour_id === t.id);
    const total_people = list.reduce((sum, b) => sum + Number(b.people || 0), 0);
    return {
      tour_id: t.id,
      bookings_count: list.length,
      people_total: total_people
    };
  });
  res.json(stats);
});

// ====== Admin: users (guides/staff) ======
app.get("/api/admin/users", requireAdmin, (req, res) => {
  const db = readDB();
  const safe = (db.users || []).map(u => ({ id: u.id, email: u.email, role: u.role, created_at: u.created_at }));
  res.json(safe);
});

app.post("/api/admin/users", requireAdmin, (req, res) => {
  const db = readDB();
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const roleRaw = String(req.body.role || "guide");
  const role = ["admin","staff","guide"].includes(roleRaw) ? roleRaw : "guide";

  if (!email || password.length < 6) {
    return res.status(400).json({ error: "Нужен email и пароль (мин 6 символов)" });
  }
  if ((db.users || []).some(u => u.email === email)) {
    return res.status(400).json({ error: "Такой пользователь уже есть" });
  }

  db.users = db.users || [];
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

app.delete("/api/admin/users/:id", requireAdmin, (req, res) => {
  const db = readDB();
  const id = req.params.id;
  db.users = (db.users || []).filter(u => u.id !== id);
  writeDB(db);
  res.json({ ok: true });
});

// ====== Pages ======
app.get("/admin", (req, res) => res.sendFile(path.join(__dirname, "public", "admin.html")));
app.get("/health", (req, res) => res.json({ ok: true }));

app.listen(PORT, () => console.log("✅ Server on port", PORT));
