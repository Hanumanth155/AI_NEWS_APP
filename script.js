/* =========================
   CONFIG (English only)
   ========================= */
// API keys removed from frontend for security
// Use serverless functions instead (see `/api/gnews` and `/api/gemini`)
const GEMINI_MODEL = "gemini-1.5-flash-latest";
const GNEWS_API = "/api/gnews";
const GEMINI_API = "/api/gemini";

/* Language map for recognition + GNews params (English only) */
const LANGS = {
  "en-US": { lang: "en", country: "us", label: "English (US)" },
};

/* =========================
   ENGLISH INTENTS ONLY
   ========================= */
const INTENTS = {
  latest: {
    en: ["latest news","headlines","breaking news","top news"]
  },
  categories: {
    business: { en: ["business"] },
    entertainment: { en: ["entertainment"] },
    general: { en: ["general"] },
    health: { en: ["health"] },
    science: { en: ["science"] },
    sports: { en: ["sports"] },
    technology: { en: ["technology"] }
  }
};

/* For yes/no confirmation (English only) */
const YES_WORDS = ["yes","yeah","yup","sure","ok","okay"];
const NO_WORDS  = ["no","nope","nah"];

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
let openedTab = null;
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
      recognition.lang = currentLangKey;
      recognition.start();
      setMic('live');
      startBtn.innerHTML = '<p class="content">🎙 Listening...</p>';
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

    if (awaitingReadConfirm) {
      if (isAffirmative(speechResult)) {
        if (pendingReadText) speak(pendingReadText);
        resetReadConfirm();
      } else if (isNegative(speechResult)) {
        speak(localize("ok"));
        resetReadConfirm();
      }
      return;
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

    if (speechResult.includes("read the headlines")) {
      readHeadlines();
      return;
    }

    const sumMatch = speechResult.match(/summarize (article )?(\d+)/);
    if (sumMatch) {
      const idx = parseInt(sumMatch[2], 10) - 1;
      summarizeArticle(idx);
      return;
    }

    if (speechResult.match(/(select|open)\s*\d+/) || speechResult.match(/\b(one|two|three|four|five|six|seven|eight|nine|ten)\b/)) {
      handleSelection(speechResult);
      return;
    }

    if (
      INTENTS.latest["en"].some(k => speechResult.includes(k)) ||
      Object.values(INTENTS.categories).some(cat =>
        cat.en && cat.en.some(k => speechResult.includes(k))
      ) ||
      speechResult.includes("news")
    ) {
      handleCommand(speechResult);
      return;
    }

    toast("❌ Command not recognized. Try: 'latest news', 'read the headlines', 'summarize 2', or 'open 3'.");
  });

  recognition.addEventListener('end', () => {
    if (isListening) recognition.start();
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
   NEWS FETCH (via serverless function)
   ========================= */
function handleCommand(command) {
  const lc = LANGS[currentLangKey] || LANGS["en-US"];
  const lang = lc.lang;
  const country = lc.country;

  let url = "";
  const categories = ["business", "entertainment", "general", "health", "science", "sports", "technology"];
  const sources = ["cnn", "bbc", "wired", "time", "ign", "buzzfeed", "abc"];

  if (INTENTS.latest[lang]?.some(k => command.includes(k))) {
    url = `https://gnews.io/api/v4/top-headlines?lang=${lang}&country=${country}&max=10`;
  }

  if (!url && command.includes("news from")) {
    let foundSource = sources.find(src => command.includes(src));
    if (foundSource) url = `https://gnews.io/api/v4/top-headlines?source=${foundSource}&lang=${lang}&country=${country}&max=10`;
  }

  if (!url) {
    for (let cat of categories) {
      const hit = (INTENTS.categories[cat]?.[lang] || []).some(k => command.includes(k));
      if (hit) {
        url = `https://gnews.io/api/v4/top-headlines?category=${cat}&lang=${lang}&country=${country}&max=10`;
        break;
      }
    }
  }

  if (!url && (command.includes("about") || command.includes("on") || command.includes("for") || command.includes("regarding"))) {
    let term = command.replace(/news|about|on|for|regarding/gi, "").trim();
    if (term) {
      url = `https://gnews.io/api/v4/search?q=${encodeURIComponent(term)}&lang=${lang}&country=${country}&max=10`;
    }
  }

  if (url) fetchNewsByUrl(url);
  else toast("❌ Sorry, I couldn't understand. Try 'latest news', 'technology news', or 'news about bitcoin'.");
}

async function fetchNewsByUrl(url) {
  newsContainer.innerHTML = '<p style="padding:10px;">Loading news...</p>';
  newsContainer.style.display = 'grid';
  newsContainer.style.gridTemplateColumns = 'repeat(2, minmax(0, 1fr))';
  newsContainer.style.gap = '16px';

  try {
    const res = await fetch(`${GNEWS_API}?url=${encodeURIComponent(url)}`);
    let data = await res.json();

    if (!data.articles || data.articles.length === 0) {
      newsContainer.innerHTML = '<p style="padding:10px;">No news articles found.</p>';
      speak(localize("no_news"));
      return;
    }

    currentArticles = data.articles;
    renderNewsArticles(currentArticles);
    speak(localize("fetched_count", { n: currentArticles.length }));
    setTimeout(() => newsContainer.scrollIntoView({ behavior: 'smooth' }), 200);
  } catch (err) {
    console.error('Error fetching news:', err);
    newsContainer.innerHTML = '<p style="padding:10px;">Error fetching news. Try again later.</p>';
    speak(localize("error_news"));
  }
}

/* =========================
   RENDER NEWS
   ========================= */
function renderNewsArticles(articles) {
  newsContainer.innerHTML = '';
  newsContainer.style.display = 'grid';
  newsContainer.style.gridTemplateColumns = 'repeat(2, minmax(0, 1fr))';
  newsContainer.style.gap = '16px';

  articles.forEach((article, index) => {
    const articleDiv = document.createElement('div');
    articleDiv.className = 'article';
    articleDiv.dataset.index = index;
    articleDiv.style.cssText = `background:#fff;border-radius:10px;box-shadow:0 2px 6px rgba(0,0,0,0.08);padding:12px;display:flex;flex-direction:column;gap:8px;`;

    const imgHtml = article.image ? `<img src="${article.image}" alt="Image" style="width:100%;height:160px;object-fit:cover;border-radius:8px;"/>` : '';

    articleDiv.innerHTML = `
      <h3 style="margin:0;font-size:16px;line-height:1.35;">${index + 1}. ${article.title || ''}</h3>
      <p style="margin:0;color:#333;font-size:14px;">${article.description || ''}</p>
      ${imgHtml}
      <p class="small-muted" style="margin:0;color:#777;font-size:12px;">${article.source?.name ? 'Source: ' + article.source.name : ''}</p>
      <a href="${article.url}" target="_blank" style="margin-top:4px;font-size:14px;">Read More</a>

      <div class="ai-tools" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px;">
        <button class="ai-btn" data-act="summary" data-i="${index}">Summarize</button>
        <button class="ai-btn" data-act="points" data-i="${index}">Key Points</button>
        <button class="ai-btn" data-act="sentiment" data-i="${index}">Sentiment</button>
        <button class="ai-btn" data-act="ask" data-i="${index}">Ask</button>
      </div>
      <div class="ai-ask" style="display:flex;gap:8px;margin-top:6px;">
        <input class="ai-input" id="ask-${index}" placeholder="Ask AI about this article..." style="flex:1;padding:6px 8px;"/>
      </div>
      <div class="ai-output" id="out-${index}" style="display:none;background:#fafafa;border:1px solid #eee;border-radius:8px;padding:8px;">
        <span class="label" style="font-weight:600;font-size:12px;color:#555;">AI</span>
        <div class="content" style="font-size:14px;margin-top:4px;"></div>
      </div>
    `;

    newsContainer.appendChild(articleDiv);
  });

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
  const numberMapEn = { one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10 };
  let indices = [];
  let numMatches = command.match(/\d+/g);
  if (numMatches) indices.push(...numMatches.map(n => parseInt(n,10) - 1));
  for (let word in numberMapEn) if (command.includes(word)) indices.push(numberMapEn[word]-1);
  indices = [...new Set(indices)].filter(i => currentArticles[i]);

  if (indices.length > 0) {
    const i = indices[0];
    const article = currentArticles[i];
    window.open(article.url, "_blank");
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
   GEMINI HELPERS (via serverless)
   ========================= */
async function callGemini(prompt) {
  const res = await fetch(GEMINI_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt })
  });
  const data = await res.json();
  return data.text || "";
}

function prepArticleText(a) {
  return `${a.title || ""}\n\n${a.description || ""}`.slice(0, 5000);
}

async function summarizeArticle(i) {
  const a = currentArticles[i]; if (!a) return;
  showOut(i, "Summarizing…");
  try { const text = await callGemini(`Summarize this article:\n${prepArticleText(a)}`); showOut(i, text); } catch(e){ showOut(i,"Error summarizing"); }
}

async function keyPoints(i) {
  const a = currentArticles[i]; if (!a) return;
  showOut(i, "Getting key points…");
  try { const text = await callGemini(`List key points:\n${prepArticleText(a)}`); showOut(i, text); } catch(e){ showOut(i,"Error getting key points"); }
}

async function sentiment(i) {
  const a = currentArticles[i]; if (!a) return;
  showOut(i, "Analyzing sentiment…");
  try { const text = await callGemini(`Give sentiment (positive/negative/neutral) of:\n${prepArticleText(a)}`); showOut(i, text); } catch(e){ showOut(i,"Error analyzing sentiment"); }
}

async function askArticle(i, q) {
  const a = currentArticles[i]; if (!a) return;
  showOut(i, "Thinking…");
  try { const text = await callGemini(`Article:\n${prepArticleText(a)}\n\nQuestion: ${q}`); showOut(i, text); } catch(e){ showOut(i,"Error answering"); }
}

function showOut(i, txt) {
  const outEl = document.getElementById(`out-${i}`);
  if (!outEl) return;
  outEl.style.display = 'block';
  outEl.querySelector('.content').textContent = txt;
}

/* =========================
   UTILS
   ========================= */
function speak(text) {
  if (!text || typeof speechSynthesis === 'undefined') return;
  const utter = new SpeechSynthesisUtterance(text);
  if (ttsVoice) utter.voice = ttsVoice;
  speechSynthesis.speak(utter);
}

function toast(msg, timeout = 3000){
  if (!toastEl) return;
  toastEl.textContent = msg;
  toastEl.style.opacity = 1;
  setTimeout(()=>{ toastEl.style.opacity = 0; }, timeout);
}

function localize(key, vars={}) {
  const strings = {
    paused: "Paused.",
    resumed: "Resumed listening.",
    paused_long: "Paused. Say 'resume listening' to continue.",
    fetched_count: `Fetched ${vars.n || 0} articles.`,
    no_news: "No news articles found.",
    error_news: "Error fetching news.",
    ok: "Okay.",
    ask_read: "Do you want me to read the title?",
    invalid_selection: "Invalid selection."
  };
  return strings[key] || key;
}

/* =========================
   SOUNDS (optional)
   ========================= */
function playSound(name){
  try{ new Audio(`${name}-sound.mp3`).play(); } catch{}
}
