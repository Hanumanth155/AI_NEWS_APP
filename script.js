/* =========================
   CONFIG
   ========================= */
/* Note: API keys are now hidden in serverless functions on Vercel */

// Gemini & GNews serverless endpoints
const GNEWS_API = "/api/gnews";
const GEMINI_API = "/api/gemini";

/* =========================
   ENGLISH INTENTS ONLY
   ========================= */
const INTENTS = {
  latest: ["latest news","headlines","breaking news","top news"],
  categories: {
    business: ["business"],
    entertainment: ["entertainment"],
    general: ["general"],
    health: ["health"],
    science: ["science"],
    sports: ["sports","cricket","football"],
    technology: ["technology"]
  }
};

/* For yes/no confirmation */
const YES_WORDS = ["yes","yeah","yup","sure","ok","okay"];
const NO_WORDS  = ["no","nope","nah"];

/* =========================
   DOM
   ========================= */
const startBtn = document.getElementById('start-btn');
const pauseBtn = document.getElementById('pause-btn');
const stopBtn  = document.getElementById('stop-btn');

const newsContainer = document.getElementById('news-container');
const micBadge = document.getElementById('mic-status');
const toastEl = document.getElementById('toast');

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
        speak("Listening paused.");
      } else {
        isPaused = false;
        setMic('live');
        pauseBtn.textContent = "⏸️ Pause";
        speak("Resumed listening.");
      }
    });
  }

  if (stopBtn){
    stopBtn.addEventListener('click', () => stopListening());
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
        speak("Okay.");
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
      speak("Listening paused. Say 'resume listening' to continue.");
      return;
    }
    if (speechResult.includes("resume listening")) {
      isPaused = false;
      setMic('live');
      if (pauseBtn) pauseBtn.textContent = "⏸️ Pause";
      speak("Resumed listening.");
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
      INTENTS.latest.some(k => speechResult.includes(k)) ||
      Object.values(INTENTS.categories).some(cat => cat.some(k => speechResult.includes(k))) ||
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

function setMic(state) {
  if (!micBadge) return;
  micBadge.classList.remove('idle', 'live', 'paused');
  micBadge.classList.add(state);
  micBadge.textContent = state === 'live' ? '● listening' : state === 'paused' ? '● paused' : '● idle';
}

/* =========================
   NEWS FETCH (via Vercel serverless)
   ========================= */
function handleCommand(command) {
  let category = "general";
  let query = "";

  const categories = ["business","entertainment","general","health","science","sports","technology"];
  for (let cat of categories) {
    if (INTENTS.categories[cat].some(k => command.includes(k))) category = cat;
  }

  if (command.includes("about") || command.includes("on") || command.includes("for") || command.includes("regarding")) {
    query = command.replace(/news|about|on|for|regarding/gi, "").trim();
  }

  fetchNews(category, query);
}

async function fetchNews(category, query="") {
  newsContainer.innerHTML = '<p style="padding:10px;">Loading news...</p>';
  newsContainer.style.display = 'grid';
  newsContainer.style.gridTemplateColumns = 'repeat(2, minmax(0, 1fr))';
  newsContainer.style.gap = '16px';

  try {
    const q = query ? `&query=${encodeURIComponent(query)}` : "";
    const res = await fetch(`${GNEWS_API}?category=${category}${q}`);
    const data = await res.json();

    if (!data.articles || data.articles.length === 0) {
      newsContainer.innerHTML = '<p style="padding:10px;">No news articles found.</p>';
      speak("No news loaded yet.");
      return;
    }

    currentArticles = data.articles;
    renderNewsArticles(currentArticles);
    speak(`Fetched ${currentArticles.length} articles.`);
    setTimeout(() => newsContainer.scrollIntoView({ behavior: 'smooth' }), 200);

  } catch (err) {
    console.error('Error fetching news:', err);
    newsContainer.innerHTML = '<p style="padding:10px;">Error fetching news. Try again later.</p>';
    speak("Error fetching news.");
  }
}

/* =========================
   GEMINI HELPERS (via Vercel serverless)
   ========================= */
async function callGemini(prompt) {
  try {
    const res = await fetch(GEMINI_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt })
    });
    const data = await res.json();
    return data.text || "";
  } catch (e) {
    console.error("Gemini API error:", e);
    return "AI response failed.";
  }
}

// rest of Gemini helpers remain same: summarizeArticle, keyPoints, sentiment, askArticle
// rendering, selection, speak(), toast(), localize() functions remain same


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
  const lang = "en"; // <-- force English
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
    }
  };
  return strings[lang][key] || strings.en[key] || "";
}

