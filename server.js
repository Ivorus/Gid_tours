const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json({ limit: "1mb" }));

// ✅ Если приложение стоит в подпапке, например /GID
// На Railway/VPS поставь переменную окружения: BASE_PATH=/GID
const BASE_PATH = (process.env.BASE_PATH || "").trim().replace(/\/+$/, "");
const mount = BASE_PATH || ""; // "" или "/GID"

const DB_PATH = path.join(__dirname, "db.json");

function readDB() {
  if (!fs.existsSync(DB_PATH)) {
    const init = { tours: [], slots: [], bookings: [] };
    fs.writeFileSync(DB_PATH, JSON.stringify(init, null, 2), "utf8");
  }
  return JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
}
function writeDB(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), "utf8");
}
function uid(prefix = "id") {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

// --- seed if empty ---
(function seed() {
  const db = readDB();
  if (db.tours.length === 0) {
    const t1 = {
      id: uid("tour"),
      title_ru: "Иерусалим за 1 день",
      title_he: "ירושלים ביום אחד",
      desc_ru: "Старый город, Стена Плача, Храм Гроба Господня, панорамы.",
      desc_he: "העיר העתיקה, הכותל, כנסיית הקבר, תצפיות.",
      region: "Jerusalem",
      duration_minutes: 420,
      base_price: 650,
      currency: "ILS",
      is_active: true
    };

    const t2 = {
      id: uid("tour"),
      title_ru: "Тель-Авив: прогулка и история",
      title_he: "תל אביב: סיור והיסטוריה",
      desc_ru: "Яффо, Неве-Цедек, бульвары, море и городские истории.",
      desc_he: "יפו, נווה צדק, שדרות, הים וסיפורים מהעיר.",
      region: "Tel-Aviv",
      duration_minutes: 180,
      base_price: 420,
      currency: "ILS",
      is_active: true
    };

    const now = new Date();
    const plusDays = (d) => new Date(now.getTime() + d * 86400000);

    db.tours.push(t1, t2);

    db.slots.push(
      {
        id: uid("slot"),
        tour_id: t1.id,
        start_iso: plusDays(2).toISOString(),
        capacity: 12,
        booked_count: 0,
        meeting_point_ru: "Встреча у Яффских ворот",
        meeting_point_he: "מפגש ליד שער יפו"
      },
      {
        id: uid("slot"),
        tour_id: t1.id,
        start_iso: plusDays(5).toISOString(),
        capacity: 12,
        booked_count: 0,
        meeting_point_ru: "Встреча у Яффских ворот",
        meeting_point_he: "מפגש ליד שער יפו"
      },
      {
        id: uid("slot"),
        tour_id: t2.id,
        start_iso: plusDays(1).toISOString(),
        capacity: 15,
        booked_count: 0,
        meeting_point_ru: "Встреча у Часовой площади, Яффо",
        meeting_point_he: "מפגש בכיכר השעון, יפו"
      }
    );

    writeDB(db);
  }
})();

const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "change_me";
function requireAdmin(req, res, next) {
  const token = req.headers["x-admin-token"] || req.query.token;
  if (token !== ADMIN_TOKEN) return res.status(401).json({ error: "Unauthorized" });
  next();
}

// ====== ROUTER (всё в одном месте) ======
const router = express.Router();

// health / debug
router.get("/api/health", (req, res) => {
  res.json({ ok: true, base_path: mount || "/" });
});

// static
router.use(express.static(path.join(__dirname, "public")));

// API
router.get("/api/tours", (req, res) => {
  const db = readDB();
  res.json(db.tours.filter(t => t.is_active));
});

router.get("/api/slots", (req, res) => {
  const db = readDB();
  const { tourId } = req.query;
  const list = db.slots.filter(s => !tourId || s.tour_id === tourId);
  res.json(list);
});

router.post("/api/bookings", (req, res) => {
  const db = readDB();
  const { tour_id, slot_id, name, phone, adults, kids, preferred_language, comment } = req.body || {};

  if (!tour_id || !slot_id || !name || !phone) {
    return res.status(400).json({ error: "Missing fields" });
  }

  const slot = db.slots.find(s => s.id === slot_id && s.tour_id === tour_id);
  if (!slot) return res.status(400).json({ error: "Invalid slot" });

  if (slot.booked_count >= slot.capacity) {
    return res.status(409).json({ error: "No places left" });
  }

  slot.booked_count += 1;

  const booking = {
    id: uid("booking"),
    tour_id,
    slot_id,
    name: String(name).trim(),
    phone: String(phone).trim(),
    adults: Number(adults || 1),
    kids: Number(kids || 0),
    preferred_language: preferred_language === "HE" ? "HE" : "RU",
    comment: String(comment || "").trim(),
    status: "new",
    created_at: new Date().toISOString()
  };

  db.bookings.unshift(booking);
  writeDB(db);

  res.json({ ok: true, booking });
});

// Admin
router.get("/api/admin/bookings", requireAdmin, (req, res) => {
  const db = readDB();
  const toursById = Object.fromEntries(db.tours.map(t => [t.id, t]));
  const slotsById = Object.fromEntries(db.slots.map(s => [s.id, s]));
  const enriched = db.bookings.map(b => ({
    ...b,
    tour: toursById[b.tour_id] || null,
    slot: slotsById[b.slot_id] || null
  }));
  res.json(enriched);
});

router.post("/api/admin/bookings/:id/status", requireAdmin, (req, res) => {
  const db = readDB();
  const booking = db.bookings.find(b => b.id === req.params.id);
  if (!booking) return res.status(404).json({ error: "Not found" });

  const { status } = req.body || {};
  if (!["new", "confirmed", "declined", "paid"].includes(status)) {
    return res.status(400).json({ error: "Bad status" });
  }
  booking.status = status;
  writeDB(db);
  res.json({ ok: true, booking });
});

// pages
router.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

// ✅ Mount router at BASE_PATH or root
app.use(mount, router);

// ✅ Fallback (helpful)
app.get("*", (req, res) => {
  res.status(404).send("Not found. Check BASE_PATH and routes.");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server on port", PORT, "BASE_PATH:", mount || "/"));
