const $ = (sel) => document.querySelector(sel);
const t = window.I18N.t;

// Aplicar traducciones a los textos estáticos y fijar el idioma del documento.
document.documentElement.lang = window.I18N.lang;
window.I18N.applyStatic();

// Preferencias persistentes. Fuente durable = prefs.json del servidor
// (inyectado como window.__NT_PREFS__); el localStorage del webview no
// sobrevive al cierre en la app empaquetada, así que solo es respaldo.
function ntPref(key) {
  const p = window.__NT_PREFS__ || {};
  if (key in p) return p[key];
  try { return localStorage.getItem(key); } catch (e) { return null; }
}
function savePref(key, value) {
  try { localStorage.setItem(key, value); } catch (e) {}
  try {
    fetch("/api/prefs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, value: String(value) }),
    }).catch(() => {});
  } catch (e) {}
}

const fileList = $("#file-list");
const fileNameEl = $("#file-name");
const statusPill = $("#status-pill");
const saveState = $("#save-state");
const wordCount = $("#word-count");
const btnRecord = $("#btn-record");
const modelSelect = $("#model-select");
const deviceSelect = $("#device-select");
const langSelect = $("#lang-select");
const chunkSelect = $("#chunk-select");

// Editor markdown con resaltado en vivo. El contenido sigue siendo texto
// markdown plano: lo que se guarda en el .md es exactamente lo que se ve.
const cm = CodeMirror.fromTextArea($("#editor"), {
  mode: { name: "markdown", highlightFormatting: true },
  lineWrapping: true,
  readOnly: "nocursor", // hasta que se abra un archivo
  autofocus: false,
  spellcheck: false,
});
cm.setOption("placeholder", t("editor_ph"));

let currentFile = null;
let recording = false;
let busy = false; // quedan chunks por transcribir tras detener
let saveTimer = null;
let ws = null;
let dirty = false; // ¿hay cambios del usuario sin guardar?

// -------------------------------------------------------------- diálogo
// Diálogo propio: confirm()/prompt() nativos no son fiables en el webview
// empaquetado. Devuelve false si se cancela; true (o el texto del input) si
// se acepta.
function askModal({ message, input = null, okLabel = null, danger = false, cancel = true }) {
  const modal = $("#modal");
  const inputEl = $("#modal-input");
  const okBtn = $("#modal-ok");
  const cancelBtn = $("#modal-cancel");
  $("#modal-msg").textContent = message;
  okBtn.textContent = okLabel || t("accept");
  okBtn.classList.toggle("danger", danger);
  cancelBtn.style.display = cancel ? "" : "none";
  if (input !== null) {
    inputEl.value = input;
    inputEl.classList.remove("hidden");
  } else {
    inputEl.classList.add("hidden");
  }
  modal.classList.remove("hidden");
  if (input !== null) { inputEl.focus(); inputEl.select(); }
  else okBtn.focus();
  return new Promise((resolve) => {
    function close(result) {
      modal.classList.add("hidden");
      okBtn.onclick = cancelBtn.onclick = modal.onclick = inputEl.onkeydown = null;
      resolve(result);
    }
    okBtn.onclick = () => close(input !== null ? inputEl.value.trim() : true);
    cancelBtn.onclick = () => close(false);
    modal.onclick = (e) => { if (e.target === modal && cancel) close(false); };
    inputEl.onkeydown = (e) => {
      if (e.key === "Enter") okBtn.onclick();
      if (e.key === "Escape" && cancel) close(false);
    };
  });
}

function alertModal(message) {
  return askModal({ message, okLabel: t("understood"), cancel: false });
}

// ------------------------------------------------------------------ API
async function api(path, body) {
  const opts = body !== undefined
    ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
    : undefined;
  const res = await fetch("/api/" + path, opts);
  if (!res.ok) {
    let detail = res.statusText;
    try { detail = (await res.json()).detail || detail; } catch (e) {}
    throw new Error(detail);
  }
  return res.json();
}

