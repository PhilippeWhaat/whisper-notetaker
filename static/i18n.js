// Internacionalización de la interfaz. Detecta el idioma del sistema:
// familia francesa (fr*) → francés, familia española (es*) → español,
// cualquier otra → inglés por defecto. Se aplica antes de arrancar la app.
(function () {
  const T = {
    es: {
      new_transcription: "+ Nueva transcripción",
      model_label: "Modelo",
      model_tiny: "tiny — muy rápido",
      model_base: "base — rápido",
      model_small: "small — rápido y preciso",
      model_medium: "medium — recomendado",
      mic_label: "Micrófono",
      lang_label: "Idioma",
      chunk_label: "Fragmentos",
      open_folder: "📁 Abrir carpeta",
      coffee: "Invítame un café",
      coffee_title: "Apoya esta herramienta",
      no_file: "Sin archivo",
      rename_hint: "Clic para renombrar",
      status_idle: "Listo",
      record: "Grabar",
      stop: "Detener",
      editor_ph: "Abre o crea una transcripción y pulsa Grabar. Puedes editar el texto mientras se transcribe — con formato markdown en vivo: # Título, **negrita**, _cursiva_…",
      donate_close: "Cerrar",
      donate_unconfig: "Las donaciones aún no están disponibles.",
      donate_already: "¡Ya doné! No volver a mostrar",
      later: "Ahora no",
      delete_title: "Enviar a la papelera",
      no_files: "Aún no hay transcripciones.",
      understood: "Entendido",
      stop_before_switch: "Detén la grabación antes de cambiar de archivo.",
      stop_before_rename: "Detén la grabación antes de renombrar.",
      rename_prompt: "Nuevo nombre del archivo:",
      rename_ok: "Renombrar",
      delete_confirm: '¿Mover "{name}" a la papelera? Se conservará en la subcarpeta "Papelera" de tus transcripciones y podrás recuperarlo cuando quieras.',
      delete_ok: "Mover a la papelera",
      saving: "Guardando…",
      saved: "Guardado ✓",
      save_error: "Error al guardar",
      words: "{n} palabras",
      rec_queue: "● Grabando ({n} en cola)",
      recording: "● Grabando",
      rec_transcribing: "● Grabando · transcribiendo…",
      loading_model: "Cargando modelo {model}…",
      finishing: "Terminando transcripción…",
      error: "Error",
      default_device: "Por defecto del sistema",
      device_default_suffix: " (predeterminado)",
      donate_ask_prompt: "Si esta pequeña herramienta te sirve, un aporte me ayuda muchísimo. ¡Gracias! 🙏",
      donate_ask_manual: "¡Gracias por considerarlo! Elige un monto:",
      donate_other: "Otro monto",
      cancel: "Cancelar",
      accept: "Aceptar",
    },
    en: {
      new_transcription: "+ New transcription",
      model_label: "Model",
      model_tiny: "tiny — very fast",
      model_base: "base — fast",
      model_small: "small — fast and accurate",
      model_medium: "medium — recommended",
      mic_label: "Microphone",
      lang_label: "Language",
      chunk_label: "Chunks",
      open_folder: "📁 Open folder",
      coffee: "Buy me a coffee",
      coffee_title: "Support this tool",
      no_file: "No file",
      rename_hint: "Click to rename",
      status_idle: "Ready",
      record: "Record",
      stop: "Stop",
      editor_ph: "Open or create a transcription and press Record. You can edit the text while it transcribes — with live markdown: # Heading, **bold**, _italic_…",
      donate_close: "Close",
      donate_unconfig: "Donations are not available yet.",
      donate_already: "I already donated — don't show again",
      later: "Not now",
      delete_title: "Move to trash",
      no_files: "No transcriptions yet.",
      understood: "Got it",
      stop_before_switch: "Stop recording before switching files.",
      stop_before_rename: "Stop recording before renaming.",
      rename_prompt: "New file name:",
      rename_ok: "Rename",
      delete_confirm: 'Move "{name}" to the trash? It will be kept in the "Papelera" subfolder of your transcriptions and you can restore it anytime.',
      delete_ok: "Move to trash",
      saving: "Saving…",
      saved: "Saved ✓",
      save_error: "Save error",
      words: "{n} words",
      rec_queue: "● Recording ({n} queued)",
      recording: "● Recording",
      rec_transcribing: "● Recording · transcribing…",
      loading_model: "Loading {model} model…",
      finishing: "Finishing transcription…",
      error: "Error",
      default_device: "System default",
      device_default_suffix: " (default)",
      donate_ask_prompt: "If this little tool helps you, a small contribution means a lot. Thank you! 🙏",
      donate_ask_manual: "Thanks for considering it! Pick an amount:",
      donate_other: "Other amount",
      cancel: "Cancel",
      accept: "OK",
    },
    fr: {
      new_transcription: "+ Nouvelle transcription",
      model_label: "Modèle",
      model_tiny: "tiny — très rapide",
      model_base: "base — rapide",
      model_small: "small — rapide et précis",
      model_medium: "medium — recommandé",
      mic_label: "Microphone",
      lang_label: "Langue",
      chunk_label: "Fragments",
      open_folder: "📁 Ouvrir le dossier",
      coffee: "Offre-moi un café",
      coffee_title: "Soutiens cet outil",
      no_file: "Aucun fichier",
      rename_hint: "Cliquer pour renommer",
      status_idle: "Prêt",
      record: "Enregistrer",
      stop: "Arrêter",
      editor_ph: "Ouvre ou crée une transcription et appuie sur Enregistrer. Tu peux modifier le texte pendant la transcription — avec du markdown en direct : # Titre, **gras**, _italique_…",
      donate_close: "Fermer",
      donate_unconfig: "Les dons ne sont pas encore disponibles.",
      donate_already: "J'ai déjà fait un don — ne plus afficher",
      later: "Plus tard",
      delete_title: "Mettre à la corbeille",
      no_files: "Aucune transcription pour l'instant.",
      understood: "Compris",
      stop_before_switch: "Arrête l'enregistrement avant de changer de fichier.",
      stop_before_rename: "Arrête l'enregistrement avant de renommer.",
      rename_prompt: "Nouveau nom du fichier :",
      rename_ok: "Renommer",
      delete_confirm: 'Mettre « {name} » à la corbeille ? Le fichier sera conservé dans le sous-dossier « Papelera » de tes transcriptions et tu pourras le récupérer à tout moment.',
      delete_ok: "Mettre à la corbeille",
      saving: "Enregistrement…",
      saved: "Enregistré ✓",
      save_error: "Erreur d'enregistrement",
      words: "{n} mots",
      rec_queue: "● Enregistrement ({n} en file)",
      recording: "● Enregistrement",
      rec_transcribing: "● Enregistrement · transcription…",
      loading_model: "Chargement du modèle {model}…",
      finishing: "Fin de la transcription…",
      error: "Erreur",
      default_device: "Par défaut du système",
      device_default_suffix: " (par défaut)",
      donate_ask_prompt: "Si ce petit outil t'est utile, un petit don m'aide énormément. Merci ! 🙏",
      donate_ask_manual: "Merci d'y penser ! Choisis un montant :",
      donate_other: "Autre montant",
      cancel: "Annuler",
      accept: "OK",
    },
  };

  function pickLang() {
    // Override opcional: ?lang=es|en|fr (útil para probar o forzar idioma).
    try {
      const forced = new URLSearchParams(location.search).get("lang");
      if (forced && T[forced]) return forced;
    } catch (e) {}
    const langs = (navigator.languages && navigator.languages.length)
      ? navigator.languages : [navigator.language || "en"];
    for (const raw of langs) {
      const p = (raw || "").toLowerCase();
      if (p.startsWith("fr")) return "fr";   // fr, fr-CA, fr-BE…
      if (p.startsWith("es")) return "es";   // es, es-MX, es-CL…
      if (p.startsWith("en")) return "en";
    }
    return "en"; // ni francés ni español → inglés
  }

  const lang = pickLang();

  function t(key, params) {
    let s = (T[lang] && T[lang][key]) || T.en[key] || key;
    if (params) {
      for (const k in params) s = s.split("{" + k + "}").join(params[k]);
    }
    return s;
  }

  function applyStatic(root) {
    root = root || document;
    root.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.getAttribute("data-i18n")); });
    root.querySelectorAll("[data-i18n-title]").forEach((el) => { el.title = t(el.getAttribute("data-i18n-title")); });
    root.querySelectorAll("[data-i18n-ph]").forEach((el) => { el.placeholder = t(el.getAttribute("data-i18n-ph")); });
  }

  // Refrán absurdo generado al vuelo, en el idioma de la interfaz.
  function randomProverb() {
    const pick = (a) => a[Math.floor(Math.random() * a.length)];
    if (lang === "fr") {
      const nP = ["chats", "moulins", "horloges", "corbeaux", "tambours", "lanternes", "chapeaux", "éléphants", "escargots", "miroirs"];
      const aP = ["vieux", "sages", "endormis", "distraits", "têtus", "philosophes", "matinaux", "maladroits", "rêveurs", "curieux"];
      const art = [{ a: "le ", n: "moulin" }, { a: "la ", n: "lune" }, { a: "l'", n: "horloge" }, { a: "la ", n: "tempête" }, { a: "l'", n: "écho" }, { a: "le ", n: "chapeau" }];
      const st = ["de la patience", "un soupir", "de vieilles pièces", "de bonnes intentions", "du café froid", "des promesses", "un bon proverbe", "de la fumée"];
      const o = pick(art);
      return pick([
        () => `On dit que ${o.a}${o.n} ne discute jamais avec les ${pick(nP)} ${pick(aP)}, et ce n'est pas pour rien.`,
        () => `Quand les ${pick(nP)} ${pick(aP)} sifflent, ${o.a}${o.n} a déjà rangé ${pick(st)}.`,
        () => `Ce n'est pas que les ${pick(nP)} ${pick(aP)} paient toujours ${o.a}${o.n} avec ${pick(st)}, mais ils ont peut-être raison.`,
      ])();
    }
    if (lang === "en") {
      const nP = ["cats", "windmills", "clocks", "crows", "drums", "lanterns", "hats", "elephants", "snails", "mirrors"];
      const aP = ["old", "wise", "sleepy", "distracted", "stubborn", "philosophical", "early-rising", "clumsy", "dreamy", "curious"];
      const n = ["windmill", "moon", "clock", "storm", "echo", "hat", "lantern"];
      const st = ["patience", "a sigh", "old coins", "good intentions", "cold coffee", "promises", "a good proverb", "smoke"];
      const one = pick(n);
      return pick([
        () => `They say the ${one} never argues with ${pick(aP)} ${pick(nP)}, and for good reason.`,
        () => `When ${pick(aP)} ${pick(nP)} whistle, the ${one} has already hidden its ${pick(st)}.`,
        () => `It's not that ${pick(aP)} ${pick(nP)} always pay for the ${one} with ${pick(st)}, but they may have a point.`,
      ])();
    }
    // español
    const nP = ["gatos", "molinos", "relojes", "cuervos", "tambores", "faroles", "sombreros", "elefantes", "escarabajos", "barcos", "caracoles", "espejos"];
    const aP = ["viejos", "sabios", "dormidos", "distraídos", "tercos", "filósofos", "madrugadores", "despistados", "soñadores", "mojados", "puntuales", "curiosos"];
    const art = [{ a: "el", n: "molino" }, { a: "la", n: "luna" }, { a: "el", n: "reloj" }, { a: "la", n: "tormenta" }, { a: "el", n: "eco" }, { a: "la", n: "niebla" }, { a: "el", n: "sombrero" }, { a: "la", n: "cuchara" }, { a: "el", n: "farol" }];
    const st = ["paciencia", "un suspiro", "monedas viejas", "buenas intenciones", "café frío", "promesas", "un buen refrán", "humo", "cuentos", "silbidos"];
    const o1 = pick(art), o2 = pick(art);
    return pick([
      () => `No es que los ${pick(nP)} ${pick(aP)} siempre se paguen ${o1.a} ${o1.n} con ${pick(st)}, pero algo de razón tendrán.`,
      () => `Dicen que ${o1.a} ${o1.n} nunca discute con los ${pick(nP)} ${pick(aP)}, y por algo será.`,
      () => `Cuando los ${pick(nP)} ${pick(aP)} silban, ${o2.a} ${o2.n} ya guardó ${pick(st)}.`,
    ])();
  }

  window.I18N = { lang, t, applyStatic, randomProverb };
})();
