/* =======================================================================================
   AI News App — Frontend (serverless-friendly, robust SpeechRecognition + TTS)
   ---------------------------------------------------------------------------------------
   - Do NOT put API keys here. GNews/Gemini calls go through /api/gnews and /api/gemini.
   - Stronger Speak button behavior:
       • HTTPS origin check
       • Mic permission preflight (getUserMedia)
       • Resilient RESTART loop (no runaway restarts)
       • Pause/Resume/Stop safe-guards
       • Visible mic status + toasts
       • TTS voice matching + cancel before new utterances
   - Fully compatible with your existing HTML/CSS.
   ======================================================================================= */

/* =========================
   CONFIG (serverless-friendly)
   ========================= */
// Model name only; keys live on serverless.
const GEMINI_MODEL = "gemini-1.5-flash-latest";

// Minimal LANGS guard so localize() can read it safely
// (If you already define LANGS elsewhere, this will just be harmless.)
/* eslint-disable no-var */ // allow browser globals if bundlers add ESLint
var LANGS = typeof LANGS !== "undefined" ? LANGS : { "en-US": { lang: "en" } };
/* eslint-enable no-var */

/* =========================
   ENGLISH INTENTS ONLY
   ========================= */
const INTENTS = {
  latest: ["latest news", "headlines", "breaking news", "top news"],
  categories: {
    business: ["business"],
    entertainment: ["entertainment"],
    general: ["general"],
    health: ["health"],
    science: ["science"],
    sports: ["sports", "cricket", "football"],
    technology: ["technology"],
  },
};

/* For yes/no confirmation */
const YES_WORDS = ["yes", "yeah", "yup", "sure", "ok", "okay", "affirmative", "please"];
const NO_WORDS = ["no", "nope", "nah", "negative", "cancel"];

/* =========================
   DOM (safe refs)
   ========================= */
const startBtn = document.getElementById("start-btn");
const pauseBtn = document.getElementById("pause-btn");
const stopBtn = document.getElementById("stop-btn");

const newsContainer = document.getElementById("news-container");
const micBadge = document.getElementById("mic-status");
const toastEl = document.getElementById("toast");
const spokenBox = document.getElementById("spoken-text");

/* =========================
   STATE
   ========================= */
let recognition = null;
let currentArticles = [];
let isListening = false;
let isPaused = false;
let currentLangKey = "en-US";

/* Ask-to-read state */
let awaitingReadConfirm = false;
let pendingReadText = "";

/* TTS voice matching */
let ttsVoice = null;

/* Speech restart guard */
let allowAutoRestart = true;
let lastEndAt = 0;
let restartTimer = null;

/* Page visibility (avoid restarting while hidden) */
let isPageHidden = false;

/* =========================
   UTILS — Toasts / Badges / SafeTimers
   ========================= */
function toast(msg, ms = 2000) {
  if (!toastEl) {
    alert(msg);
    return;
  }
  toastEl.textContent = msg;
  toastEl.classList.remove("hidden");
  toastEl.style.display = "block";
  setTimeout(() => {
    toastEl.classList.add("hidden");
    toastEl.style.display = "none";
  }, ms);
}
function setMic(state) {
  if (!micBadge) return;
  micBadge.classList.remove("idle", "live", "paused");
  micBadge.classList.add(state);
  micBadge.textContent =
    state === "live" ? "● listening" : state === "paused" ? "● paused" : "● idle";
}
function safeClearTimer(t) {
  if (t) {
    clearTimeout(t);
  }
}
function isSecureContext() {
  // localhost is treated secure by browsers
  return window.isSecureContext || location.protocol === "https:" || location.hostname === "localhost";
}

/* =========================
   TTS — Voices / Speak / Cancel
   ========================= */
function refreshVoices() {
  try {
    const voices = speechSynthesis.getVoices() || [];
    const langPrefix = currentLangKey.split("-")[0].toLowerCase();
    ttsVoice =
      voices.find((v) => (v.lang || "").toLowerCase().startsWith(langPrefix)) || null;
  } catch (e) {
    // ignore
  }
}

if (typeof speechSynthesis !== "undefined") {
  try {
    speechSynthesis.onvoiceschanged = refreshVoices;
  } catch {}
  refreshVoices();
}

