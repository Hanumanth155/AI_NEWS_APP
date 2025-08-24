/* =========================
   CONFIG (no keys in frontend)
   ========================= */
const GNEWS_API = "/api/gnews";
const GEMINI_API = "/api/gemini";

/* English only */
const LANGS = {
  "en-US": { lang: "en", country: "us", label: "English (US)" },
};

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

/* Yes/No words */
const YES_WORDS = ["yes", "yeah", "yup", "sure", "ok", "okay"];
const NO_WORDS = ["no", "nope", "nah"];

/* =========================
   DOM
   ========================= */
const startBtn = document.getElementById("start-btn");
const pauseBtn = document.getElementById("pause-btn");
const stopBtn = document.getElementById("stop-btn");
// if you had a <select id="lang-select"> remove it from UI; we force en-US anyway
const langSelect = document.getElementById("lang-select");

const newsContainer = document.getElementById("news-container");
const micBadge = document.getElementById("mic-status");
const toastEl = document.getElementById("toast");

let recognition;
let currentArticles = [];
let isListening = false;
let isPaused = false;
let currentLangKey = "en-US";

/* Ask-to-read state */
let awaitingReadConfirm = false;
let pendingReadText = "";

/* TTS voice matching */
let ttsVoice = null;
function refreshVoices() {
  try {
    const voices = speechSynthesis.getVoices() || [];
    const langPrefix = currentLangKey.split("-")[0].toLowerCase();
    ttsVoice =
      voices.find((v) =>
        (v.lang || "").toLowerCase().startsWith(langPrefix)
      ) || null;
  } catch {}
}
if (typeof speechSynthesis !== "undefined") {
  speechSynthesis.onvoiceschanged = refreshVoices;
  refreshVoices();
}

/* =========================
   SPEECH RECOGNITION
   ========================= */
if ("webkitSpeechRecognition" in window || "SpeechRecognition" in window) {
  const SpeechRecognition =
    window.SpeechRecognition || window.webkitSpeechRecognition;
  recognition = new SpeechRecognition();
  recognition.lang = currentLangKey;
  recognition.interimResults = false;
  recognition.continuous = true;
  recognition.maxAlternatives = 1;

  startBtn.addEventListener("click", () => {
    if (!isListening) {
      isListening = true;
      recognition.start();
      setMic("live");
      startBtn.innerHTML = '<p class="content">🎙 Listening...</p>';
      playSound("start");
    }
  });

  if (pauseBtn) {
    pauseBtn.addEventListener("click", () => {
      if (!isListening) {
        toast("Start listening first.");
        return;
      }
      if (!isPaused) {
        isPaused = true;
        setMic("paused");
        pauseBtn.textContent = "▶️ Resume";
        speak("Listening paused.");
      } else {
        isPaused = false;
        setMic("live");
        pauseBtn.textContent = "⏸️ Pause";
        speak("Resumed listening.");
      }
    });
  }

  if (stopBtn) {
    stopBtn.addEventListener("click", () => stopListening());
  }

  // If a lang select still exists, lock it to English and disable it
  if (langSelect) {
    langSelect.value = "en-US";
    langSelect.disabled = true;
  }

  recognition.addEventListener("result", (event) => {
    const speechResult =
      event.results[event.results.length - 1][0].transcript
        .toLowerCase()
        .trim();
    console.log("Heard:", speechResult);

    // Handle pending yes/no confirmation first
    if (awaitingReadConfirm) {
      if (isAffirmative(speechResult)) {
        if (pendingReadText) speak(pendingReadText);
        resetReadConfirm();
      } else if (isNegative(speechResult)) {
        speak("Okay.");
        resetReadConfirm();
      }
      return;
    }

    // Global controls
    if (speechResult.includes("stop listening") || speechResult === "stop") {
      stopListening();
      return;
    }
    if (speechResult.includes("pause listening")) {
      isPaused = true;
      setMic("paused");
      if (pauseBtn) pauseBtn.textContent = "▶️ Resume";
      speak("Listening paused. Say 'resume listening' to continue.");
      return;
    }
    if (speechResult.includes("resume listening")) {
      isPaused = false;
      setMic("live");
      if (pauseBtn) pauseBtn.textContent = "⏸️ Pause";
      speak("Resumed listening.");
      return;
    }
    if (isPaused) return;

    // Voice features
    if (speechResult.includes("read the headlines")) {
      readHeadlines();
      return;
    }

    // Summarize article N
    const sumMatch = speechResult.match(/summarize (article )?(\d+)/);
    if (sumMatch) {
      const idx = parseInt(sumMatch[2], 10) - 1;
      summarizeArticle(idx);
      return;
    }

    // Open/select article N (digits + English words)
    if (
      speechResult.match(/(select|open)\s*\d+/) ||
      speechResult.match(
        /\b(one|two|three|four|five|six|seven|eight|nine|ten)\b/
      )
    ) {
      handleSelection(speechResult);
      return;
    }

    // Fetch news intents (English only)
    if (
      INTENTS.latest.some((k) => speechResult.includes(k)) ||
      Object.values(INTENTS.categories).some((cat) =>
        cat.some((k) => speechResult.includes(k))
      ) ||
      speechResult.includes("news")
    ) {
      handleCommand(speechResult);
      return;
    }

    toast(
      "❌ Command not recognized. Try: 'latest news', 'read the headlines', 'summarize 2', or 'open 3'."
    );
  });

  recognition.addEventListener("end", () => {
    if (isListening) recognition.start(); // auto-restart
  });

  recognition.onerror = (event) => {
    console.error("Speech recognition error:", event.error);
    toast("🎤 Mic error: " + event.error);
    setMic("idle");
  };
} else {
  alert("Speech Recognition not supported in your browser.");
}

