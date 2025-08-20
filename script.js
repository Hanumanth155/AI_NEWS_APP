/* =========================
   CONFIG
   ========================= */
// GNews API Key (yours as you used before)
const API_KEY = "";

// Gemini API (frontend demo — you used this before)
const GEMINI_API_KEY = "";
const GEMINI_MODEL = "gemini-1.5-flash-latest";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

/* Language map for recognition + GNews params (English + Hindi only) */
const LANGS = {
  "en-US": { lang: "en", country: "us", label: "English (US)" },
  "hi-IN": { lang: "hi", country: "in", label: "Hindi (India)" },
};

/* =========================
   ENGLISH + HINDI INTENTS
   ========================= */
const INTENTS = {
  latest: {
    en: ["latest news","headlines","breaking news","top news"],
    hi: ["ताज़ा खबर","मुख्य समाचार","ब्रेकिंग न्यूज़","आज की खबरें"]
  },
  categories: {
    business: {
      en: ["business"],
      hi: ["व्यापार","बिजनेस"]
    },
    entertainment: {
      en: ["entertainment"],
      hi: ["मनोरंजन"]
    },
    general: {
      en: ["general"],
      hi: ["सामान्य","मुख्य"]
    },
    health: {
      en: ["health"],
      hi: ["स्वास्थ्य"]
    },
    science: {
      en: ["science"],
      hi: ["विज्ञान"]
    },
    sports: {
      en: ["sports"],
      hi: ["खेल","क्रिकेट","फुटबॉल"]
    },
    technology: {
      en: ["technology"],
      hi: ["तकनीक","प्रौद्योगिकी"]
    }
  }
};

/* For yes/no confirmation (EN + HI) */
const YES_WORDS = ["yes","yeah","yup","sure","ok","okay","haan","हाँ","जी हाँ","haan ji","haa"];
const NO_WORDS  = ["no","nope","nah","nahi","नहीं","जी नहीं","nai","nahin"];

/* =========================
   DOM
   ========================= */
const startBtn = document.getElementById('start-btn');
const pauseBtn = document.getElementById('pause-btn');
const stopBtn  = document.getElementById('stop-btn');
const langSelect = document.getElementById('lang-select');

const newsContainer = document.getElementById('news-container');
const micBadge = document.getElementById('mic-status');
const toastEl = document.getElementById('toast');

let recognition;
let currentArticles = [];
let isListening = false;
let openedTab = null; // no longer auto-created; used only when selecting
let isPaused = false;
let currentLangKey = langSelect ? langSelect.value : "en-US";

/* Ask-to-read state */
let awaitingReadConfirm = false;
let pendingReadText = "";

/* TTS voice matching */
let ttsVoice = null;
function refreshVoices(){
  try{
    const voices = speechSynthesis.getVoices() || [];
    const langPrefix = currentLangKey.split('-')[0].toLowerCase();
    ttsVoice = voices.find(v => (v.lang || "").toLowerCase().startsWith(langPrefix)) || null;
  }catch{}
}
if (typeof speechSynthesis !== "undefined") {
  speechSynthesis.onvoiceschanged = refreshVoices;
  refreshVoices();
}

/* =========================
   SPEECH RECOGNITION
   ========================= */