// ------------------------------------------------------------- archivos
function fmtDate(mtime) {
  return new Date(mtime * 1000).toLocaleString(window.I18N.lang, {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

async function refreshFiles() {
  const { files } = await api("files");
  fileList.innerHTML = "";
  if (!files.length) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = t("no_files");
    fileList.appendChild(li);
    return;
  }
  for (const f of files) {
    const li = document.createElement("li");
    li.dataset.name = f.name;
    if (f.name === currentFile) li.classList.add("active");
    const name = document.createElement("span");
    name.className = "fname";
    name.textContent = f.name.replace(/\.md$/, "");
    const date = document.createElement("span");
    date.className = "fdate";
    date.textContent = fmtDate(f.mtime);
    const del = document.createElement("button");
    del.className = "fdel";
    del.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-12"/></svg>';
    del.title = t("delete_title");
    del.addEventListener("click", (e) => { e.stopPropagation(); deleteFile(f.name); });
    li.append(name, date, del);
    li.addEventListener("click", () => openFile(f.name));
    fileList.appendChild(li);
  }
  loadTrash();
}

// -------------------------------------------------------------- papelera
const trashSection = $("#trash");
const trashList = $("#trash-list");
let trashOpen = false;

const ICON_RESTORE = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-2"/></svg>';
const ICON_FOREVER = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-12"/></svg>';

async function loadTrash() {
  let items = [];
  try { items = (await api("trash")).items; } catch (e) { return; }
  trashSection.classList.toggle("hidden", items.length === 0);
  $("#trash-count").textContent = items.length ? `(${items.length})` : "";
  if (!items.length) {
    trashOpen = false;
    trashSection.classList.remove("open");
    trashList.classList.add("hidden");
    return;
  }
  trashList.innerHTML = "";
  for (const it of items) {
    const li = document.createElement("li");
    const name = document.createElement("span");
    name.className = "tname";
    name.textContent = it.display;
    name.title = it.display;
    const restore = document.createElement("button");
    restore.className = "t-restore";
    restore.innerHTML = ICON_RESTORE;
    restore.title = t("trash_restore");
    restore.addEventListener("click", () => restoreTrash(it.file));
    const forever = document.createElement("button");
    forever.className = "t-forever";
    forever.innerHTML = ICON_FOREVER;
    forever.title = t("trash_delete_forever");
    forever.addEventListener("click", () => deleteForever(it.file, it.display));
    li.append(name, restore, forever);
    trashList.appendChild(li);
  }
  const row = document.createElement("li");
  row.id = "trash-empty-row";
  const empty = document.createElement("button");
  empty.id = "trash-empty";
  empty.textContent = t("trash_empty");
  empty.addEventListener("click", () => emptyTrash(items.length));
  row.appendChild(empty);
  trashList.appendChild(row);
}

function toggleTrash() {
  trashOpen = !trashOpen;
  trashSection.classList.toggle("open", trashOpen);
  trashList.classList.toggle("hidden", !trashOpen);
}

async function restoreTrash(file) {
  try { await api("trash/restore", { file }); }
  catch (err) { await alertModal(err.message); return; }
  refreshFiles();
}

async function deleteForever(file, display) {
  const ok = await askModal({
    message: t("trash_delete_confirm", { name: display }),
    okLabel: t("trash_delete_forever"),
    danger: true,
  });
  if (!ok) return;
  try { await api("trash/delete", { file }); }
  catch (err) { await alertModal(err.message); return; }
  loadTrash();
}

async function emptyTrash(n) {
  const ok = await askModal({
    message: t("trash_empty_confirm", { n }),
    okLabel: t("trash_empty"),
    danger: true,
  });
  if (!ok) return;
  try { await api("trash/empty", {}); }
  catch (err) { await alertModal(err.message); return; }
  loadTrash();
}

function markActive() {
  for (const li of fileList.querySelectorAll("li")) {
    li.classList.toggle("active", li.dataset.name === currentFile);
  }
}

async function openFile(name) {
  if (recording || busy) {
    await alertModal(t("stop_before_switch"));
    return;
  }
  await flushSave();
  try {
    const data = await api("open", { name: name || null });
    currentFile = data.name;
    cm.setValue(data.text);
    dirty = false;
    cm.setOption("readOnly", false);
    btnRecord.disabled = false;
    fileNameEl.textContent = data.name.replace(/\.md$/, "");
    setSaveState("saved");
    updateWordCount();
    markActive();
    if (!name) refreshFiles();
    cm.focus();
    cm.setCursor(cm.lineCount() - 1);
  } catch (err) {
    await alertModal(err.message);
  }
}

async function renameFile() {
  if (!currentFile) return;
  const base = currentFile.replace(/\.md$/, "");
  const entered = await askModal({ message: t("rename_prompt"), input: base, okLabel: t("rename_ok") });
  if (!entered || entered === base) return;
  // Persistir ediciones pendientes en el nombre actual antes de renombrar
  // (se puede renombrar incluso durante la grabación: el servidor lo hace
  // de forma atómica y los segmentos siguen yendo al archivo renombrado).
  await flushSave();
  try {
    const data = await api("rename", { old: currentFile, new: entered });
    currentFile = data.name;
    fileNameEl.textContent = data.name.replace(/\.md$/, "");
    refreshFiles();
  } catch (err) {
    await alertModal(err.message);
  }
}

async function deleteFile(name) {
  const ok = await askModal({
    message: t("delete_confirm", { name: name.replace(/\.md$/, "") }),
    okLabel: t("delete_ok"),
    danger: true,
  });
  if (!ok) return;
  try {
    await api("delete", { name });
    if (name === currentFile) {
      // El archivo abierto ya no existe: se cierra el editor sin tocar nada más.
      currentFile = null;
      dirty = false;
      clearTimeout(saveTimer);
      saveTimer = null;
      cm.setValue("");
      cm.setOption("readOnly", "nocursor");
      btnRecord.disabled = true;
      fileNameEl.textContent = t("no_file");
      setSaveState(null);
      updateWordCount();
    }
    refreshFiles();
  } catch (err) {
    await alertModal(err.message);
  }
}

// ------------------------------------------------------------- guardado
function setSaveState(state) {
  if (state === "saving") {
    saveState.textContent = t("saving");
    saveState.className = "";
  } else if (state === "saved") {
    saveState.textContent = t("saved");
    saveState.className = "saved";
  } else {
    saveState.textContent = "—";
    saveState.className = "";
  }
}

function scheduleSave() {
  if (!currentFile) return;
  setSaveState("saving");
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 700);
}

async function flushSave() {
  clearTimeout(saveTimer);
  saveTimer = null;
  if (!currentFile) return;
  // Sin cambios del usuario → no reescribir (evita bumpear la fecha de
  // modificación y reordenar el archivo en la lista sin motivo).
  if (!dirty) return;
  try {
    await api("save", { name: currentFile, text: cm.getValue() });
    dirty = false;
    setSaveState("saved");
  } catch (err) {
    saveState.textContent = t("save_error");
  }
}

function updateWordCount() {
  const text = cm.getValue().trim();
  const words = text ? text.split(/\s+/).length : 0;
  wordCount.textContent = t("words", { n: words });
}

// ------------------------------------------------------------ grabación
async function toggleRecord() {
  if (recording) {
    btnRecord.disabled = true;
    try { await api("stop", {}); }
    catch (err) { await alertModal(err.message); }
    btnRecord.disabled = false;
    return;
  }
  if (!currentFile) await openFile(null);
  if (!currentFile) return;
  await flushSave(); // el servidor parte del texto más reciente
  btnRecord.disabled = true;
  try {
    const deviceId = deviceSelect.value === "" ? null : Number(deviceSelect.value);
    await api("start", {
      name: currentFile,
      model: modelSelect.value,
      device_id: deviceId,
      language: langSelect.value,
      chunk_seconds: Number(chunkSelect.value),
    });
  } catch (err) {
    await alertModal(err.message);
    setStatus({ state: "idle" });
  }
  btnRecord.disabled = false;
}

function setStatus(st) {
  switch (st.state) {
    case "recording":
      recording = true; busy = false;
      statusPill.textContent = st.pending > 1 ? t("rec_queue", { n: st.pending }) : t("recording");
      statusPill.className = "pill recording";
      break;
    case "transcribing":
      recording = true; busy = false;
      statusPill.textContent = t("rec_transcribing");
      statusPill.className = "pill recording";
      break;
    case "loading_model":
      statusPill.textContent = t("loading_model", { model: st.model });
      statusPill.className = "pill busy";
      break;
    case "finishing":
      recording = false; busy = true;
      statusPill.textContent = t("finishing");
      statusPill.className = "pill busy";
      break;
    case "warning":
      statusPill.textContent = st.message;
      statusPill.className = "pill error";
      return; // no cambia el botón
    case "error":
      recording = false; busy = false;
      statusPill.textContent = st.message || t("error");
      statusPill.className = "pill error";
      break;
    default: // idle
      recording = false; busy = false;
      statusPill.textContent = t("status_idle");
      statusPill.className = "pill idle";
  }
  btnRecord.textContent = recording ? "■ " + t("stop") : "● " + t("record");
  btnRecord.classList.toggle("on", recording);
}

// El texto nuevo siempre se añade al final del documento; CodeMirror
// conserva el cursor y la selección del usuario automáticamente.
function appendSegment(text, trim) {
  const info = cm.getScrollInfo();
  const atBottom = info.height - info.top - info.clientHeight < 80;
  // El servidor retiró un signo espurio al final (p. ej. el punto con el
  // que Whisper cierra cada chunk cuando la frase en realidad continúa).
  // Solo se replica si el documento termina exactamente igual — si el
  // usuario editó el final entretanto, no se toca nada suyo.
  if (trim) {
    const doc = cm.getValue();
    if (doc.endsWith(trim)) {
      cm.replaceRange("", cm.posFromIndex(doc.length - trim.length),
                      cm.posFromIndex(doc.length), "append");
    }
  }
  const last = cm.lineCount() - 1;
  const end = { line: last, ch: cm.getLine(last).length };
  cm.replaceRange(text, end, end, "append");
  if (atBottom) cm.scrollTo(null, cm.getScrollInfo().height);
  setSaveState("saved"); // el servidor ya escribió el archivo
}

// ------------------------------------------------------------ websocket
function connectWS() {
  ws = new WebSocket(`ws://${location.host}/ws`);
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === "segment") appendSegment(msg.text, msg.trim);
    else if (msg.type === "status") setStatus(msg);
  };
  ws.onclose = () => setTimeout(connectWS, 1500);
}