function stopListening() {
  isListening = false;
  isPaused = false;
  awaitingReadConfirm = false;
  pendingReadText = "";
  recognition && recognition.stop();
  setMic("idle");
  startBtn.innerHTML = '<p class="content">🎤 Speak</p>';
  if (pauseBtn) pauseBtn.textContent = "⏸️ Pause";
  playSound("stop");
  console.log("Stopped listening");
}

function updateRecognitionLang() {
  try {
    if (recognition) recognition.lang = currentLangKey;
    refreshVoices();
  } catch {}
}

function setMic(state) {
  if (!micBadge) return;
  micBadge.classList.remove("idle", "live", "paused");
  micBadge.classList.add(state);
  micBadge.textContent =
    state === "live" ? "● listening" : state === "paused" ? "● paused" : "● idle";
}

/* =========================
   NEWS FETCH (serverless)
   ========================= */
function handleCommand(command) {
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

  // Latest/top/breaking
  if (INTENTS.latest.some((k) => command.includes(k))) {
    url = `${GNEWS_API}?type=latest`;
  }

  // Specific source (English only)
  if (!url && command.includes("news from")) {
    let foundSource = sources.find((src) => command.includes(src));
    if (foundSource) url = `${GNEWS_API}?type=source&source=${foundSource}`;
  }

  // Category
  if (!url) {
    for (let cat of categories) {
      if (INTENTS.categories[cat].some((k) => command.includes(k))) {
        url = `${GNEWS_API}?type=category&cat=${cat}`;
        break;
      }
    }
  }

  // Generic search
  if (
    !url &&
    (command.includes("about") ||
      command.includes("on") ||
      command.includes("for") ||
      command.includes("regarding"))
  ) {
    let term = command
      .replace(/news|about|on|for|regarding/gi, "")
      .trim();
    if (term) url = `${GNEWS_API}?type=search&q=${encodeURIComponent(term)}`;
  }

  if (url) fetchNewsByUrl(url);
  else
    toast(
      "❌ Sorry, I couldn't understand. Try 'latest news', 'technology news', 'news from BBC', or 'news about bitcoin'."
    );
}