if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  recognition = new SpeechRecognition();
  recognition.lang = currentLangKey;
  recognition.interimResults = false;
  recognition.continuous = true;
  recognition.maxAlternatives = 1;

  startBtn.addEventListener('click', () => {
    if (!isListening) {
      isListening = true;
      recognition.lang = currentLangKey; // ensure up-to-date
      recognition.start();
      setMic('live');
      startBtn.innerHTML = '<p class="content">🎙 Listening...</p>';
      // ❌ removed: openedTab = window.open("about:blank", "_blank");
      playSound("start");
    }
  });

  if (pauseBtn){
    pauseBtn.addEventListener('click', () => {
      if (!isListening) { toast("Start listening first."); return; }
      if (!isPaused) {
        isPaused = true;
        setMic('paused');
        pauseBtn.textContent = "▶️ Resume";
        speak(localize("paused"));
      } else {
        isPaused = false;
        setMic('live');
        pauseBtn.textContent = "⏸️ Pause";
        speak(localize("resumed"));
      }
    });
  }

  if (stopBtn){
    stopBtn.addEventListener('click', () => stopListening());
  }

  if (langSelect){
    langSelect.addEventListener('change', () => {
      currentLangKey = langSelect.value || "en-US";
      updateRecognitionLang();
      const l = LANGS[currentLangKey];
      toast(`Language set to ${l?.label || currentLangKey}.`);
    });
  }

  recognition.addEventListener('result', (event) => {
    const speechResult = event.results[event.results.length - 1][0].transcript.toLowerCase().trim();
    const spokenBox = document.getElementById("spoken-text");
    if (spokenBox) spokenBox.value = speechResult;
    console.log("Heard:", speechResult);

    // If we are waiting for yes/no, handle that first
    if (awaitingReadConfirm) {
      if (isAffirmative(speechResult)) {
        if (pendingReadText) speak(pendingReadText);
        resetReadConfirm();
      } else if (isNegative(speechResult)) {
        speak(localize("ok"));
        resetReadConfirm();
      }
      return; // do not process other commands while waiting
    }

    if (speechResult.includes("stop listening") || speechResult === "stop") {
      stopListening();
      return;
    }
    if (speechResult.includes("pause listening")) {
      isPaused = true;
      setMic('paused');
      if (pauseBtn) pauseBtn.textContent = "▶️ Resume";
      speak(localize("paused_long"));
      return;
    }
    if (speechResult.includes("resume listening")) {
      isPaused = false;
      setMic('live');
      if (pauseBtn) pauseBtn.textContent = "⏸️ Pause";
      speak(localize("resumed"));
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

    // Open/select article N (supports digits + English words + basic Hindi numerals)
    if (speechResult.match(/(select|open)\s*\d+/) || speechResult.match(/\b(one|two|three|four|five|six|seven|eight|nine|ten)\b/) ||
        speechResult.match(/(select|open)\s*(एक|दो|तीन|चार|पांच|छह|सात|आठ|नौ|दस)/)) {
      handleSelection(speechResult);
      return;
    }

    // Fetch news intents (EN + HI)
    if (
      INTENTS.latest["en"].some(k => speechResult.includes(k)) ||
      INTENTS.latest["hi"].some(k => speechResult.includes(k)) ||
      Object.values(INTENTS.categories).some(cat =>
        (cat.en && cat.en.some(k => speechResult.includes(k))) ||
        (cat.hi && cat.hi.some(k => speechResult.includes(k)))
      ) ||
      speechResult.includes("news") || speechResult.includes("समाचार") || speechResult.includes("खबर")
    ) {
      handleCommand(speechResult);
      return;
    }

    // Unknown
    toast("❌ Command not recognized. Try: 'latest news', 'read the headlines', 'summarize 2', or 'open 3'.");
  });

  recognition.addEventListener('end', () => {
    if (isListening) recognition.start(); // auto-restart for hands-free
  });

  recognition.onerror = (event) => {
    console.error("Speech recognition error:", event.error);
    toast("🎤 Mic error: " + event.error);
    setMic('idle');
  };
} else {
  alert('Speech Recognition not supported in your browser.');
}

function stopListening() {
  isListening = false;
  isPaused = false;
  awaitingReadConfirm = false;
  pendingReadText = "";
  recognition && recognition.stop();
  setMic('idle');
  startBtn.innerHTML = '<p class="content">🎤 Speak</p>';
  if (pauseBtn) pauseBtn.textContent = "⏸️ Pause";
  playSound("stop");
  console.log("Stopped listening");
}

