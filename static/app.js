const $ = (sel) => document.querySelector(sel);
const t = window.I18N.t;

// Aplicar traducciones a los textos estáticos y fijar el idioma del documento.
document.documentElement.lang = window.I18N.lang;
window.I18N.applyStatic();

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
    del.textContent = "🗑";
    del.title = t("delete_title");
    del.addEventListener("click", (e) => { e.stopPropagation(); deleteFile(f.name); });
    li.append(name, date, del);
    li.addEventListener("click", () => openFile(f.name));
    fileList.appendChild(li);
  }
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
  if (recording || busy) {
    await alertModal(t("stop_before_rename"));
    return;
  }
  const base = currentFile.replace(/\.md$/, "");
  const entered = await askModal({ message: t("rename_prompt"), input: base, okLabel: t("rename_ok") });
  if (!entered || entered === base) return;
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
  try {
    await api("save", { name: currentFile, text: cm.getValue() });
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
    scheduleSave();
  }
});

// ------------------------------------------------------------ donaciones
let donationCfg = { configured: false, currency_symbol: "$", amounts: [], custom: false };

function renderAmounts() {
  const wrap = $("#donate-amounts");
  wrap.innerHTML = "";
  const sym = donationCfg.currency_symbol || "$";
  for (const amt of donationCfg.amounts) {
    const b = document.createElement("button");
    b.textContent = `${sym}${amt}`;
    b.addEventListener("click", () => donate(amt));
    wrap.appendChild(b);
  }
  if (donationCfg.custom) {
    const b = document.createElement("button");
    b.className = "custom";
    b.textContent = t("donate_other");
    b.addEventListener("click", () => donate(null));
    wrap.appendChild(b);
  }
}

async function loadDonationConfig() {
  try {
    donationCfg = await api("donation/config");
  } catch (e) { donationCfg = { configured: false, amounts: [], custom: false }; }
  renderAmounts();
}

// mode: "prompt" (mensaje periódico, con refrán y casilla) | "manual" (botón café)
function openDonate(mode) {
  const proverb = $("#donate-proverb");
  const never = $("#donate-never");
  const amounts = $("#donate-amounts");
  const unconfig = $("#donate-unconfig");
  $("#donate-never-cb").checked = false;

  if (mode === "prompt") {
    proverb.textContent = window.I18N.randomProverb();
    proverb.classList.remove("hidden");
    never.classList.remove("hidden");
    $("#donate-ask").textContent = t("donate_ask_prompt");
  } else {
    proverb.classList.add("hidden");
    never.classList.add("hidden");
    $("#donate-ask").textContent = donationCfg.configured ? t("donate_ask_manual") : "";
  }

  if (donationCfg.configured) {
    amounts.classList.remove("hidden");
    unconfig.classList.add("hidden");
  } else {
    amounts.classList.add("hidden");
    unconfig.classList.remove("hidden");
  }
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

async function donate(amount) {
  try {
    await api("donation/go", { amount });
  } catch (err) {
    await alertModal(err.message);
    return;
  }
  closeDonate(); // respeta la casilla "¡Ya doné!" si estaba marcada
}

async function maybePromptDonation() {
  if (!donationCfg.configured) return;
  try {
    const { should_prompt } = await api("donation/state");
    if (should_prompt) setTimeout(() => openDonate("prompt"), 1500);
  } catch (e) {}
}

$("#btn-coffee").addEventListener("click", () => openDonate("manual"));
$("#donate-x").addEventListener("click", closeDonate);
$("#donate-later").addEventListener("click", closeDonate);
$("#donate").addEventListener("click", (e) => { if (e.target.id === "donate") closeDonate(); });

btnRecord.addEventListener("click", toggleRecord);
$("#btn-new").addEventListener("click", () => openFile(null));
$("#btn-folder").addEventListener("click", () => api("reveal", {}));
fileNameEl.addEventListener("click", renameFile);

// Persistir cada ajuste al cambiarlo (así "siempre se carga la última config").
modelSelect.addEventListener("change", () => localStorage.setItem("model", modelSelect.value));
langSelect.addEventListener("change", () => localStorage.setItem("language", langSelect.value));
chunkSelect.addEventListener("change", () => localStorage.setItem("chunk", chunkSelect.value));

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

const savedModel = localStorage.getItem("model");
if (savedModel) modelSelect.value = savedModel;
// Idioma de transcripción: si el usuario nunca lo eligió, se ajusta al idioma
// detectado de la interfaz (si es uno de los soportados por el selector).
const savedLang = localStorage.getItem("language");
if (savedLang) {
  langSelect.value = savedLang;
} else if (["es", "en", "fr"].includes(window.I18N.lang)) {
  langSelect.value = window.I18N.lang;
}
const savedChunk = localStorage.getItem("chunk");
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