async function fetchNewsByUrl(url) {
  // Show loading
  newsContainer.innerHTML = '<p style="padding:10px;">Loading news...</p>';
  newsContainer.style.display = "grid";
  newsContainer.style.gridTemplateColumns = "repeat(2, minmax(0, 1fr))";
  newsContainer.style.gap = "16px";

  try {
    let res = await fetch(url);
    if (!res.ok) throw new Error("Fetch failed");
    let data = await res.json();

    if (!data.articles || data.articles.length === 0) {
      newsContainer.innerHTML =
        '<p style="padding:10px;">No news articles found.</p>';
      speak("No news loaded yet.");
      return;
    }

    currentArticles = data.articles;
    renderNewsArticles(currentArticles);
    speak(`Fetched ${currentArticles.length} articles.`);
    setTimeout(
      () => newsContainer.scrollIntoView({ behavior: "smooth" }),
      200
    );
  } catch (err) {
    console.error("Error fetching news:", err);
    newsContainer.innerHTML =
      '<p style="padding:10px;">Error fetching news. Try again later.</p>';
    speak("Error fetching news.");
  }
}

function renderNewsArticles(articles) {
  newsContainer.innerHTML = "";
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

    const imgHtml = article.image
      ? `<img src="${article.image}" alt="Image" style="width:100%;height:160px;object-fit:cover;border-radius:8px;"/>`
      : "";

    articleDiv.innerHTML = `
      <h3 style="margin:0;font-size:16px;line-height:1.35;">${index + 1}. ${
      article.title || ""
    }</h3>
      <p style="margin:0;color:#333;font-size:14px;">${
        article.description || ""
      }</p>
      ${imgHtml}
      <p class="small-muted" style="margin:0;color:#777;font-size:12px;">${
        article.source?.name ? "Source: " + article.source.name : ""
      }</p>
      <a href="${article.url}" target="_blank" style="margin-top:4px;font-size:14px;">Read More</a>

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

  let indices = [];

  let numMatches = command.match(/\d+/g);
  if (numMatches) indices.push(...numMatches.map((n) => parseInt(n, 10) - 1));

  for (let word in numberMapEn)
    if (command.includes(word)) indices.push(numberMapEn[word] - 1);

  indices = [...new Set(indices)].filter((i) => currentArticles[i]);

  if (indices.length > 0) {
    const i = indices[0];
    const article = currentArticles[i];

    window.open(article.url, "_blank");

    pendingReadText = article.title || "";
    awaitingReadConfirm = true;
    speak("Should I read the headline?");
  } else {
    speak("Invalid selection. Please say a valid number.");
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
    speak("No news loaded yet.");
    return;
  }
  currentArticles.forEach((a, i) => speak(`${i + 1}. ${a.title}`));
}

/* =========================
   GEMINI HELPERS (serverless)
   ========================= */
async function callGemini(prompt) {
  const res = await fetch(GEMINI_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  });
  if (!res.ok) throw new Error("Gemini error: " + res.status);
  const data = await res.json();
  // serverless returns { text } for convenience
  return (data && data.text) ? data.text.trim() : "";
}

function prepArticleText(a) {
  const t = `${a.title || ""}\n\n${a.description || ""}`;
  return t.slice(0, 5000);
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
    showOut(i, "AI summary failed. Try again later.");
  }
}

async function keyPoints(i) {
  const a = currentArticles[i];
  if (!a) return;
  showOut(i, "Extracting key points…");
  try {
    const txt = await callGemini(
      `Extract 5 concise key points from this news. Use bullets.\n\n${prepArticleText(
        a
      )}`
    );
    showOut(i, txt, true);
  } catch (e) {
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

function mdToHtml(md) {
  const safe = escapeHtml(md).replace(/^-\s/gm, "• ").replace(/\n/g, "<br>");
  return safe;
}
function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (m) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[m]);
}

/* =========================
   SPEAK / UTIL
   ========================= */
function speak(text) {
  try {
    let u = new SpeechSynthesisUtterance(text);
    u.lang = currentLangKey;
    if (ttsVoice) u.voice = ttsVoice;
    speechSynthesis.speak(u);
  } catch {}
}

function playSound(type) {
  const file = type === "start" ? "start-sound.mp3" : "stop-sound.mp3";
  const audio = new Audio(file);
  audio.play().catch(() => {});
}

function toast(msg, ms = 2000) {
  if (!toastEl) return alert(msg);
  toastEl.textContent = msg;
  toastEl.classList.remove("hidden");
  toastEl.classList.add("show");
  toastEl.style.display = "block";
  setTimeout(() => {
    toastEl.classList.add("hidden");
    toastEl.style.display = "none";
  }, ms);
}