function speak(text) {
  try {
    // Cancel any pending speech first (prevents queueing/overlap on rapid calls)
    if (speechSynthesis && speechSynthesis.speaking) {
      speechSynthesis.cancel();
    }
    const u = new SpeechSynthesisUtterance(text);
    u.lang = currentLangKey;
    if (ttsVoice) u.voice = ttsVoice;
    speechSynthesis.speak(u);
  } catch {
    // ignore
  }
}
function stopSpeaking() {
  try {
    if (speechSynthesis && (speechSynthesis.speaking || speechSynthesis.pending)) {
      speechSynthesis.cancel();
    }
  } catch {}
}

/* =========================
   PERMISSIONS / PREFLIGHT
   ========================= */
async function ensureMicPermission() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error("MediaDevices not available");
  }
  // Only ask if not already granted
  const permStatus = await navigator.permissions
    ?.query({ name: "microphone" })
    .catch(() => null);
  if (permStatus && permStatus.state === "granted") return true;

  // Request single stream then stop immediately (preflight)
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  stream.getTracks().forEach((t) => t.stop());
  return true;
}

/* =========================
   SPEECH RECOGNITION INIT
   ========================= */
function buildRecognition() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return null;
  const r = new SR();
  r.lang = currentLangKey;
  r.interimResults = false; // final results only (stable UX)
  r.continuous = true;
  r.maxAlternatives = 1;
  return r;
}

/* =========================
   SPEECH EVENT WIRING
   ========================= */
function wireRecognitionEvents() {
  if (!recognition) return;

  recognition.onstart = () => {
    setMic("live");
    allowAutoRestart = true;
    // Visual hint
    if (startBtn) startBtn.innerHTML = '<p class="content">🎙 Listening...</p>';
    // UX cue
    // playSound("start"); // optional if you have mp3
  };

  recognition.onresult = (event) => {
    try {
      const res = event.results[event.results.length - 1];
      const speechResult = (res && res[0] && res[0].transcript) ? String(res[0].transcript) : "";
      const cleaned = speechResult.toLowerCase().trim();
      if (spokenBox) spokenBox.value = cleaned;
      console.log("Heard:", cleaned);

      // Handle pending read confirm
      if (awaitingReadConfirm) {
        if (isAffirmative(cleaned)) {
          if (pendingReadText) speak(pendingReadText);
          resetReadConfirm();
        } else if (isNegative(cleaned)) {
          speak(localize("ok"));
          resetReadConfirm();
        }
        return;
      }

      // Global voice commands
      if (cleaned.includes("stop listening") || cleaned === "stop") {
        stopListening();
        return;
      }
      if (cleaned.includes("pause listening")) {
        isPaused = true;
        setMic("paused");
        if (pauseBtn) pauseBtn.textContent = "▶️ Resume";
        speak(localize("paused_long"));
        return;
      }
      if (cleaned.includes("resume listening")) {
        isPaused = false;
        setMic("live");
        if (pauseBtn) pauseBtn.textContent = "⏸️ Pause";
        speak(localize("resumed"));
        return;
      }
      if (isPaused) return;

      // Content commands
      if (cleaned.includes("read the headlines")) {
        readHeadlines();
        return;
      }

      const sumMatch = cleaned.match(/summarize (article )?(\d+)/);
      if (sumMatch) {
        const idx = parseInt(sumMatch[2], 10) - 1;
        summarizeArticle(idx);
        return;
      }

      if (
        cleaned.match(/(select|open)\s*\d+/) ||
        cleaned.match(/\b(one|two|three|four|five|six|seven|eight|nine|ten)\b/)
      ) {
        handleSelection(cleaned);
        return;
      }

      if (
        INTENTS.latest.some((k) => cleaned.includes(k)) ||
        Object.values(INTENTS.categories).some((cat) =>
          cat.some((k) => cleaned.includes(k))
        ) ||
        cleaned.includes("news")
      ) {
        handleCommand(cleaned);
        return;
      }

      toast(
        "❌ Command not recognized. Try: 'latest news', 'read the headlines', 'summarize 2', or 'open 3'."
      );
    } catch (err) {
      console.error("onresult error:", err);
    }
  };

  recognition.onerror = (event) => {
    console.error("Speech recognition error:", event.error);
    // Common errors to surface:
    if (event.error === "not-allowed" || event.error === "service-not-allowed") {
      toast("🎤 Mic permission denied. Enable microphone access in your browser settings.");
      stopListening(true);
      return;
    }
    if (event.error === "no-speech") {
      toast("🤐 No speech detected.");
      return;
    }
    if (event.error === "aborted") {
      // benign — happens on stop()
      return;
    }
    toast("🎤 Mic error: " + event.error);
  };

  recognition.onend = () => {
    // Called when the engine naturally ends or on stop()
    lastEndAt = Date.now();
    setMic("idle");
    if (startBtn) startBtn.innerHTML = '<p class="content">🎤 Speak</p>';

    // Guarded auto-restart: only when user is listening, not paused, page visible, and short gap
    if (isListening && !isPaused && allowAutoRestart && !isPageHidden) {
      safeClearTimer(restartTimer);
      restartTimer = setTimeout(() => {
        try {
          recognition && recognition.start();
        } catch (e) {
          console.warn("Restart failed:", e);
        }
      }, 350); // small debounce to avoid thrash
    }
  };
}

