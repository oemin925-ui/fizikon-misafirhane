const FIXED_TODAY = "2026-04-22";
const DEFAULT_CHECKOUT = "2026-04-25";
const DEFAULT_TIME = "14:30";
const DEFAULT_CHECKOUT_TIME = "11:00";
const DEFAULT_ADMIN_USERNAME = "admin";
const DEFAULT_ADMIN_PASSWORD = "admin";
const DEFAULT_MAIL_SETTINGS = {
  recipients: [],
  leadMinutes: 24 * 60,
  senderAddress: "bilgiislem@fizikon.com",
  providerReady: false,
  providerMissing: [],
};
const SESSION_STORAGE_KEY = "fizikon-session-token";
const MONTH_NAMES = [
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
const WEEKDAYS = ["Pazartesi", "Sali", "Carsamba", "Persembe", "Cuma", "Cumartesi", "Pazar"];
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

let nextReservationId = 1;
let sessionToken = "";
let users = [];
const createdReservations = [];
const notifications = [];
const logs = [];

const state = {
  imported: null,
  monthsByApartment: {},
  busyByApartment: {},
  apartments: [],
  monthOptions: [],
  selectedApartment: "2 Nolu Daire",
  selectedMonth: "Nisan 2026",
  selectedReservationId: null,
  currentUser: null,
  editingUserOriginalUsername: null,
  mailSettings: { ...DEFAULT_MAIL_SETTINGS },
};

const elements = {
  appShell: document.getElementById("appShell"),
  appContent: document.getElementById("appContent"),
  loginPanel: document.getElementById("loginPanel"),
  apartmentInput: document.getElementById("apartment"),
  apartmentFilter: document.getElementById("apartmentFilter"),
  monthFilter: document.getElementById("monthFilter"),
  calendar: document.getElementById("calendar"),
  calendarTitle: document.getElementById("calendarTitle"),
  importStatus: document.getElementById("importStatus"),
  conflictBanner: document.getElementById("conflictBanner"),
  formTitle: document.getElementById("formTitle"),
  submitReservationButton: document.getElementById("submitReservationButton"),
  editReservationButton: document.getElementById("editReservationButton"),
  deleteReservationButton: document.getElementById("deleteReservationButton"),
  cancelEditButton: document.getElementById("cancelEditButton"),
  selectionStatus: document.getElementById("selectionStatus"),
  guestName: document.getElementById("guestName"),
  guestNameSuggestions: document.getElementById("guestNameSuggestions"),
  checkIn: document.getElementById("checkIn"),
  checkOut: document.getElementById("checkOut"),
  arrivalTime: document.getElementById("arrivalTime"),
  checkoutTime: document.getElementById("checkoutTime"),
  username: document.getElementById("username"),
  password: document.getElementById("password"),
  loginButton: document.getElementById("loginButton"),
  loginStatus: document.getElementById("loginStatus"),
  sessionPanel: document.getElementById("sessionPanel"),
  sessionUserLabel: document.getElementById("sessionUserLabel"),
  sessionRoleLabel: document.getElementById("sessionRoleLabel"),
  currentPasswordChange: document.getElementById("currentPasswordChange"),
  nextPasswordChange: document.getElementById("nextPasswordChange"),
  confirmPasswordChange: document.getElementById("confirmPasswordChange"),
  changePasswordButton: document.getElementById("changePasswordButton"),
  passwordChangeStatus: document.getElementById("passwordChangeStatus"),
  logoutButton: document.getElementById("logoutButton"),
  exportButton: document.getElementById("exportButton"),
  adminPanel: document.getElementById("adminPanel"),
  newUsername: document.getElementById("newUsername"),
  newUsernameGroup: document.getElementById("newUsernameGroup"),
  newPassword: document.getElementById("newPassword"),
  newUserRole: document.getElementById("newUserRole"),
  selectedEditUserGroup: document.getElementById("selectedEditUserGroup"),
  selectedEditUsername: document.getElementById("selectedEditUsername"),
  addUserButton: document.getElementById("addUserButton"),
  editUserButton: document.getElementById("editUserButton"),
  editUserPicker: document.getElementById("editUserPicker"),
  editUserSelect: document.getElementById("editUserSelect"),
  deleteUserPicker: document.getElementById("deleteUserPicker"),
  deleteUserSelect: document.getElementById("deleteUserSelect"),
  userAdminStatus: document.getElementById("userAdminStatus"),
  mailRecipientOne: document.getElementById("mailRecipientOne"),
  mailRecipientTwo: document.getElementById("mailRecipientTwo"),
  saveMailButton: document.getElementById("saveMailButton"),
  testMailButton: document.getElementById("testMailButton"),
  mailStatus: document.getElementById("mailStatus"),
};

function normalizeUsers(rawUsers, ensureAdmin = false) {
  const normalizedUsers = Array.isArray(rawUsers)
    ? rawUsers
      .map((user) => ({
        username: typeof user?.username === "string" ? user.username.trim() : "",
        password: typeof user?.password === "string" ? user.password : "",
        role: user?.role === "Admin" ? "Admin" : "Personel",
        active: user?.active !== false,
      }))
      .filter((user) => user.username && (user.password || !ensureAdmin))
    : [];

  if (!ensureAdmin) {
    return normalizedUsers;
  }

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

function replaceArrayContents(target, items) {
  target.splice(0, target.length, ...(Array.isArray(items) ? items : []));
}

function persistSessionToken(token) {
  sessionToken = token || "";

  try {
    if (sessionToken) {
      window.localStorage.setItem(SESSION_STORAGE_KEY, sessionToken);
    } else {
      window.localStorage.removeItem(SESSION_STORAGE_KEY);
    }
  } catch {
    // Keep the in-memory session working if storage is unavailable.
  }
}

function loadSessionToken() {
  try {
    return window.localStorage.getItem(SESSION_STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

function hydrateServerState(payload = {}) {
  nextReservationId = Number(payload?.nextReservationId) || 1;
  replaceArrayContents(createdReservations, payload?.reservations);
  replaceArrayContents(notifications, payload?.notifications);
  replaceArrayContents(logs, payload?.logs);
  users = normalizeUsers(payload?.users, false);
  state.mailSettings = {
    ...DEFAULT_MAIL_SETTINGS,
    ...(payload?.mailSettings || {}),
    recipients: Array.isArray(payload?.mailSettings?.recipients)
      ? payload.mailSettings.recipients.filter(Boolean)
      : [],
  };
}

async function apiRequest(url, options = {}) {
  const { auth = true, body, headers = {}, ...rest } = options;
  const requestHeaders = { ...headers };

  if (body !== undefined) {
    requestHeaders["Content-Type"] = "application/json; charset=utf-8";
  }

  if (auth && sessionToken) {
    requestHeaders.Authorization = `Bearer ${sessionToken}`;
  }

  const response = await fetch(url, {
    ...rest,
    headers: requestHeaders,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const isJson = response.headers.get("content-type")?.includes("application/json");
  const payload = isJson ? await response.json() : null;

  if (!response.ok) {
    const error = new Error(payload?.error || "Sunucu istegi basarisiz oldu.");
    error.payload = payload;

    if (response.status === 401) {
      persistSessionToken("");
      state.currentUser = null;
      hydrateServerState({});
      updateSessionUi();
    }

    throw error;
  }

  return payload;
}

function maybeRepairMojibake(text) {
  if (typeof text !== "string" || !/[ÃÄÅ]/.test(text)) {
    return text;
  }

  try {
    const bytes = Uint8Array.from(Array.from(text).map((char) => char.charCodeAt(0)));
    return new TextDecoder("utf-8").decode(bytes);
  } catch {
    return text;
  }
}

function normalizeText(text) {
  return maybeRepairMojibake((text || "").replace(/\s+/g, " ").trim());
}

function normalizeGuestNameCandidate(text) {
  const value = normalizeText(text);
  const blocked = new Set(["X", "DOLU", "FIZIKON", "FİZİKON", "BOS"]);

  if (!value || value.length < 3 || blocked.has(value.toUpperCase())) {
    return "";
  }

  if (!/[A-Za-zÇĞİÖŞÜçğıöşü]/.test(value)) {
    return "";
  }

  return value;
}

function timestampNow() {
  return new Date().toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
}

function requireLoggedInUser() {
  if (state.currentUser) {
    return state.currentUser;
  }

  showConflict("Islem yapmak icin once giris yapin.");
  return null;
}

function findActiveUser(username) {
  return users.find((user) => user.username === username && user.active);
}

function isAdminSession() {
  return state.currentUser?.role === "Admin";
}

function updateSessionUi() {
  const loggedIn = Boolean(state.currentUser);
  const adminSession = isAdminSession();

  elements.appShell.classList.toggle("logged-out", !loggedIn);
  elements.appShell.classList.toggle("logged-in", loggedIn);
  elements.loginPanel.classList.toggle("hidden", loggedIn);
  elements.sessionPanel.classList.toggle("hidden", !loggedIn);
  elements.exportButton.disabled = !loggedIn;
  elements.adminPanel.classList.toggle("hidden", !adminSession);
  elements.sessionUserLabel.textContent = loggedIn ? state.currentUser.username : "";
  elements.sessionRoleLabel.textContent = loggedIn
    ? `${state.currentUser.role} kullanicisi ile giris yapildi.`
    : "";

  if (!adminSession) {
    hideEditUserPicker();
    hideDeleteUserPicker();
    clearUserAdminStatus();
    clearMailStatus();
    resetUserEditor();
  }

  if (!loggedIn) {
    resetPasswordChangeForm();
    clearPasswordChangeStatus();
  }
}

function populateMailSettings() {
  const recipients = state.mailSettings?.recipients || [];
  elements.mailRecipientOne.value = recipients[0] || "";
  elements.mailRecipientTwo.value = recipients[1] || "";
}

function applyServerAuthPayload(payload) {
  state.currentUser = payload?.currentUser || null;
  state.selectedReservationId = null;
  hydrateServerState(payload?.data);
  updateSessionUi();
  populateMailSettings();
  refreshView();
}

async function refreshServerState() {
  const payload = await apiRequest("/api/session");
  applyServerAuthPayload(payload);
  return payload;
}

async function restoreSession() {
  const storedToken = loadSessionToken();
  if (!storedToken) {
    return false;
  }

  persistSessionToken(storedToken);

  try {
    const payload = await refreshServerState();
    elements.loginStatus.textContent = payload.currentUser?.role === "Admin"
      ? "Admin oturumu geri yuklendi."
      : "Personel oturumu geri yuklendi.";
    return true;
  } catch {
    persistSessionToken("");
    state.currentUser = null;
    hydrateServerState({});
    updateSessionUi();
    return false;
  }
}

function setUserAdminStatus(message) {
  elements.userAdminStatus.textContent = message;
  elements.userAdminStatus.classList.remove("hidden");
}

function clearUserAdminStatus() {
  elements.userAdminStatus.textContent = "";
  elements.userAdminStatus.classList.add("hidden");
}

function setMailStatus(message) {
  elements.mailStatus.textContent = message;
  elements.mailStatus.classList.remove("hidden");
}

function clearMailStatus() {
  elements.mailStatus.textContent = "";
  elements.mailStatus.classList.add("hidden");
}

function setPasswordChangeStatus(message) {
  elements.passwordChangeStatus.textContent = message;
  elements.passwordChangeStatus.classList.remove("hidden");
}

function clearPasswordChangeStatus() {
  elements.passwordChangeStatus.textContent = "";
  elements.passwordChangeStatus.classList.add("hidden");
}

function resetPasswordChangeForm() {
  elements.currentPasswordChange.value = "";
  elements.nextPasswordChange.value = "";
  elements.confirmPasswordChange.value = "";
}

function getDeletableUsers() {
  return users.filter((user) => user.active && user.username !== DEFAULT_ADMIN_USERNAME);
}

function getEditableUsers() {
  return users.filter((user) => user.active);
}

function hideEditUserPicker() {
  elements.editUserPicker.classList.add("hidden");
  elements.editUserSelect.innerHTML = "";
}

function showEditUserPicker() {
  const editableUsers = getEditableUsers();

  if (editableUsers.length === 0) {
    setUserAdminStatus("Duzenlenebilecek aktif kullanici bulunamadi.");
    hideEditUserPicker();
    return;
  }

  elements.editUserSelect.innerHTML = editableUsers
    .sort((left, right) => left.username.localeCompare(right.username, "tr"))
    .map((user) => `<option value="${user.username}">${user.username} (${user.role})</option>`)
    .join("");

  elements.editUserPicker.classList.remove("hidden");
}

function hideDeleteUserPicker() {
  elements.deleteUserPicker.classList.add("hidden");
  elements.deleteUserSelect.innerHTML = "";
}

function setUserEditorMode(mode, selectedUsername = "") {
  const editing = mode === "edit";

  elements.newUsernameGroup.classList.toggle("hidden", editing);
  elements.selectedEditUserGroup.classList.toggle("hidden", !editing);
  elements.selectedEditUsername.value = editing ? selectedUsername : "";
  elements.addUserButton.textContent = editing ? "Degisiklikleri Kaydet" : "Kullanici Ekle";
}

function showDeleteUserPicker() {
  const deletableUsers = getDeletableUsers();

  if (deletableUsers.length === 0) {
    setUserAdminStatus("Silinebilecek aktif kullanici bulunamadi.");
    hideDeleteUserPicker();
    return;
  }

  elements.deleteUserSelect.innerHTML = deletableUsers
    .sort((left, right) => left.username.localeCompare(right.username, "tr"))
    .map((user) => `<option value="${user.username}">${user.username} (${user.role})</option>`)
    .join("");

  elements.deleteUserPicker.classList.remove("hidden");
}

function resetUserEditor() {
  state.editingUserOriginalUsername = null;
  elements.newUsername.value = "";
  elements.newPassword.value = "";
  elements.newUserRole.value = "Personel";
  setUserEditorMode("create");
  hideEditUserPicker();
}

function reminderLabel() {
  const leadMinutes = Number(state.mailSettings?.leadMinutes) || DEFAULT_MAIL_SETTINGS.leadMinutes;
  const leadHours = Math.round(leadMinutes / 60);
  return `${leadHours} saat kala`;
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

function parseMonthLabel(label) {
  const [monthName, yearValue] = normalizeText(label).split(" ");
  const monthIndex = MONTH_INDEXES[stripTurkish(monthName)];
  return {
    monthIndex,
    year: Number(yearValue),
  };
}

function toIso(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDisplayDate(isoDate) {
  const [year, month, day] = isoDate.split("-");
  return `${day}.${month}.${year}`;
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

function monthLabelFromIso(isoDate) {
  const date = new Date(isoDate);
  return `${MONTH_NAMES[date.getMonth()]} ${date.getFullYear()}`;
}

function getMonthBounds(monthLabel) {
  const { monthIndex, year } = parseMonthLabel(monthLabel);
  const start = new Date(year, monthIndex, 1);
  const end = new Date(year, monthIndex + 1, 0);
  return {
    startIso: toIso(start),
    endIso: toIso(end),
    monthIndex,
    year,
  };
}

function overlapsRange(startA, endA, startB, endB) {
  return startA <= endB && endA >= startB;
}

function parseCell(cellText) {
  const cleaned = normalizeText(cellText);

  if (!cleaned) {
    return { dayLabel: "", note: "", empty: true };
  }

  const match = cleaned.match(/^(\d{1,2})(?:\s+(.*))?$/);
  if (!match) {
    return { dayLabel: "", note: cleaned, empty: false };
  }

  return {
    dayLabel: match[1],
    note: normalizeText(match[2] || ""),
    empty: false,
  };
}

function addBusyNote(apartment, isoDate, note) {
  if (!note) {
    return;
  }

  if (!state.busyByApartment[apartment][isoDate]) {
    state.busyByApartment[apartment][isoDate] = [];
  }

  if (!state.busyByApartment[apartment][isoDate].includes(note)) {
    state.busyByApartment[apartment][isoDate].push(note);
  }
}

function buildImportedState(rawData) {
  const apartments = rawData.apartments.map((apartment) => ({
    ...apartment,
    name: normalizeText(apartment.name),
    months: apartment.months.map((month) => ({
      ...month,
      monthLabel: normalizeText(month.monthLabel),
      rows: month.rows.map((row) => row.map((cell) => normalizeText(cell))),
    })),
  }));

  state.apartments = apartments.map((item) => item.name);
  state.monthOptions = apartments[0]?.months.map((month) => month.monthLabel) || [];
  state.monthsByApartment = {};
  state.busyByApartment = {};

  apartments.forEach((apartment) => {
    state.monthsByApartment[apartment.name] = {};
    state.busyByApartment[apartment.name] = {};

    apartment.months.forEach((month) => {
      const { monthIndex, year } = parseMonthLabel(month.monthLabel);
      const gridStart = startOfGrid(year, monthIndex);
      const cells = [];

      month.rows.slice(1).forEach((row, rowIndex) => {
        row.forEach((cellText, columnIndex) => {
          const parsed = parseCell(cellText);
          const gridIndex = rowIndex * 7 + columnIndex;
          const date = addDays(gridStart, gridIndex);
          const isoDate = toIso(date);

          addBusyNote(apartment.name, isoDate, parsed.note);

          cells.push({
            isoDate,
            dayLabel: parsed.dayLabel || String(date.getDate()),
            note: parsed.note,
            empty: parsed.empty,
            currentMonth: date.getMonth() === monthIndex,
          });
        });
      });

      state.monthsByApartment[apartment.name][month.monthLabel] = {
        monthLabel: month.monthLabel,
        weekdays: WEEKDAYS,
        cells,
      };
    });
  });
}

function updateGuestNameSuggestions() {
  const names = new Set();

  createdReservations.forEach((reservation) => {
    const name = normalizeGuestNameCandidate(reservation.guestName);
    if (name) {
      names.add(name);
    }
  });

  state.apartments.forEach((apartment) => {
    const importedByDate = state.busyByApartment[apartment] || {};
    Object.values(importedByDate).forEach((notes) => {
      notes.forEach((note) => {
        const name = normalizeGuestNameCandidate(note);
        if (name) {
          names.add(name);
        }
      });
    });
  });

  elements.guestNameSuggestions.innerHTML = Array.from(names)
    .sort((left, right) => left.localeCompare(right, "tr"))
    .map((name) => `<option value="${name}"></option>`)
    .join("");
}

function populateSelectors() {
  elements.apartmentInput.innerHTML = "";
  elements.apartmentFilter.innerHTML = "";
  elements.monthFilter.innerHTML = "";

  state.apartments.forEach((apartment) => {
    elements.apartmentInput.add(new Option(apartment, apartment));
    elements.apartmentFilter.add(new Option(apartment, apartment));
  });

  state.monthOptions.forEach((monthLabel) => {
    elements.monthFilter.add(new Option(monthLabel, monthLabel));
  });

  elements.apartmentInput.value = state.selectedApartment;
  elements.apartmentFilter.value = state.selectedApartment;
  elements.monthFilter.value = state.selectedMonth;
}

function reservationTouchesDate(reservation, isoDate) {
  return isoDate >= reservation.checkIn && isoDate <= reservation.checkOut;
}

function getSelectedReservation() {
  return createdReservations.find((reservation) => reservation.id === state.selectedReservationId) || null;
}

function canEditReservation(reservation) {
  return Boolean(reservation?.canEdit);
}

function buildReservationSummary(reservation) {
  const ownerLabel = isAdminSession() && reservation?.createdByUsername
    ? ` / Olusturan: ${reservation.createdByUsername}`
    : "";
  return `${reservation.guestName} / ${formatDisplayDate(reservation.checkIn)} - ${formatDisplayDate(reservation.checkOut)}${ownerLabel}`;
}

function getPanelReservationsForDate(apartment, isoDate) {
  return createdReservations
    .filter((reservation) => reservation.apartment === apartment && reservationTouchesDate(reservation, isoDate))
    .sort((left, right) => left.checkIn.localeCompare(right.checkIn));
}

function getReservationForDateSelection(apartment, isoDate) {
  const reservations = getPanelReservationsForDate(apartment, isoDate).filter((reservation) => canEditReservation(reservation));
  if (reservations.length === 0) {
    return null;
  }

  if (reservations.length === 1) {
    return reservations[0];
  }

  const currentIndex = reservations.findIndex((reservation) => reservation.id === state.selectedReservationId);
  if (currentIndex >= 0) {
    return reservations[(currentIndex + 1) % reservations.length];
  }

  return reservations.find((reservation) => reservation.checkIn === isoDate) || reservations[0];
}

function updateActionButtons() {
  const selectedReservation = getSelectedReservation();

  if (!selectedReservation) {
    elements.selectionStatus.textContent = "Duzenle ve sil icin takvimde panelden olusturulmus bir randevuya tiklayin.";
    elements.cancelEditButton.classList.add("hidden");
    elements.editReservationButton.disabled = true;
    elements.deleteReservationButton.disabled = true;
    return;
  }

  if (!canEditReservation(selectedReservation)) {
    elements.selectionStatus.textContent = "Bu rezervasyonu sadece olusturan kullanici veya admin duzenleyebilir.";
    elements.cancelEditButton.classList.add("hidden");
    elements.editReservationButton.disabled = true;
    elements.deleteReservationButton.disabled = true;
    return;
  }

  elements.selectionStatus.textContent = `Secilen kayit: ${buildReservationSummary(selectedReservation)}`;
  elements.cancelEditButton.classList.remove("hidden");
  elements.editReservationButton.disabled = false;
  elements.deleteReservationButton.disabled = false;
}

function createdNotesForDate(apartment, isoDate) {
  return createdReservations
    .filter((reservation) => reservation.apartment === apartment && reservationTouchesDate(reservation, isoDate))
    .map((reservation) => {
      if (!canEditReservation(reservation)) {
        return "Rezervasyon";
      }

      return reservation.checkIn === isoDate ? `${reservation.guestName} ${reservation.arrivalTime}` : reservation.guestName;
    });
}

function getCalendarNotes(apartment, isoDate) {
  const importedNotes = state.busyByApartment[apartment]?.[isoDate] || [];
  const panelNotes = createdNotesForDate(apartment, isoDate);
  return [...new Set([...panelNotes, ...importedNotes])];
}

function renderCalendar() {
  const monthData = state.monthsByApartment[state.selectedApartment]?.[state.selectedMonth];
  if (!monthData) {
    elements.calendar.innerHTML = '<div class="note danger">Takvim verisi bulunamadi.</div>';
    return;
  }

  elements.calendarTitle.textContent = `${state.selectedMonth} / ${state.selectedApartment}`;

  const weekdayMarkup = monthData.weekdays.map((weekday) => `<div class="weekday">${weekday}</div>`).join("");
  const dayMarkup = monthData.cells
    .map((cell) => {
      if (!cell.currentMonth) {
        return '<div class="day outside"><strong>&nbsp;</strong><span></span></div>';
      }

      const notes = getCalendarNotes(state.selectedApartment, cell.isoDate);
      const panelReservations = getPanelReservationsForDate(state.selectedApartment, cell.isoDate);
      const visibleNotes = notes.length > 0 ? notes.slice(0, 4) : [];
      const noteMarkup = visibleNotes.length > 0
        ? visibleNotes.map((note) => `<span>${note}</span>`).join("")
        : "<span>Bos</span>";
      const busyClass = notes.length > 0 ? "busy" : "";
      const selectableClass = panelReservations.some((reservation) => canEditReservation(reservation)) ? "selectable" : "";
      const lockedClass = panelReservations.length > 0 && !panelReservations.some((reservation) => canEditReservation(reservation))
        ? "locked"
        : "";
      const selectedClass = state.selectedReservationId && panelReservations.some((reservation) => reservation.id === state.selectedReservationId)
        ? "selected"
        : "";

      return `
        <div class="day ${busyClass} ${selectableClass} ${lockedClass} ${selectedClass}" data-iso-date="${cell.isoDate}">
          <strong>${cell.dayLabel}</strong>
          ${noteMarkup}
        </div>
      `;
    })
    .join("");

  elements.calendar.innerHTML = `${weekdayMarkup}${dayMarkup}`;
}

function refreshView() {
  renderCalendar();
  updateActionButtons();
  updateGuestNameSuggestions();
}

function buildExportRows() {
  const visibleReservations = createdReservations.filter((reservation) => canEditReservation(reservation));
  return [
    ["REZERVASYON LISTESI"],
    ["Daire", "Misafir Adi"],
    ...visibleReservations.map((reservation) => [
      reservation.apartment,
      reservation.guestName,
    ]),
  ];
}

function exportCsvFile(fileName, csvContent) {
  const blob = new Blob(["\uFEFF", csvContent], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = fileName;
  link.click();
  setTimeout(() => {
    URL.revokeObjectURL(link.href);
  }, 1000);
}

function hideConflict() {
  elements.conflictBanner.className = "note hidden";
  elements.conflictBanner.textContent = "";
}

function showConflict(message) {
  elements.conflictBanner.className = "note danger";
  elements.conflictBanner.textContent = message;
}

function listConflictDates(apartment, checkIn, checkOut, ignoreReservationId = null) {
  const conflicts = [];
  let cursor = new Date(checkIn);
  const end = new Date(checkOut);

  while (cursor <= end) {
    const isoDate = toIso(cursor);
    const imported = state.busyByApartment[apartment]?.[isoDate] || [];
    const created = createdReservations.filter(
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

function resetForm() {
  state.selectedReservationId = null;
  elements.formTitle.textContent = "Yeni kayit olustur";
  elements.submitReservationButton.textContent = "Randevu Ver";
  elements.apartmentInput.value = state.selectedApartment;
  elements.guestName.value = "Emin";
  elements.checkIn.value = FIXED_TODAY;
  elements.checkOut.value = DEFAULT_CHECKOUT;
  elements.arrivalTime.value = DEFAULT_TIME;
  elements.checkoutTime.value = DEFAULT_CHECKOUT_TIME;
  hideConflict();
  updateActionButtons();
}

function selectReservation(id) {
  const reservation = createdReservations.find((item) => item.id === id);
  if (!reservation || !canEditReservation(reservation)) {
    return;
  }

  state.selectedReservationId = id;
  elements.formTitle.textContent = "Duzenlenecek randevu";
  elements.apartmentInput.value = reservation.apartment;
  elements.guestName.value = reservation.guestName;
  elements.checkIn.value = reservation.checkIn;
  elements.checkOut.value = reservation.checkOut;
  elements.arrivalTime.value = reservation.arrivalTime;
  elements.checkoutTime.value = reservation.checkoutTime || DEFAULT_CHECKOUT_TIME;
  hideConflict();
  updateActionButtons();
  renderCalendar();
}

function syncSelections(apartment, monthLabel = state.selectedMonth) {
  state.selectedApartment = apartment;
  state.selectedMonth = monthLabel;
  elements.apartmentInput.value = apartment;
  elements.apartmentFilter.value = apartment;
  elements.monthFilter.value = monthLabel;
  refreshView();
}

async function handleCreateOrUpdate() {
  const actor = requireLoggedInUser();
  if (!actor) {
    return;
  }

  hideConflict();

  const reservation = {
    apartment: elements.apartmentInput.value,
    guestName: elements.guestName.value.trim(),
    checkIn: elements.checkIn.value,
    checkOut: elements.checkOut.value,
    arrivalTime: elements.arrivalTime.value,
    checkoutTime: elements.checkoutTime.value,
    status: "Planlandi",
    source: "panel",
  };

  if (!reservation.guestName || !reservation.checkIn || !reservation.checkOut || !reservation.arrivalTime || !reservation.checkoutTime) {
    showConflict("Tum alanlari doldurmaniz gerekiyor.");
    return;
  }

  if (reservation.checkOut < reservation.checkIn) {
    showConflict("Cikis tarihi gelis tarihinden once olamaz.");
    return;
  }

  try {
    const payload = await apiRequest("/api/reservations", {
      method: "POST",
      body: reservation,
    });

    hydrateServerState(payload.data);
    syncSelections(reservation.apartment, monthLabelFromIso(reservation.checkIn));
    resetForm();
  } catch (error) {
    if (error.payload?.data) {
      hydrateServerState(error.payload.data);
      refreshView();
    }

    showConflict(error.message);
  }
}

async function handleUpdateReservation() {
  const selectedReservation = getSelectedReservation();
  if (!selectedReservation) {
    showConflict("Duzenlemek icin once takvimden bir panel randevusu secin.");
    return;
  }

  if (!canEditReservation(selectedReservation)) {
    showConflict("Bu rezervasyonu sadece olusturan kullanici veya admin duzenleyebilir.");
    return;
  }

  const actor = requireLoggedInUser();
  if (!actor) {
    return;
  }

  const confirmed = window.confirm(`${selectedReservation.guestName} kaydini duzenlemek istiyor musunuz?`);
  if (!confirmed) {
    return;
  }

  hideConflict();

  const updatedReservation = {
    apartment: elements.apartmentInput.value,
    guestName: elements.guestName.value.trim(),
    checkIn: elements.checkIn.value,
    checkOut: elements.checkOut.value,
    arrivalTime: elements.arrivalTime.value,
    checkoutTime: elements.checkoutTime.value,
  };

  if (!updatedReservation.guestName || !updatedReservation.checkIn || !updatedReservation.checkOut || !updatedReservation.arrivalTime || !updatedReservation.checkoutTime) {
    showConflict("Tum alanlari doldurmaniz gerekiyor.");
    return;
  }

  if (updatedReservation.checkOut < updatedReservation.checkIn) {
    showConflict("Cikis tarihi gelis tarihinden once olamaz.");
    return;
  }

  try {
    const payload = await apiRequest(`/api/reservations/${selectedReservation.id}`, {
      method: "PUT",
      body: updatedReservation,
    });

    hydrateServerState(payload.data);
    syncSelections(updatedReservation.apartment, monthLabelFromIso(updatedReservation.checkIn));
    resetForm();
  } catch (error) {
    if (error.payload?.data) {
      hydrateServerState(error.payload.data);
      refreshView();
    }

    showConflict(error.message);
  }
}

async function handleDeleteReservation() {
  const reservation = getSelectedReservation();
  if (!reservation) {
    showConflict("Silmek icin once takvimden bir panel randevusu secin.");
    return;
  }

  if (!canEditReservation(reservation)) {
    showConflict("Bu rezervasyonu sadece olusturan kullanici veya admin silebilir.");
    return;
  }

  const actor = requireLoggedInUser();
  if (!actor) {
    return;
  }

  const confirmed = window.confirm(`${reservation.guestName} kaydini silmek istiyor musunuz?`);
  if (!confirmed) {
    return;
  }

  try {
    const payload = await apiRequest(`/api/reservations/${reservation.id}`, {
      method: "DELETE",
    });

    hydrateServerState(payload.data);
    resetForm();
    refreshView();
  } catch (error) {
    if (error.payload?.data) {
      hydrateServerState(error.payload.data);
      refreshView();
    }

    showConflict(error.message);
  }
}

async function handleLogin() {
  const username = elements.username.value.trim();
  const password = elements.password.value;

  if (!username || !password) {
    elements.loginStatus.textContent = "Kullanici adi ve sifre zorunludur.";
    return;
  }

  try {
    const payload = await apiRequest("/api/login", {
      auth: false,
      method: "POST",
      body: { username, password },
    });

    persistSessionToken(payload.token);
    applyServerAuthPayload(payload);
    resetForm();
    elements.loginStatus.textContent = payload.currentUser.role === "Admin"
      ? "Admin girisi basarili. Log kayitlari ve kullanici yonetimi acildi."
      : "Personel girisi basarili. Log kayitlari sadece admin tarafinda gorulur.";
  } catch (error) {
    persistSessionToken("");
    state.currentUser = null;
    hydrateServerState({});
    updateSessionUi();
    elements.loginStatus.textContent = error.message || "Giris basarisiz. Kullanici adi veya sifre hatali.";
  }
}

async function handleLogout() {
  try {
    if (sessionToken) {
      await apiRequest("/api/logout", { method: "POST" });
    }
  } catch {
    // Sunucuya ulasilamasa bile istemci oturumu kapatilabilir.
  }

  persistSessionToken("");
  state.currentUser = null;
  state.selectedReservationId = null;
  elements.username.value = "";
  elements.password.value = "";
  elements.loginStatus.textContent = "Cikis yapildi. Farkli kullanici ile giris yapabilirsiniz.";
  hideConflict();
  clearUserAdminStatus();
  clearMailStatus();
  clearPasswordChangeStatus();
  resetUserEditor();
  resetPasswordChangeForm();
  hideEditUserPicker();
  hideDeleteUserPicker();
  resetForm();
  updateSessionUi();
  elements.username.focus();
}

async function handleChangePassword() {
  const actor = requireLoggedInUser();
  if (!actor) {
    return;
  }

  const currentPassword = elements.currentPasswordChange.value;
  const newPassword = elements.nextPasswordChange.value;
  const confirmPassword = elements.confirmPasswordChange.value;

  if (!currentPassword || !newPassword || !confirmPassword) {
    setPasswordChangeStatus("Tum sifre alanlarini doldurun.");
    return;
  }

  if (newPassword !== confirmPassword) {
    setPasswordChangeStatus("Yeni sifreler birbiriyle ayni olmali.");
    return;
  }

  if (newPassword.length < 4) {
    setPasswordChangeStatus("Yeni sifre en az 4 karakter olmali.");
    return;
  }

  try {
    const payload = await apiRequest("/api/account/password", {
      method: "PUT",
      body: {
        currentPassword,
        newPassword,
      },
    });

    applyServerAuthPayload(payload);
    resetPasswordChangeForm();
    setPasswordChangeStatus("Sifreniz guncellendi.");
  } catch (error) {
    if (error.payload?.data) {
      applyServerAuthPayload(error.payload);
    }

    setPasswordChangeStatus(error.message);
  }
}

async function handleAddUser() {
  if (!isAdminSession()) {
    setUserAdminStatus("Kullanici eklemek icin once admin girisi yapin.");
    return;
  }

  const username = state.editingUserOriginalUsername || elements.newUsername.value.trim();
  const password = elements.newPassword.value;
  const role = elements.newUserRole.value;

  if (!username || !password) {
    setUserAdminStatus("Yeni kullanici adi ve sifre zorunludur.");
    return;
  }

  if (state.editingUserOriginalUsername) {
    try {
      const payload = await apiRequest(`/api/users/${encodeURIComponent(state.editingUserOriginalUsername)}`, {
        method: "PUT",
        body: { password, role },
      });

      applyServerAuthPayload(payload);
      setUserAdminStatus(`${username} kullanicisi guncellendi. Kayit sadece loga yazilir.`);
      resetUserEditor();
      hideDeleteUserPicker();
    } catch (error) {
      if (error.payload?.data) {
        applyServerAuthPayload(error.payload);
      }

      setUserAdminStatus(error.message);
    }

    return;
  }

  try {
    const payload = await apiRequest("/api/users", {
      method: "POST",
      body: { username, password, role },
    });

    applyServerAuthPayload(payload);
    setUserAdminStatus(`${username} kullanicisi eklendi. Kullanici listede gosterilmez, sadece loga yazilir.`);
    resetUserEditor();
    hideDeleteUserPicker();
  } catch (error) {
    if (error.payload?.data) {
      applyServerAuthPayload(error.payload);
    }

    setUserAdminStatus(error.message);
  }
}

async function handleSaveMailSettings() {
  if (!isAdminSession()) {
    setMailStatus("Mail alicilarini kaydetmek icin once admin girisi yapin.");
    return;
  }

  const recipients = [elements.mailRecipientOne.value.trim(), elements.mailRecipientTwo.value.trim()].filter(Boolean);

  try {
    const payload = await apiRequest("/api/settings/mail", {
      method: "PUT",
      body: { recipients },
    });

    applyServerAuthPayload(payload);
    const providerMessage = state.mailSettings.providerReady
      ? `Mail servisi hazir. Gonderen: ${state.mailSettings.senderAddress}.`
      : `.env dosyasinda su alanlar eksik: ${(state.mailSettings.providerMissing || []).join(", ") || "MAIL_SMTP_PASSWORD"}.`;
    setMailStatus(`Mail alicilari kaydedildi. Yaklasan rezervasyonlarda ${reminderLabel()} bildirim denenecek. ${providerMessage}`);
  } catch (error) {
    if (error.payload?.data) {
      applyServerAuthPayload(error.payload);
    }

    setMailStatus(error.message);
  }
}

async function handleSendTestMail() {
  if (!isAdminSession()) {
    setMailStatus("Deneme mail icin once admin girisi yapin.");
    return;
  }

  if (!state.mailSettings?.recipients?.length) {
    setMailStatus("Once mail alicilarini kaydedin.");
    return;
  }

  try {
    const payload = await apiRequest("/api/settings/mail/test", {
      method: "POST",
    });

    applyServerAuthPayload(payload);
    setMailStatus("Deneme mail gonderimi baslatildi. Sonucu log ve bildirimlerde tutulur.");
  } catch (error) {
    if (error.payload?.data) {
      applyServerAuthPayload(error.payload);
    }

    setMailStatus(error.message);
  }
}

function handleDeleteUser() {
  if (!isAdminSession()) {
    setUserAdminStatus("Kullanici silmek icin once admin girisi yapin.");
    return;
  }

  hideEditUserPicker();
  showDeleteUserPicker();
}

function handleEditUser() {
  if (!isAdminSession()) {
    setUserAdminStatus("Kullanici duzenlemek icin once admin girisi yapin.");
    return;
  }

  hideDeleteUserPicker();
  showEditUserPicker();
}

function handleLoadEditUser() {
  if (!isAdminSession()) {
    setUserAdminStatus("Kullanici duzenlemek icin once admin girisi yapin.");
    return;
  }

  const username = elements.editUserSelect.value;
  if (!username) {
    setUserAdminStatus("Listeden bir kullanici secin.");
    return;
  }

  const user = findActiveUser(username);
  if (!user) {
    setUserAdminStatus("Duzenlenecek aktif kullanici bulunamadi.");
    hideEditUserPicker();
    return;
  }

  state.editingUserOriginalUsername = user.username;
  elements.newUsername.value = "";
  elements.newPassword.value = user.password;
  elements.newUserRole.value = user.role;
  setUserEditorMode("edit", user.username);
  hideEditUserPicker();
  setUserAdminStatus(`${user.username} listeden secildi. Sifre ve rol guncellenebilir.`);
}

async function handleConfirmDeleteUser() {
  if (!isAdminSession()) {
    setUserAdminStatus("Kullanici silmek icin once admin girisi yapin.");
    return;
  }

  const username = elements.deleteUserSelect.value;
  if (!username) {
    setUserAdminStatus("Listeden bir kullanici secin.");
    return;
  }

  try {
    const payload = await apiRequest(`/api/users/${encodeURIComponent(username)}`, {
      method: "DELETE",
    });

    applyServerAuthPayload(payload);
    setUserAdminStatus(`${username} kullanicisi silindi. Kayit ekranda gosterilmez, sadece loga yazilir.`);
    if (state.editingUserOriginalUsername === username) {
      resetUserEditor();
    }
    hideDeleteUserPicker();
  } catch (error) {
    if (error.payload?.data) {
      applyServerAuthPayload(error.payload);
    }

    setUserAdminStatus(error.message);
    hideDeleteUserPicker();
  }
}

function bindEvents() {
  elements.loginButton.addEventListener("click", handleLogin);
  elements.logoutButton.addEventListener("click", handleLogout);
  elements.changePasswordButton.addEventListener("click", handleChangePassword);
  [elements.username, elements.password].forEach((input) => {
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        handleLogin();
      }
    });
  });
  [elements.currentPasswordChange, elements.nextPasswordChange, elements.confirmPasswordChange].forEach((input) => {
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        handleChangePassword();
      }
    });
  });

  elements.exportButton.addEventListener("click", () => {
    const actor = requireLoggedInUser();
    if (!actor) {
      return;
    }

    const rows = buildExportRows();
    const csv = rows.map((row) => row.join(";")).join("\n");
    const fileName = isAdminSession()
      ? "fizikon-rezervasyon-ve-loglar.csv"
      : "fizikon-rezervasyonlar.csv";
    exportCsvFile(fileName, csv);
  });

  document.getElementById("addUserButton").addEventListener("click", handleAddUser);
  document.getElementById("editUserButton").addEventListener("click", handleEditUser);
  document.getElementById("loadEditUserButton").addEventListener("click", handleLoadEditUser);
  document.getElementById("cancelEditUserButton").addEventListener("click", () => {
    hideEditUserPicker();
    clearUserAdminStatus();
  });
  document.getElementById("deleteUserButton").addEventListener("click", handleDeleteUser);
  document.getElementById("confirmDeleteUserButton").addEventListener("click", handleConfirmDeleteUser);
  document.getElementById("cancelDeleteUserButton").addEventListener("click", () => {
    hideDeleteUserPicker();
    clearUserAdminStatus();
  });
  elements.saveMailButton.addEventListener("click", handleSaveMailSettings);
  elements.testMailButton.addEventListener("click", handleSendTestMail);

  elements.apartmentFilter.addEventListener("change", (event) => {
    syncSelections(event.target.value, state.selectedMonth);
    resetForm();
  });

  elements.apartmentInput.addEventListener("change", (event) => {
    syncSelections(event.target.value, state.selectedMonth);
    hideConflict();
  });

  elements.monthFilter.addEventListener("change", (event) => {
    syncSelections(state.selectedApartment, event.target.value);
    resetForm();
  });

  document.getElementById("reservationForm").addEventListener("submit", (event) => {
    event.preventDefault();
    handleCreateOrUpdate();
  });

  elements.editReservationButton.addEventListener("click", () => {
    handleUpdateReservation();
  });

  elements.deleteReservationButton.addEventListener("click", () => {
    handleDeleteReservation();
  });

  elements.cancelEditButton.addEventListener("click", () => {
    resetForm();
  });

  elements.calendar.addEventListener("click", (event) => {
    const day = event.target.closest(".day[data-iso-date]");
    if (!day) {
      return;
    }

    const reservations = getPanelReservationsForDate(state.selectedApartment, day.dataset.isoDate);
    if (reservations.length > 0 && !reservations.some((reservation) => canEditReservation(reservation))) {
      state.selectedReservationId = null;
      updateActionButtons();
      showConflict("Bu gundeki rezervasyon baska bir kullaniciya ait. Detaylari sadece olusturan kullanici veya admin gorebilir.");
      renderCalendar();
      return;
    }

    const reservation = getReservationForDateSelection(state.selectedApartment, day.dataset.isoDate);
    if (!reservation) {
      resetForm();
      return;
    }

    selectReservation(reservation.id);
  });
}

async function init() {
  try {
    const bootstrap = await apiRequest("/api/bootstrap", { auth: false });
    state.imported = bootstrap.importedData;
    buildImportedState(bootstrap.importedData);
    populateSelectors();
    bindEvents();
    resetUserEditor();
    hideDeleteUserPicker();
    clearUserAdminStatus();
    clearMailStatus();
    hydrateServerState({});
    populateMailSettings();
    updateSessionUi();
    refreshView();
    resetForm();
    await restoreSession();
    elements.importStatus.textContent = "Tum aylar yüklendi. Log, silme, duzenleme ve yaklasan rezervasyon bilgileri sadece Excel aktarmasinda tutuluyor.";
    elements.importStatus.textContent = "Tum aylar yuklendi. Ayni tarihe dolu daire icin yeni randevu yazilmaz. Log kayitlari sadece admin exportunda tutulur.";
  } catch (error) {
    elements.importStatus.textContent = "Word verileri yuklenemedi.";
    elements.calendarTitle.textContent = "Takvim yuklenemedi";
    elements.calendar.innerHTML = `<div class="note danger">${error.message}</div>`;
  }
}

init();
