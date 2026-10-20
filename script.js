// ---------- Config ----------
const API_BASE = "https://mental-health-score-predictor-1-rwwx.onrender.com/";
const REQUEST_TIMEOUT_MS = 15000;
const MAX_SCORE = 10; // change if your model's score scale differs

// ---------- Elements ----------
const form = document.getElementById("predictForm");
const submitBtn = document.getElementById("submitBtn");
const btnLabel = submitBtn.querySelector(".btn-label");
const resetBtn = document.getElementById("resetBtn");
const formError = document.getElementById("formError");
const apiStatus = document.getElementById("apiStatus");

const card = document.getElementById("resultCard");
const gaugeFill = document.getElementById("gaugeFill");
const scoreValue = document.getElementById("scoreValue");
const resultTitle = document.getElementById("resultTitle");
const resultText = document.getElementById("resultText");

// ---------- Field rules (mirror the Pydantic model) ----------
const numberRules = {
  age:                     { label: "Age", min: 10, max: 100, integer: true },
  avg_daily_usage_hours:   { label: "Daily usage", min: 0, max: 24 },
  daily_unlocks:           { label: "Phone unlocks", min: 0, integer: true },
  study_hours:             { label: "Study hours", min: 0, max: 24 },
  physical_activity_hours: { label: "Physical activity", min: 0, max: 24 },
  sleep_hours_per_night:   { label: "Sleep hours", min: 0, max: 24 },
};
const requiredChoices = {
  gender: "gender",
  academic_level: "academic level",
  most_used_platform: "platform",
  purpose_of_use: "purpose",
  stress_level: "stress level",
};

// ---------- Validation ----------
function setError(name, message) {
  const el = form.querySelector(`.error[data-for="${name}"]`);
  if (!el) return;
  el.textContent = message || "";
  const field = el.closest(".field");
  if (field) field.classList.toggle("invalid", Boolean(message));
}

function validate() {
  let valid = true;
  formError.textContent = "";

  for (const [name, rule] of Object.entries(numberRules)) {
    const raw = form.elements[name].value.trim();
    let msg = "";
    if (raw === "") msg = `${rule.label} is required.`;
    else {
      const n = Number(raw);
      if (Number.isNaN(n)) msg = "Enter a valid number.";
      else if (rule.integer && !Number.isInteger(n)) msg = "Enter a whole number.";
      else if (rule.min !== undefined && n < rule.min) msg = `Must be at least ${rule.min}.`;
      else if (rule.max !== undefined && n > rule.max) msg = `Must be ${rule.max} or less.`;
    }
    setError(name, msg);
    if (msg) valid = false;
  }

  for (const [name, label] of Object.entries(requiredChoices)) {
    const v = form.elements[name].value;
    const msg = v ? "" : `Choose a ${label}.`;
    setError(name, msg);
    if (msg) valid = false;
  }

  const country = form.elements.country.value.trim();
  setError("country", country ? "" : "Country is required.");
  if (!country) valid = false;

  // Cross-field check: a day only has 24 hours
  if (valid) {
    const total = ["study_hours", "physical_activity_hours", "sleep_hours_per_night"]
      .reduce((sum, n) => sum + Number(form.elements[n].value), 0);
    if (total > 24) {
      formError.textContent = `Study, activity and sleep add up to ${total.toFixed(1)} hours, which is more than a day. Please adjust them.`;
      valid = false;
    }
  }
  return valid;
}

// Clear an error as soon as the person edits the field
form.addEventListener("input", (e) => {
  if (e.target.name) setError(e.target.name, "");
  formError.textContent = "";
});

// ---------- Build payload ----------
function buildPayload() {
  const f = form.elements;
  return {
    age: parseInt(f.age.value, 10),
    gender: f.gender.value,
    country: f.country.value.trim(),
    academic_level: f.academic_level.value,
    most_used_platform: f.most_used_platform.value,
    purpose_of_use: f.purpose_of_use.value,
    avg_daily_usage_hours: parseFloat(f.avg_daily_usage_hours.value),
    daily_unlocks: parseInt(f.daily_unlocks.value, 10),
    study_hours: parseFloat(f.study_hours.value),
    physical_activity_hours: parseFloat(f.physical_activity_hours.value),
    sleep_hours_per_night: parseFloat(f.sleep_hours_per_night.value),
    stress_level: f.stress_level.value,
  };
}