/* =========================
   LIFECYCLE — Start / Pause / Resume / Stop
   ========================= */
async function startListening() {
  if (isListening) return;

  // Basic HTTPS check — SpeechRecognition needs secure origins on most browsers
  if (!isSecureContext()) {
    toast("⚠️ Use HTTPS (or localhost) for microphone access.");
    return;
  }

  // Ensure SpeechRecognition support
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    toast("❌ Speech Recognition not supported in this browser.");
    return;
  }

  // Mic permission preflight (shows permission prompt on first use)
  try {
    await ensureMicPermission();
  } catch (e) {
    console.error("Mic preflight failed:", e);
    toast("🎤 Please allow microphone access.");
    return;
  }

  // Build (or rebuild) recognition if missing
  if (!recognition) {
    recognition = buildRecognition();
    if (!recognition) {
      toast("❌ Unable to initialize Speech Recognition.");
      return;
    }
    wireRecognitionEvents();
  }

  // Update flags + UI
  isListening = true;
  isPaused = false;
  allowAutoRestart = true;
  setMic("live");
  if (startBtn) startBtn.innerHTML = '<p class="content">🎙 Listening...</p>';

  // Start engine
  try {
    recognition.start();
  } catch (err) {
    console.error("recognition.start() failed:", err);
    toast("🎤 Could not start mic: " + err.message);
    isListening = false;
    setMic("idle");
  }
}

function pauseListening() {
  if (!isListening) {
    toast("Start listening first.");
    return;
  }
  if (isPaused) {
    // resume
    isPaused = false;
    setMic("live");
    if (pauseBtn) pauseBtn.textContent = "⏸️ Pause";
    speak(localize("resumed"));
    // restart recognition if needed
    try {
      recognition && recognition.start();
    } catch (e) {
      // if already running this may throw — ignore
    }
    return;
  }
  // pause
  isPaused = true;
  setMic("paused");
  if (pauseBtn) pauseBtn.textContent = "▶️ Resume";
  speak(localize("paused"));
  try {
    allowAutoRestart = false;
    recognition && recognition.stop();
  } catch {}
}

function stopListening(silent = false) {
  isListening = false;
  isPaused = false;
  awaitingReadConfirm = false;
  pendingReadText = "";
  allowAutoRestart = false;
  safeClearTimer(restartTimer);

  try {
    recognition && recognition.stop();
  } catch {}
  setMic("idle");
  if (startBtn) startBtn.innerHTML = '<p class="content">🎤 Speak</p>';
  if (pauseBtn) pauseBtn.textContent = "⏸️ Pause";
  if (!silent) {
    // playSound("stop");
  }
  stopSpeaking();
  console.log("Stopped listening");
}

/* =========================
   BUTTON WIRING
   ========================= */
if (startBtn) {
  startBtn.addEventListener("click", () => {
    startListening();
  });
}
if (pauseBtn) {
  pauseBtn.addEventListener("click", () => {
    pauseListening();
  });
}
if (stopBtn) {
  stopBtn.addEventListener("click", () => {
    stopListening();
  });
}

/* Page visibility — don’t auto-restart while hidden */
document.addEventListener("visibilitychange", () => {
  isPageHidden = document.hidden;
  if (isPageHidden) {
    // suspend auto-restart
    allowAutoRestart = false;
    try {
      recognition && recognition.stop();
    } catch {}
    setMic("idle");
  } else {
    // resume if user was listening
    if (isListening && !isPaused) {
      allowAutoRestart = true;
      try {
        recognition && recognition.start();
      } catch (e) {
        // may already be running
      }
    }
  }
});

/* =========================
   NEWS FETCH (GNews via serverless)
   ========================= */