// ------------------------------------------------------------ arranque
async function loadDevices() {
  try {
    const { devices } = await api("devices");
    deviceSelect.innerHTML = "";
    const def = document.createElement("option");
    def.value = "";
    def.textContent = t("default_device");
    deviceSelect.appendChild(def);
    for (const d of devices) {
      const opt = document.createElement("option");
      opt.value = d.id;
      opt.textContent = d.name + (d.default ? t("device_default_suffix") : "");
      deviceSelect.appendChild(opt);
    }
  } catch (err) {
    deviceSelect.innerHTML = "";
    const def = document.createElement("option");
    def.value = "";
    def.textContent = t("default_device");
    deviceSelect.appendChild(def);
  }
}

cm.on("change", (_cm, change) => {
  updateWordCount();
  // Solo guardar por acciones del usuario: los "append" ya los guardó el
  // servidor y "setValue" es la carga inicial del archivo.
  if (change.origin && change.origin !== "setValue" && change.origin !== "append") {
    dirty = true;
    scheduleSave();
  }
});

// ------------------------------------------------------------ donaciones
// PayPal.me para todo el mundo. Montos redondeados por moneda, en la moneda
// local del sistema, con selector para cambiarla (PayPal adapta el enlace).
const CURRENCIES = {
  USD: { symbol: "$", amounts: [5, 10, 20] },
  EUR: { symbol: "€", amounts: [5, 10, 20] },
  GBP: { symbol: "£", amounts: [5, 10, 20] },
  MXN: { symbol: "$", amounts: [100, 200, 500] },
  COP: { symbol: "$", amounts: [20000, 40000, 80000] },
  ARS: { symbol: "$", amounts: [5000, 10000, 20000] },
  CLP: { symbol: "$", amounts: [4000, 8000, 16000] },
  BRL: { symbol: "R$", amounts: [25, 50, 100] },
  CAD: { symbol: "$", amounts: [5, 10, 20] },
  AUD: { symbol: "$", amounts: [5, 10, 20] },
  CHF: { symbol: "Fr", amounts: [5, 10, 20] },
  CNY: { symbol: "¥", amounts: [40, 80, 150] },
  JPY: { symbol: "¥", amounts: [700, 1500, 3000] },
};
// Orden del selector.
const CURRENCY_ORDER = ["USD", "EUR", "GBP", "MXN", "COP", "ARS", "CLP", "BRL", "CAD", "AUD", "CHF", "CNY", "JPY"];
// Región del sistema (subetiqueta de país) → moneda.
const REGION_CURRENCY = {
  US: "USD", GB: "GBP", UK: "GBP", MX: "MXN", CO: "COP", AR: "ARS", CL: "CLP",
  BR: "BRL", CA: "CAD", AU: "AUD", NZ: "AUD", CH: "CHF", CN: "CNY", TW: "CNY",
  JP: "JPY",
  ES: "EUR", FR: "EUR", DE: "EUR", IT: "EUR", PT: "EUR", BE: "EUR", NL: "EUR",
  IE: "EUR", AT: "EUR", FI: "EUR", GR: "EUR", LU: "EUR",
};
// Idioma (cuando no hay país claro) → moneda.
const LANG_CURRENCY = { en: "USD", es: "EUR", fr: "EUR", de: "EUR", it: "EUR", pt: "EUR", zh: "CNY", ja: "JPY" };

