const DB_NAME = "peiMutualResidentialRentalInspectionDB";
const DB_VERSION = 1;
const STORE_NAME = "inspections";

const qs = s => document.querySelector(s);
const qsa = s => [...document.querySelectorAll(s)];

let db = null;
let currentInspectionId = null;
let currentCreatedAt = null;
let isDirty = false;
let autosaveTimer = null;

// ------------------------------
// INDEXEDDB
// ------------------------------

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = event => {
      const database = event.target.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("updatedAt", "updatedAt");
        store.createIndex("propertyAddress", "propertyAddress");
      }
    };

    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };

    request.onerror = () => reject(request.error);
  });
}

function dbPut(record) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(record);
    tx.oncomplete = () => resolve(record);
    tx.onerror = () => reject(tx.error);
  });
}

function dbGet(id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

function dbGetAll() {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

function dbDelete(id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

function makeId() {
  if (crypto?.randomUUID) return crypto.randomUUID();
  return `inspection-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

// ------------------------------
// INSPECTION ITEM UI
// ------------------------------

function createInspectionItem(title, guidance = "") {
  const tpl = qs("#inspectionItemTemplate");
  const node = tpl.content.cloneNode(true);
  const article = node.querySelector(".inspection-item");
  node.querySelector(".item-title").textContent = title;

  if (guidance) {
    const btn = node.querySelector(".mini-guidance-button");
    const panel = node.querySelector(".item-guidance");
    btn.classList.remove("hidden");
    panel.textContent = guidance;
    btn.addEventListener("click", () => panel.classList.toggle("hidden"));
  }

  const buttons = [...node.querySelectorAll(".status-buttons button")];
  const details = node.querySelector(".deficiency-details");

  buttons.forEach(btn => {
    btn.addEventListener("click", () => {
      buttons.forEach(x => x.classList.remove("selected"));
      btn.classList.add("selected");
      article.dataset.status = btn.dataset.status;
      details.classList.toggle("hidden", !["D", "IC", "R"].includes(btn.dataset.status));
      markDirty();
    });
  });

  const input = node.querySelector(".photo-input");
  const preview = node.querySelector(".photo-preview");
  const remove = node.querySelector(".remove-photo");

  input.addEventListener("change", () => {
    const file = input.files?.[0];
    if (!file) return;

    clearArticlePreview(article);
    article._photoBlob = file;
    article._photoName = file.name || "inspection-photo.jpg";
    renderPhoto(article, file);
    markDirty();
  });

  remove.addEventListener("click", () => {
    clearArticlePreview(article);
    article._photoBlob = null;
    article._photoName = "";
    input.value = "";
    remove.classList.add("hidden");
    markDirty();
  });

  node.querySelector(".observation").addEventListener("input", markDirty);
  return node;
}

function clearArticlePreview(article) {
  if (article._photoObjectUrl) {
    URL.revokeObjectURL(article._photoObjectUrl);
    article._photoObjectUrl = null;
  }
  const preview = article.querySelector(".photo-preview");
  if (preview) preview.innerHTML = "";
}

function renderPhoto(article, blob) {
  const preview = article.querySelector(".photo-preview");
  const remove = article.querySelector(".remove-photo");
  if (!preview || !blob) return;

  clearArticlePreview(article);

  const url = URL.createObjectURL(blob);
  article._photoObjectUrl = url;

  const img = document.createElement("img");
  img.src = url;
  img.alt = "Inspection photo";
  preview.appendChild(img);

  const caption = document.createElement("div");
  caption.className = "photo-caption";
  caption.textContent = article._photoName || "Saved inspection photo";
  preview.appendChild(caption);

  remove?.classList.remove("hidden");
}

// ------------------------------
// GENERATED SECTIONS
// ------------------------------

function makeSection(s) {
  const el = document.createElement("section");
  el.className = "inspection-section";
  el.innerHTML = `
    <button class="section-header" type="button">
      <span>${s.number}. ${s.title}</span>
      <span class="section-arrow">▶</span>
    </button>
    <div class="section-content collapsed"></div>`;

  const c = el.querySelector(".section-content");

  if (s.guidance) {
    const d = document.createElement("details");
    d.className = "guidance";
    d.innerHTML = `<summary>Inspector Guidance</summary><p>${s.guidance}</p>`;
    c.appendChild(d);
  }

  const target = document.createElement("div");
  c.appendChild(target);
  s.items.forEach(i => target.appendChild(createInspectionItem(i)));
  return el;
}

function build() {
  inspectionSectionsBeforeFire.forEach(s =>
    qs("#generatedSections").appendChild(makeSection(s))
  );

  Object.entries(fireItems).forEach(([k, arr]) => {
    const t = qs(`[data-items="${k}"]`);
    arr.forEach(i => t.appendChild(createInspectionItem(i)));
  });

  inspectionSectionsAfterFire.forEach(s =>
    qs("#generatedSectionsAfterFire").appendChild(makeSection(s))
  );
}

function wireSections() {
  qsa(".section-header").forEach(h =>
    h.addEventListener("click", () => {
      const c = h.closest(".inspection-section").querySelector(".section-content");
      c.classList.toggle("collapsed");
      h.querySelector(".section-arrow").textContent =
        c.classList.contains("collapsed") ? "▶" : "▼";
    })
  );
}

// ------------------------------
// INTELLIGENT RULES
// ------------------------------

function updateCrawl() {
  const on = qs("#crawlSpace").checked;
  qs("#crawlSpaceDetails").classList.toggle("hidden", !on);
  if (!on) return;

  const st = {
    height: qs("#crawlHeight").value,
    occupied: qs("#crawlOccupied").checked,
    flue: qs("#crawlFlue").checked,
    plenum: qs("#crawlPlenum").checked
  };

  const a = qs("#crawlAlert");

  if (inspectionRules.crawlSpace.reviewSuggested(st)) {
    a.className = "rule-alert warning";
    a.innerHTML =
      "<strong>Further classification/code review may be appropriate.</strong> One or more observed characteristics affect how the space may be treated for Code purposes.";
    a.classList.remove("hidden");
  } else if (st.height) {
    a.className = "rule-alert ok";
    a.textContent = "No automatic review trigger identified by this screening rule.";
    a.classList.remove("hidden");
  } else {
    a.classList.add("hidden");
  }
}

function updateAlarm() {
  const s = qs("#storeys").value;
  const u = qs("#dwellingUnits").value;
  const b = qs("#fireAlarmRule");

  if (!s || !u) {
    b.className = "rule-alert neutral";
    b.textContent = "Enter storeys and dwelling units in Section 1.";
    return;
  }

  if (inspectionRules.fireAlarm.generalTrigger({ storeys: s, dwellingUnits: u })) {
    b.className = "rule-alert warning";
    b.innerHTML =
      `<strong>General fire-alarm trigger identified.</strong> ${s} storey(s), ${u} dwelling unit(s). ` +
      `The screening trigger is 4+ storeys OR more than 11 units. Exceptions may apply; use R if the requirement cannot be established.`;
  } else {
    b.className = "rule-alert ok";
    b.innerHTML =
      `<strong>General size/storey trigger not identified.</strong> ${s} storey(s), ${u} dwelling unit(s). ` +
      `Other conditions can still affect requirements.`;
  }
}

function updateCO() {
  const any = qsa(".co-source").some(x => x.checked);
  const b = qs("#coMessage");
  b.className = any ? "rule-alert warning" : "rule-alert neutral";
  b.textContent = any
    ? "Potential CO source / communicating garage selected. Confirm the applicable CO detection arrangement."
    : "No potential CO source selected yet.";
}

// ------------------------------
// FIELD SERIALIZATION
// ------------------------------

function getFieldKey(el, index) {
  if (el.id) return `id:${el.id}`;
  if (el.name) {
    const sameName = qsa(`[name="${CSS.escape(el.name)}"]`);
    const position = sameName.indexOf(el);
    return `name:${el.name}:${position}`;
  }
  return `field:${index}`;
}

function serializeFields() {
  const fields = {};

  qsa("input, textarea, select").forEach((el, i) => {
    if (el.type === "file" || el.id === "savedInspectionSearch") return;

    const key = getFieldKey(el, i);

    if (el.type === "checkbox" || el.type === "radio") {
      fields[key] = el.checked;
    } else {
      fields[key] = el.value;
    }
  });

  return fields;
}

function restoreFields(fields = {}) {
  qsa("input, textarea, select").forEach((el, i) => {
    if (el.type === "file" || el.id === "savedInspectionSearch") return;

    const key = getFieldKey(el, i);
    if (!Object.prototype.hasOwnProperty.call(fields, key)) return;

    if (el.type === "checkbox" || el.type === "radio") {
      el.checked = Boolean(fields[key]);
    } else {
      el.value = fields[key] ?? "";
    }
  });
}

function serializeItems() {
  return qsa(".inspection-item").map((el, i) => ({
    index: i,
    status: el.dataset.status || "",
    observation: el.querySelector(".observation")?.value || "",
    photoBlob: el._photoBlob || null,
    photoName: el._photoName || ""
  }));
}

function restoreItems(items = []) {
  qsa(".inspection-item").forEach(article => {
    article.dataset.status = "";
    qsaWithin(article, ".status-buttons button").forEach(b => b.classList.remove("selected"));
    article.querySelector(".deficiency-details")?.classList.add("hidden");
    const obs = article.querySelector(".observation");
    if (obs) obs.value = "";
    clearArticlePreview(article);
    article._photoBlob = null;
    article._photoName = "";
    const input = article.querySelector(".photo-input");
    if (input) input.value = "";
    article.querySelector(".remove-photo")?.classList.add("hidden");
  });

  items.forEach(item => {
    const article = qsa(".inspection-item")[item.index];
    if (!article) return;

    if (item.status) {
      article.dataset.status = item.status;
      article.querySelector(`[data-status="${item.status}"]`)?.classList.add("selected");
      if (["D", "IC", "R"].includes(item.status)) {
        article.querySelector(".deficiency-details")?.classList.remove("hidden");
      }
    }

    const obs = article.querySelector(".observation");
    if (obs) obs.value = item.observation || "";

    if (item.photoBlob) {
      article._photoBlob = item.photoBlob;
      article._photoName = item.photoName || "inspection-photo.jpg";
      renderPhoto(article, item.photoBlob);
    }
  });
}

function qsaWithin(root, selector) {
  return [...root.querySelectorAll(selector)];
}

// ------------------------------
// SAVE / OPEN / NEW
// ------------------------------

function markDirty() {
  isDirty = true;
  updateCurrentInspectionLabel();

  // Once an inspection has been manually saved at least once,
  // changes are quietly auto-saved after a short delay.
  if (currentInspectionId) {
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => saveCurrentInspection(false), 1200);
  }
}

function updateCurrentInspectionLabel() {
  const label = qs("#currentInspectionLabel");
  const address = qs("#propertyAddress")?.value?.trim();
  label.textContent = currentInspectionId
    ? (address || "Saved inspection")
    : (address || "New inspection");

  label.classList.toggle("dirty", isDirty);
}

function showSaveNotice(message = "Inspection saved.") {
  const n = qs("#saveNotice");
  n.textContent = message;
  n.classList.remove("hidden");
  setTimeout(() => n.classList.add("hidden"), 1800);
}

async function saveCurrentInspection(showNotice = true) {
  if (!db) await openDatabase();

  if (!currentInspectionId) {
    currentInspectionId = makeId();
    currentCreatedAt = new Date().toISOString();
  }

  const now = new Date().toISOString();

  const record = {
    id: currentInspectionId,
    createdAt: currentCreatedAt || now,
    updatedAt: now,
    propertyAddress: qs("#propertyAddress")?.value?.trim() || "",
    ownerInsured: qs("#ownerInsured")?.value?.trim() || "",
    inspectionDate: qs("#inspectionDate")?.value || "",
    inspector: qs("#inspector")?.value?.trim() || "",
    yearConstructed: qs("#yearConstructed")?.value || "",
    dwellingUnits: qs("#dwellingUnits")?.value || "",
    storeys: qs("#storeys")?.value || "",
    fields: serializeFields(),
    items: serializeItems()
  };

  await dbPut(record);
  isDirty = false;
  updateCurrentInspectionLabel();

  if (showNotice) showSaveNotice("Inspection saved on this device.");
  return record;
}

async function openSavedInspection(id) {
  const record = await dbGet(id);
  if (!record) {
    alert("That saved inspection could not be found.");
    return;
  }

  if (isDirty && !currentInspectionId) {
    const proceed = confirm("This new inspection has unsaved changes. Open another inspection and discard these changes?");
    if (!proceed) return;
  } else if (isDirty && currentInspectionId) {
    await saveCurrentInspection(false);
  }

  resetFormVisuals();
  restoreFields(record.fields);
  restoreItems(record.items);

  currentInspectionId = record.id;
  currentCreatedAt = record.createdAt || new Date().toISOString();
  isDirty = false;

  updateCrawl();
  updateAlarm();
  updateCO();
  updateCurrentInspectionLabel();
  closeOpenModal();
  showSaveNotice("Inspection opened.");
}

async function startNewInspection() {
  if (isDirty && !currentInspectionId) {
    const proceed = confirm("This inspection has unsaved changes. Start a new inspection and discard them?");
    if (!proceed) return;
  } else if (isDirty && currentInspectionId) {
    await saveCurrentInspection(false);
  }

  resetFormVisuals();
  currentInspectionId = null;
  currentCreatedAt = null;
  isDirty = false;

  // Set today's date for convenience.
  const date = qs("#inspectionDate");
  if (date) {
    const today = new Date();
    const local = new Date(today.getTime() - today.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 10);
    date.value = local;
  }

  updateCrawl();
  updateAlarm();
  updateCO();
  updateCurrentInspectionLabel();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function resetFormVisuals() {
  qsa("input, textarea, select").forEach(el => {
    if (el.id === "savedInspectionSearch") return;

    if (el.type === "checkbox" || el.type === "radio") {
      el.checked = false;
    } else if (el.type !== "file") {
      el.value = "";
    } else {
      el.value = "";
    }
  });

  qsa(".inspection-item").forEach(article => {
    article.dataset.status = "";
    qsaWithin(article, ".status-buttons button").forEach(b => b.classList.remove("selected"));
    article.querySelector(".deficiency-details")?.classList.add("hidden");
    clearArticlePreview(article);
    article._photoBlob = null;
    article._photoName = "";
    article.querySelector(".remove-photo")?.classList.add("hidden");
  });

  qs("#crawlSpaceDetails")?.classList.add("hidden");
}

// ------------------------------
// SAVED INSPECTION MODAL
// ------------------------------

function formatDateTime(value) {
  if (!value) return "";
  try {
    return new Intl.DateTimeFormat("en-CA", {
      dateStyle: "medium",
      timeStyle: "short"
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function escapeHTML(value = "") {
  return value.replace(/[&<>"']/g, ch => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[ch]);
}

async function renderSavedInspections(filter = "") {
  const records = await dbGetAll();
  records.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));

  const needle = filter.trim().toLowerCase();
  const filtered = records.filter(r => {
    const haystack = [
      r.propertyAddress,
      r.ownerInsured,
      r.inspector,
      r.inspectionDate
    ].join(" ").toLowerCase();
    return !needle || haystack.includes(needle);
  });

  const list = qs("#savedInspectionsList");
  const empty = qs("#noSavedInspections");
  list.innerHTML = "";
  empty.classList.toggle("hidden", filtered.length > 0);

  filtered.forEach(record => {
    const card = document.createElement("article");
    card.className = "saved-inspection-card";

    const title = record.propertyAddress || "Untitled inspection";
    const dateText = record.inspectionDate
      ? `Inspection date: ${record.inspectionDate}`
      : "No inspection date";
    const ownerText = record.ownerInsured
      ? `Owner / insured: ${record.ownerInsured}`
      : "";
    const updatedText = `Last saved: ${formatDateTime(record.updatedAt)}`;

    card.innerHTML = `
      <div>
        <h3 class="saved-inspection-title">${escapeHTML(title)}</h3>
        <p class="saved-inspection-meta">
          ${escapeHTML(dateText)}
          ${ownerText ? "<br>" + escapeHTML(ownerText) : ""}
          <br>${escapeHTML(updatedText)}
        </p>
      </div>
      <div class="saved-inspection-actions">
        <button class="secondary-button open-saved" type="button">Open</button>
        <button class="danger-button delete-saved" type="button">Delete</button>
      </div>`;

    card.querySelector(".open-saved").addEventListener("click", () =>
      openSavedInspection(record.id)
    );

    card.querySelector(".delete-saved").addEventListener("click", async () => {
      const yes = confirm(`Delete the saved inspection for "${title}"? This cannot be undone.`);
      if (!yes) return;

      await dbDelete(record.id);

      if (currentInspectionId === record.id) {
        currentInspectionId = null;
        currentCreatedAt = null;
        isDirty = true;
        updateCurrentInspectionLabel();
      }

      await renderSavedInspections(qs("#savedInspectionSearch").value);
    });

    list.appendChild(card);
  });
}

async function openOpenModal() {
  if (!db) await openDatabase();
  qs("#openInspectionModal").classList.remove("hidden");
  qs("#savedInspectionSearch").value = "";
  await renderSavedInspections();
}

function closeOpenModal() {
  qs("#openInspectionModal").classList.add("hidden");
}

// ------------------------------
// EVENT WIRING
// ------------------------------

function wireInputs() {
  qsa("input:not([type=file]), textarea, select").forEach(el => {
    if (el.id === "savedInspectionSearch") return;
    el.addEventListener("input", () => {
      markDirty();
      if (el.id === "propertyAddress") updateCurrentInspectionLabel();
    });
    el.addEventListener("change", markDirty);
  });

  ["#crawlSpace", "#crawlHeight", "#crawlOccupied", "#crawlFlue", "#crawlPlenum"]
    .forEach(s => qs(s)?.addEventListener("change", updateCrawl));

  ["#storeys", "#dwellingUnits"]
    .forEach(s => qs(s)?.addEventListener("input", updateAlarm));

  qsa(".co-source").forEach(e =>
    e.addEventListener("change", updateCO)
  );

  qs("#standardsToggle").addEventListener("click", () =>
    qs("#standardsPanel").classList.toggle("hidden")
  );

  qs("#saveInspection").addEventListener("click", async () => {
    try {
      await saveCurrentInspection(true);
    } catch (error) {
      console.error(error);
      alert("The inspection could not be saved. Please try again.");
    }
  });

  qs("#openInspection").addEventListener("click", openOpenModal);
  qs("#newInspection").addEventListener("click", startNewInspection);

  qs("#closeOpenModal").addEventListener("click", closeOpenModal);

  qs("#openInspectionModal").addEventListener("click", event => {
    if (event.target === qs("#openInspectionModal")) closeOpenModal();
  });

  qs("#savedInspectionSearch").addEventListener("input", event =>
    renderSavedInspections(event.target.value)
  );

  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && !qs("#openInspectionModal").classList.contains("hidden")) {
      closeOpenModal();
    }
  });
}

// ------------------------------
// STARTUP
// ------------------------------

async function init() {
  try {
    await openDatabase();
  } catch (error) {
    console.error("IndexedDB could not be opened:", error);
    alert("This browser could not open local inspection storage. Save/Open will not work until browser storage is available.");
  }

  build();
  wireSections();
  wireInputs();

  // Set date only for a brand-new blank session.
  if (!qs("#inspectionDate").value) {
    const now = new Date();
    qs("#inspectionDate").value = new Date(
      now.getTime() - now.getTimezoneOffset() * 60000
    ).toISOString().slice(0, 10);
  }

  updateCrawl();
  updateAlarm();
  updateCO();
  updateCurrentInspectionLabel();
}

init();