function handleCommand(command) {
  const lang = "en";
  const country = "us";

  let url = "";
  const categories = [
    "business",
    "entertainment",
    "general",
    "health",
    "science",
    "sports",
    "technology",
  ];
  const sources = ["cnn", "bbc", "wired", "time", "ign", "buzzfeed", "abc"];

  // Build GNews URLs WITHOUT token (serverless adds it)
  if (INTENTS.latest.some((k) => command.includes(k))) {
    url = `https://gnews.io/api/v4/top-headlines?lang=${lang}&country=${country}&max=10`;
  }

  if (!url && command.includes("news from")) {
    let foundSource = sources.find((src) => command.includes(src));
    if (foundSource)
      url = `https://gnews.io/api/v4/top-headlines?source=${foundSource}&lang=${lang}&country=${country}&max=10`;
  }

  if (!url) {
    for (let cat of categories) {
      const hit = INTENTS.categories[cat].some((k) => command.includes(k));
      if (hit) {
        url = `https://gnews.io/api/v4/top-headlines?category=${cat}&lang=${lang}&country=${country}&max=10`;
        break;
      }
    }
  }

  if (
    !url &&
    (command.includes("about") ||
      command.includes("on") ||
      command.includes("for") ||
      command.includes("regarding"))
  ) {
    let term = command.replace(/news|about|on|for|regarding/gi, "").trim();
    if (term) {
      url = `https://gnews.io/api/v4/search?q=${encodeURIComponent(
        term
      )}&lang=${lang}&country=${country}&max=10`;
    }
  }

  if (url) fetchNewsByUrl(url);
  else
    toast(
      "❌ Sorry, I couldn't understand. Try 'latest news', 'technology news', or 'news about bitcoin'."
    );
}

async function fetchNewsByUrl(url) {
  newsContainer.innerHTML = '<p style="padding:10px;">Loading news...</p>';
  newsContainer.style.display = "grid";
  newsContainer.style.gridTemplateColumns = "repeat(2, minmax(0, 1fr))";
  newsContainer.style.gap = "16px";

  try {
    // Call your serverless proxy instead of hitting GNews directly
    const res = await fetch(`/api/gnews?url=${encodeURIComponent(url)}`);
    if (!res.ok) throw new Error(`GNews proxy error: ${res.status}`);
    const data = await res.json();

    if (!data.articles || data.articles.length === 0) {
      newsContainer.innerHTML = '<p style="padding:10px;">No news articles found.</p>';
      speak(localize("no_news"));
      return;
    }

    currentArticles = data.articles;
    renderNewsArticles(currentArticles);
    speak(`Fetched ${currentArticles.length} articles.`);
    setTimeout(() => newsContainer.scrollIntoView({ behavior: "smooth" }), 200);
  } catch (err) {
    console.error("Error fetching news:", err);
    newsContainer.innerHTML =
      '<p style="padding:10px;">Error fetching news. Try again later.</p>';
    speak(localize("error_news"));
  }
}

/* =========================
   RENDER — News Cards + AI Tools
   ========================= */
