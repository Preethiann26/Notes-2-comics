// Notes-2-Comic frontend logic
// Talks to the backend at /api/generate-comic and /api/generate-quiz
// (same origin, since the backend serves this file too).

const API_BASE = ""; // same origin

const state = {
  notes: "",
  comicPanels: [],
  mindMap: null,
  questions: [],
  answers: [],
  lastScorePct: 0,
};

// ---------- View switching ----------
function showView(id) {
  document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
  document.getElementById(id).classList.add("active");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// ---------- Home / input ----------
const notesInput = document.getElementById("notesInput");
const fileInput = document.getElementById("fileInput");
const inputError = document.getElementById("inputError");

fileInput.addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const text = await file.text();
  notesInput.value = text.slice(0, 6000);
});

document.getElementById("transformBtn").addEventListener("click", async () => {
  const notes = notesInput.value.trim();
  inputError.textContent = "";

  if (!notes) {
    inputError.textContent = "Please paste or type some notes first.";
    return;
  }
  if (notes.length < 20) {
    inputError.textContent = "Add a bit more detail so the AI has something to work with.";
    return;
  }

  state.notes = notes;
  const panelCount = document.getElementById("panelCount").value;
  const questionCount = document.getElementById("questionCount").value;

  showView("view-loading");
  document.getElementById("loadingText").textContent = "Turning your notes into a story...";

  try {
    // Run comic + quiz generation in parallel
    const [comicRes, quizRes] = await Promise.all([
      fetch(`${API_BASE}/api/generate-comic`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes, panelCount }),
      }),
      fetch(`${API_BASE}/api/generate-quiz`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes, questionCount }),
      }),
    ]);

    const comicData = await comicRes.json();
    const quizData = await quizRes.json();

    if (!comicRes.ok) throw new Error(comicData.error || "Comic generation failed.");
    if (!quizRes.ok) throw new Error(quizData.error || "Quiz generation failed.");

    state.comicPanels = comicData.panels;
    state.mindMap = quizData.mindMap;
    state.questions = quizData.questions;
    state.answers = new Array(quizData.questions.length).fill(null);

    renderComic();
    showView("view-comic");
  } catch (err) {
    console.error(err);
    showView("view-home");
    inputError.textContent = "Something went wrong: " + err.message;
  }
});

// ---------- Comic rendering ----------
function renderComic() {
  const strip = document.getElementById("comicStrip");
  strip.innerHTML = "";
  state.comicPanels.forEach((panel, i) => {
    const div = document.createElement("div");
    div.className = "comic-panel";
    div.innerHTML = `
      <img src="${panel.imageBase64}" alt="Comic panel ${i + 1}" />
      <div class="caption"><span class="panel-num">#${i + 1}</span> ${escapeHtml(panel.caption)}</div>
    `;
    strip.appendChild(div);
  });
}

document.getElementById("backToHomeFromComic").addEventListener("click", () => showView("view-home"));
document.getElementById("goToQuizBtn").addEventListener("click", () => {
  renderQuiz();
  showView("view-quiz");
});

// ---------- Quiz rendering ----------
function renderQuiz() {
  const container = document.getElementById("quizContainer");
  container.innerHTML = "";
  state.answers = new Array(state.questions.length).fill(null);

  state.questions.forEach((q, qIdx) => {
    const qDiv = document.createElement("div");
    qDiv.className = "quiz-question";
    qDiv.innerHTML = `<div class="q-title">${qIdx + 1}. ${escapeHtml(q.question)}</div>`;

    const optsDiv = document.createElement("div");
    optsDiv.className = "quiz-options";

    q.options.forEach((opt, oIdx) => {
      const label = document.createElement("label");
      label.className = "quiz-option";
      label.innerHTML = `
        <input type="radio" name="q${qIdx}" value="${oIdx}" />
        <span>${escapeHtml(opt)}</span>
      `;
      label.addEventListener("click", () => {
        state.answers[qIdx] = oIdx;
        optsDiv.querySelectorAll(".quiz-option").forEach((el) => el.classList.remove("selected"));
        label.classList.add("selected");
      });
      optsDiv.appendChild(label);
    });

    qDiv.appendChild(optsDiv);
    container.appendChild(qDiv);
  });
}