function updateRecognitionLang(){
  try{
    if (recognition) recognition.lang = currentLangKey;
    refreshVoices();
  }catch{}
}

function setMic(state) {
  if (!micBadge) return;
  micBadge.classList.remove('idle', 'live', 'paused');
  micBadge.classList.add(state);
  micBadge.textContent = state === 'live' ? '● listening' : state === 'paused' ? '● paused' : '● idle';
}

/* =========================
   NEWS FETCH (GNews)
   ========================= */
function handleCommand(command) {
  const lc = LANGS[currentLangKey] || LANGS["en-US"];
  const lang = lc.lang;     // "en" or "hi"
  const country = lc.country;

  let url = "";
  const categories = ["business", "entertainment", "general", "health", "science", "sports", "technology"];
  const sources = ["cnn", "bbc", "wired", "time", "ign", "buzzfeed", "abc"];

  // --- Latest/top/breaking (multi-lingual via INTENTS) ---
  if (INTENTS.latest[lang]?.some(k => command.includes(k))) {
    url = `https://gnews.io/api/v4/top-headlines?lang=${lang}&country=${country}&max=10&token=${API_KEY}`;
  }

  // --- Specific source in English (keep original feature) ---
  if (!url && command.includes("news from")) {
    let foundSource = sources.find(src => command.includes(src));
    if (foundSource) url = `https://gnews.io/api/v4/top-headlines?source=${foundSource}&lang=${lang}&country=${country}&max=10&token=${API_KEY}`;
  }

  // --- Category (EN + HI) ---
  if (!url) {
    for (let cat of categories) {
      const hit = (INTENTS.categories[cat]?.[lang] || []).some(k => command.includes(k));
      if (hit) {
        url = `https://gnews.io/api/v4/top-headlines?category=${cat}&lang=${lang}&country=${country}&max=10&token=${API_KEY}`;
        break;
      }
    }
  }

  // --- Generic search (English + Hindi) ---
  if (!url && (
    command.includes("about") || command.includes("on") || command.includes("for") || command.includes("regarding") ||
    command.includes("के बारे में") || command.includes("समाचार") || command.includes("खबर")
  )) {
    let term = command
      .replace(/news|about|on|for|regarding|के बारे में|समाचार|खबर/gi, "")
      .trim();
    if (term) {
      url = `https://gnews.io/api/v4/search?q=${encodeURIComponent(term)}&lang=${lang}&country=${country}&max=10&token=${API_KEY}`;
    }
  }

  if (url) fetchNewsByUrl(url);
  else toast("❌ Sorry, I couldn't understand. Try 'latest news', 'technology news', 'news about bitcoin', or 'क्रिकेट समाचार'.");
}

async function fetchNewsByUrl(url) {
  // Show loading
  newsContainer.innerHTML = '<p style="padding:10px;">Loading news...</p>';
  newsContainer.style.display = 'grid';
  newsContainer.style.gridTemplateColumns = 'repeat(2, minmax(0, 1fr))';
  newsContainer.style.gap = '16px';

  try {
    const lc = LANGS[currentLangKey];
    let lang = lc?.lang || "en";

    let res = await fetch(url);
    let data = await res.json();

    // ✅ If Hindi chosen and no articles found → fallback to English
    if ((!data.articles || data.articles.length === 0) && lang === "hi") {
      const fallbackUrl = url.replace("lang=hi", "lang=en");
      console.log("⚠️ No Hindi articles. Falling back to English:", fallbackUrl);
      res = await fetch(fallbackUrl);
      data = await res.json();
    }

    if (!data.articles || data.articles.length === 0) {
      newsContainer.innerHTML = '<p style="padding:10px;">No news articles found.</p>';
      speak(localize("no_news"));
      return;
    }

    let articles = data.articles;

    // 🔥 If Hindi selected → translate fetched (English) articles
    if (lang === "hi") {
      for (let i = 0; i < articles.length; i++) {
        const a = articles[i];
        try {
          const translated = await callGemini(
            `Translate this news headline and description into Hindi:\n\nTITLE: ${a.title || ""}\n\nDESCRIPTION: ${a.description || ""}`
          );
          // Simple split: first line = title, rest = description
          const [firstLine, ...rest] = translated.split("\n");
          a.title = firstLine.trim() || a.title;
          a.description = rest.join(" ").trim() || a.description;
        } catch (e) {
          console.error("Translation failed for article", i, e);
        }
      }
    }

    currentArticles = articles;
    renderNewsArticles(articles);
    speak(localize("fetched_count", { n: articles.length }));
    setTimeout(() => newsContainer.scrollIntoView({ behavior: 'smooth' }), 200);

  } catch (err) {
    console.error('Error fetching news:', err);
    newsContainer.innerHTML = '<p style="padding:10px;">Error fetching news. Try again later.</p>';
    speak(localize("error_news"));
  }
}



