const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || "change_me_please";
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || "admin@example.com").toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "Admin12345!";

const DB_PATH = path.join(__dirname, "db.json");

function ensureDB() {
  if (!fs.existsSync(DB_PATH)) {
    const init = {
      users: [],
      tours: [],
      bookings: [],
      theme: {
        // ✅ Дизайн по умолчанию
        brand_name: "Guide Israel",
        subtitle: "Экскурсии по Израилю • запись онлайн",
        hero_title: "Выберите экскурсию — и запишитесь за 1 минуту",
        hero_desc: "После заявки мы подтверждаем запись и связываемся с вами.",

        bg: "#0b0c10",
        card: "#11131a",
        border: "#24273a",
        text: "#e9ecff",
        muted: "#a7acc7",
        accent: "#4f6ef7",
        accent2: "#7c4dff",

        radius: 18,        // скругление карточек
        logo_size: 40,     // размер “иконки/лого”
        card_image_h: 190, // высота фото в карточке
        btn_h: 44          // высота кнопок
      }
    };
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
  if (!Array.isArray(t.photos)) t.photos = [];
  if (t.image_url && !t.photos.includes(t.image_url)) t.photos.unshift(t.image_url);
  delete t.image_url;

  if (typeof t.is_active !== "boolean") t.is_active = true;
  if (!t.created_at) t.created_at = new Date().toISOString();
  if (!t.updated_at) t.updated_at = t.created_at;
  return t;
}

// ===== Session =====
app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true }
  })
);

// ===== Seed admin =====
(function seedAdmin() {
  const db = readDB();

  db.tours = (db.tours || []).map(normalizeTour);

  // ensure theme exists
  if (!db.theme) {
    db.theme = {
      brand_name: "Guide Israel",
      subtitle: "Экскурсии по Израилю • запись онлайн",
      hero_title: "Выберите экскурсию — и запишитесь за 1 минуту",
      hero_desc: "После заявки мы подтверждаем запись и связываемся с вами.",
      bg: "#0b0c10",
      card: "#11131a",
      border: "#24273a",
      text: "#e9ecff",
      muted: "#a7acc7",
      accent: "#4f6ef7",
      accent2: "#7c4dff",
      radius: 18,
      logo_size: 40,
      card_image_h: 190,
      btn_h: 44
    };
  }

  writeDB(db);

  const exists = (db.users || []).find(u => u.email === ADMIN_EMAIL);
  if (!exists) {
    const hash = bcrypt.hashSync(ADMIN_PASSWORD, 10);
    db.users.push({
      id: uid("user"),
      email: ADMIN_EMAIL,
      pass_hash: hash,
      role: "admin",
      created_at: new Date().toISOString()
    });
    writeDB(db);
    console.log("✅ Admin user created:", ADMIN_EMAIL);
  }
})();

// ===== Auth helpers =====
function requireLogin(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: "Unauthorized" });
  next();
}
function requireAdmin(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: "Unauthorized" });
  if (req.session.user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
  next();
}

// ===== Static =====
app.use(express.static(path.join(__dirname, "public")));

// ===== Auth =====
app.post("/api/login", (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");

  const db = readDB();
  const user = (db.users || []).find(u => u.email === email);
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

// ===== Theme (public) =====
app.get("/api/theme", (req, res) => {
  const db = readDB();
  res.json(db.theme || {});
});

// ===== Theme (admin) =====
app.put("/api/admin/theme", requireLogin, (req, res) => {
  const db = readDB();
  const patch = req.body || {};
  db.theme = db.theme || {};
  // whitelist keys
  const keys = [
    "brand_name","subtitle","hero_title","hero_desc",
    "bg","card","border","text","muted","accent","accent2",
    "radius","logo_size","card_image_h","btn_h"
  ];
  for (const k of keys) {
    if (patch[k] !== undefined) db.theme[k] = patch[k];
  }
  writeDB(db);
  res.json({ ok: true, theme: db.theme });
});

// ===== Tours (public) =====
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

// ===== Booking (public) =====
app.post("/api/bookings", (req, res) => {
  const db = readDB();
  const { tour_id, name, phone, date_iso, people, comment } = req.body || {};

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
    comment: String(comment || "").trim(),
    status: "new",
    created_at: new Date().toISOString()
  };

  db.bookings = db.bookings || [];
  db.bookings.unshift(booking);
  writeDB(db);
  res.json({ ok: true, booking });
});

// ===== Admin: tours =====
app.get("/api/admin/tours", requireLogin, (req, res) => {
  const db = readDB();
  res.json((db.tours || []).map(normalizeTour));
});
app.post("/api/admin/tours", requireLogin, (req, res) => {
  const db = readDB();
  const { title_ru, desc_ru, price_ils, duration_min, photos, is_active } = req.body || {};
  if (!title_ru) return res.status(400).json({ error: "Нужно название" });

  const tour = normalizeTour({
    id: uid("tour"),
    title_ru: String(title_ru).trim(),
    desc_ru: String(desc_ru || "").trim(),
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
  const fields = ["title_ru","desc_ru","price_ils","duration_min","is_active"];
  for (const f of fields) if (patch[f] !== undefined) tour[f] = patch[f];
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

// ===== Admin: bookings + stats =====
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
app.get("/api/admin/tour-stats", requireLogin, (req, res) => {
  const db = readDB();
  const tours = (db.tours || []).map(normalizeTour);
  const bookings = db.bookings || [];
  const stats = tours.map(t => {
    const list = bookings.filter(b => b.tour_id === t.id);
    const total_people = list.reduce((sum, b) => sum + Number(b.people || 0), 0);
    return { tour_id: t.id, bookings_count: list.length, people_total: total_people };
  });
  res.json(stats);
});

// ===== Admin: users =====
app.get("/api/admin/users", requireAdmin, (req, res) => {
  const db = readDB();
  res.json((db.users || []).map(u => ({ id: u.id, email: u.email, role: u.role, created_at: u.created_at })));
});
app.post("/api/admin/users", requireAdmin, (req, res) => {
  const db = readDB();
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const roleRaw = String(req.body.role || "guide");
  const role = ["admin","staff","guide"].includes(roleRaw) ? roleRaw : "guide";
  if (!email || password.length < 6) return res.status(400).json({ error: "Нужен email и пароль (мин 6 символов)" });
  if ((db.users || []).some(u => u.email === email)) return res.status(400).json({ error: "Такой пользователь уже есть" });

  db.users = db.users || [];
  db.users.push({ id: uid("user"), email, pass_hash: bcrypt.hashSync(password, 10), role, created_at: new Date().toISOString() });
  writeDB(db);
  res.json({ ok: true });
});
app.delete("/api/admin/users/:id", requireAdmin, (req, res) => {
  const db = readDB();
  db.users = (db.users || []).filter(u => u.id !== req.params.id);
  writeDB(db);
  res.json({ ok: true });
});

// pages
app.get("/admin", (req, res) => res.sendFile(path.join(__dirname, "public", "admin.html")));
app.get("/health", (req, res) => res.json({ ok: true }));

app.listen(PORT, () => console.log("✅ Server on port", PORT));
