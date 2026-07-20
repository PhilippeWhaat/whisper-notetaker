const $ = (sel) => document.querySelector(sel);

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

let currentFile = null;
let recording = false;
let busy = false; // quedan chunks por transcribir tras detener
let saveTimer = null;
let ws = null;

// -------------------------------------------------------------- diálogo
// Diálogo propio: confirm()/prompt() nativos no son fiables en el webview
// empaquetado. Devuelve false si se cancela; true (o el texto del input) si
// se acepta.
function askModal({ message, input = null, okLabel = "Aceptar", danger = false, cancel = true }) {
  const modal = $("#modal");
  const inputEl = $("#modal-input");
  const okBtn = $("#modal-ok");
  const cancelBtn = $("#modal-cancel");
  $("#modal-msg").textContent = message;
  okBtn.textContent = okLabel;
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
  return new Date(mtime * 1000).toLocaleString("es", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

async function refreshFiles() {
  const { files } = await api("files");
  fileList.innerHTML = "";
  if (!files.length) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "Aún no hay transcripciones.";
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
    del.title = "Enviar a la papelera";
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
    await askModal({ message: "Detén la grabación antes de cambiar de archivo.", okLabel: "Entendido", cancel: false });
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
    await askModal({ message: err.message, okLabel: "Entendido", cancel: false });
  }
}

async function renameFile() {
  if (!currentFile) return;
  if (recording || busy) {
    await askModal({ message: "Detén la grabación antes de renombrar.", okLabel: "Entendido", cancel: false });
    return;
  }
  const base = currentFile.replace(/\.md$/, "");
  const entered = await askModal({ message: "Nuevo nombre del archivo:", input: base, okLabel: "Renombrar" });
  if (!entered || entered === base) return;
  try {
    const data = await api("rename", { old: currentFile, new: entered });
    currentFile = data.name;
    fileNameEl.textContent = data.name.replace(/\.md$/, "");
    refreshFiles();
  } catch (err) {
    await askModal({ message: err.message, okLabel: "Entendido", cancel: false });
  }
}

async function deleteFile(name) {
  const ok = await askModal({
    message: `¿Mover "${name.replace(/\.md$/, "")}" a la papelera? Se conservará en la subcarpeta "Papelera" de tus transcripciones y podrás recuperarlo cuando quieras.`,
    okLabel: "Mover a la papelera",
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
      fileNameEl.textContent = "Sin archivo";
      setSaveState(null);
      updateWordCount();
    }
    refreshFiles();
  } catch (err) {
    await askModal({ message: err.message, okLabel: "Entendido", cancel: false });
  }
}

// ------------------------------------------------------------- guardado
function setSaveState(state) {
  if (state === "saving") {
    saveState.textContent = "Guardando…";
    saveState.className = "";
  } else if (state === "saved") {
    saveState.textContent = "Guardado ✓";
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
    saveState.textContent = "Error al guardar";
  }
}

function updateWordCount() {
  const text = cm.getValue().trim();
  const words = text ? text.split(/\s+/).length : 0;
  wordCount.textContent = `${words} palabras`;
}

// ------------------------------------------------------------ grabación
async function toggleRecord() {
  if (recording) {
    btnRecord.disabled = true;
    try { await api("stop", {}); }
    catch (err) { await askModal({ message: err.message, okLabel: "Entendido", cancel: false }); }
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
    localStorage.setItem("model", modelSelect.value);
    localStorage.setItem("language", langSelect.value);
    localStorage.setItem("chunk", chunkSelect.value);
  } catch (err) {
    await askModal({ message: err.message, okLabel: "Entendido", cancel: false });
    setStatus({ state: "idle" });
  }
  btnRecord.disabled = false;
}

function setStatus(st) {
  switch (st.state) {
    case "recording":
      recording = true; busy = false;
      statusPill.textContent = st.pending > 1 ? `● Grabando (${st.pending} en cola)` : "● Grabando";
      statusPill.className = "pill recording";
      break;
    case "transcribing":
      recording = true; busy = false;
      statusPill.textContent = "● Grabando · transcribiendo…";
      statusPill.className = "pill recording";
      break;
    case "loading_model":
      statusPill.textContent = `Cargando modelo ${st.model}…`;
      statusPill.className = "pill busy";
      break;
    case "finishing":
      recording = false; busy = true;
      statusPill.textContent = "Terminando transcripción…";
      statusPill.className = "pill busy";
      break;
    case "warning":
      statusPill.textContent = st.message;
      statusPill.className = "pill error";
      return; // no cambia el botón
    case "error":
      recording = false; busy = false;
      statusPill.textContent = st.message || "Error";
      statusPill.className = "pill error";
      break;
    default: // idle
      recording = false; busy = false;
      statusPill.textContent = "Listo";
      statusPill.className = "pill idle";
  }
  btnRecord.textContent = recording ? "■ Detener" : "● Grabar";
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
    def.textContent = "Por defecto del sistema";
    deviceSelect.appendChild(def);
    for (const d of devices) {
      const opt = document.createElement("option");
      opt.value = d.id;
      opt.textContent = d.name + (d.default ? " (predeterminado)" : "");
      deviceSelect.appendChild(opt);
    }
  } catch (err) {
    deviceSelect.innerHTML = "<option value=''>Por defecto del sistema</option>";
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

// Refrán absurdo generado al vuelo, distinto cada vez.
function randomProverb() {
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const nP = ["gatos", "molinos", "relojes", "cuervos", "tambores", "faroles",
              "sombreros", "elefantes", "escarabajos", "barcos", "caracoles", "espejos"];
  const aP = ["viejos", "sabios", "dormidos", "distraídos", "tercos", "filósofos",
              "madrugadores", "despistados", "soñadores", "mojados", "puntuales", "curiosos"];
  const conArt = [{ a: "el", n: "molino" }, { a: "la", n: "luna" }, { a: "el", n: "reloj" },
                  { a: "la", n: "tormenta" }, { a: "el", n: "eco" }, { a: "la", n: "niebla" },
                  { a: "el", n: "sombrero" }, { a: "la", n: "cuchara" }, { a: "el", n: "farol" }];
  const conQue = ["paciencia", "un suspiro", "monedas viejas", "buenas intenciones",
                  "café frío", "promesas", "un buen refrán", "humo", "cuentos", "silbidos"];
  const o1 = pick(conArt), o2 = pick(conArt);
  const templates = [
    () => `No es que los ${pick(nP)} ${pick(aP)} siempre se paguen ${o1.a} ${o1.n} con ${pick(conQue)}, pero algo de razón tendrán.`,
    () => `Dicen que ${o1.a} ${o1.n} nunca discute con los ${pick(nP)} ${pick(aP)}, y por algo será.`,
    () => `Más vale ${o1.n} en mano que cien ${pick(nP)} ${pick(aP)} contando ${pick(conQue)}.`,
    () => `Cuando los ${pick(nP)} ${pick(aP)} silban, ${o2.a} ${o2.n} ya guardó ${pick(conQue)}.`,
    () => `No por mucho ${pick(nP.map(w => w.slice(0, -1)))} se llena ${o1.a} ${o1.n} de ${pick(conQue)}.`,
  ];
  return pick(templates)();
}

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
    b.textContent = "Otro monto";
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
    proverb.textContent = randomProverb();
    proverb.classList.remove("hidden");
    never.classList.remove("hidden");
    $("#donate-ask").textContent = "Si esta pequeña herramienta te sirve, un aporte me ayuda muchísimo. ¡Gracias! 🙏";
  } else {
    proverb.classList.add("hidden");
    never.classList.add("hidden");
    $("#donate-ask").textContent = donationCfg.configured
      ? "¡Gracias por considerarlo! Elige un monto:"
      : "";
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
    await askModal({ message: err.message, okLabel: "Entendido", cancel: false });
    return;
  }
  $("#donate").classList.add("hidden");
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
const savedLang = localStorage.getItem("language");
if (savedLang) langSelect.value = savedLang;
const savedChunk = localStorage.getItem("chunk");
if (savedChunk) chunkSelect.value = savedChunk;

connectWS();
refreshFiles();
loadDevices();
loadDonationConfig().then(maybePromptDonation);
// La carpeta puede cambiar desde fuera (Finder, otra app): la lista se
// refresca sola periódicamente y al volver a la ventana.
setInterval(refreshFiles, 8000);
window.addEventListener("focus", refreshFiles);