function detectCurrency() {
  const locales = navigator.languages && navigator.languages.length
    ? navigator.languages : [navigator.language || ""];
  for (const raw of locales) {
    const parts = (raw || "").split("-");
    if (parts[1]) {
      const cur = REGION_CURRENCY[parts[1].toUpperCase()];
      if (cur) return cur;
    }
  }
  for (const raw of locales) {
    const cur = LANG_CURRENCY[(raw || "").slice(0, 2).toLowerCase()];
    if (cur) return cur;
  }
  return "USD";
}

let donationCfg = { configured: false, signature: "" };
let currency = (() => {
  try {
    const forced = new URLSearchParams(location.search).get("cur");
    if (forced && CURRENCIES[forced.toUpperCase()]) return forced.toUpperCase();
  } catch (e) {}
  const saved = ntPref("donationCurrency");
  if (saved && CURRENCIES[saved]) return saved;
  const d = detectCurrency();
  return CURRENCIES[d] ? d : "USD";
})();

function renderAmounts() {
  const wrap = $("#donate-amounts");
  wrap.innerHTML = "";
  if (!donationCfg.configured) return;
  const cur = CURRENCIES[currency] || CURRENCIES.USD;
  for (const amt of cur.amounts) {
    const b = document.createElement("button");
    b.textContent = `${cur.symbol}${amt.toLocaleString(window.I18N.lang)}`;
    b.addEventListener("click", () => donate(amt));
    wrap.appendChild(b);
  }
  // Monto libre: el donante escribe la cantidad.
  const other = document.createElement("button");
  other.className = "custom";
  other.textContent = t("donate_other");
  other.addEventListener("click", customAmount);
  wrap.appendChild(other);
  // Selector de moneda.
  const sel = $("#donate-currency");
  if (sel.options.length === 0) {
    for (const code of CURRENCY_ORDER) {
      const opt = document.createElement("option");
      opt.value = code;
      opt.textContent = `${code} (${CURRENCIES[code].symbol})`;
      sel.appendChild(opt);
    }
    sel.addEventListener("change", () => {
      currency = sel.value;
      savePref("donationCurrency", currency);
      renderAmounts();
    });
  }
  sel.value = currency;
}