function renderNewsArticles(articles) {
  newsContainer.innerHTML = "";
  // enforce 2 per row grid each time (in case external CSS overwrites)
  newsContainer.style.display = "grid";
  newsContainer.style.gridTemplateColumns = "repeat(2, minmax(0, 1fr))";
  newsContainer.style.gap = "16px";

  articles.forEach((article, index) => {
    const articleDiv = document.createElement("div");
    articleDiv.className = "article";
    articleDiv.dataset.index = index;
    articleDiv.style.cssText = `
      background:#fff;border-radius:10px;box-shadow:0 2px 6px rgba(0,0,0,0.08);
      padding:12px;display:flex;flex-direction:column;gap:8px;
    `;

    const safeTitle = escapeHtml(article.title || "");
    const safeDesc = escapeHtml(article.description || "");
    const safeSource = escapeHtml(article.source?.name || "");
    const imgHtml = article.image
      ? `<img src="${article.image}" alt="Image" style="width:100%;height:160px;object-fit:cover;border-radius:8px;"/>`
      : "";

    articleDiv.innerHTML = `
      <h3 style="margin:0;font-size:16px;line-height:1.35;">${index + 1}. ${safeTitle}</h3>
      <p style="margin:0;color:#333;font-size:14px;">${safeDesc}</p>
      ${imgHtml}
      <p class="small-muted" style="margin:0;color:#777;font-size:12px;">${
        safeSource ? "Source: " + safeSource : ""
      }</p>
      <a href="${article.url}" target="_blank" rel="noopener" style="margin-top:4px;font-size:14px;">Read More</a>

      <!-- AI tools -->
      <div class="ai-tools" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px;">
        <button class="ai-btn" data-act="summary" data-i="${index}">Summarize</button>
        <button class="ai-btn" data-act="points" data-i="${index}">Key Points</button>
        <button class="ai-btn" data-act="sentiment" data-i="${index}">Sentiment</button>
      </div>
      <div class="ai-ask" style="display:flex;gap:8px;margin-top:6px;">
        <input class="ai-input" id="ask-${index}" placeholder="Ask AI about this article..." style="flex:1;padding:6px 8px;"/>
        <button class="ai-btn" data-act="ask" data-i="${index}">Ask</button>
      </div>
      <div class="ai-output" id="out-${index}" style="display:none;background:#fafafa;border:1px solid #eee;border-radius:8px;padding:8px;">
        <span class="label" style="font-weight:600;font-size:12px;color:#555;">AI</span>
        <div class="content" style="font-size:14px;margin-top:4px;"></div>
      </div>
    `;

    newsContainer.appendChild(articleDiv);
  });

  // Wire AI buttons
  newsContainer.querySelectorAll(".ai-btn").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      const i = parseInt(e.currentTarget.dataset.i, 10);
      const act = e.currentTarget.dataset.act;
      if (act === "summary") await summarizeArticle(i);
      if (act === "points") await keyPoints(i);
      if (act === "sentiment") await sentiment(i);
      if (act === "ask") {
        const q = (document.getElementById(`ask-${i}`)?.value || "").trim();
        if (!q) {
          toast("Type a question for AI first.");
          return;
        }
        await askArticle(i, q);
      }
    });
  });
}

/* =========================
   OPEN / READ
   ========================= */
function handleSelection(command) {
  // Support numbers: digits, English words, basic Hindi words
  const numberMapEn = {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
  };
  const numberMapHi = {
    एक: 1,
    दो: 2,
    तीन: 3,
    चार: 4,
    पांच: 5,
    छह: 6,
    सात: 7,
    आठ: 8,
    नौ: 9,
    दस: 10,
  };

  let indices = [];

  const numMatches = command.match(/\d+/g);
  if (numMatches) indices.push(...numMatches.map((n) => parseInt(n, 10) - 1));

  for (let word in numberMapEn) if (command.includes(word)) indices.push(numberMapEn[word] - 1);
  for (let word in numberMapHi) if (command.includes(word)) indices.push(numberMapHi[word] - 1);

  indices = [...new Set(indices)].filter((i) => currentArticles[i]);

  if (indices.length > 0) {
    // Only act on the first valid index in this command
    const i = indices[0];
    const article = currentArticles[i];

    // Open in a new tab now
    window.open(article.url, "_blank", "noopener,noreferrer");

    // Ask to read the headline (localized)
    pendingReadText = article.title || "";
    awaitingReadConfirm = true;
    speak(localize("ask_read"));
  } else {
    speak(localize("invalid_selection"));
  }
}

function resetReadConfirm() {
  awaitingReadConfirm = false;
  pendingReadText = "";
}

function isAffirmative(text) {
  return YES_WORDS.some((w) => text.includes(w.toLowerCase()));
}
function isNegative(text) {
  return NO_WORDS.some((w) => text.includes(w.toLowerCase()));
}

function readHeadlines() {
  if (currentArticles.length === 0) {
    speak(localize("no_news"));
    return;
  }
  // read titles with small spacing
  (async () => {
    for (let i = 0; i < currentArticles.length; i++) {
      const a = currentArticles[i];
      speak(`${i + 1}. ${a.title}`);
      await new Promise((r) => setTimeout(r, 600)); // brief gap between items
    }
  })();
}

/* =========================
   GEMINI HELPERS (via serverless)
   ========================= */
