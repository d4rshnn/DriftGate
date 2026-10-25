/* =====================================================================
   DriftGate – app.js
   ===================================================================== */

'use strict';

// ── State ──────────────────────────────────────────────────────────────
let scenario   = null;   // loaded scenario.json
let metrics    = null;   // loaded metrics.json
let agents     = [];     // live agent state (mutated during playback)
let elapsed    = 0;      // scenario seconds elapsed
let speed      = 1;      // 1 or 2
let playing    = false;
let rafId      = null;   // requestAnimationFrame handle
let lastTs     = null;   // last real timestamp for delta calc
let eventIdx   = 0;      // next event index to fire

// ── DOM refs ───────────────────────────────────────────────────────────
const clockEl     = document.getElementById('clock');
const btnPlay     = document.getElementById('btnPlay');
const btnPause    = document.getElementById('btnPause');
const btnReset    = document.getElementById('btnReset');
const btnSpeed    = document.getElementById('btnSpeed');
const kpiRow      = document.getElementById('kpi-row');
const agentTbody  = document.getElementById('agent-tbody');
const toastEl     = document.getElementById('toast');

// ── Bootstrap ──────────────────────────────────────────────────────────
async function init() {
  try {
    const [sRes, mRes] = await Promise.all([
      fetch('data/scenario.json'),
      fetch('data/metrics.json'),
    ]);
    scenario = await sRes.json();
    metrics  = await mRes.json();
  } catch (e) {
    console.error('DriftGate: failed to load JSON data', e);
    return;
  }

  // deep-copy initial agent state
  agents = scenario.agents.map(a => ({ ...a }));

  renderKpi();
  renderAgentTable();
  updateClock();
  updateButtons();
}

// ── Navigation ────────────────────────────────────────────────────────
function switchScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  const screenEl = document.getElementById('screen-' + name);
  const navEl    = document.querySelector(`.nav-item[data-screen="${name}"]`);
  if (screenEl) screenEl.classList.add('active');
  if (navEl)    navEl.classList.add('active');
}

document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', () => {
    switchScreen(item.dataset.screen);
  });
});

// ── KPI tiles ─────────────────────────────────────────────────────────
function formatMetric(val) {
  return val === null || val === undefined ? '&mdash;' : val;
}

function renderKpi() {
  const defs = [
    { key: 'detectionRate',        label: 'Detection Rate'          },
    { key: 'falseAlarmRate',       label: 'False-Alarm Rate'        },
    { key: 'actionsUntilCaught',   label: 'Actions Until Caught'    },
    { key: 'permissionCheckDetects', label: 'Permission Check Detects' },
  ];

  kpiRow.innerHTML = defs.map(d => `
    <div class="kpi-tile">
      <span class="kpi-label">${d.label}</span>
      <span class="kpi-value">${formatMetric(metrics[d.key])}</span>
      <span class="kpi-eval-label">${metrics.label || ''}</span>
    </div>
  `).join('');
}

// ── Agent table ───────────────────────────────────────────────────────
function scoreColor(score) {
  if (score <= 20)  return '#2fa66a';
  if (score <= 50)  return '#e0a030';
  if (score <= 75)  return '#e8742a';
  return '#e5384f';
}

function chipClass(status) {
  const map = { healthy: 'chip-healthy', watching: 'chip-watching',
                restricted: 'chip-restricted', quarantined: 'chip-quarantined' };
  return map[status] || 'chip-healthy';
}

function renderAgentTable() {
  agentTbody.innerHTML = agents.map(a => `
    <tr>
      <td><span class="agent-id">${a.id}</span></td>
      <td>${a.role}</td>
      <td><span class="status-chip ${chipClass(a.status)}">${a.status}</span></td>
      <td>
        <div class="risk-bar-wrap">
          <div class="risk-bar-bg">
            <div class="risk-bar-fill"
                 style="width:${a.score}%;background:${scoreColor(a.score)}"></div>
          </div>
          <span class="risk-score-num" style="color:${scoreColor(a.score)}">${a.score}</span>
        </div>
      </td>
      <td>${a.lastAction}</td>
    </tr>
  `).join('');
}

// ── Clock ─────────────────────────────────────────────────────────────
function updateClock() {
  const m = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const s = String(Math.floor(elapsed % 60)).padStart(2, '0');
  clockEl.textContent = `${m}:${s}`;
}

// ── Playback engine ───────────────────────────────────────────────────
function tick(ts) {
  if (!playing) return;

  if (lastTs !== null) {
    const delta = (ts - lastTs) / 1000 * speed;
    elapsed = Math.min(elapsed + delta, scenario.meta.durationSec);
  }
  lastTs = ts;

  updateClock();
  fireEvents();

  if (elapsed >= scenario.meta.durationSec) {
    playing = false;
    lastTs  = null;
    updateButtons();
    return;
  }

  rafId = requestAnimationFrame(tick);
}

function fireEvents() {
  while (eventIdx < scenario.events.length &&
         scenario.events[eventIdx].t <= elapsed) {
    applyEvent(scenario.events[eventIdx]);
    eventIdx++;
  }
}

function applyEvent(ev) {
  // switch screen
  if (ev.screen) switchScreen(ev.screen);

  // update agent state
  if (ev.agent && ev.status !== undefined) {
    const a = agents.find(x => x.id === ev.agent);
    if (a) {
      if (ev.status    !== undefined) a.status     = ev.status;
      if (ev.score     !== undefined) a.score      = ev.score;
      if (ev.text      !== undefined) a.lastAction = ev.text;
    }
  }

  renderAgentTable();
}

// ── Controls ──────────────────────────────────────────────────────────
function updateButtons() {
  btnPlay.disabled  = playing;
  btnPause.disabled = !playing;
}

btnPlay.addEventListener('click', () => {
  if (!scenario) return;
  playing = true;
  lastTs  = null;
  updateButtons();
  rafId = requestAnimationFrame(tick);
});

btnPause.addEventListener('click', () => {
  playing = false;
  lastTs  = null;
  if (rafId) cancelAnimationFrame(rafId);
  updateButtons();
});

btnReset.addEventListener('click', () => {
  playing  = false;
  elapsed  = 0;
  eventIdx = 0;
  lastTs   = null;
  if (rafId) cancelAnimationFrame(rafId);

  if (scenario) {
    agents = scenario.agents.map(a => ({ ...a }));
    renderAgentTable();
  }

  updateClock();
  updateButtons();
  switchScreen('overview');
});

btnSpeed.addEventListener('click', () => {
  speed = speed === 1 ? 2 : 1;
  btnSpeed.textContent = speed + 'x';
  btnSpeed.classList.toggle('active', speed === 2);
});

// ── Toast ─────────────────────────────────────────────────────────────
let toastTimer = null;
function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2500);
}

// expose globally for placeholder screens
window.showToast = showToast;

// ── Start ─────────────────────────────────────────────────────────────
init();