document.getElementById("submitQuizBtn").addEventListener("click", () => {
  const unanswered = state.answers.filter((a) => a === null).length;
  if (unanswered > 0) {
    alert(`Please answer all questions. ${unanswered} left.`);
    return;
  }

  let correct = 0;
  state.questions.forEach((q, i) => {
    if (state.answers[i] === q.correctIndex) correct++;
  });
  const pct = Math.round((correct / state.questions.length) * 100);
  state.lastScorePct = pct;

  saveHistoryEntry(pct);
  renderResults(pct);
  showView("view-results");
});

// ---------- Results ----------
function renderResults(pct) {
  const card = document.getElementById("resultsCard");
  const pass = pct >= 60;
  card.classList.toggle("pass", pass);
  card.classList.toggle("fail", !pass);

  document.getElementById("resultsEmoji").textContent = pass ? "🎉" : "💪";
  document.getElementById("resultsHeadline").textContent = pass ? "Congratulations!" : "Keep Learning!";
  document.getElementById("scoreText").textContent = pct + "%";
  document.getElementById("resultsMessage").textContent = pass
    ? "You're a learning superstar! Keep up the amazing work!"
    : "Not quite there yet, but that's okay! Every challenge is an opportunity to grow — let's review together.";
}

document.getElementById("retryQuizBtn").addEventListener("click", () => {
  renderQuiz();
  showView("view-quiz");
});
document.getElementById("backToHomeFromResults").addEventListener("click", () => showView("view-home"));
document.getElementById("reviewMindMapBtn").addEventListener("click", () => {
  renderMindMap();
  showView("view-mindmap");
});

// ---------- Mind map ----------
function renderMindMap() {
  const container = document.getElementById("mindMapContainer");
  container.innerHTML = "";
  if (!state.mindMap) return;

  const topic = document.createElement("div");
  topic.className = "mindmap-topic";
  topic.textContent = state.mindMap.mainTopic;
  container.appendChild(topic);

  const branches = document.createElement("div");
  branches.className = "mindmap-branches";
  state.mindMap.keyConcepts.forEach((concept) => {
    const c = document.createElement("div");
    c.className = "mindmap-concept";
    c.innerHTML = `<div class="concept-title">${escapeHtml(concept.title)}</div>`;
    concept.details.forEach((d) => {
      const detail = document.createElement("div");
      detail.className = "concept-detail";
      detail.textContent = d;
      c.appendChild(detail);
    });
    branches.appendChild(c);
  });
  container.appendChild(branches);
}

document.getElementById("backToResultsBtn").addEventListener("click", () => showView("view-results"));
document.getElementById("retryFromMindMapBtn").addEventListener("click", () => {
  renderQuiz();
  showView("view-quiz");
});

// ---------- Progress history (stored locally in the browser) ----------
function saveHistoryEntry(pct) {
  const history = JSON.parse(localStorage.getItem("n2c_history") || "[]");
  history.unshift({
    date: new Date().toISOString(),
    topic: (state.mindMap && state.mindMap.mainTopic) || "Untitled notes",
    score: pct,
  });
  localStorage.setItem("n2c_history", JSON.stringify(history.slice(0, 50)));
}

function renderHistory() {
  const container = document.getElementById("historyContainer");
  const history = JSON.parse(localStorage.getItem("n2c_history") || "[]");
  container.innerHTML = "";

  if (history.length === 0) {
    container.innerHTML = `<div class="history-empty">No quizzes taken yet — transform some notes to get started!</div>`;
    return;
  }

  history.forEach((h) => {
    const div = document.createElement("div");
    div.className = "history-item";
    const date = new Date(h.date).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
    div.innerHTML = `
      <div><strong>${escapeHtml(h.topic)}</strong><br/><span style="color:#5b5e78;font-size:0.85rem">${date}</span></div>
      <div style="font-weight:700;color:${h.score >= 60 ? "#4caf7d" : "#e8543a"}">${h.score}%</div>
    `;
    container.appendChild(div);
  });
}

document.getElementById("navHistoryBtn").addEventListener("click", () => {
  renderHistory();
  showView("view-history");
});
document.getElementById("backToHomeFromHistory").addEventListener("click", () => showView("view-home"));

// ---------- Utils ----------
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
