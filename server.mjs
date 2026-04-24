import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { promisify } from "node:util";
import { Pool } from "pg";

const rootDir = process.cwd();
const envFilePath = path.join(rootDir, ".env");
const execFileAsync = promisify(execFile);

function loadEnvFile() {
  if (!fsSync.existsSync(envFilePath)) {
    return;
  }

  const rawContent = fsSync.readFileSync(envFilePath, "utf8");
  rawContent.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      return;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
      return;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const rawValue = trimmed.slice(separatorIndex + 1).trim();
    const unquotedValue = rawValue.replace(/^['"]|['"]$/g, "");

    if (key && !(key in process.env)) {
      process.env[key] = unquotedValue;
    }
  });
}

loadEnvFile();

const host = process.env.HOST || "0.0.0.0";
const port = Number(process.env.PORT || 4184);
const databaseUrl = typeof process.env.DATABASE_URL === "string" ? process.env.DATABASE_URL.trim() : "";
const databaseSslMode = typeof process.env.DATABASE_SSL === "string" ? process.env.DATABASE_SSL.trim().toLowerCase() : "";
const dataDir = path.resolve(process.env.DATA_DIR || path.join(rootDir, "data"));
const dataFilePath = path.join(dataDir, "app-data.json");
const importedSeedPath = path.join(rootDir, "reservation_seed.json");
const storageMode = databaseUrl ? "postgres" : "file";

const DEFAULT_ADMIN_USERNAME = "admin";
const DEFAULT_ADMIN_PASSWORD = "admin";
const FIXED_TODAY = "2026-04-22";
const DEFAULT_MAIL_LEAD_MINUTES = Number(process.env.MAIL_REMINDER_LEAD_MINUTES || 24 * 60);
const MAIL_CHECK_INTERVAL_MS = Number(process.env.MAIL_CHECK_INTERVAL_MS || 60_000);
const MAIL_FAILURE_BACKOFF_MS = 30 * 60 * 1000;
const DEFAULT_MAIL_FROM_ADDRESS = process.env.MAIL_FROM_ADDRESS || "bilgiislem@fizikon.com";
const DEFAULT_MAIL_FROM_NAME = process.env.MAIL_FROM_NAME || "Fizikon Misafirhane";
const mailProviderMode = typeof process.env.MAIL_PROVIDER_MODE === "string"
  ? process.env.MAIL_PROVIDER_MODE.trim().toLowerCase()
  : "smtp";
const MONTH_INDEXES = {
  ocak: 0,
  subat: 1,
  mart: 2,
  nisan: 3,
  mayis: 4,
  haziran: 5,
  temmuz: 6,
  agustos: 7,
  eylul: 8,
  ekim: 9,
  kasim: 10,
  aralik: 11,
};

const DEFAULT_STORE = {
  nextReservationId: 4,
  users: [
    {
      username: DEFAULT_ADMIN_USERNAME,
      password: DEFAULT_ADMIN_PASSWORD,
      role: "Admin",
      active: true,
    },
    {
      username: "resepsiyon.1",
      password: "123456",
      role: "Personel",
      active: true,
    },
  ],
  reservations: [
    {
      id: 1,
      apartment: "2 Nolu Daire",
      guestName: "Emin",
      createdByUsername: DEFAULT_ADMIN_USERNAME,
      checkIn: "2026-04-22",
      checkOut: "2026-04-25",
      arrivalTime: "14:30",
      checkoutTime: "11:00",
      status: "Bugun Giris",
      source: "panel",
    },
    {
      id: 2,
      apartment: "5 Nolu Daire",
      guestName: "Veronika Shostakevich",
      createdByUsername: DEFAULT_ADMIN_USERNAME,
      checkIn: "2026-07-01",
      checkOut: "2026-07-10",
      arrivalTime: "11:00",
      checkoutTime: "10:00",
      status: "Aktif",
      source: "panel",
    },
    {
      id: 3,
      apartment: "8 Nolu Daire",
      guestName: "Alparslan Cekic",
      createdByUsername: DEFAULT_ADMIN_USERNAME,
      checkIn: "2026-05-05",
      checkOut: "2026-05-09",
      arrivalTime: "09:00",
      checkoutTime: "12:00",
      status: "Aktif",
      source: "panel",
    },
  ],
  notifications: [
    "Randevu olusturuldu: 2 Nolu Daire / Emin / 22.04.2026 14:30",
    "Yaklasan rezervasyon: Bugun 2 Nolu Daireye Emin giris yapacak",
  ],
  logs: [
    "08:45 - admin, Emin icin rezervasyon olusturdu.",
    "08:50 - admin, gelis saatini 14:30 olarak duzenledi.",
    "09:00 - system, admin kullanicilara bildirim gonderdi.",
  ],
  mailSettings: {
    recipients: [],
    leadMinutes: DEFAULT_MAIL_LEAD_MINUTES,
    sentReminderKeys: [],
  },
};

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".html": "text/html; charset=utf-8",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

const sessions = new Map();

let importedDataCache = null;
let importedBusyByApartmentCache = {};
let storeCache = null;
let mailCheckInProgress = false;
const mailFailureBackoff = new Map();
let databasePool = null;

function cloneDefaultStore() {
  return JSON.parse(JSON.stringify(DEFAULT_STORE));
}

function normalizeText(text) {
  return typeof text === "string" ? text.replace(/\s+/g, " ").trim() : "";
}

function normalizeEmailAddress(value) {
  const raw = normalizeText(value).toLowerCase();
  if (!raw) {
    return "";
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) {
    return "";
  }

  return raw;
}

function stripTurkish(text) {
  return normalizeText(text)
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c");
}