function renderNewsArticles(articles) {
  newsContainer.innerHTML = '';
  // enforce 2 per row grid each time (in case external CSS overwrites)
  newsContainer.style.display = 'grid';
  newsContainer.style.gridTemplateColumns = 'repeat(2, minmax(0, 1fr))';
  newsContainer.style.gap = '16px';

  articles.forEach((article, index) => {
    const articleDiv = document.createElement('div');
    articleDiv.className = 'article';
    articleDiv.dataset.index = index;
    articleDiv.style.cssText = `
      background:#fff;border-radius:10px;box-shadow:0 2px 6px rgba(0,0,0,0.08);
      padding:12px;display:flex;flex-direction:column;gap:8px;
    `;

    const imgHtml = article.image ? `<img src="${article.image}" alt="Image" style="width:100%;height:160px;object-fit:cover;border-radius:8px;"/>` : '';

    articleDiv.innerHTML = `
      <h3 style="margin:0;font-size:16px;line-height:1.35;">${index + 1}. ${article.title || ''}</h3>
      <p style="margin:0;color:#333;font-size:14px;">${article.description || ''}</p>
      ${imgHtml}
      <p class="small-muted" style="margin:0;color:#777;font-size:12px;">${article.source?.name ? 'Source: ' + article.source.name : ''}</p>
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
  newsContainer.querySelectorAll('.ai-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const i = parseInt(e.currentTarget.dataset.i, 10);
      const act = e.currentTarget.dataset.act;
      if (act === 'summary') await summarizeArticle(i);
      if (act === 'points') await keyPoints(i);
      if (act === 'sentiment') await sentiment(i);
      if (act === 'ask') {
        const q = (document.getElementById(`ask-${i}`)?.value || '').trim();
        if (!q) { toast("Type a question for AI first."); return; }
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
  const numberMapEn = { one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10 };
  const numberMapHi = { "एक":1,"दो":2,"तीन":3,"चार":4,"पांच":5,"छह":6,"सात":7,"आठ":8,"नौ":9,"दस":10 };

  let indices = [];

  let numMatches = command.match(/\d+/g);
  if (numMatches) indices.push(...numMatches.map(n => parseInt(n,10) - 1));

  for (let word in numberMapEn) if (command.includes(word)) indices.push(numberMapEn[word]-1);
  for (let word in numberMapHi) if (command.includes(word)) indices.push(numberMapHi[word]-1);

  indices = [...new Set(indices)].filter(i => currentArticles[i]);

  if (indices.length > 0) {
    // Only act on the first valid index in this command
    const i = indices[0];
    const article = currentArticles[i];

    // Open in a new tab now
    window.open(article.url, "_blank");

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
  return YES_WORDS.some(w => text.includes(w.toLowerCase()));
}
function isNegative(text) {
  return NO_WORDS.some(w => text.includes(w.toLowerCase()));
}

function readHeadlines() {
  if (currentArticles.length === 0) { speak(localize("no_news")); return; }
  currentArticles.forEach((a, i) => speak(`${i + 1}. ${a.title}`));
}

/* =========================
   GEMINI HELPERS
   ========================= */
async function callGemini(prompt) {
  if (!GEMINI_API_KEY || GEMINI_API_KEY === "YOUR_GEMINI_API_KEY_HERE") {
    toast("Add your Gemini API key in script.js to use AI features.");
    throw new Error("No Gemini key");
  }
  const body = {
    contents: [{ parts: [{ text: prompt }]}],
    safetySettings: [
      { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" }
    ]
  };
  const res = await fetch(GEMINI_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error("Gemini error: " + res.status);
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  return text.trim();
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
      `Summarize the following news in 3-4 bullet points in plain English.\n\n${prepArticleText(a)}`
    );
    showOut(i, txt, true);
    speak(`Summary for article ${i+1}.`);
  } catch (e) { showOut(i, "AI summary failed. Try again later."); }
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
  } catch (e) { showOut(i, "AI key points failed. Try again later."); }
}

async function sentiment(i) {
  const a = currentArticles[i];
  if (!a) return;
  showOut(i, "Analyzing sentiment…");
  try {
    const txt = await callGemini(
      `Classify the overall sentiment (Positive/Negative/Neutral) and give one-line justification.\n\n${prepArticleText(a)}`
    );
    showOut(i, txt, true);
  } catch (e) { showOut(i, "AI sentiment failed. Try again later."); }
}

async function askArticle(i, question) {
  const a = currentArticles[i];
  if (!a) return;
  showOut(i, "Thinking…");
  try {
    const txt = await callGemini(
      `You are a helpful assistant. Answer the user question using ONLY the information below (title/description). If unknown, say so briefly.\n\nARTICLE:\n${prepArticleText(a)}\n\nQUESTION:\n${question}`
    );
    showOut(i, txt, true);
    speak(`Answer ready for article ${i+1}.`);
  } catch (e) { showOut(i, "AI Q&A failed. Try again later."); }
}

function showOut(i, text, format = false) {
  const box = document.getElementById(`out-${i}`);
  if (!box) return;
  box.style.display = 'block';
  const content = box.querySelector('.content');
  content.innerHTML = format ? mdToHtml(text) : escapeHtml(text);
}

function mdToHtml(md) {
  // tiny markdown-ish converter (bullets, newlines)
  const safe = escapeHtml(md)
    .replace(/^-\s/gm, "• ")
    .replace(/\n/g, "<br>");
  return safe;
}
function escapeHtml(s){ return s.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m])); }

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
  // optional: drop your own mp3s in project root
  const file = type === "start" ? "start-sound.mp3" : "stop-sound.mp3";
  const audio = new Audio(file);
  audio.play().catch(()=>{});
}

function articlesCount(n){ return n===1 ? "1 article" : `${n} articles`; }

function toast(msg, ms=2000){
  if (!toastEl) return alert(msg);
  toastEl.textContent = msg;
  toastEl.classList.remove('hidden');
  toastEl.classList.add('show');
  toastEl.style.display = 'block';
  setTimeout(()=>{
    toastEl.classList.add('hidden');
    toastEl.style.display = 'none';
  }, ms);
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
      error_news: "Error fetching news."
    },
    hi: {
      paused: "सुनना रोक दिया गया है।",
      paused_long: "सुनना रोक दिया गया है। जारी रखने के लिए 'resume listening' कहें।",
      resumed: "सुनना फिर से शुरू हुआ।",
      ask_read: "क्या मैं शीर्षक पढ़ दूँ?",
      ok: "ठीक है।",
      invalid_selection: "गलत चयन। कृपया सही नंबर बोलें।",
      fetched_count: `${vars.n || 0} खबरें मिलीं।`,
      no_news: "अभी कोई खबर लोड नहीं है।",
      error_news: "खबरें लाने में समस्या हुई।"
    }
  };
  return strings[lang][key] || strings.en[key] || "";
}