// ---------- UI state ----------
function setLoading(isLoading) {
  submitBtn.disabled = isLoading;
  submitBtn.classList.toggle("loading", isLoading);
  btnLabel.textContent = isLoading ? "Predicting…" : "Predict my score";
  if (isLoading) {
    card.dataset.state = "loading";
    resultTitle.textContent = "Calculating…";
    resultText.textContent = "Sending your answers to the model.";
    gaugeFill.style.strokeDashoffset = 100;
  }
}

function describe(score) {
  const ratio = score / MAX_SCORE;
  if (ratio < 0.4) return { state: "low", title: "Needs attention", text: "The model predicts a lower score. Sleep, stress, and screen time are good places to look for changes." };
  if (ratio < 0.7) return { state: "mid", title: "Moderate", text: "The model predicts a middle-range score. Small changes to your routine could move it in a better direction." };
  return { state: "good", title: "Looking good", text: "The model predicts a healthy score. Keep up the habits that are working for you." };
}

function animateScore(target) {
  const duration = 1100;
  const start = performance.now();
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce) { scoreValue.textContent = target.toFixed(2); return; }
  function tick(now) {
    const t = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - t, 3);
    scoreValue.textContent = (target * eased).toFixed(2);
    if (t < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

function showScore(score) {
  const info = describe(score);
  card.dataset.state = info.state;
  resultTitle.textContent = info.title;
  resultText.textContent = info.text;
  const pct = Math.max(0, Math.min(100, (score / MAX_SCORE) * 100));
  gaugeFill.style.strokeDashoffset = 100 - pct;
  animateScore(score);
}

function showError(message) {
  card.dataset.state = "error";
  scoreValue.textContent = "–";
  gaugeFill.style.strokeDashoffset = 100;
  resultTitle.textContent = "Couldn't get a prediction";
  resultText.textContent = message;
}

// ---------- API ----------
function formatApiError(status, body) {
  // FastAPI validation errors: { detail: [{ loc: [...], msg: "..." }] }
  if (status === 422 && Array.isArray(body?.detail)) {
    return body.detail.map(d => `${(d.loc || []).slice(1).join(".")}: ${d.msg}`).join("; ");
  }
  if (typeof body?.detail === "string") return body.detail;
  return `The server responded with an error (${status}).`;
}

async function predict(payload) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${API_BASE}/predict`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new Error(formatApiError(res.status, body));
    return body.predicted_mental_health_score;
  } catch (err) {
    if (err.name === "AbortError") throw new Error("The request timed out. Check that the server is running and try again.");
    if (err instanceof TypeError) throw new Error(`Can't reach the server at ${API_BASE}. Start it with: uvicorn main:app --reload`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function checkServer() {
  try {
    const res = await fetch(`${API_BASE}/`, { method: "GET" });
    if (!res.ok) throw new Error();
    apiStatus.textContent = "Server connected";
    apiStatus.className = "api-status online";
  } catch {
    apiStatus.textContent = "Server offline";
    apiStatus.className = "api-status offline";
  }
}

// ---------- Events ----------
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!validate()) {
    const firstBad = form.querySelector(".field.invalid input, .field.invalid select");
    if (firstBad) firstBad.focus();
    return;
  }

  setLoading(true);
  try {
    const score = await predict(buildPayload());
    showScore(score);
    apiStatus.textContent = "Server connected";
    apiStatus.className = "api-status online";
    if (window.matchMedia("(max-width: 880px)").matches) {
      card.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  } catch (err) {
    showError(err.message);
    if (err instanceof Error && err.message.startsWith("Can't reach")) {
      apiStatus.textContent = "Server offline";
      apiStatus.className = "api-status offline";
    }
  } finally {
    setLoading(false);
    // setLoading(false) leaves card state as set by showScore/showError
  }
});

resetBtn.addEventListener("click", () => {
  form.reset();
  form.querySelectorAll(".error").forEach(el => (el.textContent = ""));
  form.querySelectorAll(".invalid").forEach(el => el.classList.remove("invalid"));
  formError.textContent = "";
  card.dataset.state = "empty";
  scoreValue.textContent = "–";
  gaugeFill.style.strokeDashoffset = 100;
  resultTitle.textContent = "Your score will appear here";
  resultText.textContent = "Fill in the form and select Predict my score.";
});

checkServer();