async function callGemini(prompt) {
  const body = {
    model: GEMINI_MODEL,
    prompt,
    // keep your original safety settings semantics; serverless can use/ignore
    safetySettings: [
      { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
    ],
  };

  const res = await fetch("/api/gemini", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) throw new Error("Gemini error: " + res.status);
  const data = await res.json();

  // Support either a simplified {text} shape OR the raw Gemini {candidates} shape.
  if (typeof data.text === "string" && data.text.trim()) {
    return data.text.trim();
  }
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  return String(text).trim();
}

function prepArticleText(a) {
  const t = `${a.title || ""}\n\n${a.description || ""}`;
  return t.slice(0, 5000); // keep prompt small
}

async function summarizeArticle(i) {
  const a = currentArticles[i];
  if (!a) return;
  showOut(i, "Summarizing…");
  try {
    const txt = await callGemini(
      `Summarize the following news in 3-4 bullet points in plain English.\n\n${prepArticleText(
        a
      )}`
    );
    showOut(i, txt, true);
    speak(`Summary for article ${i + 1}.`);
  } catch (e) {
    console.error(e);
    showOut(i, "AI summary failed. Try again later.");
  }
}

async function keyPoints(i) {
  const a = currentArticles[i];
  if (!a) return;
  showOut(i, "Extracting key points…");
  try {
    const txt = await callGemini(
      `Extract 5 concise key points from this news. Use bullets.\n\n${prepArticleText(a)}`
    );
    showOut(i, txt, true);
  } catch (e) {
    console.error(e);
    showOut(i, "AI key points failed. Try again later.");
  }
}

async function sentiment(i) {
  const a = currentArticles[i];
  if (!a) return;
  showOut(i, "Analyzing sentiment…");
  try {
    const txt = await callGemini(
      `Classify the overall sentiment (Positive/Negative/Neutral) and give one-line justification.\n\n${prepArticleText(
        a
      )}`
    );
    showOut(i, txt, true);
  } catch (e) {
    console.error(e);
    showOut(i, "AI sentiment failed. Try again later.");
  }
}

async function askArticle(i, question) {
  const a = currentArticles[i];
  if (!a) return;
  showOut(i, "Thinking…");
  try {
    const txt = await callGemini(
      `You are a helpful assistant. Answer the user question using ONLY the information below (title/description). If unknown, say so briefly.\n\nARTICLE:\n${prepArticleText(
        a
      )}\n\nQUESTION:\n${question}`
    );
    showOut(i, txt, true);
    speak(`Answer ready for article ${i + 1}.`);
  } catch (e) {
    console.error(e);
    showOut(i, "AI Q&A failed. Try again later.");
  }
}

function showOut(i, text, format = false) {
  const box = document.getElementById(`out-${i}`);
  if (!box) return;
  box.style.display = "block";
  const content = box.querySelector(".content");
  content.innerHTML = format ? mdToHtml(text) : escapeHtml(text);
}

/* =========================
   MARKDOWN-ish / ESCAPES
   ========================= */
function mdToHtml(md) {
  // tiny markdown-ish converter (bullets, newlines)
  const safe = escapeHtml(md)
    .replace(/^-\s/gm, "• ")
    .replace(/\n/g, "<br>");
  return safe;
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (m) => {
    return (
      {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      }[m] || m
    );
  });
}

/* =========================
   SOUND (optional)
   ========================= */
function playSound(type) {
  // optional: drop your own mp3s (start-sound.mp3 / stop-sound.mp3) in project root
  const file = type === "start" ? "start-sound.mp3" : "stop-sound.mp3";
  try {
    const audio = new Audio(file);
    audio.play().catch(() => {});
  } catch {}
}
function articlesCount(n) {
  return n === 1 ? "1 article" : `${n} articles`;
}

/* =========================
   LOCALIZATION HELPERS
   ========================= */
function localize(key, vars = {}) {
  const lang = (LANGS[currentLangKey]?.lang) || "en";
  const strings = {
    en: {
      paused: "Listening paused.",
      paused_long: "Listening paused. Say 'resume listening' to continue.",
      resumed: "Resumed listening.",
      ask_read: "Should I read the headline?",
      ok: "Okay.",
      invalid_selection: "Invalid selection. Please say a valid number.",
      fetched_count: `Fetched ${vars.n || 0} articles.`,
      no_news: "No news loaded yet.",
      error_news: "Error fetching news.",
    },
  };
  return (strings[lang] && strings[lang][key]) || strings.en[key] || "";
}

/* =========================
   STARTUP HINT (optional)
   ========================= */
window.addEventListener("load", () => {
  // If browser lacks recognition support, disable Speak button gracefully
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    setMic("idle");
    if (startBtn) {
      startBtn.disabled = true;
      startBtn.style.opacity = "0.6";
      startBtn.style.cursor = "not-allowed";
    }
    toast("❌ Speech Recognition not supported in this browser.");
  }
});