async function loadDonationConfig() {
  try {
    donationCfg = await api("donation/config");
  } catch (e) { donationCfg = { configured: false, signature: "" }; }
  renderAmounts();
}

// mode: "prompt" (mensaje periódico, con refrán y casilla) | "manual" (botón café)
function openDonate(mode) {
  const proverb = $("#donate-proverb");
  const sign = $("#donate-sign");
  const never = $("#donate-never");
  const amounts = $("#donate-amounts");
  const curRow = $("#donate-cur-row");
  const unconfig = $("#donate-unconfig");
  $("#donate-never-cb").checked = false;
  renderAmounts();

  if (mode === "prompt") {
    proverb.textContent = window.I18N.randomProverb();
    proverb.classList.remove("hidden");
    if (donationCfg.signature) {
      sign.textContent = "— " + donationCfg.signature;
      sign.classList.remove("hidden");
    } else {
      sign.classList.add("hidden");
    }
    never.classList.remove("hidden");
    $("#donate-ask").textContent = t("donate_ask_prompt");
  } else {
    proverb.classList.add("hidden");
    sign.classList.add("hidden");
    never.classList.add("hidden");
    $("#donate-ask").textContent = donationCfg.configured ? t("donate_ask_manual") : "";
  }

  amounts.classList.toggle("hidden", !donationCfg.configured);
  curRow.classList.toggle("hidden", !donationCfg.configured);
  unconfig.classList.toggle("hidden", donationCfg.configured);
  $("#donate").classList.remove("hidden");
}

