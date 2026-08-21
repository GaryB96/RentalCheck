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


async function normalizeImageBlob(blob, maxDimension = 2200, quality = 0.9) {
  if (!blob) return null;

  // Already-normalized JPEGs can still be resized to keep IndexedDB/PDF sizes reasonable.
  try {
    const dataUrl = await blobToDataURL(blob);
    const img = new Image();

    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = dataUrl;
    });

    let width = img.naturalWidth || img.width;
    let height = img.naturalHeight || img.height;

    if (!width || !height) throw new Error("Image dimensions unavailable.");

    const scale = Math.min(1, maxDimension / Math.max(width, height));
    width = Math.round(width * scale);
    height = Math.round(height * scale);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, width, height);

    const jpegBlob = await new Promise(resolve =>
      canvas.toBlob(resolve, "image/jpeg", quality)
    );

    if (!jpegBlob) throw new Error("JPEG conversion failed.");
    return jpegBlob;
  } catch (error) {
    console.warn("Image normalization failed; preserving original blob.", error);
    return blob;
  }
}

async function ensureArticlePhotoNormalized(article) {
  if (!article?._photoBlob) return null;

  if (article._photoBlob.type === "image/jpeg" && article._photoNormalized) {
    return article._photoBlob;
  }

  const normalized = await normalizeImageBlob(article._photoBlob);
  if (normalized) {
    article._photoBlob = normalized;
    article._photoName = (article._photoName || "inspection-photo")
      .replace(/\.[^.]+$/, "") + ".jpg";
    article._photoNormalized = normalized.type === "image/jpeg";
  }
  return article._photoBlob;
}

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
      updateSectionNAButton(article.closest(".inspection-section"));
      markDirty();
    });
  });

  const cameraInput = node.querySelector(".camera-input");
  const libraryInput = node.querySelector(".library-input");
  const preview = node.querySelector(".photo-preview");
  const remove = node.querySelector(".remove-photo");

  async function handleSelectedPhoto(inputElement) {
    const file = inputElement.files?.[0];
    if (!file) return;

    clearArticlePreview(article);

    const normalized = await normalizeImageBlob(file);
    article._photoBlob = normalized || file;
    article._photoName = (file.name || "inspection-photo")
      .replace(/\.[^.]+$/, "") + ".jpg";
    article._photoNormalized = article._photoBlob?.type === "image/jpeg";

    renderPhoto(article, article._photoBlob);

    if (inputElement === cameraInput && libraryInput) libraryInput.value = "";
    if (inputElement === libraryInput && cameraInput) cameraInput.value = "";

    markDirty();
  }

  cameraInput?.addEventListener("change", () => handleSelectedPhoto(cameraInput));
  libraryInput?.addEventListener("change", () => handleSelectedPhoto(libraryInput));

  remove.addEventListener("click", () => {
    clearArticlePreview(article);
    article._photoBlob = null;
    article._photoName = "";
    if (cameraInput) cameraInput.value = "";
    if (libraryInput) libraryInput.value = "";
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
    <div class="section-header-bar">
      <button class="section-header" type="button">
        <span>${s.number}. ${s.title}</span>
        <span class="section-arrow">▶</span>
      </button>
      <button class="section-na-button" type="button" title="Mark every rated item in this section Not Applicable">Section N/A</button>
    </div>
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


function setSectionCollapsed(section, collapsed, scrollToHeader = false) {
  const content = section.querySelector(".section-content");
  const arrow = section.querySelector(".section-arrow");
  if (!content) return;

  content.classList.toggle("collapsed", collapsed);
  if (arrow) arrow.textContent = collapsed ? "▶" : "▼";

  if (collapsed && scrollToHeader) {
    section.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function addBottomCollapseButtons() {
  qsa(".inspection-section").forEach(section => {
    const content = section.querySelector(".section-content");
    if (!content || content.querySelector(".collapse-section-bottom")) return;

    const footer = document.createElement("div");
    footer.className = "section-footer-actions";
    footer.innerHTML = `
      <button type="button" class="collapse-section-bottom">
        Collapse Section ↑
      </button>`;

    footer.querySelector(".collapse-section-bottom").addEventListener("click", () => {
      setSectionCollapsed(section, true, true);
    });

    content.appendChild(footer);
  });
}

function updateSectionNAButton(section) {
  const button = section.querySelector(".section-na-button");
  if (!button) return;

  const items = [...section.querySelectorAll(".inspection-item")];
  if (!items.length) {
    button.disabled = true;
    return;
  }

  const allNA = items.every(item => item.dataset.status === "NA");
  button.textContent = allNA ? "Clear Section N/A" : "Section N/A";
  button.classList.toggle("active", allNA);
}

function markSectionNA(section) {
  const items = [...section.querySelectorAll(".inspection-item")];
  if (!items.length) return;

  const allNA = items.every(item => item.dataset.status === "NA");

  items.forEach(item => {
    const buttons = [...item.querySelectorAll(".status-buttons button")];
    const details = item.querySelector(".deficiency-details");

    if (allNA) {
      buttons.forEach(btn => btn.classList.remove("selected"));
      item.dataset.status = "";
      details?.classList.add("hidden");
    } else {
      buttons.forEach(btn => btn.classList.remove("selected"));
      const na = item.querySelector('[data-status="NA"]');
      na?.classList.add("selected");
      item.dataset.status = "NA";
      details?.classList.add("hidden");
    }
  });

  updateSectionNAButton(section);
  markDirty();
}

function wireSectionNAButtons() {
  qsa(".section-na-button").forEach(button => {
    button.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      markSectionNA(button.closest(".inspection-section"));
    });
    updateSectionNAButton(button.closest(".inspection-section"));
  });
}

function updateAllSectionNAButtons() {
  qsa(".inspection-section").forEach(updateSectionNAButton);
}

function wireSections() {
  qsa(".section-header").forEach(h =>
    h.addEventListener("click", () => {
      const section = h.closest(".inspection-section");
      const content = section.querySelector(".section-content");
      setSectionCollapsed(section, !content.classList.contains("collapsed"));
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
      `The screening trigger is 4+ storeys OR more than 11 units. Exceptions may apply; use Further Review Required if the requirement cannot be established.`;
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
    article.querySelectorAll(".photo-input").forEach(input => {
      input.value = "";
    });
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
      article._photoNormalized = item.photoBlob?.type === "image/jpeg";
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
  // Normalize all attached images before persistence so reopened inspections remain PDF-safe.
  await Promise.all(qsa(".inspection-item").map(article => ensureArticlePhotoNormalized(article)));

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
// PDF-READY REPORT EXPORT
// ------------------------------

function statusLabel(status) {
  return ({
    S: "Satisfactory",
    D: "Deficiency",
    IC: "Immediate Concern",
    R: "Further Review Required",
    NI: "Not Inspected / Not Accessible",
    NA: "Not Applicable"
  })[status] || "Not Rated";
}

function formatInspectionDate(value) {
  if (!value) return "";
  const parts = value.split("-");
  if (parts.length !== 3) return value;
  return `${parts[0]}-${parts[1]}-${parts[2]}`;
}

function readLabelText(el) {
  const clone = el.cloneNode(true);
  clone.querySelectorAll("input,select,textarea,button").forEach(x => x.remove());
  return clone.textContent.replace(/\s+/g, " ").trim();
}

function getSelectedChoices(container) {
  if (!container) return [];
  return [...container.querySelectorAll('input[type="checkbox"]:checked, input[type="radio"]:checked')]
    .map(input => {
      const label = input.closest("label");
      return label ? readLabelText(label) : (input.value || "");
    })
    .filter(Boolean);
}

function getSectionTitle(section) {
  return section.querySelector(".section-header span")?.textContent?.trim() || "";
}

function getExportableItems(section, options) {
  return [...section.querySelectorAll(".inspection-item")]
    .map(article => {
      const title = article.querySelector(".item-title")?.textContent?.trim() || "";
      const status = article.dataset.status || "";
      const observation = article.querySelector(".observation")?.value?.trim() || "";
      const photoBlob = article._photoBlob || null;
      const photoName = article._photoName || "";

      return { title, status, observation, photoBlob, photoName };
    })
    .filter(item => {
      if (!item.status && !item.observation && !item.photoBlob) return false;
      if (item.status === "S" && !options.includeSatisfactory) return false;
      if (["NA","NI"].includes(item.status) && !options.includeNA) return false;
      return true;
    });
}

function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    if (!blob) return resolve("");
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function buildReportHTML(options) {
  const address = qs("#propertyAddress")?.value?.trim() || "";
  const owner = qs("#ownerInsured")?.value?.trim() || "";
  const date = qs("#inspectionDate")?.value || "";
  const inspector = qs("#inspector")?.value?.trim() || "";
  const units = qs("#dwellingUnits")?.value || "";
  const storeys = qs("#storeys")?.value || "";
  const year = qs("#yearConstructed")?.value || "";
  const buildingType = qs("#buildingType")?.value || "";

  const sectionBlocks = [];

  for (const section of qsa(".inspection-section")) {
    const title = getSectionTitle(section);
    if (!title || title.startsWith("1.") || title.startsWith("19.")) continue;

    const items = getExportableItems(section, options);

    // Collect subsection choice groups that are useful in the fire section.
    const choiceGroups = [];
    if (title.startsWith("7.")) {
      [...section.querySelectorAll(".subsection")].forEach(sub => {
        const subTitle = sub.querySelector("h3")?.textContent?.trim();
        const choices = getSelectedChoices(sub);
        if (subTitle && choices.length) {
          choiceGroups.push({ title: subTitle, choices });
        }
      });
    }

    if (!items.length && !choiceGroups.length) continue;

    const rows = [];
    for (const item of items) {
      let photoHTML = "";
      if (options.includePhotos && item.photoBlob) {
        try {
          const src = await blobToDataURL(item.photoBlob);
          if (src) {
            photoHTML = `<div class="report-photo"><img src="${src}" alt="Inspection photo"></div>`;
          }
        } catch (e) {
          console.warn("Could not include photo in export.", e);
        }
      }

      rows.push(`
        <div class="report-item status-${item.status || "blank"}">
          <div class="report-item-top">
            <div class="report-item-title">${escapeHTML(item.title)}</div>
            <div class="report-status">${escapeHTML(statusLabel(item.status))}</div>
          </div>
          ${item.observation ? `<div class="report-observation"><strong>Observation:</strong> ${escapeHTML(item.observation)}</div>` : ""}
          ${photoHTML}
        </div>`);
    }

    const choiceHTML = choiceGroups.map(group => `
      <div class="report-choice-group">
        <strong>${escapeHTML(group.title)}:</strong>
        ${escapeHTML(group.choices.join("; "))}
      </div>`).join("");

    let guidanceHTML = "";
    if (options.includeGuidance) {
      const notes = [...section.querySelectorAll(".guidance p, .code-reference p")]
        .map(p => p.textContent.replace(/\s+/g, " ").trim())
        .filter(Boolean);

      if (notes.length) {
        guidanceHTML = `
          <div class="report-guidance">
            <strong>Inspector / Code Guidance</strong>
            ${notes.map(n => `<p>${escapeHTML(n)}</p>`).join("")}
          </div>`;
      }
    }

    sectionBlocks.push(`
      <section class="report-section">
        <h2>${escapeHTML(title)}</h2>
        ${choiceHTML}
        ${rows.join("")}
        ${guidanceHTML}
      </section>`);
  }

  // Summary
  const summarySection = qs('[data-section="summary"]');
  const summaryFields = [...summarySection.querySelectorAll("label")]
    .map(label => {
      const ta = label.querySelector("textarea");
      if (!ta || !ta.value.trim()) return null;
      return {
        label: readLabelText(label),
        value: ta.value.trim()
      };
    })
    .filter(Boolean);

  const overallRisk = getSelectedChoices(summarySection)
    .find(x => [
      "Acceptable",
      "Acceptable subject to recommendations",
      "Deficiencies requiring correction",
      "Significant deficiencies",
      "Further specialist assessment required"
    ].includes(x)) || "";

  const summaryHTML = `
    <section class="report-section summary-section">
      <h2>19. Inspection Summary</h2>
      ${summaryFields.map(f => `
        <div class="summary-block">
          <h3>${escapeHTML(f.label)}</h3>
          <p>${escapeHTML(f.value).replace(/\n/g, "<br>")}</p>
        </div>`).join("")}
      ${overallRisk ? `
        <div class="overall-risk">
          <strong>Overall Insurance Risk:</strong> ${escapeHTML(overallRisk)}
        </div>` : ""}
    </section>`;

  const generated = new Date();
  const generatedText = new Intl.DateTimeFormat("en-CA", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(generated);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Inspection Report - ${escapeHTML(address)}</title>
<style>
  @page { size: letter; margin: 0.55in; }
  * { box-sizing: border-box; }
  body {
    margin:0;
    font-family: Arial, Helvetica, sans-serif;
    color:#20262c;
    font-size:10.5pt;
    line-height:1.38;
    background:white;
  }
  .report-header {
    border-bottom:3px solid #303840;
    padding-bottom:12px;
    margin-bottom:16px;
  }
  .report-header h1 {
    margin:0 0 3px;
    font-size:19pt;
  }
  .report-header .subtitle {
    color:#5d6872;
    font-size:10pt;
    margin-bottom:10px;
  }
  .property-grid {
    display:grid;
    grid-template-columns:1fr 1fr;
    gap:7px 20px;
    font-size:9.5pt;
  }
  .property-row strong { display:inline-block; min-width:118px; }
  .standards {
    margin-top:12px;
    padding:8px 10px;
    background:#f2f4f6;
    border-left:4px solid #697987;
    font-size:8.8pt;
  }
  .report-section {
    page-break-inside:auto;
    margin:0 0 16px;
  }
  .report-section h2 {
    font-size:13pt;
    margin:0 0 8px;
    padding-bottom:4px;
    border-bottom:1px solid #aeb5bb;
  }
  .report-item {
    border:1px solid #d5d9dd;
    border-left:5px solid #8e989f;
    padding:7px 9px;
    margin:0 0 6px;
    page-break-inside:avoid;
  }
  .report-item.status-D { border-left-color:#a97100; }
  .report-item.status-IC { border-left-color:#a63030; }
  .report-item.status-R { border-left-color:#476aa6; }
  .report-item.status-S { border-left-color:#46764b; }
  .report-item-top {
    display:flex;
    justify-content:space-between;
    gap:18px;
    align-items:flex-start;
  }
  .report-item-title { font-weight:700; }
  .report-status {
    flex-shrink:0;
    font-size:8.8pt;
    font-weight:700;
    color:#4c5660;
  }
  .report-observation {
    margin-top:5px;
    padding-top:5px;
    border-top:1px dotted #c5c9cd;
  }
  .report-photo { margin-top:8px; }
  .report-photo img {
    max-width:4.8in;
    max-height:3.5in;
    object-fit:contain;
    border:1px solid #cbd0d4;
  }
  .report-choice-group {
    margin:0 0 7px;
    padding:6px 8px;
    background:#f6f7f8;
    font-size:9pt;
  }
  .report-guidance {
    margin-top:9px;
    padding:8px 10px;
    border-left:4px solid #60788d;
    background:#f7f9fa;
    font-size:8.8pt;
    page-break-inside:avoid;
  }
  .report-guidance p { margin:4px 0; }
  .summary-block {
    margin:0 0 10px;
    page-break-inside:avoid;
  }
  .summary-block h3 {
    margin:0 0 3px;
    font-size:10.5pt;
  }
  .summary-block p { margin:0; }
  .overall-risk {
    margin-top:12px;
    padding:10px;
    border:2px solid #4c5964;
    font-size:11pt;
  }
  .report-footer {
    margin-top:18px;
    padding-top:8px;
    border-top:1px solid #c8cdd1;
    font-size:8pt;
    color:#66717a;
  }
  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
</style>
</head>
<body>
  <header class="report-header">
    <h1>PEI Mutual Residential Rental Inspection</h1>
    <div class="subtitle">Existing Residential Rental Building — Insurance Risk Inspection Report</div>

    <div class="property-grid">
      <div class="property-row"><strong>Property:</strong> ${escapeHTML(address)}</div>
      <div class="property-row"><strong>Owner / Insured:</strong> ${escapeHTML(owner)}</div>
      <div class="property-row"><strong>Inspection Date:</strong> ${escapeHTML(formatInspectionDate(date))}</div>
      <div class="property-row"><strong>Inspector:</strong> ${escapeHTML(inspector)}</div>
      <div class="property-row"><strong>Building Type:</strong> ${escapeHTML(buildingType)}</div>
      <div class="property-row"><strong>Year Constructed:</strong> ${escapeHTML(year)}</div>
      <div class="property-row"><strong>Dwelling Units:</strong> ${escapeHTML(units)}</div>
      <div class="property-row"><strong>Storeys:</strong> ${escapeHTML(storeys)}</div>
    </div>

    <div class="standards">
      <strong>Current reference standards:</strong>
      NBC 2020 · NFC 2020 · CEC 2024 · NPC 2020 · NFPA 1 (2024) · NFPA 101 (2024).
      Current codes are used as reference standards where applicable; an existing building is not
      necessarily required to comply retrospectively with every provision applicable to new construction.
    </div>
  </header>

  ${sectionBlocks.join("")}
  ${summaryHTML}

  <footer class="report-footer">
    Report generated ${escapeHTML(generatedText)}. This report documents a visual insurance risk inspection
    and does not constitute certification of compliance with applicable building, fire, electrical, plumbing,
    or other codes.
  </footer>

<script>
  window.addEventListener("load", () => {
    setTimeout(() => window.print(), 400);
  });
</script>
</body>
</html>`;
}


function safeFileName(value) {
  return (value || "Residential Rental Inspection")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function photoFormat(blob) {
  const type = (blob?.type || "").toLowerCase();
  if (type.includes("png")) return "PNG";
  if (type.includes("webp")) return "WEBP";
  return "JPEG";
}

async function generateInspectionPdf(options) {
  if (!window.jspdf?.jsPDF) throw new Error("PDF library did not load.");

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "letter", compress: true });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 40;
  const contentWidth = pageWidth - margin * 2;
  const bottom = pageHeight - 42;
  let y = margin;

  const address = qs("#propertyAddress")?.value?.trim() || "";
  const owner = qs("#ownerInsured")?.value?.trim() || "";
  const date = qs("#inspectionDate")?.value || "";
  const inspector = qs("#inspector")?.value?.trim() || "";
  const units = qs("#dwellingUnits")?.value || "";
  const storeys = qs("#storeys")?.value || "";
  const year = qs("#yearConstructed")?.value || "";
  const buildingType = qs("#buildingType")?.value || "";

  function newPage() { doc.addPage(); y = margin; }
  function ensureSpace(h) { if (y + h > bottom) newPage(); }

  function addText(text, x, opts = {}) {
    const {
      size = 10, style = "normal", maxWidth = contentWidth,
      lineHeight = 1.22, color = [32, 38, 44]
    } = opts;
    doc.setFont("helvetica", style);
    doc.setFontSize(size);
    doc.setTextColor(...color);
    const lines = doc.splitTextToSize(String(text || ""), maxWidth);
    const height = Math.max(size * lineHeight, lines.length * size * lineHeight);
    ensureSpace(height + 3);
    doc.text(lines, x, y);
    y += lines.length * size * lineHeight;
  }

  function addHeading(text) {
    ensureSpace(32);
    y += 6;
    addText(text, margin, { size: 13, style: "bold", lineHeight: 1.05 });
    doc.setDrawColor(160);
    doc.line(margin, y + 1, pageWidth - margin, y + 1);
    y += 10;
  }

  function addMeta(label, value, x, width) {
    if (!value) return;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(40);
    doc.text(`${label}:`, x, y);
    const labelWidth = doc.getTextWidth(`${label}: `);
    doc.setFont("helvetica", "normal");
    const lines = doc.splitTextToSize(String(value), width - labelWidth);
    doc.text(lines, x + labelWidth, y);
  }

  addText("PEI Mutual Residential Rental Inspection", margin, { size: 17, style: "bold", lineHeight: 1.05 });
  addText("Existing Residential Rental Building — Insurance Risk Inspection Report", margin, {
    size: 9, color: [90, 100, 108], lineHeight: 1.15
  });
  y += 8;

  const colW = contentWidth / 2 - 8;
  [
    [["Property", address], ["Owner / Insured", owner]],
    [["Inspection Date", date], ["Inspector", inspector]],
    [["Building Type", buildingType], ["Year Constructed", year]],
    [["Dwelling Units", units], ["Storeys", storeys]]
  ].forEach(row => {
    ensureSpace(16);
    addMeta(row[0][0], row[0][1], margin, colW);
    addMeta(row[1][0], row[1][1], margin + contentWidth / 2 + 8, colW);
    y += 15;
  });

  y += 5;
  ensureSpace(45);
  doc.setFillColor(242, 244, 246);
  doc.rect(margin, y, contentWidth, 38, "F");
  y += 10;
  addText(
    "Current reference standards: NBC 2020 · NFC 2020 · CEC 2024 · NPC 2020 · NFPA 1 (2024) · NFPA 101 (2024). Current codes are reference standards where applicable; an existing building is not necessarily required to comply retrospectively with every provision applicable to new construction.",
    margin + 8,
    { size: 7.4, maxWidth: contentWidth - 16, color: [60, 68, 76], lineHeight: 1.16 }
  );
  y += 10;

  for (const section of qsa(".inspection-section")) {
    const title = getSectionTitle(section);
    if (!title || title.startsWith("1.") || title.startsWith("19.")) continue;

    const items = getExportableItems(section, options);
    const choiceGroups = title.startsWith("7.")
      ? [...section.querySelectorAll(".subsection")].map(sub => ({
          title: sub.querySelector("h3")?.textContent?.trim() || "",
          choices: getSelectedChoices(sub)
        })).filter(g => g.title && g.choices.length)
      : [];

    const guidanceNotes = options.includeGuidance
      ? [...section.querySelectorAll(".guidance p, .code-reference p")]
          .map(p => p.textContent.replace(/\s+/g, " ").trim()).filter(Boolean)
      : [];

    if (!items.length && !choiceGroups.length) continue;

    addHeading(title);

    for (const group of choiceGroups) {
      addText(group.title, margin, { size: 9, style: "bold", lineHeight: 1.08 });
      addText(group.choices.join("; "), margin + 8, {
        size: 8, maxWidth: contentWidth - 8, color: [70, 78, 85], lineHeight: 1.16
      });
      y += 4;
    }

    for (const item of items) {
      ensureSpace(38);

      const colors = {
        S: [70, 118, 75], D: [169, 113, 0], IC: [166, 48, 48],
        R: [71, 106, 166], NI: [120, 125, 130], NA: [120, 125, 130]
      };
      const accent = colors[item.status] || [140, 145, 150];

      doc.setFillColor(...accent);
      doc.rect(margin, y, 3, 16, "F");

      doc.setFont("helvetica", "bold");
      doc.setFontSize(9.2);
      doc.setTextColor(30);
      const titleLines = doc.splitTextToSize(item.title, contentWidth - 155);
      doc.text(titleLines, margin + 9, y + 9);

      doc.setFontSize(7.8);
      doc.setTextColor(...accent);
      doc.text(statusLabel(item.status), pageWidth - margin, y + 9, { align: "right" });

      y += Math.max(20, titleLines.length * 10 + 5);

      if (item.observation) {
        addText(`Observation: ${item.observation}`, margin + 9, {
          size: 8.5, maxWidth: contentWidth - 9, lineHeight: 1.2
        });
        y += 4;
      }

      if (options.includePhotos && item.photoBlob) {
        try {
          const article = [...section.querySelectorAll(".inspection-item")].find(a =>
            (a.querySelector(".item-title")?.textContent?.trim() || "") === item.title
          );
          if (article) {
            await ensureArticlePhotoNormalized(article);
            item.photoBlob = article._photoBlob || item.photoBlob;
          }
          const dataUrl = await blobToDataURL(item.photoBlob);
          const props = doc.getImageProperties(dataUrl);
          const maxW = 300, maxH = 220;
          let w = maxW, h = (props.height * w) / props.width;
          if (h > maxH) { h = maxH; w = (props.width * h) / props.height; }
          ensureSpace(h + 12);
          doc.addImage(dataUrl, photoFormat(item.photoBlob), margin + 9, y, w, h, undefined, "FAST");
          y += h + 8;
        } catch (error) {
          console.warn("Photo could not be added to PDF.", error);
          addText("Attached photo could not be rendered in PDF.", margin + 9, {
            size: 8, color: [120, 60, 60]
          });
        }
      }

      doc.setDrawColor(220);
      doc.line(margin, y, pageWidth - margin, y);
      y += 7;
    }

    if (guidanceNotes.length) {
      ensureSpace(35);
      addText("Inspector / Code Guidance", margin, { size: 8.5, style: "bold" });
      guidanceNotes.forEach(note => {
        addText(note, margin + 8, {
          size: 7.5, maxWidth: contentWidth - 8, color: [65, 74, 82], lineHeight: 1.16
        });
        y += 2;
      });
      y += 5;
    }
  }

  const summarySection = qs('[data-section="summary"]');

  const summaryEntries = [...summarySection.querySelectorAll("label")]
    .map(label => {
      const ta = label.querySelector("textarea");
      if (!ta || !ta.value.trim()) return null;
      return { label: readLabelText(label), value: ta.value.trim() };
    })
    .filter(Boolean);

  const overallRisk = getSelectedChoices(summarySection).find(x =>
    ["Acceptable", "Acceptable subject to recommendations", "Deficiencies requiring correction",
     "Significant deficiencies", "Further specialist assessment required"].includes(x)
  );

  if (summaryEntries.length || overallRisk) {
    addHeading("19. Inspection Summary");

    summaryEntries.forEach(entry => {
      addText(entry.label, margin, { size: 9, style: "bold", lineHeight: 1.08 });
      addText(entry.value, margin + 8, { size: 8.5, maxWidth: contentWidth - 8, lineHeight: 1.2 });
      y += 5;
    });

    if (overallRisk) {
      ensureSpace(36);
      doc.setDrawColor(70);
      doc.rect(margin, y, contentWidth, 28);
      y += 18;
      addText(`Overall Insurance Risk: ${overallRisk}`, margin + 8, {
        size: 10, style: "bold", maxWidth: contentWidth - 16
      });
      y += 8;
    }
  }

  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.7);
    doc.setTextColor(95);
    doc.text("Visual insurance risk inspection — not certification of code compliance.", margin, pageHeight - 20);
    doc.text(`Page ${p} of ${pages}`, pageWidth - margin, pageHeight - 20, { align: "right" });
  }

  doc.setProperties({
    title: `${address} - Residential Rental Inspection`,
    subject: "Residential Rental Insurance Inspection",
    author: inspector || "PEI Mutual",
    creator: "PEI Mutual Residential Rental Inspection App"
  });

  const dateForName = date || new Date().toISOString().slice(0, 10);

  const filenameParts = [];
  if (owner) filenameParts.push(owner);
  if (address) filenameParts.push(address);
  filenameParts.push("Rental Inspection");
  filenameParts.push(dateForName);

  const shareTitleParts = [];
  if (owner) shareTitleParts.push(owner);
  if (address) shareTitleParts.push(address);
  shareTitleParts.push("Residential Rental Inspection");

  return {
    blob: doc.output("blob"),
    filename: safeFileName(filenameParts.join(" - ")) + ".pdf",
    title: shareTitleParts.join(" - ")
  };
}


function fileExtensionFromBlob(blob) {
  const type = (blob?.type || "").toLowerCase();
  if (type.includes("png")) return "png";
  if (type.includes("webp")) return "webp";
  if (type.includes("heic") || type.includes("heif")) return "heic";
  return "jpg";
}

async function collectOriginalPhotoFiles() {
  const address = qs("#propertyAddress")?.value?.trim() || "";
  const owner = qs("#ownerInsured")?.value?.trim() || "";
  const date = qs("#inspectionDate")?.value || new Date().toISOString().slice(0,10);

  const prefixParts = [];
  if (owner) prefixParts.push(owner);
  if (address) prefixParts.push(address);
  prefixParts.push(date);

  const prefix = safeFileName(prefixParts.join(" - "));
  const photos = [];
  let overallPhotoNumber = 1;

  for (const section of qsa(".inspection-section")) {
    const sectionTitle = getSectionTitle(section)
      .replace(/^\d+\.\s*/, "")
      .trim();

    for (const article of [...section.querySelectorAll(".inspection-item")]) {
      if (!article._photoBlob) continue;

      await ensureArticlePhotoNormalized(article);
      const blob = article._photoBlob;
      if (!blob) continue;

      const itemTitle = article.querySelector(".item-title")?.textContent?.trim() || "Inspection Photo";
      const number = String(overallPhotoNumber).padStart(2, "0");

      const filename = safeFileName(
        `${prefix} - Photo ${number} - ${sectionTitle} - ${itemTitle}`
      ) + ".jpg";

      photos.push(new File([blob], filename, {
        type: "image/jpeg",
        lastModified: Date.now()
      }));

      overallPhotoNumber++;
    }
  }

  return photos;
}

function downloadFile(file) {
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

async function shareOrDownloadPdf(result, originalPhotoFiles = []) {
  const pdfFile = new File([result.blob], result.filename, {
    type: "application/pdf"
  });

  // If photos are included, create one reliable ZIP package containing
  // the PDF plus each inspection photo as a separate JPEG file.
  if (originalPhotoFiles.length) {
    if (!window.JSZip) throw new Error("ZIP library did not load.");

    const zip = new JSZip();
    zip.file(pdfFile.name, pdfFile);

    const photosFolder = zip.folder("Inspection Photos");
    originalPhotoFiles.forEach(file => photosFolder.file(file.name, file));

    const progressButton = qs("#createPdfReport");
    if (progressButton) {
      progressButton.textContent = `Packaging PDF + ${originalPhotoFiles.length} photo${originalPhotoFiles.length === 1 ? "" : "s"}…`;
    }

    const zipBlob = await zip.generateAsync({
      type: "blob",
      compression: "STORE"
    });

    if (progressButton) {
      progressButton.textContent = "Opening Share Sheet…";
    }

    const baseName = result.filename.replace(/\.pdf$/i, "");
    const zipFile = new File(
      [zipBlob],
      `${baseName} - Export Package.zip`,
      { type: "application/zip" }
    );

    if (navigator.share && navigator.canShare) {
      try {
        const shareData = {
          title: result.title,
          files: [zipFile]
        };

        if (navigator.canShare(shareData)) {
          await navigator.share(shareData);
          return "shared-package";
        }
      } catch (error) {
        if (error?.name === "AbortError") return "cancelled";
        console.warn("ZIP share failed; using download fallback.", error);
      }
    }

    downloadFile(zipFile);
    return "downloaded-package";
  }

  // PDF-only export
  if (navigator.share && navigator.canShare) {
    try {
      const shareData = {
        title: result.title,
        text: "Residential rental inspection report",
        files: [pdfFile]
      };

      if (navigator.canShare(shareData)) {
        await navigator.share(shareData);
        return "shared";
      }
    } catch (error) {
      if (error?.name === "AbortError") return "cancelled";
      console.warn("PDF share failed; using download fallback.", error);
    }
  }

  downloadFile(pdfFile);
  return "downloaded";
}

async function createPdfReadyReport() {
  const options = {
    includeSatisfactory: qs("#exportIncludeSatisfactory").checked,
    includeNA: qs("#exportIncludeNA").checked,
    includePhotos: qs("#exportIncludePhotos").checked,
    includeOriginalPhotos: qs("#exportIncludeOriginalPhotos")?.checked ?? true,
    includeGuidance: qs("#exportIncludeGuidance").checked
  };

  const button = qs("#createPdfReport");
  const original = button.textContent;

  try {
    button.disabled = true;
    button.textContent = "Creating PDF…";
    await saveCurrentInspection(false);

    const result = await generateInspectionPdf(options);
    const originalPhotoFiles = options.includeOriginalPhotos
      ? await collectOriginalPhotoFiles()
      : [];

    button.textContent = originalPhotoFiles.length
      ? `Preparing ${originalPhotoFiles.length} photo${originalPhotoFiles.length === 1 ? "" : "s"}…`
      : "Opening Share Sheet…";

    const outcome = await shareOrDownloadPdf(result, originalPhotoFiles);

    if (outcome === "shared") {
      closeExportModal();
      showSaveNotice("PDF shared.");
    } else if (outcome === "shared-package") {
      closeExportModal();
      showSaveNotice("Export package shared.");
    } else if (outcome === "downloaded-package") {
      closeExportModal();
      showSaveNotice("Export package downloaded.");
    } else if (outcome === "downloaded") {
      closeExportModal();
      showSaveNotice("PDF downloaded.");
    }
  } catch (error) {
    console.error("PDF export failed:", error);
    if (!window.jspdf?.jsPDF) {
      alert("The PDF generator did not load. Check the internet connection and reload the app.");
    } else {
      alert("The inspection export could not be completed. Try exporting again. If it continues, turn off 'Include inspection photos as separate files' to confirm the PDF-only export works.");
    }
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}


function openExportModal() {
  qs("#exportModal").classList.remove("hidden");
}

function closeExportModal() {
  qs("#exportModal").classList.add("hidden");
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
  qs("#exportInspection").addEventListener("click", openExportModal);

  qs("#closeOpenModal").addEventListener("click", closeOpenModal);

  qs("#closeExportModal").addEventListener("click", closeExportModal);
  qs("#cancelExport").addEventListener("click", closeExportModal);
  qs("#createPdfReport").addEventListener("click", createPdfReadyReport);

  qs("#exportModal").addEventListener("click", event => {
    if (event.target === qs("#exportModal")) closeExportModal();
  });

  qs("#openInspectionModal").addEventListener("click", event => {
    if (event.target === qs("#openInspectionModal")) closeOpenModal();
  });

  qs("#savedInspectionSearch").addEventListener("input", event =>
    renderSavedInspections(event.target.value)
  );

  document.addEventListener("keydown", event => {
    if (event.key !== "Escape") return;
    if (!qs("#openInspectionModal").classList.contains("hidden")) closeOpenModal();
    if (!qs("#exportModal").classList.contains("hidden")) closeExportModal();
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
  addBottomCollapseButtons();
  wireSections();
  wireSectionNAButtons();
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

init();  updateAllSectionNAButtons();
}
nst DB_NAME = "peiMutualResidentialRentalInspectionDB";
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


async function normalizeImageBlob(blob, maxDimension = 2200, quality = 0.9) {
  if (!blob) return null;

  // Already-normalized JPEGs can still be resized to keep IndexedDB/PDF sizes reasonable.
  try {
    const dataUrl = await blobToDataURL(blob);
    const img = new Image();

    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = dataUrl;
    });

    let width = img.naturalWidth || img.width;
    let height = img.naturalHeight || img.height;

    if (!width || !height) throw new Error("Image dimensions unavailable.");

    const scale = Math.min(1, maxDimension / Math.max(width, height));
    width = Math.round(width * scale);
    height = Math.round(height * scale);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, width, height);

    const jpegBlob = await new Promise(resolve =>
      canvas.toBlob(resolve, "image/jpeg", quality)
    );

    if (!jpegBlob) throw new Error("JPEG conversion failed.");
    return jpegBlob;
  } catch (error) {
    console.warn("Image normalization failed; preserving original blob.", error);
    return blob;
  }
}

async function ensureArticlePhotoNormalized(article) {
  if (!article?._photoBlob) return null;

  if (article._photoBlob.type === "image/jpeg" && article._photoNormalized) {
    return article._photoBlob;
  }

  const normalized = await normalizeImageBlob(article._photoBlob);
  if (normalized) {
    article._photoBlob = normalized;
    article._photoName = (article._photoName || "inspection-photo")
      .replace(/\.[^.]+$/, "") + ".jpg";
    article._photoNormalized = normalized.type === "image/jpeg";
  }
  return article._photoBlob;
}

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
      updateSectionNAButton(article.closest(".inspection-section"));
      markDirty();
    });
  });

  const cameraInput = node.querySelector(".camera-input");
  const libraryInput = node.querySelector(".library-input");
  const preview = node.querySelector(".photo-preview");
  const remove = node.querySelector(".remove-photo");

  async function handleSelectedPhoto(inputElement) {
    const file = inputElement.files?.[0];
    if (!file) return;

    clearArticlePreview(article);

    const normalized = await normalizeImageBlob(file);
    article._photoBlob = normalized || file;
    article._photoName = (file.name || "inspection-photo")
      .replace(/\.[^.]+$/, "") + ".jpg";
    article._photoNormalized = article._photoBlob?.type === "image/jpeg";

    renderPhoto(article, article._photoBlob);

    if (inputElement === cameraInput && libraryInput) libraryInput.value = "";
    if (inputElement === libraryInput && cameraInput) cameraInput.value = "";

    markDirty();
  }

  cameraInput?.addEventListener("change", () => handleSelectedPhoto(cameraInput));
  libraryInput?.addEventListener("change", () => handleSelectedPhoto(libraryInput));

  remove.addEventListener("click", () => {
    clearArticlePreview(article);
    article._photoBlob = null;
    article._photoName = "";
    if (cameraInput) cameraInput.value = "";
    if (libraryInput) libraryInput.value = "";
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
    <div class="section-header-bar">
      <button class="section-header" type="button">
        <span>${s.number}. ${s.title}</span>
        <span class="section-arrow">▶</span>
      </button>
      <button class="section-na-button" type="button" title="Mark every rated item in this section Not Applicable">Section N/A</button>
    </div>
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


function setSectionCollapsed(section, collapsed, scrollToHeader = false) {
  const content = section.querySelector(".section-content");
  const arrow = section.querySelector(".section-arrow");
  if (!content) return;

  content.classList.toggle("collapsed", collapsed);
  if (arrow) arrow.textContent = collapsed ? "▶" : "▼";

  if (collapsed && scrollToHeader) {
    section.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function addBottomCollapseButtons() {
  qsa(".inspection-section").forEach(section => {
    const content = section.querySelector(".section-content");
    if (!content || content.querySelector(".collapse-section-bottom")) return;

    const footer = document.createElement("div");
    footer.className = "section-footer-actions";
    footer.innerHTML = `
      <button type="button" class="collapse-section-bottom">
        Collapse Section ↑
      </button>`;

    footer.querySelector(".collapse-section-bottom").addEventListener("click", () => {
      setSectionCollapsed(section, true, true);
    });

    content.appendChild(footer);
  });
}

function updateSectionNAButton(section) {
  const button = section.querySelector(".section-na-button");
  if (!button) return;

  const items = [...section.querySelectorAll(".inspection-item")];
  if (!items.length) {
    button.disabled = true;
    return;
  }

  const allNA = items.every(item => item.dataset.status === "NA");
  button.textContent = allNA ? "Clear Section N/A" : "Section N/A";
  button.classList.toggle("active", allNA);
}

function markSectionNA(section) {
  const items = [...section.querySelectorAll(".inspection-item")];
  if (!items.length) return;

  const allNA = items.every(item => item.dataset.status === "NA");

  items.forEach(item => {
    const buttons = [...item.querySelectorAll(".status-buttons button")];
    const details = item.querySelector(".deficiency-details");

    if (allNA) {
      buttons.forEach(btn => btn.classList.remove("selected"));
      item.dataset.status = "";
      details?.classList.add("hidden");
    } else {
      buttons.forEach(btn => btn.classList.remove("selected"));
      const na = item.querySelector('[data-status="NA"]');
      na?.classList.add("selected");
      item.dataset.status = "NA";
      details?.classList.add("hidden");
    }
  });

  updateSectionNAButton(section);
  markDirty();
}

function wireSectionNAButtons() {
  qsa(".section-na-button").forEach(button => {
    button.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      markSectionNA(button.closest(".inspection-section"));
    });
    updateSectionNAButton(button.closest(".inspection-section"));
  });
}

function updateAllSectionNAButtons() {
  qsa(".inspection-section").forEach(updateSectionNAButton);
}

function wireSections() {
  qsa(".section-header").forEach(h =>
    h.addEventListener("click", () => {
      const section = h.closest(".inspection-section");
      const content = section.querySelector(".section-content");
      setSectionCollapsed(section, !content.classList.contains("collapsed"));
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
      `The screening trigger is 4+ storeys OR more than 11 units. Exceptions may apply; use Further Review Required if the requirement cannot be established.`;
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
    article.querySelectorAll(".photo-input").forEach(input => {
      input.value = "";
    });
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
      article._photoNormalized = item.photoBlob?.type === "image/jpeg";
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
  // Normalize all attached images before persistence so reopened inspections remain PDF-safe.
  await Promise.all(qsa(".inspection-item").map(article => ensureArticlePhotoNormalized(article)));

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
// PDF-READY REPORT EXPORT
// ------------------------------

function statusLabel(status) {
  return ({
    S: "Satisfactory",
    D: "Deficiency",
    IC: "Immediate Concern",
    R: "Further Review Required",
    NI: "Not Inspected / Not Accessible",
    NA: "Not Applicable"
  })[status] || "Not Rated";
}

function formatInspectionDate(value) {
  if (!value) return "";
  const parts = value.split("-");
  if (parts.length !== 3) return value;
  return `${parts[0]}-${parts[1]}-${parts[2]}`;
}

function readLabelText(el) {
  const clone = el.cloneNode(true);
  clone.querySelectorAll("input,select,textarea,button").forEach(x => x.remove());
  return clone.textContent.replace(/\s+/g, " ").trim();
}

function getSelectedChoices(container) {
  if (!container) return [];
  return [...container.querySelectorAll('input[type="checkbox"]:checked, input[type="radio"]:checked')]
    .map(input => {
      const label = input.closest("label");
      return label ? readLabelText(label) : (input.value || "");
    })
    .filter(Boolean);
}

function getSectionTitle(section) {
  return section.querySelector(".section-header span")?.textContent?.trim() || "";
}

function getExportableItems(section, options) {
  return [...section.querySelectorAll(".inspection-item")]
    .map(article => {
      const title = article.querySelector(".item-title")?.textContent?.trim() || "";
      const status = article.dataset.status || "";
      const observation = article.querySelector(".observation")?.value?.trim() || "";
      const photoBlob = article._photoBlob || null;
      const photoName = article._photoName || "";

      return { title, status, observation, photoBlob, photoName };
    })
    .filter(item => {
      if (!item.status && !item.observation && !item.photoBlob) return false;
      if (item.status === "S" && !options.includeSatisfactory) return false;
      if (["NA","NI"].includes(item.status) && !options.includeNA) return false;
      return true;
    });
}

function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    if (!blob) return resolve("");
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function buildReportHTML(options) {
  const address = qs("#propertyAddress")?.value?.trim() || "";
  const owner = qs("#ownerInsured")?.value?.trim() || "";
  const date = qs("#inspectionDate")?.value || "";
  const inspector = qs("#inspector")?.value?.trim() || "";
  const units = qs("#dwellingUnits")?.value || "";
  const storeys = qs("#storeys")?.value || "";
  const year = qs("#yearConstructed")?.value || "";
  const buildingType = qs("#buildingType")?.value || "";

  const sectionBlocks = [];

  for (const section of qsa(".inspection-section")) {
    const title = getSectionTitle(section);
    if (!title || title.startsWith("1.") || title.startsWith("19.")) continue;

    const items = getExportableItems(section, options);

    // Collect subsection choice groups that are useful in the fire section.
    const choiceGroups = [];
    if (title.startsWith("7.")) {
      [...section.querySelectorAll(".subsection")].forEach(sub => {
        const subTitle = sub.querySelector("h3")?.textContent?.trim();
        const choices = getSelectedChoices(sub);
        if (subTitle && choices.length) {
          choiceGroups.push({ title: subTitle, choices });
        }
      });
    }

    if (!items.length && !choiceGroups.length) continue;

    const rows = [];
    for (const item of items) {
      let photoHTML = "";
      if (options.includePhotos && item.photoBlob) {
        try {
          const src = await blobToDataURL(item.photoBlob);
          if (src) {
            photoHTML = `<div class="report-photo"><img src="${src}" alt="Inspection photo"></div>`;
          }
        } catch (e) {
          console.warn("Could not include photo in export.", e);
        }
      }

      rows.push(`
        <div class="report-item status-${item.status || "blank"}">
          <div class="report-item-top">
            <div class="report-item-title">${escapeHTML(item.title)}</div>
            <div class="report-status">${escapeHTML(statusLabel(item.status))}</div>
          </div>
          ${item.observation ? `<div class="report-observation"><strong>Observation:</strong> ${escapeHTML(item.observation)}</div>` : ""}
          ${photoHTML}
        </div>`);
    }

    const choiceHTML = choiceGroups.map(group => `
      <div class="report-choice-group">
        <strong>${escapeHTML(group.title)}:</strong>
        ${escapeHTML(group.choices.join("; "))}
      </div>`).join("");

    let guidanceHTML = "";
    if (options.includeGuidance) {
      const notes = [...section.querySelectorAll(".guidance p, .code-reference p")]
        .map(p => p.textContent.replace(/\s+/g, " ").trim())
        .filter(Boolean);

      if (notes.length) {
        guidanceHTML = `
          <div class="report-guidance">
            <strong>Inspector / Code Guidance</strong>
            ${notes.map(n => `<p>${escapeHTML(n)}</p>`).join("")}
          </div>`;
      }
    }

    sectionBlocks.push(`
      <section class="report-section">
        <h2>${escapeHTML(title)}</h2>
        ${choiceHTML}
        ${rows.join("")}
        ${guidanceHTML}
      </section>`);
  }

  // Summary
  const summarySection = qs('[data-section="summary"]');
  const summaryFields = [...summarySection.querySelectorAll("label")]
    .map(label => {
      const ta = label.querySelector("textarea");
      if (!ta || !ta.value.trim()) return null;
      return {
        label: readLabelText(label),
        value: ta.value.trim()
      };
    })
    .filter(Boolean);

  const overallRisk = getSelectedChoices(summarySection)
    .find(x => [
      "Acceptable",
      "Acceptable subject to recommendations",
      "Deficiencies requiring correction",
      "Significant deficiencies",
      "Further specialist assessment required"
    ].includes(x)) || "";

  const summaryHTML = `
    <section class="report-section summary-section">
      <h2>19. Inspection Summary</h2>
      ${summaryFields.map(f => `
        <div class="summary-block">
          <h3>${escapeHTML(f.label)}</h3>
          <p>${escapeHTML(f.value).replace(/\n/g, "<br>")}</p>
        </div>`).join("")}
      ${overallRisk ? `
        <div class="overall-risk">
          <strong>Overall Insurance Risk:</strong> ${escapeHTML(overallRisk)}
        </div>` : ""}
    </section>`;

  const generated = new Date();
  const generatedText = new Intl.DateTimeFormat("en-CA", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(generated);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Inspection Report - ${escapeHTML(address)}</title>
<style>
  @page { size: letter; margin: 0.55in; }
  * { box-sizing: border-box; }
  body {
    margin:0;
    font-family: Arial, Helvetica, sans-serif;
    color:#20262c;
    font-size:10.5pt;
    line-height:1.38;
    background:white;
  }
  .report-header {
    border-bottom:3px solid #303840;
    padding-bottom:12px;
    margin-bottom:16px;
  }
  .report-header h1 {
    margin:0 0 3px;
    font-size:19pt;
  }
  .report-header .subtitle {
    color:#5d6872;
    font-size:10pt;
    margin-bottom:10px;
  }
  .property-grid {
    display:grid;
    grid-template-columns:1fr 1fr;
    gap:7px 20px;
    font-size:9.5pt;
  }
  .property-row strong { display:inline-block; min-width:118px; }
  .standards {
    margin-top:12px;
    padding:8px 10px;
    background:#f2f4f6;
    border-left:4px solid #697987;
    font-size:8.8pt;
  }
  .report-section {
    page-break-inside:auto;
    margin:0 0 16px;
  }
  .report-section h2 {
    font-size:13pt;
    margin:0 0 8px;
    padding-bottom:4px;
    border-bottom:1px solid #aeb5bb;
  }
  .report-item {
    border:1px solid #d5d9dd;
    border-left:5px solid #8e989f;
    padding:7px 9px;
    margin:0 0 6px;
    page-break-inside:avoid;
  }
  .report-item.status-D { border-left-color:#a97100; }
  .report-item.status-IC { border-left-color:#a63030; }
  .report-item.status-R { border-left-color:#476aa6; }
  .report-item.status-S { border-left-color:#46764b; }
  .report-item-top {
    display:flex;
    justify-content:space-between;
    gap:18px;
    align-items:flex-start;
  }
  .report-item-title { font-weight:700; }
  .report-status {
    flex-shrink:0;
    font-size:8.8pt;
    font-weight:700;
    color:#4c5660;
  }
  .report-observation {
    margin-top:5px;
    padding-top:5px;
    border-top:1px dotted #c5c9cd;
  }
  .report-photo { margin-top:8px; }
  .report-photo img {
    max-width:4.8in;
    max-height:3.5in;
    object-fit:contain;
    border:1px solid #cbd0d4;
  }
  .report-choice-group {
    margin:0 0 7px;
    padding:6px 8px;
    background:#f6f7f8;
    font-size:9pt;
  }
  .report-guidance {
    margin-top:9px;
    padding:8px 10px;
    border-left:4px solid #60788d;
    background:#f7f9fa;
    font-size:8.8pt;
    page-break-inside:avoid;
  }
  .report-guidance p { margin:4px 0; }
  .summary-block {
    margin:0 0 10px;
    page-break-inside:avoid;
  }
  .summary-block h3 {
    margin:0 0 3px;
    font-size:10.5pt;
  }
  .summary-block p { margin:0; }
  .overall-risk {
    margin-top:12px;
    padding:10px;
    border:2px solid #4c5964;
    font-size:11pt;
  }
  .report-footer {
    margin-top:18px;
    padding-top:8px;
    border-top:1px solid #c8cdd1;
    font-size:8pt;
    color:#66717a;
  }
  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
</style>
</head>
<body>
  <header class="report-header">
    <h1>PEI Mutual Residential Rental Inspection</h1>
    <div class="subtitle">Existing Residential Rental Building — Insurance Risk Inspection Report</div>

    <div class="property-grid">
      <div class="property-row"><strong>Property:</strong> ${escapeHTML(address)}</div>
      <div class="property-row"><strong>Owner / Insured:</strong> ${escapeHTML(owner)}</div>
      <div class="property-row"><strong>Inspection Date:</strong> ${escapeHTML(formatInspectionDate(date))}</div>
      <div class="property-row"><strong>Inspector:</strong> ${escapeHTML(inspector)}</div>
      <div class="property-row"><strong>Building Type:</strong> ${escapeHTML(buildingType)}</div>
      <div class="property-row"><strong>Year Constructed:</strong> ${escapeHTML(year)}</div>
      <div class="property-row"><strong>Dwelling Units:</strong> ${escapeHTML(units)}</div>
      <div class="property-row"><strong>Storeys:</strong> ${escapeHTML(storeys)}</div>
    </div>

    <div class="standards">
      <strong>Current reference standards:</strong>
      NBC 2020 · NFC 2020 · CEC 2024 · NPC 2020 · NFPA 1 (2024) · NFPA 101 (2024).
      Current codes are used as reference standards where applicable; an existing building is not
      necessarily required to comply retrospectively with every provision applicable to new construction.
    </div>
  </header>

  ${sectionBlocks.join("")}
  ${summaryHTML}

  <footer class="report-footer">
    Report generated ${escapeHTML(generatedText)}. This report documents a visual insurance risk inspection
    and does not constitute certification of compliance with applicable building, fire, electrical, plumbing,
    or other codes.
  </footer>

<script>
  window.addEventListener("load", () => {
    setTimeout(() => window.print(), 400);
  });
</script>
</body>
</html>`;
}


function safeFileName(value) {
  return (value || "Residential Rental Inspection")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function photoFormat(blob) {
  const type = (blob?.type || "").toLowerCase();
  if (type.includes("png")) return "PNG";
  if (type.includes("webp")) return "WEBP";
  return "JPEG";
}

async function generateInspectionPdf(options) {
  if (!window.jspdf?.jsPDF) throw new Error("PDF library did not load.");

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "letter", compress: true });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 40;
  const contentWidth = pageWidth - margin * 2;
  const bottom = pageHeight - 42;
  let y = margin;

  const address = qs("#propertyAddress")?.value?.trim() || "";
  const owner = qs("#ownerInsured")?.value?.trim() || "";
  const date = qs("#inspectionDate")?.value || "";
  const inspector = qs("#inspector")?.value?.trim() || "";
  const units = qs("#dwellingUnits")?.value || "";
  const storeys = qs("#storeys")?.value || "";
  const year = qs("#yearConstructed")?.value || "";
  const buildingType = qs("#buildingType")?.value || "";

  function newPage() { doc.addPage(); y = margin; }
  function ensureSpace(h) { if (y + h > bottom) newPage(); }

  function addText(text, x, opts = {}) {
    const {
      size = 10, style = "normal", maxWidth = contentWidth,
      lineHeight = 1.22, color = [32, 38, 44]
    } = opts;
    doc.setFont("helvetica", style);
    doc.setFontSize(size);
    doc.setTextColor(...color);
    const lines = doc.splitTextToSize(String(text || ""), maxWidth);
    const height = Math.max(size * lineHeight, lines.length * size * lineHeight);
    ensureSpace(height + 3);
    doc.text(lines, x, y);
    y += lines.length * size * lineHeight;
  }

  function addHeading(text) {
    ensureSpace(32);
    y += 6;
    addText(text, margin, { size: 13, style: "bold", lineHeight: 1.05 });
    doc.setDrawColor(160);
    doc.line(margin, y + 1, pageWidth - margin, y + 1);
    y += 10;
  }

  function addMeta(label, value, x, width) {
    if (!value) return;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(40);
    doc.text(`${label}:`, x, y);
    const labelWidth = doc.getTextWidth(`${label}: `);
    doc.setFont("helvetica", "normal");
    const lines = doc.splitTextToSize(String(value), width - labelWidth);
    doc.text(lines, x + labelWidth, y);
  }

  addText("PEI Mutual Residential Rental Inspection", margin, { size: 17, style: "bold", lineHeight: 1.05 });
  addText("Existing Residential Rental Building — Insurance Risk Inspection Report", margin, {
    size: 9, color: [90, 100, 108], lineHeight: 1.15
  });
  y += 8;

  const colW = contentWidth / 2 - 8;
  [
    [["Property", address], ["Owner / Insured", owner]],
    [["Inspection Date", date], ["Inspector", inspector]],
    [["Building Type", buildingType], ["Year Constructed", year]],
    [["Dwelling Units", units], ["Storeys", storeys]]
  ].forEach(row => {
    ensureSpace(16);
    addMeta(row[0][0], row[0][1], margin, colW);
    addMeta(row[1][0], row[1][1], margin + contentWidth / 2 + 8, colW);
    y += 15;
  });

  y += 5;
  ensureSpace(45);
  doc.setFillColor(242, 244, 246);
  doc.rect(margin, y, contentWidth, 38, "F");
  y += 10;
  addText(
    "Current reference standards: NBC 2020 · NFC 2020 · CEC 2024 · NPC 2020 · NFPA 1 (2024) · NFPA 101 (2024). Current codes are reference standards where applicable; an existing building is not necessarily required to comply retrospectively with every provision applicable to new construction.",
    margin + 8,
    { size: 7.4, maxWidth: contentWidth - 16, color: [60, 68, 76], lineHeight: 1.16 }
  );
  y += 10;

  for (const section of qsa(".inspection-section")) {
    const title = getSectionTitle(section);
    if (!title || title.startsWith("1.") || title.startsWith("19.")) continue;

    const items = getExportableItems(section, options);
    const choiceGroups = title.startsWith("7.")
      ? [...section.querySelectorAll(".subsection")].map(sub => ({
          title: sub.querySelector("h3")?.textContent?.trim() || "",
          choices: getSelectedChoices(sub)
        })).filter(g => g.title && g.choices.length)
      : [];

    const guidanceNotes = options.includeGuidance
      ? [...section.querySelectorAll(".guidance p, .code-reference p")]
          .map(p => p.textContent.replace(/\s+/g, " ").trim()).filter(Boolean)
      : [];

    if (!items.length && !choiceGroups.length) continue;

    addHeading(title);

    for (const group of choiceGroups) {
      addText(group.title, margin, { size: 9, style: "bold", lineHeight: 1.08 });
      addText(group.choices.join("; "), margin + 8, {
        size: 8, maxWidth: contentWidth - 8, color: [70, 78, 85], lineHeight: 1.16
      });
      y += 4;
    }

    for (const item of items) {
      ensureSpace(38);

      const colors = {
        S: [70, 118, 75], D: [169, 113, 0], IC: [166, 48, 48],
        R: [71, 106, 166], NI: [120, 125, 130], NA: [120, 125, 130]
      };
      const accent = colors[item.status] || [140, 145, 150];

      doc.setFillColor(...accent);
      doc.rect(margin, y, 3, 16, "F");

      doc.setFont("helvetica", "bold");
      doc.setFontSize(9.2);
      doc.setTextColor(30);
      const titleLines = doc.splitTextToSize(item.title, contentWidth - 155);
      doc.text(titleLines, margin + 9, y + 9);

      doc.setFontSize(7.8);
      doc.setTextColor(...accent);
      doc.text(statusLabel(item.status), pageWidth - margin, y + 9, { align: "right" });

      y += Math.max(20, titleLines.length * 10 + 5);

      if (item.observation) {
        addText(`Observation: ${item.observation}`, margin + 9, {
          size: 8.5, maxWidth: contentWidth - 9, lineHeight: 1.2
        });
        y += 4;
      }

      if (options.includePhotos && item.photoBlob) {
        try {
          const article = [...section.querySelectorAll(".inspection-item")].find(a =>
            (a.querySelector(".item-title")?.textContent?.trim() || "") === item.title
          );
          if (article) {
            await ensureArticlePhotoNormalized(article);
            item.photoBlob = article._photoBlob || item.photoBlob;
          }
          const dataUrl = await blobToDataURL(item.photoBlob);
          const props = doc.getImageProperties(dataUrl);
          const maxW = 300, maxH = 220;
          let w = maxW, h = (props.height * w) / props.width;
          if (h > maxH) { h = maxH; w = (props.width * h) / props.height; }
          ensureSpace(h + 12);
          doc.addImage(dataUrl, photoFormat(item.photoBlob), margin + 9, y, w, h, undefined, "FAST");
          y += h + 8;
        } catch (error) {
          console.warn("Photo could not be added to PDF.", error);
          addText("Attached photo could not be rendered in PDF.", margin + 9, {
            size: 8, color: [120, 60, 60]
          });
        }
      }

      doc.setDrawColor(220);
      doc.line(margin, y, pageWidth - margin, y);
      y += 7;
    }

    if (guidanceNotes.length) {
      ensureSpace(35);
      addText("Inspector / Code Guidance", margin, { size: 8.5, style: "bold" });
      guidanceNotes.forEach(note => {
        addText(note, margin + 8, {
          size: 7.5, maxWidth: contentWidth - 8, color: [65, 74, 82], lineHeight: 1.16
        });
        y += 2;
      });
      y += 5;
    }
  }

  const summarySection = qs('[data-section="summary"]');

  const summaryEntries = [...summarySection.querySelectorAll("label")]
    .map(label => {
      const ta = label.querySelector("textarea");
      if (!ta || !ta.value.trim()) return null;
      return { label: readLabelText(label), value: ta.value.trim() };
    })
    .filter(Boolean);

  const overallRisk = getSelectedChoices(summarySection).find(x =>
    ["Acceptable", "Acceptable subject to recommendations", "Deficiencies requiring correction",
     "Significant deficiencies", "Further specialist assessment required"].includes(x)
  );

  if (summaryEntries.length || overallRisk) {
    addHeading("19. Inspection Summary");

    summaryEntries.forEach(entry => {
      addText(entry.label, margin, { size: 9, style: "bold", lineHeight: 1.08 });
      addText(entry.value, margin + 8, { size: 8.5, maxWidth: contentWidth - 8, lineHeight: 1.2 });
      y += 5;
    });

    if (overallRisk) {
      ensureSpace(36);
      doc.setDrawColor(70);
      doc.rect(margin, y, contentWidth, 28);
      y += 18;
      addText(`Overall Insurance Risk: ${overallRisk}`, margin + 8, {
        size: 10, style: "bold", maxWidth: contentWidth - 16
      });
      y += 8;
    }
  }

  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.7);
    doc.setTextColor(95);
    doc.text("Visual insurance risk inspection — not certification of code compliance.", margin, pageHeight - 20);
    doc.text(`Page ${p} of ${pages}`, pageWidth - margin, pageHeight - 20, { align: "right" });
  }

  doc.setProperties({
    title: `${address} - Residential Rental Inspection`,
    subject: "Residential Rental Insurance Inspection",
    author: inspector || "PEI Mutual",
    creator: "PEI Mutual Residential Rental Inspection App"
  });

  const dateForName = date || new Date().toISOString().slice(0, 10);

  const filenameParts = [];
  if (owner) filenameParts.push(owner);
  if (address) filenameParts.push(address);
  filenameParts.push("Rental Inspection");
  filenameParts.push(dateForName);

  const shareTitleParts = [];
  if (owner) shareTitleParts.push(owner);
  if (address) shareTitleParts.push(address);
  shareTitleParts.push("Residential Rental Inspection");

  return {
    blob: doc.output("blob"),
    filename: safeFileName(filenameParts.join(" - ")) + ".pdf",
    title: shareTitleParts.join(" - ")
  };
}


function fileExtensionFromBlob(blob) {
  const type = (blob?.type || "").toLowerCase();
  if (type.includes("png")) return "png";
  if (type.includes("webp")) return "webp";
  if (type.includes("heic") || type.includes("heif")) return "heic";
  return "jpg";
}

async function collectOriginalPhotoFiles() {
  const address = qs("#propertyAddress")?.value?.trim() || "";
  const owner = qs("#ownerInsured")?.value?.trim() || "";
  const date = qs("#inspectionDate")?.value || new Date().toISOString().slice(0,10);

  const prefixParts = [];
  if (owner) prefixParts.push(owner);
  if (address) prefixParts.push(address);
  prefixParts.push(date);

  const prefix = safeFileName(prefixParts.join(" - "));
  const photos = [];
  let overallPhotoNumber = 1;

  for (const section of qsa(".inspection-section")) {
    const sectionTitle = getSectionTitle(section)
      .replace(/^\d+\.\s*/, "")
      .trim();

    for (const article of [...section.querySelectorAll(".inspection-item")]) {
      if (!article._photoBlob) continue;

      await ensureArticlePhotoNormalized(article);
      const blob = article._photoBlob;
      if (!blob) continue;

      const itemTitle = article.querySelector(".item-title")?.textContent?.trim() || "Inspection Photo";
      const number = String(overallPhotoNumber).padStart(2, "0");

      const filename = safeFileName(
        `${prefix} - Photo ${number} - ${sectionTitle} - ${itemTitle}`
      ) + ".jpg";

      photos.push(new File([blob], filename, {
        type: "image/jpeg",
        lastModified: Date.now()
      }));

      overallPhotoNumber++;
    }
  }

  return photos;
}

function downloadFile(file) {
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

async function shareOrDownloadPdf(result, originalPhotoFiles = []) {
  const pdfFile = new File([result.blob], result.filename, {
    type: "application/pdf"
  });

  // If photos are included, create one reliable ZIP package containing
  // the PDF plus each inspection photo as a separate JPEG file.
  if (originalPhotoFiles.length) {
    if (!window.JSZip) throw new Error("ZIP library did not load.");

    const zip = new JSZip();
    zip.file(pdfFile.name, pdfFile);

    const photosFolder = zip.folder("Inspection Photos");
    originalPhotoFiles.forEach(file => photosFolder.file(file.name, file));

    const progressButton = qs("#createPdfReport");
    if (progressButton) {
      progressButton.textContent = `Packaging PDF + ${originalPhotoFiles.length} photo${originalPhotoFiles.length === 1 ? "" : "s"}…`;
    }

    const zipBlob = await zip.generateAsync({
      type: "blob",
      compression: "STORE"
    });

    if (progressButton) {
      progressButton.textContent = "Opening Share Sheet…";
    }

    const baseName = result.filename.replace(/\.pdf$/i, "");
    const zipFile = new File(
      [zipBlob],
      `${baseName} - Export Package.zip`,
      { type: "application/zip" }
    );

    if (navigator.share && navigator.canShare) {
      try {
        const shareData = {
          title: result.title,
          text: "Residential rental inspection report package",
          files: [zipFile]
        };

        if (navigator.canShare(shareData)) {
          await navigator.share(shareData);
          return "shared-package";
        }
      } catch (error) {
        if (error?.name === "AbortError") return "cancelled";
        console.warn("ZIP share failed; using download fallback.", error);
      }
    }

    downloadFile(zipFile);
    return "downloaded-package";
  }

  // PDF-only export
  if (navigator.share && navigator.canShare) {
    try {
      const shareData = {
        title: result.title,
        text: "Residential rental inspection report",
        files: [pdfFile]
      };

      if (navigator.canShare(shareData)) {
        await navigator.share(shareData);
        return "shared";
      }
    } catch (error) {
      if (error?.name === "AbortError") return "cancelled";
      console.warn("PDF share failed; using download fallback.", error);
    }
  }

  downloadFile(pdfFile);
  return "downloaded";
}

async function createPdfReadyReport() {
  const options = {
    includeSatisfactory: qs("#exportIncludeSatisfactory").checked,
    includeNA: qs("#exportIncludeNA").checked,
    includePhotos: qs("#exportIncludePhotos").checked,
    includeOriginalPhotos: qs("#exportIncludeOriginalPhotos")?.checked ?? true,
    includeGuidance: qs("#exportIncludeGuidance").checked
  };

  const button = qs("#createPdfReport");
  const original = button.textContent;

  try {
    button.disabled = true;
    button.textContent = "Creating PDF…";
    await saveCurrentInspection(false);

    const result = await generateInspectionPdf(options);
    const originalPhotoFiles = options.includeOriginalPhotos
      ? await collectOriginalPhotoFiles()
      : [];

    button.textContent = originalPhotoFiles.length
      ? `Preparing ${originalPhotoFiles.length} photo${originalPhotoFiles.length === 1 ? "" : "s"}…`
      : "Opening Share Sheet…";

    const outcome = await shareOrDownloadPdf(result, originalPhotoFiles);

    if (outcome === "shared") {
      closeExportModal();
      showSaveNotice("PDF shared.");
    } else if (outcome === "shared-package") {
      closeExportModal();
      showSaveNotice("Export package shared.");
    } else if (outcome === "downloaded-package") {
      closeExportModal();
      showSaveNotice("Export package downloaded.");
    } else if (outcome === "downloaded") {
      closeExportModal();
      showSaveNotice("PDF downloaded.");
    }
  } catch (error) {
    console.error("PDF export failed:", error);
    if (!window.jspdf?.jsPDF) {
      alert("The PDF generator did not load. Check the internet connection and reload the app.");
    } else {
      alert("The inspection export could not be completed. Try exporting again. If it continues, turn off 'Include inspection photos as separate files' to confirm the PDF-only export works.");
    }
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}


function openExportModal() {
  qs("#exportModal").classList.remove("hidden");
}

function closeExportModal() {
  qs("#exportModal").classList.add("hidden");
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
  qs("#exportInspection").addEventListener("click", openExportModal);

  qs("#closeOpenModal").addEventListener("click", closeOpenModal);

  qs("#closeExportModal").addEventListener("click", closeExportModal);
  qs("#cancelExport").addEventListener("click", closeExportModal);
  qs("#createPdfReport").addEventListener("click", createPdfReadyReport);

  qs("#exportModal").addEventListener("click", event => {
    if (event.target === qs("#exportModal")) closeExportModal();
  });

  qs("#openInspectionModal").addEventListener("click", event => {
    if (event.target === qs("#openInspectionModal")) closeOpenModal();
  });

  qs("#savedInspectionSearch").addEventListener("input", event =>
    renderSavedInspections(event.target.value)
  );

  document.addEventListener("keydown", event => {
    if (event.key !== "Escape") return;
    if (!qs("#openInspectionModal").classList.contains("hidden")) closeOpenModal();
    if (!qs("#exportModal").classList.contains("hidden")) closeExportModal();
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
  addBottomCollapseButtons();
  wireSections();
  wireSectionNAButtons();
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