function toIso(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function startOfGrid(year, monthIndex) {
  const firstDate = new Date(year, monthIndex, 1);
  const weekday = (firstDate.getDay() + 6) % 7;
  return addDays(firstDate, -weekday);
}

function parseMonthLabel(label) {
  const [monthName, yearValue] = normalizeText(label).split(" ");
  return {
    monthIndex: MONTH_INDEXES[stripTurkish(monthName)],
    year: Number(yearValue),
  };
}

function parseCell(cellText) {
  const cleaned = normalizeText(cellText);
  if (!cleaned) {
    return { note: "" };
  }

  const match = cleaned.match(/^(\d{1,2})(?:\s+(.*))?$/);
  if (!match) {
    return { note: cleaned };
  }

  return {
    note: normalizeText(match[2] || ""),
  };
}

function addBusyNote(map, apartment, isoDate, note) {
  if (!note) {
    return;
  }

  if (!map[apartment]) {
    map[apartment] = {};
  }

  if (!map[apartment][isoDate]) {
    map[apartment][isoDate] = [];
  }

  if (!map[apartment][isoDate].includes(note)) {
    map[apartment][isoDate].push(note);
  }
}

function buildImportedBusyByApartment(rawData) {
  const busyMap = {};

  const apartments = Array.isArray(rawData?.apartments) ? rawData.apartments : [];
  apartments.forEach((apartment) => {
    const apartmentName = normalizeText(apartment.name);
    busyMap[apartmentName] = {};

    const months = Array.isArray(apartment.months) ? apartment.months : [];
    months.forEach((month) => {
      const { monthIndex, year } = parseMonthLabel(month.monthLabel);
      const gridStart = startOfGrid(year, monthIndex);

      const rows = Array.isArray(month.rows) ? month.rows.slice(1) : [];

      rows.forEach((row, rowIndex) => {
        row.forEach((cellText, columnIndex) => {
          const parsed = parseCell(cellText);
          const gridIndex = rowIndex * 7 + columnIndex;
          const isoDate = toIso(addDays(gridStart, gridIndex));
          addBusyNote(busyMap, apartmentName, isoDate, parsed.note);
        });
      });
    });
  });

  return busyMap;
}

function normalizeUsers(rawUsers) {
  const normalizedUsers = Array.isArray(rawUsers)
    ? rawUsers
      .map((user) => ({
        username: normalizeText(user?.username),
        password: typeof user?.password === "string" ? user.password : "",
        role: user?.role === "Admin" ? "Admin" : "Personel",
        active: user?.active !== false,
      }))
      .filter((user) => user.username && user.password)
    : [];

  const adminUser = normalizedUsers.find((user) => user.username === DEFAULT_ADMIN_USERNAME);
  if (adminUser) {
    adminUser.role = "Admin";
    adminUser.active = true;
    if (!adminUser.password) {
      adminUser.password = DEFAULT_ADMIN_PASSWORD;
    }
  } else {
    normalizedUsers.unshift({
      username: DEFAULT_ADMIN_USERNAME,
      password: DEFAULT_ADMIN_PASSWORD,
      role: "Admin",
      active: true,
    });
  }

  return normalizedUsers;
}

function normalizeReservations(rawReservations) {
  return Array.isArray(rawReservations)
    ? rawReservations
      .map((reservation, index) => ({
        id: Number(reservation?.id) || index + 1,
        apartment: normalizeText(reservation?.apartment),
        guestName: normalizeText(reservation?.guestName),
        createdByUsername: normalizeText(reservation?.createdByUsername) || DEFAULT_ADMIN_USERNAME,
        checkIn: normalizeText(reservation?.checkIn),
        checkOut: normalizeText(reservation?.checkOut),
        arrivalTime: normalizeText(reservation?.arrivalTime),
        checkoutTime: normalizeText(reservation?.checkoutTime),
        status: normalizeText(reservation?.status) || "Planlandi",
        source: normalizeText(reservation?.source) || "panel",
      }))
      .filter((reservation) =>
        reservation.apartment &&
        reservation.guestName &&
        reservation.checkIn &&
        reservation.checkOut &&
        reservation.arrivalTime &&
        reservation.checkoutTime,
      )
    : [];
}

function normalizeMessages(rawMessages) {
  return Array.isArray(rawMessages)
    ? rawMessages
      .map((item) => normalizeText(item))
      .filter(Boolean)
    : [];
}

function normalizeMailRecipients(rawRecipients) {
  const recipients = Array.isArray(rawRecipients) ? rawRecipients : [];
  const normalizedRecipients = [];

  recipients.forEach((recipient) => {
    const normalized = normalizeEmailAddress(recipient);
    if (normalized && !normalizedRecipients.includes(normalized)) {
      normalizedRecipients.push(normalized);
    }
  });

  return normalizedRecipients.slice(0, 2);
}

function normalizeMailSettings(rawSettings) {
  const sentReminderKeys = Array.isArray(rawSettings?.sentReminderKeys)
    ? rawSettings.sentReminderKeys.map((item) => normalizeText(item)).filter(Boolean)
    : [];

  return {
    recipients: normalizeMailRecipients(rawSettings?.recipients),
    leadMinutes: Math.max(Number(rawSettings?.leadMinutes) || DEFAULT_MAIL_LEAD_MINUTES, 1),
    sentReminderKeys,
  };
}

function normalizeStore(rawStore) {
  const baseStore = cloneDefaultStore();
  const reservations = normalizeReservations(rawStore?.reservations ?? baseStore.reservations);
  const highestReservationId = reservations.reduce((maxId, reservation) => Math.max(maxId, reservation.id), 0);

  return {
    nextReservationId: Math.max(
      Number(rawStore?.nextReservationId) || 0,
      highestReservationId + 1,
      1,
    ),
    users: normalizeUsers(rawStore?.users ?? baseStore.users),
    reservations,
    notifications: normalizeMessages(rawStore?.notifications ?? baseStore.notifications),
    logs: normalizeMessages(rawStore?.logs ?? baseStore.logs),
    mailSettings: normalizeMailSettings(rawStore?.mailSettings ?? baseStore.mailSettings),
  };
}

async function writeStoreFile(store) {
  await fs.mkdir(dataDir, { recursive: true });
  const tempPath = `${dataFilePath}.tmp`;
  await fs.writeFile(tempPath, JSON.stringify(store, null, 2), "utf8");
  await fs.rename(tempPath, dataFilePath);
}

function getDatabasePool() {
  if (!databaseUrl) {
    return null;
  }

  if (!databasePool) {
    const useSsl = databaseSslMode === "true" || databaseSslMode === "require";
    databasePool = new Pool({
      connectionString: databaseUrl,
      ssl: useSsl ? { rejectUnauthorized: false } : false,
    });
  }

  return databasePool;
}

async function ensureDatabaseStoreTable() {
  const pool = getDatabasePool();
  if (!pool) {
    return;
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_state (
      id SMALLINT PRIMARY KEY,
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function readStoreFileIfExists() {
  try {
    const rawContent = await fs.readFile(dataFilePath, "utf8");
    return normalizeStore(JSON.parse(rawContent));
  } catch {
    return null;
  }
}

async function readStoreFromDatabase() {
  const pool = getDatabasePool();
  if (!pool) {
    return null;
  }

  await ensureDatabaseStoreTable();
  const result = await pool.query("SELECT data FROM app_state WHERE id = 1");
  if (!result.rows[0]?.data) {
    return null;
  }

  return normalizeStore(result.rows[0].data);
}

async function writeStoreToDatabase(store) {
  const pool = getDatabasePool();
  if (!pool) {
    return;
  }

  await ensureDatabaseStoreTable();
  await pool.query(
    `
      INSERT INTO app_state (id, data, updated_at)
      VALUES (1, $1::jsonb, NOW())
      ON CONFLICT (id)
      DO UPDATE SET
        data = EXCLUDED.data,
        updated_at = NOW()
    `,
    [JSON.stringify(store)],
  );
}

async function loadImportedData() {
  if (importedDataCache) {
    return importedDataCache;
  }

  const importedContent = await fs.readFile(importedSeedPath, "utf8");
  importedDataCache = JSON.parse(importedContent);
  importedBusyByApartmentCache = buildImportedBusyByApartment(importedDataCache);
  return importedDataCache;
}

async function loadStore() {
  if (storeCache) {
    return storeCache;
  }

  await loadImportedData();

  if (storageMode === "postgres") {
    const databaseStore = await readStoreFromDatabase();
    if (databaseStore) {
      storeCache = databaseStore;
      return storeCache;
    }

    const fileStore = await readStoreFileIfExists();
    storeCache = fileStore ?? normalizeStore(DEFAULT_STORE);
    await writeStoreToDatabase(storeCache);
    return storeCache;
  }

  const fileStore = await readStoreFileIfExists();
  if (fileStore) {
    storeCache = fileStore;
    return storeCache;
  }

  storeCache = normalizeStore(DEFAULT_STORE);
  await writeStoreFile(storeCache);
  return storeCache;
}

async function saveStore() {
  if (storageMode === "postgres") {
    await writeStoreToDatabase(storeCache);
    return;
  }

  await writeStoreFile(storeCache);
}

function sanitizeUser(user) {
  if (!user) {
    return null;
  }

  return {
    username: user.username,
    role: user.role,
  };
}

function getMailConfig() {
  const senderAddress = normalizeEmailAddress(process.env.MAIL_FROM_ADDRESS || DEFAULT_MAIL_FROM_ADDRESS) || DEFAULT_MAIL_FROM_ADDRESS;
  const senderName = normalizeText(process.env.MAIL_FROM_NAME || DEFAULT_MAIL_FROM_NAME) || "Fizikon Misafirhane";
  const smtpHost = normalizeText(process.env.MAIL_SMTP_HOST || "smtp.yandex.com");
  const smtpPort = Number(process.env.MAIL_SMTP_PORT || 587);
  const smtpUsername = normalizeText(process.env.MAIL_SMTP_USERNAME || senderAddress) || senderAddress;
  const smtpPassword = process.env.MAIL_SMTP_PASSWORD || "";
  const useSsl = normalizeText(process.env.MAIL_SMTP_SECURE || "true").toLowerCase() !== "false";
  const brevoApiKey = normalizeText(process.env.BREVO_API_KEY || "");
  const brevoApiBaseUrl = normalizeText(process.env.BREVO_API_BASE_URL || "https://api.brevo.com");

  return {
    senderAddress,
    senderName,
    smtpHost,
    smtpPort,
    smtpUsername,
    smtpPassword,
    useSsl,
    brevoApiKey,
    brevoApiBaseUrl,
  };
}

function getMailProviderStatus() {
  const config = getMailConfig();
  const missing = [];

  if (mailProviderMode === "disabled") {
    return {
      configured: false,
      disabled: true,
      missing: ["MAIL_PROVIDER_MODE_DISABLED"],
      senderAddress: config.senderAddress,
    };
  }

  if (!config.senderAddress) {
    missing.push("MAIL_FROM_ADDRESS");
  }

  if (mailProviderMode === "brevo") {
    if (!config.brevoApiKey) {
      missing.push("BREVO_API_KEY");
    }

    return {
      configured: missing.length === 0,
      disabled: false,
      missing,
      senderAddress: config.senderAddress,
    };
  }

  if (!config.smtpHost) {
    missing.push("MAIL_SMTP_HOST");
  }

  if (!config.smtpUsername) {
    missing.push("MAIL_SMTP_USERNAME");
  }

  if (!config.smtpPassword) {
    missing.push("MAIL_SMTP_PASSWORD");
  }

  return {
    configured: missing.length === 0,
    disabled: false,
    missing,
    senderAddress: config.senderAddress,
  };
}

function isMailProviderConfigured() {
  return getMailProviderStatus().configured;
}

function buildMailSettingsForClient() {
  const providerStatus = getMailProviderStatus();
  return {
    recipients: [...storeCache.mailSettings.recipients],
    leadMinutes: storeCache.mailSettings.leadMinutes,
    senderAddress: providerStatus.senderAddress,
    providerDisabled: providerStatus.disabled === true,
    providerReady: providerStatus.configured,
    providerMissing: providerStatus.missing,
  };
}

function canManageReservation(user, reservation) {
  if (!user || !reservation) {
    return false;
  }

  return user.role === "Admin" || reservation.createdByUsername === user.username;
}

function sanitizeReservationForUser(reservation, user) {
  const visibleToUser = canManageReservation(user, reservation);

  return {
    ...reservation,
    guestName: visibleToUser ? reservation.guestName : "Rezervasyon",
    arrivalTime: visibleToUser ? reservation.arrivalTime : "",
    checkoutTime: visibleToUser ? reservation.checkoutTime : "",
    status: visibleToUser ? reservation.status : "Rezervasyon",
    source: visibleToUser ? reservation.source : "panel",
    createdByUsername: visibleToUser ? reservation.createdByUsername : "",
    canEdit: visibleToUser,
  };
}

function buildClientData(user) {
  return {
    nextReservationId: storeCache.nextReservationId,
    reservations: storeCache.reservations.map((reservation) => sanitizeReservationForUser(reservation, user)),
    users: user?.role === "Admin" ? storeCache.users : [],
    logs: user?.role === "Admin" ? storeCache.logs : [],
    notifications: user?.role === "Admin" ? storeCache.notifications : [],
    mailSettings: user?.role === "Admin" ? buildMailSettingsForClient() : null,
  };
}

function buildAuthPayload(user, token = null) {
  const payload = {
    currentUser: sanitizeUser(user),
    data: buildClientData(user),
  };

  if (token) {
    payload.token = token;
  }

  return payload;
}

function reservationTouchesDate(reservation, isoDate) {
  return isoDate >= reservation.checkIn && isoDate <= reservation.checkOut;
}

function timestampNow() {
  return new Date().toLocaleTimeString("tr-TR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDisplayDate(isoDate) {
  const [year, month, day] = isoDate.split("-");
  return `${day}.${month}.${year}`;
}

function monthLabelFromIso(isoDate) {
  const date = new Date(isoDate);
  const monthNames = [
    "Ocak",
    "Subat",
    "Mart",
    "Nisan",
    "Mayis",
    "Haziran",
    "Temmuz",
    "Agustos",
    "Eylul",
    "Ekim",
    "Kasim",
    "Aralik",
  ];
  return `${monthNames[date.getMonth()]} ${date.getFullYear()}`;
}

function listConflictDates(apartment, checkIn, checkOut, ignoreReservationId = null) {
  const conflicts = [];
  let cursor = new Date(checkIn);
  const end = new Date(checkOut);

  while (cursor <= end) {
    const isoDate = toIso(cursor);
    const imported = importedBusyByApartmentCache[apartment]?.[isoDate] || [];
    const created = storeCache.reservations.filter(
      (reservation) =>
        reservation.id !== ignoreReservationId &&
        reservation.apartment === apartment &&
        reservationTouchesDate(reservation, isoDate),
    );

    if (imported.length > 0 || created.length > 0) {
      conflicts.push(isoDate);
    }

    cursor = addDays(cursor, 1);
  }

  return conflicts;
}

function getReservationStartDateTime(reservation) {
  const arrivalTime = normalizeText(reservation?.arrivalTime) || "00:00";
  const date = new Date(`${reservation?.checkIn}T${arrivalTime}:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getReservationEndDateTime(reservation) {
  const checkoutTime = normalizeText(reservation?.checkoutTime) || "00:00";
  const date = new Date(`${reservation?.checkOut}T${checkoutTime}:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function buildMailReminderKey(reservation, recipient, reminderType) {
  if (reminderType === "departure") {
    return `${reservation.id}|departure|${reservation.checkOut}|${reservation.checkoutTime}|${recipient}`;
  }

  return `${reservation.id}|arrival|${reservation.checkIn}|${reservation.arrivalTime}|${recipient}`;
}

function buildReservationDetailLine(reservation) {
  return `${reservation.apartment} / Giris: ${formatDisplayDate(reservation.checkIn)} ${reservation.arrivalTime} / Cikis: ${formatDisplayDate(reservation.checkOut)} ${reservation.checkoutTime}`;
}

function buildReservationNotificationMessage(reservation, reminderType = "created") {
  const detailLine = buildReservationDetailLine(reservation);

  if (reminderType === "arrival") {
    return `Yaklasan giris: ${detailLine}`;
  }

  if (reminderType === "departure") {
    return `Yaklasan cikis: ${detailLine}`;
  }

  return `Rezervasyon olusturuldu: ${detailLine}`;
}

function buildMailSubject(reservation, reminderType) {
  if (reminderType === "departure") {
    return `Rezervasyon bitis bildirimi - ${reservation.apartment}`;
  }

  return `Rezervasyon bildirimi - ${reservation.apartment}`;
}

function buildMailBody(reservation, reminderType) {
  const detailLine = buildReservationDetailLine(reservation);

  if (reminderType === "departure") {
    return [
      "Rezervasyon cikis bildirimi:",
      detailLine,
      "",
      "Cikis saati yaklasti. Otomatik bilgilendirme gonderildi.",
    ].join("\n");
  }

  return [
    reminderType === "arrival" ? "Rezervasyon giris bildirimi:" : "Rezervasyon olusturuldu:",
    detailLine,
    "",
    reminderType === "arrival"
      ? "Giris saati yaklasti. Otomatik bilgilendirme gonderildi."
      : "Rezervasyon kaydi olusturuldu.",
  ].join("\n");
}

function buildTestMailSubject() {
  return "Fizikon Misafirhane test maili";
}

function buildTestMailBody() {
  return `Bu bir test mailidir. Sistem hazir. Saat ${timestampNow()}.`;
}

function buildReservationCreatedMailSubject() {
  return "Misafirhane randevunuz olusturulmustur";
}

function buildReservationCreatedMailBody() {
  return [
    "Misafirhane randevunuz oluşturulmuştur!",
    "",
    "Randevu detaylarınızı kontrol etmeyi unutmayın. Belirlenen gün ve saatte hazır bulunmanız rica olunur.",
    "",
    "📌 Misafirhane randevunuz var — lütfen bilgilerinizi gözden geçirin.",
  ].join("\n");
}

async function sendMailWithSmtp(recipients, subject, body) {
  const providerStatus = getMailProviderStatus();
  if (!providerStatus.configured) {
    throw new Error(`Mail ayarlari eksik: ${providerStatus.missing.join(", ")}`);
  }

  const config = getMailConfig();
  const scriptPath = path.join(rootDir, "scripts", "send-mail.ps1");

  await execFileAsync("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    scriptPath,
    "-SmtpHost",
    config.smtpHost,
    "-Port",
    String(config.smtpPort),
    "-Username",
    config.smtpUsername,
    "-Password",
    config.smtpPassword,
    "-From",
    config.senderAddress,
    "-To",
    recipients.join(","),
    "-Subject",
    subject,
    "-Body",
    body,
    "-UseSsl",
    config.useSsl ? "true" : "false",
  ]);
}

async function sendMailWithBrevo(recipients, subject, body) {
  const providerStatus = getMailProviderStatus();
  if (!providerStatus.configured) {
    throw new Error(`Mail ayarlari eksik: ${providerStatus.missing.join(", ")}`);
  }

  const config = getMailConfig();
  const endpoint = `${config.brevoApiBaseUrl.replace(/\/+$/g, "")}/v3/smtp/email`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "accept": "application/json",
      "content-type": "application/json",
      "api-key": config.brevoApiKey,
    },
    body: JSON.stringify({
      sender: {
        email: config.senderAddress,
        name: config.senderName,
      },
      to: recipients.map((recipient) => ({ email: recipient })),
      subject,
      htmlContent: `<html><body><p>${body.replace(/\n/g, "<br>")}</p></body></html>`,
      textContent: body,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Brevo API hatasi: ${response.status} ${errorText}`);
  }
}

async function sendMailToRecipients(recipients, subject, body, logLabel) {
  const results = [];

  try {
    if (mailProviderMode === "brevo") {
      await sendMailWithBrevo(recipients, subject, body);
    } else {
      await sendMailWithSmtp(recipients, subject, body);
    }

    recipients.forEach((recipient) => {
      storeCache.notifications.unshift(`Mail bildirimi gonderildi: ${recipient} / ${logLabel}`);
      storeCache.logs.unshift(`${timestampNow()} - system, ${recipient} adresine mail gonderdi: ${logLabel}.`);
      results.push({ recipient, ok: true });
    });
  } catch (error) {
    recipients.forEach((recipient) => {
      storeCache.logs.unshift(`${timestampNow()} - system, ${recipient} adresine mail gonderilemedi: ${error.message}`);
      results.push({ recipient, ok: false, error: error.message });
    });
  }

  await saveStore();
  return results;
}

async function checkUpcomingReservationMail() {
  if (mailCheckInProgress) {
    return;
  }

  await loadStore();

  const recipients = storeCache.mailSettings.recipients;
  const canSendMail = recipients.length > 0 && isMailProviderConfigured();

  mailCheckInProgress = true;

  try {
    const now = new Date();
    const nowMs = now.getTime();
    const leadMs = Math.max(storeCache.mailSettings.leadMinutes, 1) * 60 * 1000;

    for (const reservation of storeCache.reservations) {
      const reminderPlans = [];
      const reservationStart = getReservationStartDateTime(reservation);
      const reservationEnd = getReservationEndDateTime(reservation);

      if (reservationStart) {
        const reservationStartMs = reservationStart.getTime();
        const diffMs = reservationStartMs - nowMs;

        if (diffMs >= 0 && diffMs <= leadMs) {
          reminderPlans.push({
            reminderType: "arrival",
            logLabel: `${reservation.apartment} / ${reservation.guestName} / giris`,
          });
        }
      }

      if (reservationEnd) {
        const reservationEndMs = reservationEnd.getTime();
        const diffMs = reservationEndMs - nowMs;

        if (diffMs >= 0 && diffMs <= leadMs) {
          reminderPlans.push({
            reminderType: "departure",
            logLabel: `${reservation.apartment} / ${reservation.guestName} / cikis`,
          });
        }
      }

      for (const plan of reminderPlans) {
        const panelReminderKey = buildMailReminderKey(reservation, "panel", plan.reminderType);
        if (!storeCache.mailSettings.sentReminderKeys.includes(panelReminderKey)) {
          storeCache.notifications.unshift(buildReservationNotificationMessage(reservation, plan.reminderType));
          storeCache.mailSettings.sentReminderKeys.unshift(panelReminderKey);
          storeCache.mailSettings.sentReminderKeys = [...new Set(storeCache.mailSettings.sentReminderKeys)];
          await saveStore();
        }

        if (!canSendMail) {
          continue;
        }

        const pendingRecipients = recipients.filter((recipient) => {
          const reminderKey = buildMailReminderKey(reservation, recipient, plan.reminderType);
          const backoffUntil = mailFailureBackoff.get(reminderKey) || 0;
          return !storeCache.mailSettings.sentReminderKeys.includes(reminderKey) && backoffUntil <= nowMs;
        });

        if (pendingRecipients.length === 0) {
          continue;
        }

        const results = await sendMailToRecipients(
          pendingRecipients,
          buildMailSubject(reservation, plan.reminderType),
          buildMailBody(reservation, plan.reminderType),
          plan.logLabel,
        );

        results.forEach((result) => {
          const reminderKey = buildMailReminderKey(reservation, result.recipient, plan.reminderType);
          if (result.ok) {
            storeCache.mailSettings.sentReminderKeys.unshift(reminderKey);
            mailFailureBackoff.delete(reminderKey);
          } else {
            mailFailureBackoff.set(reminderKey, nowMs + MAIL_FAILURE_BACKOFF_MS);
          }
        });

        storeCache.mailSettings.sentReminderKeys = [...new Set(storeCache.mailSettings.sentReminderKeys)];
        await saveStore();
      }
    }
  } finally {
    mailCheckInProgress = false;
  }
}

function validateReservationInput(rawReservation) {
  const reservation = {
    apartment: normalizeText(rawReservation?.apartment),
    guestName: normalizeText(rawReservation?.guestName),
    checkIn: normalizeText(rawReservation?.checkIn),
    checkOut: normalizeText(rawReservation?.checkOut),
    arrivalTime: normalizeText(rawReservation?.arrivalTime),
    checkoutTime: normalizeText(rawReservation?.checkoutTime),
    status: "Planlandi",
    source: "panel",
  };

  if (!reservation.apartment || !reservation.guestName || !reservation.checkIn || !reservation.checkOut || !reservation.arrivalTime || !reservation.checkoutTime) {
    return { error: "Tum alanlari doldurmaniz gerekiyor." };
  }

  if (reservation.checkOut < reservation.checkIn) {
    return { error: "Cikis tarihi gelis tarihinden once olamaz." };
  }

  return { reservation };
}

function validateUserInput(rawUser, allowUsername = true) {
  const username = normalizeText(rawUser?.username);
  const password = typeof rawUser?.password === "string" ? rawUser.password : "";
  const role = rawUser?.role === "Admin" ? "Admin" : "Personel";

  if (allowUsername && !username) {
    return { error: "Kullanici adi zorunludur." };
  }

  if (!password) {
    return { error: "Sifre zorunludur." };
  }

  return {
    user: {
      username,
      password,
      role,
      active: true,
    },
  };
}

function validatePasswordChangeInput(rawInput) {
  const currentPassword = typeof rawInput?.currentPassword === "string" ? rawInput.currentPassword : "";
  const newPassword = typeof rawInput?.newPassword === "string" ? rawInput.newPassword : "";

  if (!currentPassword || !newPassword) {
    return { error: "Mevcut sifre ve yeni sifre zorunludur." };
  }

  if (newPassword.length < 4) {
    return { error: "Yeni sifre en az 4 karakter olmali." };
  }

  return {
    passwordChange: {
      currentPassword,
      newPassword,
    },
  };
}

function validateMailSettingsInput(rawSettings) {
  const rawRecipients = Array.isArray(rawSettings?.recipients) ? rawSettings.recipients : [];
  const recipients = normalizeMailRecipients(rawRecipients);

  if (rawRecipients.length > 2) {
    return { error: "En fazla iki mail adresi kaydedebilirsiniz." };
  }

  const invalidRecipient = rawRecipients.find((recipient) => normalizeText(recipient) && !normalizeEmailAddress(recipient));
  if (invalidRecipient) {
    return { error: "Mail adreslerini ornek@firma.com formatinda girin." };
  }

  return {
    mailSettings: {
      recipients,
      leadMinutes: storeCache.mailSettings.leadMinutes,
      sentReminderKeys: storeCache.mailSettings.sentReminderKeys.filter((key) =>
        key.endsWith("|panel") || recipients.some((recipient) => key.endsWith(`|${recipient}`)),
      ),
    },
  };
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

function sendNotFound(response) {
  response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  response.end("Dosya bulunamadi.");
}

function sendText(response, statusCode, message) {
  response.writeHead(statusCode, { "Content-Type": "text/plain; charset=utf-8" });
  response.end(message);
}

async function readJsonBody(request) {
  const chunks = [];

  for await (const chunk of request) {
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  const rawBody = Buffer.concat(chunks).toString("utf8");
  return JSON.parse(rawBody);
}

function getAuthToken(request) {
  const authorization = request.headers.authorization || "";
  if (!authorization.startsWith("Bearer ")) {
    return "";
  }

  return authorization.slice("Bearer ".length).trim();
}

function getAuthenticatedUser(request) {
  const token = getAuthToken(request);
  if (!token) {
    return { token: "", user: null };
  }

  const username = sessions.get(token);
  if (!username) {
    return { token, user: null };
  }

  const user = storeCache.users.find((item) => item.username === username && item.active);
  if (!user) {
    sessions.delete(token);
    return { token, user: null };
  }

  return { token, user };
}

async function requireAuth(request, response, adminOnly = false) {
  await loadStore();
  const auth = getAuthenticatedUser(request);

  if (!auth.user) {
    sendJson(response, 401, { error: "Oturum gecersiz. Lutfen yeniden giris yapin." });
    return null;
  }

  if (adminOnly && auth.user.role !== "Admin") {
    sendJson(response, 403, {
      error: "Bu islem icin admin yetkisi gerekir.",
      ...buildAuthPayload(auth.user),
    });
    return null;
  }

  return auth;
}

function safeResolve(urlPath) {
  const decodedPath = decodeURIComponent(urlPath.split("?")[0]);
  const relativePath = decodedPath === "/" ? "/index.html" : decodedPath;
  const targetPath = path.normalize(path.join(rootDir, relativePath));

  if (!targetPath.startsWith(rootDir)) {
    return null;
  }

  if (targetPath.startsWith(dataDir)) {
    return null;
  }

  return targetPath;
}

async function sendFile(response, filePath) {
  try {
    const stats = await fs.stat(filePath);
    if (stats.isDirectory()) {
      sendNotFound(response);
      return;
    }

    const extension = path.extname(filePath).toLowerCase();
    const content = await fs.readFile(filePath);
    response.writeHead(200, {
      "Content-Type": mimeTypes[extension] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    response.end(content);
  } catch {
    sendNotFound(response);
  }
}

async function handleBootstrap(response) {
  const importedData = await loadImportedData();
  sendJson(response, 200, { importedData });
}

async function handleLogin(request, response) {
  await loadStore();

  let body;
  try {
    body = await readJsonBody(request);
  } catch {
    sendJson(response, 400, { error: "Gecersiz giris verisi." });
    return;
  }

  const username = normalizeText(body?.username);
  const password = typeof body?.password === "string" ? body.password : "";
  const user = storeCache.users.find((item) => item.username === username && item.active);

  if (!user || user.password !== password) {
    sendJson(response, 401, { error: "Giris basarisiz. Kullanici adi veya sifre hatali." });
    return;
  }

  const token = randomUUID();
  sessions.set(token, user.username);
  sendJson(response, 200, buildAuthPayload(user, token));
}

async function handleSession(request, response) {
  const auth = await requireAuth(request, response, false);
  if (!auth) {
    return;
  }

  sendJson(response, 200, buildAuthPayload(auth.user));
}

async function handleLogout(request, response) {
  await loadStore();
  const token = getAuthToken(request);
  if (token) {
    sessions.delete(token);
  }

  sendJson(response, 200, { ok: true });
}

async function handleChangeOwnPassword(request, response) {
  const auth = await requireAuth(request, response, false);
  if (!auth) {
    return;
  }

  let body;
  try {
    body = await readJsonBody(request);
  } catch {
    sendJson(response, 400, {
      error: "Gecersiz sifre degistirme verisi.",
      ...buildAuthPayload(auth.user),
    });
    return;
  }

  const { passwordChange, error } = validatePasswordChangeInput(body);
  if (error) {
    sendJson(response, 400, {
      error,
      ...buildAuthPayload(auth.user),
    });
    return;
  }

  const userToUpdate = storeCache.users.find((item) => item.active && item.username === auth.user.username);
  if (!userToUpdate) {
    sendJson(response, 404, {
      error: "Kullanici bulunamadi.",
      ...buildAuthPayload(auth.user),
    });
    return;
  }

  if (userToUpdate.password !== passwordChange.currentPassword) {
    sendJson(response, 400, {
      error: "Mevcut sifre hatali.",
      ...buildAuthPayload(auth.user),
    });
    return;
  }

  if (passwordChange.currentPassword === passwordChange.newPassword) {
    sendJson(response, 400, {
      error: "Yeni sifre mevcut sifre ile ayni olmamali.",
      ...buildAuthPayload(auth.user),
    });
    return;
  }

  userToUpdate.password = passwordChange.newPassword;
  storeCache.logs.unshift(`${timestampNow()} - ${auth.user.username}, kendi sifresini degistirdi.`);
  await saveStore();
  sendJson(response, 200, buildAuthPayload(userToUpdate));
}

async function handleCreateReservation(request, response) {
  const auth = await requireAuth(request, response, false);
  if (!auth) {
    return;
  }

  let body;
  try {
    body = await readJsonBody(request);
  } catch {
    sendJson(response, 400, {
      error: "Gecersiz rezervasyon verisi.",
      ...buildAuthPayload(auth.user),
    });
    return;
  }

  const { reservation, error } = validateReservationInput(body);
  if (error) {
    sendJson(response, 400, {
      error,
      ...buildAuthPayload(auth.user),
    });
    return;
  }

  const conflicts = listConflictDates(reservation.apartment, reservation.checkIn, reservation.checkOut, null);
  if (conflicts.length > 0) {
    const preview = conflicts.slice(0, 4).map((date) => formatDisplayDate(date)).join(", ");
    sendJson(response, 409, {
      error: `Bu tarihlerde daha once verilmis randevu var: ${preview}. Yeni islem kaydedilmedi.`,
      ...buildAuthPayload(auth.user),
    });
    return;
  }

  const createdReservation = {
    id: storeCache.nextReservationId,
    createdByUsername: auth.user.username,
    ...reservation,
  };

  storeCache.nextReservationId += 1;
  storeCache.reservations.unshift(createdReservation);
  storeCache.notifications.unshift(buildReservationNotificationMessage(createdReservation, "created"));
  storeCache.logs.unshift(
    `${timestampNow()} - ${auth.user.username}, ${reservation.guestName} icin rezervasyon olusturdu.`,
  );

  const createdReservationStart = getReservationStartDateTime(createdReservation);
  const leadMs = Math.max(storeCache.mailSettings.leadMinutes, 1) * 60 * 1000;
  const isArrivalSoon = createdReservationStart
    ? createdReservationStart.getTime() - Date.now() <= leadMs && createdReservationStart.getTime() - Date.now() >= 0
    : false;

  if (isArrivalSoon) {
    storeCache.notifications.unshift(buildReservationNotificationMessage(createdReservation, "arrival"));
  }

  await saveStore();
  if (storeCache.mailSettings.recipients.length > 0 && isMailProviderConfigured()) {
    await sendMailToRecipients(
      storeCache.mailSettings.recipients,
      buildReservationCreatedMailSubject(),
      buildMailBody(createdReservation, "created"),
      `${reservation.apartment} / ${reservation.guestName} / olusturma`,
    );
  }

  sendJson(response, 200, buildAuthPayload(auth.user));
}

async function handleUpdateReservation(request, response, reservationId) {
  const auth = await requireAuth(request, response, false);
  if (!auth) {
    return;
  }

  const selectedReservation = storeCache.reservations.find((item) => item.id === reservationId);
  if (!selectedReservation) {
    sendJson(response, 404, {
      error: "Duzenlenecek randevu bulunamadi.",
      ...buildAuthPayload(auth.user),
    });
    return;
  }

  if (!canManageReservation(auth.user, selectedReservation)) {
    sendJson(response, 403, {
      error: "Bu rezervasyonu sadece olusturan kullanici veya admin duzenleyebilir.",
      ...buildAuthPayload(auth.user),
    });
    return;
  }

  let body;
  try {
    body = await readJsonBody(request);
  } catch {
    sendJson(response, 400, {
      error: "Gecersiz rezervasyon verisi.",
      ...buildAuthPayload(auth.user),
    });
    return;
  }

  const { reservation, error } = validateReservationInput(body);
  if (error) {
    sendJson(response, 400, {
      error,
      ...buildAuthPayload(auth.user),
    });
    return;
  }

  const conflicts = listConflictDates(reservation.apartment, reservation.checkIn, reservation.checkOut, selectedReservation.id);
  if (conflicts.length > 0) {
    const preview = conflicts.slice(0, 4).map((date) => formatDisplayDate(date)).join(", ");
    sendJson(response, 409, {
      error: `Bu tarihlerde daha once verilmis randevu var: ${preview}. Duzenleme kaydedilmedi.`,
      ...buildAuthPayload(auth.user),
    });
    return;
  }

  selectedReservation.apartment = reservation.apartment;
  selectedReservation.guestName = reservation.guestName;
  selectedReservation.checkIn = reservation.checkIn;
  selectedReservation.checkOut = reservation.checkOut;
  selectedReservation.arrivalTime = reservation.arrivalTime;
  selectedReservation.checkoutTime = reservation.checkoutTime;
  selectedReservation.status = reservation.status;
  selectedReservation.source = reservation.source;

  storeCache.notifications.unshift(
    `Randevu duzenlendi: ${selectedReservation.apartment} / ${selectedReservation.guestName} / ${formatDisplayDate(selectedReservation.checkIn)} ${selectedReservation.arrivalTime}`,
  );
  storeCache.logs.unshift(
    `${timestampNow()} - ${auth.user.username}, ${selectedReservation.guestName} kaydini duzenledi.`,
  );

  await saveStore();
  sendJson(response, 200, buildAuthPayload(auth.user));
}

async function handleDeleteReservation(request, response, reservationId) {
  const auth = await requireAuth(request, response, false);
  if (!auth) {
    return;
  }

  const reservationIndex = storeCache.reservations.findIndex((item) => item.id === reservationId);
  if (reservationIndex === -1) {
    sendJson(response, 404, {
      error: "Silinecek randevu bulunamadi.",
      ...buildAuthPayload(auth.user),
    });
    return;
  }

  if (!canManageReservation(auth.user, storeCache.reservations[reservationIndex])) {
    sendJson(response, 403, {
      error: "Bu rezervasyonu sadece olusturan kullanici veya admin silebilir.",
      ...buildAuthPayload(auth.user),
    });
    return;
  }

  const [reservation] = storeCache.reservations.splice(reservationIndex, 1);
  storeCache.notifications.unshift(`Randevu silindi: ${reservation.apartment} / ${reservation.guestName}`);
  storeCache.logs.unshift(
    `${timestampNow()} - ${auth.user.username}, ${reservation.guestName} kaydini sildi.`,
  );

  await saveStore();
  sendJson(response, 200, buildAuthPayload(auth.user));
}

async function handleCreateUser(request, response) {
  const auth = await requireAuth(request, response, true);
  if (!auth) {
    return;
  }

  let body;
  try {
    body = await readJsonBody(request);
  } catch {
    sendJson(response, 400, {
      error: "Gecersiz kullanici verisi.",
      ...buildAuthPayload(auth.user),
    });
    return;
  }

  const { user, error } = validateUserInput(body, true);
  if (error) {
    sendJson(response, 400, {
      error,
      ...buildAuthPayload(auth.user),
    });
    return;
  }

  if (storeCache.users.some((item) => item.username === user.username && item.active)) {
    sendJson(response, 409, {
      error: "Bu kullanici adi zaten kullaniliyor.",
      ...buildAuthPayload(auth.user),
    });
    return;
  }

  const existingInactive = storeCache.users.find((item) => item.username === user.username && !item.active);
  if (existingInactive) {
    existingInactive.password = user.password;
    existingInactive.role = user.role;
    existingInactive.active = true;
  } else {
    storeCache.users.push(user);
  }

  storeCache.logs.unshift(`${timestampNow()} - ${auth.user.username}, kullanici ekledi: ${user.username} (${user.role}).`);
  await saveStore();
  sendJson(response, 200, buildAuthPayload(auth.user));
}

async function handleUpdateUser(request, response, username) {
  const auth = await requireAuth(request, response, true);
  if (!auth) {
    return;
  }

  const userToEdit = storeCache.users.find((item) => item.active && item.username === username);
  if (!userToEdit) {
    sendJson(response, 404, {
      error: "Duzenlenecek kullanici bulunamadi.",
      ...buildAuthPayload(auth.user),
    });
    return;
  }

  let body;
  try {
    body = await readJsonBody(request);
  } catch {
    sendJson(response, 400, {
      error: "Gecersiz kullanici verisi.",
      ...buildAuthPayload(auth.user),
    });
    return;
  }

  const { user, error } = validateUserInput({ password: body?.password, role: body?.role }, false);
  if (error) {
    sendJson(response, 400, {
      error,
      ...buildAuthPayload(auth.user),
    });
    return;
  }

  userToEdit.password = user.password;
  userToEdit.role = user.role;

  storeCache.logs.unshift(`${timestampNow()} - ${auth.user.username}, kullanici duzenledi: ${username} (${user.role}).`);
  await saveStore();

  const refreshedUser = storeCache.users.find((item) => item.username === auth.user.username && item.active) || auth.user;
  sendJson(response, 200, buildAuthPayload(refreshedUser));
}

async function handleDeleteUser(request, response, username) {
  const auth = await requireAuth(request, response, true);
  if (!auth) {
    return;
  }

  const userToDelete = storeCache.users.find((item) => item.active && item.username === username);
  if (!userToDelete || userToDelete.username === DEFAULT_ADMIN_USERNAME) {
    sendJson(response, 404, {
      error: "Silinecek aktif kullanici bulunamadi.",
      ...buildAuthPayload(auth.user),
    });
    return;
  }

  userToDelete.active = false;
  storeCache.logs.unshift(`${timestampNow()} - ${auth.user.username}, kullanici sildi: ${username}.`);
  await saveStore();
  sendJson(response, 200, buildAuthPayload(auth.user));
}

async function handleUpdateMailSettings(request, response) {
  const auth = await requireAuth(request, response, true);
  if (!auth) {
    return;
  }

  let body;
  try {
    body = await readJsonBody(request);
  } catch {
    sendJson(response, 400, {
      error: "Gecersiz mail ayar verisi.",
      ...buildAuthPayload(auth.user),
    });
    return;
  }

  const { mailSettings, error } = validateMailSettingsInput(body);
  if (error) {
    sendJson(response, 400, {
      error,
      ...buildAuthPayload(auth.user),
    });
    return;
  }

  storeCache.mailSettings = mailSettings;
  storeCache.logs.unshift(`${timestampNow()} - ${auth.user.username}, mail alicilarini guncelledi.`);
  await saveStore();
  sendJson(response, 200, buildAuthPayload(auth.user));
}

async function handleImportStore(request, response) {
  const auth = await requireAuth(request, response, true);
  if (!auth) {
    return;
  }

  let body;
  try {
    body = await readJsonBody(request);
  } catch {
    sendJson(response, 400, {
      error: "Gecersiz veri aktarma paketi.",
      ...buildAuthPayload(auth.user),
    });
    return;
  }

  const incomingStore = body?.store ?? body;
  if (!incomingStore || typeof incomingStore !== "object") {
    sendJson(response, 400, {
      error: "Aktarilacak veri bulunamadi.",
      ...buildAuthPayload(auth.user),
    });
    return;
  }

  storeCache = normalizeStore(incomingStore);
  await saveStore();

  const refreshedUser = storeCache.users.find((item) => item.active && item.username === auth.user.username) || auth.user;
  sendJson(response, 200, buildAuthPayload(refreshedUser));
}

async function handleSendTestMail(request, response) {
  const auth = await requireAuth(request, response, true);
  if (!auth) {
    return;
  }

  if (storeCache.mailSettings.recipients.length === 0) {
    sendJson(response, 400, {
      error: "Deneme mail icin once alici mail adreslerini kaydedin.",
      ...buildAuthPayload(auth.user),
    });
    return;
  }

  if (!isMailProviderConfigured()) {
    const providerStatus = getMailProviderStatus();
    if (providerStatus.disabled) {
      sendJson(response, 400, {
        error: "Mail gonderimi bu sunucuda kapali.",
        ...buildAuthPayload(auth.user),
      });
      return;
    }

    sendJson(response, 400, {
      error: `Mail ayarlari eksik. Doldurulmasi gereken alanlar: ${providerStatus.missing.join(", ")}. Sonra sunucuyu yeniden baslatin.`,
      ...buildAuthPayload(auth.user),
    });
    return;
  }

  const results = await sendMailToRecipients(
    storeCache.mailSettings.recipients,
    buildTestMailSubject(),
    buildTestMailBody(),
    "test maili",
  );
  const failedResults = results.filter((item) => !item.ok);

  if (failedResults.length > 0) {
    sendJson(response, 502, {
      error: `Bazi test mail gonderimleri basarisiz oldu: ${failedResults.map((item) => `${item.recipient} (${item.error})`).join(", ")}`,
      ...buildAuthPayload(auth.user),
    });
    return;
  }

  sendJson(response, 200, buildAuthPayload(auth.user));
}

const server = http.createServer(async (request, response) => {
  try {
    if (!request.url) {
      sendNotFound(response);
      return;
    }

    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    const pathname = url.pathname;

    if (pathname === "/api/health") {
      await loadStore();
      const mailProviderStatus = getMailProviderStatus();
      sendJson(response, 200, {
        ok: true,
        app: "fizikon-misafirhane-paneli",
        storageMode,
        persistentDataFile: storageMode === "file" ? dataFilePath : null,
        persistentDataStore: storageMode === "postgres" ? "postgres" : "local-file",
        databaseConfigured: storageMode === "postgres",
        mailProviderConfigured: mailProviderStatus.configured,
        mailProviderDisabled: mailProviderStatus.disabled === true,
        mailProviderMissing: mailProviderStatus.missing,
        mailRecipientCount: storeCache.mailSettings.recipients.length,
        mailSenderAddress: mailProviderStatus.senderAddress,
      });
      return;
    }

    if (pathname === "/api/bootstrap" && request.method === "GET") {
      await handleBootstrap(response);
      return;
    }

    if (pathname === "/api/login" && request.method === "POST") {
      await handleLogin(request, response);
      return;
    }

    if (pathname === "/api/session" && request.method === "GET") {
      await handleSession(request, response);
      return;
    }

    if (pathname === "/api/logout" && request.method === "POST") {
      await handleLogout(request, response);
      return;
    }

    if (pathname === "/api/account/password" && request.method === "PUT") {
      await handleChangeOwnPassword(request, response);
      return;
    }

    if (pathname === "/api/reservations" && request.method === "POST") {
      await handleCreateReservation(request, response);
      return;
    }

    const reservationMatch = pathname.match(/^\/api\/reservations\/(\d+)$/);
    if (reservationMatch) {
      const reservationId = Number(reservationMatch[1]);

      if (request.method === "PUT") {
        await handleUpdateReservation(request, response, reservationId);
        return;
      }

      if (request.method === "DELETE") {
        await handleDeleteReservation(request, response, reservationId);
        return;
      }
    }

    if (pathname === "/api/users" && request.method === "POST") {
      await handleCreateUser(request, response);
      return;
    }

    if (pathname === "/api/settings/mail" && request.method === "PUT") {
      await handleUpdateMailSettings(request, response);
      return;
    }

    if (pathname === "/api/admin/store/import" && request.method === "POST") {
      await handleImportStore(request, response);
      return;
    }

    if (pathname === "/api/settings/mail/test" && request.method === "POST") {
      await handleSendTestMail(request, response);
      return;
    }

    const userMatch = pathname.match(/^\/api\/users\/([^/]+)$/);
    if (userMatch) {
      const username = decodeURIComponent(userMatch[1]);

      if (request.method === "PUT") {
        await handleUpdateUser(request, response, username);
        return;
      }

      if (request.method === "DELETE") {
        await handleDeleteUser(request, response, username);
        return;
      }
    }

    const targetPath = safeResolve(pathname);
    if (!targetPath) {
      sendNotFound(response);
      return;
    }

    await sendFile(response, targetPath);
  } catch (error) {
    console.error(error);
    sendText(response, 500, "Sunucu hatasi olustu.");
  }
});

await loadStore();
setInterval(() => {
  void checkUpcomingReservationMail();
}, MAIL_CHECK_INTERVAL_MS).unref?.();
void checkUpcomingReservationMail();

server.listen(port, host, () => {
  console.log(`Fizikon Misafirhane Paneli calisiyor: http://${host}:${port}/`);
  if (storageMode === "postgres") {
    console.log("Kalici veri kaynagi: PostgreSQL");
  } else {
    console.log(`Kalici veri dosyasi: ${dataFilePath}`);
  }
});