// El mensaje solo deja de aparecer si la persona marca honestamente
// "¡Ya doné!". Como no podemos verificar el pago, no lo ocultamos por el
// simple hecho de haber pulsado un monto: la honestidad es del usuario.
function closeDonate() {
  if ($("#donate-never-cb").checked) {
    api("donation/dismiss", {}).catch(() => {});
  }
  $("#donate").classList.add("hidden");
}

async function customAmount() {
  const entered = await askModal({
    message: t("donate_amount_prompt", { currency }),
    input: "",
    okLabel: t("accept"),
  });
  if (entered === false) return; // cancelado
  const val = parseFloat(String(entered).replace(",", ".").replace(/[^\d.]/g, ""));
  if (!(val > 0)) { await alertModal(t("donate_amount_invalid")); return; }
  donate(val);
}

async function donate(amount) {
  try {
    await api("donation/go", { amount, currency });
  } catch (err) {
    await alertModal(err.message);
    return;
  }
  closeDonate(); // respeta la casilla "¡Ya doné!" si estaba marcada
}

async function maybePromptDonation() {
  if (!donationCfg.configured) return;
  // Mostrar como máximo una vez por apertura de la app. sessionStorage se
  // conserva entre recargas (p. ej. al cambiar de idioma) pero se borra al
  // cerrar la ventana → no reaparece en cada cambio de idioma.
  try { if (sessionStorage.getItem("donationPromptShown")) return; } catch (e) {}
  try {
    const { should_prompt } = await api("donation/state");
    if (should_prompt) {
      try { sessionStorage.setItem("donationPromptShown", "1"); } catch (e) {}
      setTimeout(() => openDonate("prompt"), 1500);
    }
  } catch (e) {}
}

$("#btn-coffee").addEventListener("click", () => openDonate("manual"));
$("#trash-toggle").addEventListener("click", toggleTrash);
$("#donate-x").addEventListener("click", closeDonate);
$("#donate-later").addEventListener("click", closeDonate);
$("#donate").addEventListener("click", (e) => { if (e.target.id === "donate") closeDonate(); });

btnRecord.addEventListener("click", toggleRecord);
$("#btn-new").addEventListener("click", () => openFile(null));
$("#btn-folder").addEventListener("click", () => api("reveal", {}));
fileNameEl.addEventListener("click", renameFile);

// Persistir cada ajuste al cambiarlo (así "siempre se carga la última config").
modelSelect.addEventListener("change", () => savePref("model", modelSelect.value));
langSelect.addEventListener("change", () => savePref("language", langSelect.value));
chunkSelect.addEventListener("change", () => savePref("chunk", chunkSelect.value));

// Selector de idioma de la interfaz (discreto, abajo a la derecha).
document.querySelectorAll("#lang-switch button").forEach((b) => {
  if (b.dataset.lang === window.I18N.lang) b.classList.add("active");
  b.addEventListener("click", () => {
    if (b.dataset.lang !== window.I18N.lang) window.I18N.setLang(b.dataset.lang);
  });
});

window.addEventListener("beforeunload", () => {
  if (currentFile && saveTimer) {
    navigator.sendBeacon(
      "/api/save",
      new Blob([JSON.stringify({ name: currentFile, text: cm.getValue() })],
               { type: "application/json" })
    );
  }
});

const savedModel = ntPref("model");
if (savedModel) modelSelect.value = savedModel;
// Idioma de transcripción: si el usuario nunca lo eligió, se ajusta al idioma
// detectado de la interfaz (si es uno de los soportados por el selector).
const savedLang = ntPref("language");
if (savedLang) {
  langSelect.value = savedLang;
} else if (["es", "en", "fr"].includes(window.I18N.lang)) {
  langSelect.value = window.I18N.lang;
}
const savedChunk = ntPref("chunk");
if (savedChunk) chunkSelect.value = savedChunk;

// Estado inicial del botón de grabación y la píldora de estado.
setStatus({ state: "idle" });
btnRecord.disabled = true;

connectWS();
refreshFiles();
loadDevices();
loadDonationConfig().then(maybePromptDonation);
// La carpeta puede cambiar desde fuera (Finder, otra app): la lista se
// refresca sola periódicamente y al volver a la ventana.
setInterval(refreshFiles, 8000);
window.addEventListener("focus", refreshFiles);
