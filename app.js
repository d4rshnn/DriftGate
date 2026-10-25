/* =====================================================================
   DriftGate – scripted monitoring demo
   ===================================================================== */

'use strict';

const INTRO_HOLD_MS = 3000;

// ── State ──────────────────────────────────────────────────────────────
let scenario = null;
let metrics = null;
let agents = [];
let elapsed = 0;
let speed = 1;
let playing = false;
let rafId = null;
let lastTs = null;
let eventIdx = 0;
let introShown = true;

// ── DOM refs (shared) ──────────────────────────────────────────────────
const kpiRow = document.getElementById('kpi-row');
const agentTbody = document.getElementById('agent-tbody');
const toastEl = document.getElementById('toast');
const mainContentEl = document.querySelector('.main-content');
let autoScrollResumeTimer = null;
let autoScrollPausedUntil = 0;

function autoScrollTo(target) {
  const activeScreen = document.querySelector('.screen.active');
  if (!target || !activeScreen || !['timeline', 'alert', 'drift', 'chain'].includes(activeScreen.id.replace('screen-', ''))) return;
  if (Date.now() < autoScrollPausedUntil) return;
  const caption = document.getElementById('caption-bar');
  const captionSpace = caption && caption.classList.contains('visible') ? caption.offsetHeight + 24 : 0;
  const host = mainContentEl.getBoundingClientRect();
  const box = target.getBoundingClientRect();
  let nextTop = mainContentEl.scrollTop;
  const visibleBottom = host.bottom - captionSpace;
  if (box.bottom > visibleBottom) nextTop += box.bottom - visibleBottom;
  if (box.top < host.top) nextTop -= host.top - box.top;
  if (Math.abs(nextTop - mainContentEl.scrollTop) > 1) mainContentEl.scrollTo({ top: Math.max(0, nextTop), behavior: 'smooth' });
}

function pauseAutoScroll() {
  autoScrollPausedUntil = Date.now() + 6000;
  clearTimeout(autoScrollResumeTimer);
  autoScrollResumeTimer = setTimeout(() => {
    const active = document.querySelector('.screen.active');
    if (active && active.id === 'screen-timeline') autoScrollTo(document.querySelector('#tl-feed .tl-row:last-child'));
    if (active && active.id === 'screen-alert') autoScrollTo(document.querySelector('.al-response-panel'));
    if (active && active.id === 'screen-drift') autoScrollTo(document.getElementById('dr-explainers'));
    if (active && active.id === 'screen-chain') autoScrollTo(document.querySelector('.ch-graph-panel'));
  }, 6000);
}

mainContentEl.addEventListener('wheel', pauseAutoScroll, { passive: true });
mainContentEl.addEventListener('touchstart', pauseAutoScroll, { passive: true });
window.addEventListener('keydown', event => {
  if (['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', 'Space'].includes(event.code) && !event.target.matches('input, textarea, select, button')) pauseAutoScroll();
});

function cssColor(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

// ── Bootstrap ──────────────────────────────────────────────────────────
async function init() {
  try {
    const [sRes, mRes] = await Promise.all([
      fetch('data/scenario.json'),
      fetch('data/metrics.json'),
    ]);
    if (!sRes.ok || !mRes.ok) return;
    scenario = await sRes.json();
    metrics = await mRes.json();
  } catch (_error) {
    return;
  }

  agents = scenario.agents.map(agent => ({ ...agent }));

  renderKpi();
  metricsScreens.init();
  renderAgentTable();
  timeline.init();
  alertScreen.init();
  driftScreen.init();
  chainScreen.init();
  chapterBar.init();
  captionSystem.init();
  introCard.init();
  shortcuts.init();
}

// ── Navigation ─────────────────────────────────────────────────────────
function switchScreen(name) {
  mainContentEl.scrollTop = 0;
  document.querySelectorAll('.screen').forEach(screen => screen.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
  const screenEl = document.getElementById(`screen-${name}`);
  const navEl = document.querySelector(`.nav-item[data-screen="${name}"]`);
  if (screenEl) screenEl.classList.add('active');
  if (navEl) navEl.classList.add('active');
  if (name === 'alert') alertScreen.onNavigate();
  if (name === 'drift') driftScreen.onNavigate();
  if (name === 'chain') chainScreen.onNavigate();
}

document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', () => switchScreen(item.dataset.screen));
});

// ── Shared metrics ──────────────────────────────────────────────────────
function getSharedMetrics() {
  const runs = Array.isArray(metrics && metrics.pastRuns) ? metrics.pastRuns : [];
  const attacks = runs.filter(run => run.kind === 'attack');
  const normalRuns = runs.filter(run => run.kind === 'normal');
  const detected = attacks.filter(run => run.detected);
  const falseAlarms = normalRuns.filter(run => run.falseAlarm);
  const permissionDetections = attacks.filter(run => run.permissionCheckDetected);
  const actions = detected.map(run => Number(run.actionsUntilCaught)).filter(Number.isFinite);
  const meanActions = actions.length ? actions.reduce((sum, value) => sum + value, 0) / actions.length : null;
  const derived = {
    detectionRate: attacks.length ? detected.length / attacks.length * 100 : 0,
    falseAlarmRate: normalRuns.length ? falseAlarms.length / normalRuns.length * 100 : 0,
    actionsUntilCaught: meanActions,
    permissionCheckDetects: attacks.length ? permissionDetections.length / attacks.length * 100 : 0,
  };
  const keys = ['detectionRate', 'falseAlarmRate', 'actionsUntilCaught', 'permissionCheckDetects'];
  const display = {};
  const numeric = {};
  keys.forEach(key => {
    const raw = metrics && metrics[key];
    const value = raw === null || raw === undefined ? derived[key] : raw;
    numeric[key] = Number.isFinite(Number(value)) ? Number(value) : 0;
    if (value === null || value === undefined) display[key] = '—';
    else if (raw !== null && raw !== undefined) display[key] = String(raw);
    else display[key] = key === 'actionsUntilCaught'
      ? (value === null ? '—' : Number(value).toFixed(1))
      : `${Math.round(Number(value))}%`;
  });
  return { display, numeric, attacks, normalRuns, detected, falseAlarms };
}

function renderKpi() {
  const shared = getSharedMetrics();
  const definitions = metrics.metricDefinitions || [];
  const icons = {
    detectionRate: '<path d="M12 2 20 5v6c0 5-3.4 8.7-8 11-4.6-2.3-8-6-8-11V5z"/><path d="m8.5 12 2.2 2.2 4.8-5"/>',
    falseAlarmRate: '<path d="M12 3 22 20H2z"/><path d="M12 9v5m0 3h.01"/>',
    actionsUntilCaught: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    permissionCheckDetects: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>'
  };
  kpiRow.innerHTML = definitions.map(definition => `
    <div class="kpi-tile kpi-${definition.key}">
      <span class="kpi-icon"><svg viewBox="0 0 24 24" aria-hidden="true">${icons[definition.key] || ''}</svg></span>
      <span class="kpi-label">${definition.label}</span>
      <span class="kpi-value">${shared.display[definition.key]}</span>
      <span class="kpi-eval-label">${metrics.label || ''}</span>
    </div>
  `).join('');
}

// ── Agent table ────────────────────────────────────────────────────────
function scoreColor(score) {
  if (score <= 29) return cssColor('--ok');
  if (score <= 59) return cssColor('--watching');
  if (score <= 89) return cssColor('--restricted');
  return cssColor('--quarantined');
}

function scoreTextColor(score) {
  if (score <= 29) return cssColor('--ok-text');
  if (score <= 59) return cssColor('--watching-text');
  if (score <= 89) return cssColor('--restricted-text');
  return cssColor('--quarantined');
}

function chipClass(status) {
  const map = {
    healthy: 'chip-healthy', watching: 'chip-watching',
    restricted: 'chip-restricted', quarantined: 'chip-quarantined',
  };
  return map[status] || 'chip-healthy';
}

function renderAgentTable() {
  agentTbody.innerHTML = agents.map(agent => `
    <tr>
      <td><span class="agent-id"><span class="agent-avatar role-${agent.id.split('-')[0]}"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.2"/><path d="M5 20c.7-4 3-6 7-6s6.3 2 7 6"/></svg></span>${agent.id}</span></td>
      <td>${agent.role}</td>
      <td><span class="status-chip ${chipClass(agent.status)}">${agent.status}</span></td>
      <td>
        <div class="risk-bar-wrap">
          <div class="risk-bar-bg">
            <div class="risk-bar-fill" style="width:${agent.score}%;background:${scoreColor(agent.score)}"></div>
          </div>
          <span class="risk-score-num" style="color:${scoreTextColor(agent.score)}">${agent.score}</span>
        </div>
      </td>
      <td>${agent.lastAction}</td>
    </tr>
  `).join('');
}

// ── Playback engine ───────────────────────────────────────────────────
function tick(ts) {
  if (!playing) return;
  if (lastTs !== null) elapsed = Math.min(elapsed + (ts - lastTs) / 1000 * speed, scenario.meta.durationSec);
  lastTs = ts;
  chapterBar.update();
  captionSystem.update();
  fireEvents();
  if (elapsed >= scenario.meta.durationSec) {
    playing = false;
    lastTs = null;
    endCard.show();
    return;
  }
  rafId = requestAnimationFrame(tick);
}

function fireEvents() {
  while (eventIdx < scenario.events.length && scenario.events[eventIdx].t <= elapsed) {
    applyEvent(scenario.events[eventIdx]);
    eventIdx++;
  }
}

function applyEvent(ev) {
  const isSilent = !!ev.silent;
  if (ev.screen && !isSilent) switchScreen(ev.screen);
  if (ev.agent) {
    const agent = agents.find(item => item.id === ev.agent);
    if (agent) {
      if (ev.status !== undefined) agent.status = ev.status;
      if (ev.score !== undefined) agent.score = ev.score;
      if (ev.text !== undefined) agent.lastAction = ev.text;
    }
  }
  renderAgentTable();
  if (ev.agent) timeline.addEvent(ev);
  if (!isSilent && ev.agent && ev.screen === 'timeline') {
    const notable = (ev.tags && ev.tags.length > 0) || (ev.score && ev.score >= 14);
    if (notable) timeline.autoSelectAgent(ev.agent);
  }
  if (ev.alertId && !isSilent) alertScreen.show(ev.alertId, { animate: true });
  if (!isSilent && ev.screen === 'drift') driftScreen.start();
  if (!isSilent && ev.screen === 'chain') chainScreen.start('with');
}

function doPlay() {
  if (!scenario || playing) return;
  playing = true;
  lastTs = null;
  rafId = requestAnimationFrame(tick);
}

function doPause() {
  playing = false;
  lastTs = null;
  if (rafId) cancelAnimationFrame(rafId);
}

function doReset() {
  playing = false;
  elapsed = 0;
  eventIdx = 0;
  speed = 1;
  lastTs = null;
  if (rafId) cancelAnimationFrame(rafId);
  if (scenario) {
    agents = scenario.agents.map(agent => ({ ...agent }));
    renderAgentTable();
  }
  switchScreen('overview');
  timeline.reset();
  alertScreen.reset();
  driftScreen.reset();
  chainScreen.reset();
  chapterBar.update();
  captionSystem.hide();
  endCard.reset();
}

function restartPlayback() {
  doReset();
  doPlay();
}

// ── Manual reports ─────────────────────────────────────────────────────
const metricsScreens = (() => {
  const cardsEl = document.getElementById('metrics-cards');
  const compareEl = document.getElementById('metrics-compare-panel');
  const setupEl = document.getElementById('metrics-setup-panel');
  const summaryEl = document.getElementById('pr-summary-row');
  const tbody = document.getElementById('pr-tbody');
  const filterButtons = [...document.querySelectorAll('.pr-filter')];
  let activeFilter = 'all';

  function renderMetrics() {
    const shared = getSharedMetrics();
    const definitions = metrics.metricDefinitions || [];
    cardsEl.innerHTML = definitions.map(definition => {
      const value = shared.numeric[definition.key];
      const barValue = definition.key === 'actionsUntilCaught' ? Math.min(100, value * 10) : Math.max(0, Math.min(100, value));
      return `<article class="metrics-card">
        <span class="metrics-card-label">${definition.label}</span>
        <strong class="metrics-card-val">${shared.display[definition.key]}</strong>
        <div class="metrics-bar-bg" aria-hidden="true"><div class="metrics-bar-fill" style="width:${barValue}%"></div></div>
        <p class="metrics-card-def">${definition.definition}</p>
        <code class="metrics-card-formula">${definition.formula}</code>
      </article>`;
    }).join('');

    const detection = shared.numeric.detectionRate;
    const permission = shared.numeric.permissionCheckDetects;
    compareEl.innerHTML = `<h3 class="panel-title">DriftGate vs a plain permission check</h3>
      <div class="metrics-compare-row"><span class="metrics-compare-label">DriftGate</span><div class="metrics-compare-bar-bg"><div class="metrics-compare-bar-fill metrics-compare-dg" style="width:${Math.max(0, Math.min(100, detection))}%"></div></div><strong class="metrics-compare-val">${shared.display.detectionRate}</strong></div>
      <div class="metrics-compare-row"><span class="metrics-compare-label">Permission check</span><div class="metrics-compare-bar-bg"><div class="metrics-compare-bar-fill metrics-compare-permission" style="width:${Math.max(0, Math.min(100, permission))}%"></div></div><strong class="metrics-compare-val">${shared.display.permissionCheckDetects}</strong></div>`;
    setupEl.innerHTML = `<h3 class="panel-title">How this was measured</h3><p>${metrics.setup || ''}</p>`;
  }

  function isMissed(run) {
    return run.kind === 'attack' ? !run.detected : !!run.falseAlarm;
  }

  function outcome(run) {
    if (run.kind === 'attack') return run.detected
      ? '<span class="pr-chip pr-chip-detected">Detected</span>'
      : '<span class="pr-chip pr-chip-missed">Missed</span>';
    return run.falseAlarm
      ? '<span class="pr-chip pr-chip-false-alarm">False alarm</span>'
      : '<span class="pr-chip pr-chip-clean">Clean</span>';
  }

  function renderRuns() {
    const runs = Array.isArray(metrics.pastRuns) ? metrics.pastRuns : [];
    const attacks = runs.filter(run => run.kind === 'attack');
    const detectedCount = attacks.filter(run => run.detected).length;
    const falseAlarmCount = runs.filter(run => run.kind === 'normal' && run.falseAlarm).length;
    summaryEl.innerHTML = `<div class="pr-summary-item"><strong class="pr-summary-val">${runs.length}</strong><span class="pr-summary-lbl">Runs</span></div>
      <div class="pr-summary-item"><strong class="pr-summary-val">${detectedCount} of ${attacks.length}</strong><span class="pr-summary-lbl">Attacks detected</span></div>
      <div class="pr-summary-item"><strong class="pr-summary-val">${falseAlarmCount}</strong><span class="pr-summary-lbl">False alarms</span></div>`;
    const visibleRuns = runs.filter(run => {
      if (activeFilter === 'attacks') return run.kind === 'attack';
      if (activeFilter === 'normal') return run.kind === 'normal';
      if (activeFilter === 'missed') return isMissed(run);
      return true;
    });
    tbody.innerHTML = visibleRuns.map(run => `<tr class="${isMissed(run) ? 'pr-row-missed' : ''}">
      <td>${run.id}</td>
      <td><span class="pr-chip ${run.kind === 'attack' ? 'pr-chip-attack' : 'pr-chip-normal'}">${run.kind === 'attack' ? 'Attack' : 'Normal'}</span></td>
      <td>${run.scenario}</td><td>${run.agent}</td><td>${outcome(run)}</td>
      <td>${run.actionsUntilCaught === null || run.actionsUntilCaught === undefined ? '—' : run.actionsUntilCaught}</td>
      <td>${run.response}</td>
      <td>${run.kind === 'attack' ? '<span class="pr-chip pr-chip-allowed">Allowed</span>' : '<span class="pr-chip pr-chip-na">n/a</span>'}</td>
    </tr>`).join('');
  }

  function init() {
    renderMetrics();
    renderRuns();
    filterButtons.forEach(button => button.addEventListener('click', () => {
      activeFilter = button.dataset.filter;
      filterButtons.forEach(item => item.classList.toggle('active', item === button));
      renderRuns();
    }));
  }

  return { init };
})();

// ── Toast ──────────────────────────────────────────────────────────────
let toastTimer = null;
function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2500);
}
window.showToast = showToast;

// ══════════════════════════════════════════════════════════════════════
// SHARED GAUGE HELPER
// ══════════════════════════════════════════════════════════════════════
function makeGauge(ringEl, numEl) {
  const CIRC = 2 * Math.PI * 64;
  let current = 0, target = 0, raf = null;

  function setValue(val) {
    const pct    = Math.min(Math.max(val, 0), 100) / 100;
    const offset = CIRC * (1 - pct);
    const color  = scoreColor(val);
    ringEl.style.strokeDashoffset = offset;
    ringEl.style.stroke = color;
    if (numEl) { numEl.textContent = val; numEl.setAttribute('fill', scoreTextColor(val)); }
  }

  function animateTo(tgt, duration) {
    target = tgt;
    if (raf) cancelAnimationFrame(raf);
    const start = current, startTime = performance.now(), dur = duration || 600;
    function step(now) {
      const t    = Math.min((now - startTime) / dur, 1);
      const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
      setValue(Math.round(start + (target - start) * ease));
      if (t < 1) { raf = requestAnimationFrame(step); }
      else { current = target; raf = null; }
    }
    raf = requestAnimationFrame(step);
  }

  function reset() {
    if (raf) cancelAnimationFrame(raf);
    current = 0; target = 0; raf = null; setValue(0);
  }

  setValue(0);
  return { animateTo, reset, setValue };
}

// ══════════════════════════════════════════════════════════════════════
// INTRO CARD
// ══════════════════════════════════════════════════════════════════════
const introCard = (() => {
  const overlayEl = document.getElementById('intro-overlay');
  const progressEl = document.getElementById('intro-progress-fill');

  function fadeOut() {
    overlayEl.classList.add('fade-out');
    introShown = false;
    setTimeout(() => {
      overlayEl.style.display = 'none';
      doPlay();
    }, 510);
  }

  function icInit() {
    progressEl.style.width = '0%';
    requestAnimationFrame(() => { progressEl.style.width = '100%'; });
    setTimeout(fadeOut, INTRO_HOLD_MS);
  }

  return { init: icInit };
})();

// ══════════════════════════════════════════════════════════════════════
// CHAPTER BAR
// ══════════════════════════════════════════════════════════════════════
const chapterBar = (() => {
  const fillEl   = document.getElementById('chapter-progress-fill');
  const labelsEl = document.getElementById('chapter-labels');

  function cbInit() {
    if (!scenario || !scenario.chapters) return;
    const dur = scenario.meta.durationSec;
    labelsEl.innerHTML = scenario.chapters.map((ch, i) => {
      const end = i + 1 < scenario.chapters.length ? scenario.chapters[i + 1].t : dur;
      const width = Math.max(0, end - ch.t) / dur * 100;
      return `<div class="chapter-segment" data-chap-t="${ch.t}" style="width:${width}%"><span class="chapter-label">${ch.name}</span></div>`;
    }).join('');
  }

  function cbUpdate() {
    if (!scenario) return;
    const dur  = scenario.meta.durationSec;
    const pct  = Math.min(elapsed / dur * 100, 100);
    fillEl.style.width = pct + '%';

    const chaps = scenario.chapters || [];
    let currentIdx = 0;
    for (let i = 0; i < chaps.length; i++) {
      if (elapsed >= chaps[i].t) currentIdx = i;
    }
    labelsEl.querySelectorAll('.chapter-segment').forEach((el, i) => {
      el.classList.toggle('current', i === currentIdx);
    });
  }

  return { init: cbInit, update: cbUpdate };
})();

// ══════════════════════════════════════════════════════════════════════
// CAPTION SYSTEM
// ══════════════════════════════════════════════════════════════════════
const captionSystem = (() => {
  const barEl   = document.getElementById('caption-bar');
  let enabled   = true;
  let lastCapIdx = -1;
  let hideTimer  = null;

  function csInit() {
    if (!scenario || !scenario.captions) return;
  }

  function csUpdate() {
    if (!scenario || !scenario.captions || !enabled) return;
    const caps = scenario.captions;
    let activeIdx = -1;
    for (let i = 0; i < caps.length; i++) {
      const c = caps[i];
      if (elapsed >= c.t && c.dur > 0 && elapsed < c.t + c.dur) {
        activeIdx = i; break;
      }
    }
    if (activeIdx === lastCapIdx) return;
    lastCapIdx = activeIdx;

    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }

    if (activeIdx === -1 || !caps[activeIdx].text) {
      barEl.classList.remove('visible');
      mainContentEl.style.setProperty('--caption-reserve', '0px');
      return;
    }
    barEl.textContent = caps[activeIdx].text;
    barEl.classList.add('visible');
    requestAnimationFrame(() => mainContentEl.style.setProperty('--caption-reserve', `${barEl.offsetHeight + 24}px`));
  }

  function hide() {
    barEl.classList.remove('visible');
    mainContentEl.style.setProperty('--caption-reserve', '0px');
    lastCapIdx = -1;
  }

  function toggle() {
    enabled = !enabled;
    if (!enabled) hide();
  }

  return { init: csInit, update: csUpdate, hide, toggle };
})();

// ══════════════════════════════════════════════════════════════════════
// END CARD
// ══════════════════════════════════════════════════════════════════════
const endCard = (() => {
  const overlayEl = document.getElementById('end-overlay');
  const titleEl   = document.getElementById('end-title');
  const linesEl   = document.getElementById('end-lines');
  const checkLinesEl = document.getElementById('end-check-lines');
  const kpisEl    = document.getElementById('end-kpis');
  let shown = false;
  let lineTimers = [];

  function show() {
    if (shown) return;
    shown = true;
    if (!scenario || !scenario.summary) return;

    const sum = scenario.summary;
    titleEl.textContent = sum.title;

    linesEl.innerHTML = sum.lines.map(l => `
      <div class="end-line">
        <span class="end-line-bullet">▶</span>
        <span>${l}</span>
      </div>
    `).join('');

    checkLinesEl.innerHTML = (sum.checkLines || []).map(line => `
      <div class="end-check-line"><span class="end-check-bullet">&#10003;</span><span>${line}</span></div>
    `).join('');

    const shared = getSharedMetrics();
    kpisEl.innerHTML = (metrics.metricDefinitions || []).map(definition => `
      <div class="end-kpi-item">
        <span class="end-kpi-val">${shared.display[definition.key]}</span>
        <span class="end-kpi-lbl">${definition.label}</span>
      </div>
    `).join('');

    overlayEl.style.display = 'flex';

    const revealEls = [...linesEl.querySelectorAll('.end-line'), ...checkLinesEl.querySelectorAll('.end-check-line')];
    const staggerCount = Math.max(1, (sum.lines || []).length);
    revealEls.forEach((el, i) => {
      const t = setTimeout(() => el.classList.add('revealed'), (i % staggerCount) * 180 + 120);
      lineTimers.push(t);
    });
  }

  function hide() {
    overlayEl.style.display = 'none';
  }

  function ecReset() {
    lineTimers.forEach(t => clearTimeout(t));
    lineTimers = [];
    shown = false;
    hide();
  }

  return { show, reset: ecReset };
})();

// ══════════════════════════════════════════════════════════════════════
// KEYBOARD SHORTCUTS
// ══════════════════════════════════════════════════════════════════════
const shortcuts = (() => {
  let cleanMode     = false;

  function skInit() {
    document.addEventListener('keydown', e => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (introShown) { if (e.code === 'Space') e.preventDefault(); return; }

      switch (e.code) {
        case 'Space':
          e.preventDefault();
          playing ? doPause() : doPlay();
          break;
        case 'KeyR':
          restartPlayback();
          break;
        case 'Digit1':
          speed = 1;
          break;
        case 'Digit2':
          speed = 2;
          break;
        case 'KeyF':
          if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {});
          else document.exitFullscreen().catch(() => {});
          break;
        case 'KeyC':
          captionSystem.toggle();
          break;
        case 'KeyH':
          cleanMode = !cleanMode;
          document.body.classList.toggle('clean-mode', cleanMode);
          break;
      }
    });
  }

  return { init: skInit };
})();

// ══════════════════════════════════════════════════════════════════════
// TIMELINE MODULE
// ══════════════════════════════════════════════════════════════════════
const timeline = (() => {
  const history = {};
  let selectedAgent = 'procurement-01';
  let filterMode    = 'all';

  const agentCardsEl = document.getElementById('tl-agent-cards');
  const feedEl       = document.getElementById('tl-feed');
  const feedWrapEl   = document.getElementById('tl-feed-wrap');
  const emptyEl      = document.getElementById('tl-empty');
  const filterAllBtn = document.getElementById('tl-filter-all');
  const filterFlagBtn= document.getElementById('tl-filter-flagged');
  const statusChip   = document.getElementById('tl-risk-status-chip');
  const sparkLine    = document.getElementById('tl-sparkline-line');
  const sparkDots    = document.getElementById('tl-sparkline-dots');
  const cntEvents    = document.getElementById('tl-cnt-events');
  const cntFlagged   = document.getElementById('tl-cnt-flagged');
  const cntBlocked   = document.getElementById('tl-cnt-blocked');
  let gauge = null;

  const TAG_CFG = {
    'UNTRUSTED INPUT': { cls: 'tl-tag-untrusted', icon: '⚠',  caption: 'Content from outside the organization entered the session' },
    'OUT OF ROLE':     { cls: 'tl-tag-outrole',   icon: '⛔', caption: 'Outside the declared role contract' },
    'CANARY HIT':      { cls: 'tl-tag-canary',     icon: '🐦', caption: 'Decoy file touched, likely compromise' },
    'NEW DESTINATION': { cls: 'tl-tag-newdest',    icon: '📤', caption: 'Data sent to an unapproved destination' },
  };

  function fmtTime(sec) {
    return String(Math.floor(sec / 60)).padStart(2, '0') + ':' +
           String(Math.floor(sec % 60)).padStart(2, '0');
  }

  function cardBorderClass(ev) {
    if (!ev.tags || !ev.tags.length) return '';
    if (ev.tags.includes('UNTRUSTED INPUT'))  return 'border-watching';
    if (ev.tags.includes('OUT OF ROLE'))      return 'border-restricted';
    if (ev.tags.includes('CANARY HIT'))       return 'border-quarantined';
    if (ev.tags.includes('NEW DESTINATION'))  return 'border-quarantined';
    return '';
  }

  function nodeClass(status) {
    const map = { healthy:'tl-node-healthy', watching:'tl-node-watching',
                  restricted:'tl-node-restricted', quarantined:'tl-node-quarantined' };
    return map[status] || 'tl-node-healthy';
  }

  function pillStyle(score) {
    const border = scoreColor(score);
    const text = scoreTextColor(score);
    return `color:${text};border-color:${border}55;`;
  }

  function buildTagsHtml(tags) {
    if (!tags || !tags.length) return '';
    return tags.map(t => {
      const cfg = TAG_CFG[t] || { cls:'', icon:'' };
      return `<span class="tl-tag ${cfg.cls}">${cfg.icon} ${t}</span>`;
    }).join('');
  }

  function buildCaptionHtml(tags) {
    if (!tags || !tags.length) return '';
    for (const t of tags) {
      if (TAG_CFG[t] && TAG_CFG[t].caption)
        return `<div class="tl-card-caption">${TAG_CFG[t].caption}</div>`;
    }
    return '';
  }

  function buildBadgeHtml(status) {
    if (status === 'restricted')
      return `<span class="tl-resp-badge tl-resp-restricted">⊘ RESTRICTED</span>`;
    if (status === 'quarantined')
      return `<span class="tl-resp-badge tl-resp-quarantined">☣ QUARANTINED</span>`;
    return '';
  }

  function hasLinkToPrev(evList, idx) {
    const ev = evList[idx];
    if (!ev.tags) return false;
    const needs = ev.tags.includes('OUT OF ROLE') || ev.tags.includes('NEW DESTINATION');
    if (!needs) return false;
    for (let i = idx - 1; i >= 0; i--) {
      if (evList[i].tags && evList[i].tags.includes('UNTRUSTED INPUT')) return true;
      if (evList[i].tags && evList[i].tags.length > 0) break;
    }
    return false;
  }

  function buildRow(ev, evList, idx) {
    const wrapper = document.createElement('div');
    wrapper.className = 'tl-row';
    wrapper.dataset.linked = hasLinkToPrev(evList, idx) ? 'true' : 'false';
    if (filterMode === 'flagged' && (!ev.tags || !ev.tags.length))
      wrapper.classList.add('hidden');

    const tagsHtml    = buildTagsHtml(ev.tags);
    const captionHtml = buildCaptionHtml(ev.tags);
    const badgeHtml   = buildBadgeHtml(ev.status);
    const border      = cardBorderClass(ev);
    const scoreVal    = ev.score !== undefined ? ev.score : 0;

    wrapper.innerHTML = `
      <div class="tl-node ${nodeClass(ev.status)}"></div>
      <div class="tl-card ${border}">
        <div class="tl-card-top">
          <span class="tl-card-time">${fmtTime(ev.t)}</span>
          <span class="tl-card-text">${ev.text || ''}</span>
          <span class="tl-card-score-pill" style="${pillStyle(scoreVal)}">Risk ${scoreVal}</span>
        </div>
        ${tagsHtml ? `<div class="tl-card-tags">${tagsHtml}</div>` : ''}
        ${captionHtml}
        ${badgeHtml ? `<div class="tl-card-badges">${badgeHtml}</div>` : ''}
      </div>
    `;
    return wrapper;
  }

  function renderFeed() {
    feedEl.innerHTML = '';
    const evList = history[selectedAgent] || [];
    if (!evList.length) { feedEl.appendChild(emptyEl); emptyEl.style.display = 'flex'; return; }
    evList.forEach((ev, idx) => {
      if (hasLinkToPrev(evList, idx)) feedEl.appendChild(buildLinkConnector());
      feedEl.appendChild(buildRow(ev, evList, idx));
    });
    feedEl.scrollTo({ top: feedEl.scrollHeight, behavior: 'instant' });
  }

  function buildLinkConnector() {
    const link = document.createElement('div');
    link.className = 'tl-link-connector';
    link.innerHTML = '<span class="tl-link-line"></span><span class="tl-link-chip" title="Came right after untrusted input">Linked</span>';
    return link;
  }

  function updateRiskPanel() {
    const evList = history[selectedAgent] || [];
    const agent  = agents.find(a => a.id === selectedAgent);
    const score  = agent ? agent.score : 0;
    const status = agent ? agent.status : 'healthy';

    cntEvents.textContent  = evList.length;
    cntFlagged.textContent = evList.filter(e => e.tags && e.tags.length).length;
    cntBlocked.textContent = evList.filter(e => e.status === 'restricted' || e.status === 'quarantined').length;

    statusChip.textContent = status;
    statusChip.className   = `status-chip ${chipClass(status)}`;

    if (gauge) gauge.animateTo(score, 600);
    renderSparkline(evList);
  }

  function renderSparkline(evList) {
    if (!evList.length) { sparkLine.setAttribute('points',''); sparkDots.innerHTML=''; return; }
    const W=240, H=60, PAD=6;
    const scores = evList.map(e => e.score !== undefined ? e.score : 0);
    const maxS = Math.max(100, ...scores);
    const pts = scores.map((s, i) => {
      const x = PAD + (scores.length === 1 ? W/2-PAD : (i/(scores.length-1))*(W-PAD*2));
      const y = H - PAD - (s/maxS)*(H-PAD*2);
      return `${x},${y}`;
    });
    sparkLine.setAttribute('points', pts.join(' '));
    sparkDots.innerHTML = pts.map(p => {
      const [x,y] = p.split(',');
      return `<circle class="tl-sparkline-dot" cx="${x}" cy="${y}" r="2.5"/>`;
    }).join('');
  }

  function renderAgentCards() {
    agentCardsEl.innerHTML = agents.map(a => {
      const isSelected = a.id === selectedAgent;
      const color      = scoreTextColor(a.score);
      return `
        <div class="tl-agent-card ${isSelected?'selected':''}" data-agentid="${a.id}">
          <div class="tl-card-id">${a.id}</div>
          <div class="tl-card-role">${a.role}</div>
          <div class="tl-card-meta">
            <span class="status-chip ${chipClass(a.status)}">${a.status}</span>
            <span class="tl-card-score" style="color:${color}">${a.score}</span>
          </div>
        </div>
      `;
    }).join('');

    agentCardsEl.querySelectorAll('.tl-agent-card').forEach(card => {
      card.addEventListener('click', () => {
        selectedAgent = card.dataset.agentid;
        renderAgentCards(); renderFeed(); updateRiskPanel();
      });
    });
  }

  function applyFilter() {
    feedEl.querySelectorAll('.tl-row').forEach(row => {
      const hasTag = row.querySelector('.tl-tag') !== null;
      row.classList.toggle('hidden', filterMode === 'flagged' && !hasTag);
    });
  }

  function tlInit() {
    if (scenario) scenario.agents.forEach(a => { history[a.id] = []; });
    gauge = makeGauge(document.getElementById('tl-gauge-ring'), document.getElementById('tl-gauge-num'));
    renderAgentCards(); renderFeed(); updateRiskPanel();

    filterAllBtn.addEventListener('click', () => {
      filterMode = 'all';
      filterAllBtn.classList.add('active'); filterFlagBtn.classList.remove('active');
      applyFilter();
    });
    filterFlagBtn.addEventListener('click', () => {
      filterMode = 'flagged';
      filterFlagBtn.classList.add('active'); filterAllBtn.classList.remove('active');
      applyFilter();
    });
  }

  function tlAddEvent(ev) {
    if (!ev.agent) return;
    if (!history[ev.agent]) history[ev.agent] = [];
    const evList = history[ev.agent];
    evList.push(ev);
    renderAgentCards();

    if (ev.agent === selectedAgent) {
      const existingEmpty = feedEl.querySelector('.tl-empty');
      if (existingEmpty) existingEmpty.remove();
      if (hasLinkToPrev(evList, evList.length - 1)) feedEl.appendChild(buildLinkConnector());
      feedEl.appendChild(buildRow(ev, evList, evList.length - 1));
      feedEl.scrollTo({ top: feedEl.scrollHeight, behavior: 'smooth' });
      autoScrollTo(feedEl.lastElementChild);
      if (ev.score && ev.score >= 60) {
        feedWrapEl.classList.add('alert-flash');
        setTimeout(() => feedWrapEl.classList.remove('alert-flash'), 1200);
      }
      updateRiskPanel();
    } else {
      updateRiskPanel();
    }
  }

  function tlAutoSelectAgent(agentId) {
    if (selectedAgent === agentId) return;
    selectedAgent = agentId;
    renderAgentCards(); renderFeed(); updateRiskPanel();
  }

  function tlReset() {
    Object.keys(history).forEach(k => { history[k] = []; });
    selectedAgent = 'procurement-01';
    if (gauge) gauge.reset();
    filterMode = 'all';
    filterAllBtn.classList.add('active'); filterFlagBtn.classList.remove('active');
    renderAgentCards(); renderFeed(); updateRiskPanel();
  }

  return { init: tlInit, addEvent: tlAddEvent, autoSelectAgent: tlAutoSelectAgent, reset: tlReset };
})();

// ══════════════════════════════════════════════════════════════════════
// ALERT SCREEN MODULE
// ══════════════════════════════════════════════════════════════════════
const alertScreen = (() => {
  let firedAlerts   = [];
  let activeAlertId = null;
  let gauge         = null;
  let revealTimers  = [];

  const emptyEl     = document.getElementById('al-empty');
  const bodyEl      = document.getElementById('al-body');
  const tabsEl      = document.getElementById('al-tabs');
  const metaEl      = document.getElementById('al-meta');
  const compareVerd = document.getElementById('al-compare-verdict');
  const compareIcon = document.getElementById('al-compare-icon');
  const compareCap  = document.getElementById('al-compare-caption');
  const compareDg   = document.getElementById('al-compare-dg');
  const signalsCol  = document.getElementById('al-signals-col');
  const stackedBar  = document.getElementById('al-stacked-bar');
  const stackedLeg  = document.getElementById('al-stacked-legend');
  const reasonsList = document.getElementById('al-reasons-list');
  const scoreTotal  = document.getElementById('al-score-total');
  const evidTrail   = document.getElementById('al-evidence-trail');
  const judgeQuote  = document.getElementById('al-judge-quote');
  const ladderEl    = document.getElementById('al-ladder');
  const checklistEl = document.getElementById('al-checklist');
  const btnApprove  = document.getElementById('al-btn-approve');
  const btnReject   = document.getElementById('al-btn-reject');

  const SEG_COLORS  = [cssColor('--quarantined'), cssColor('--restricted'), cssColor('--watching'), cssColor('--ok'), cssColor('--accent')];
  const SEG_TEXT_COLORS = [cssColor('--quarantined'), cssColor('--restricted-text'), cssColor('--watching-text'), cssColor('--ok-text'), cssColor('--accent')];
  const SIG_FIRED   = ['fired-red','fired-orange','fired-amber','fired-green','fired-red'];

  function fmtTime(sec) {
    return String(Math.floor(sec/60)).padStart(2,'0') + ':' + String(Math.floor(sec%60)).padStart(2,'0');
  }

  function getAlert(id) { return scenario && scenario.alerts ? scenario.alerts.find(a => a.id === id) : null; }
  function clearTimers() { revealTimers.forEach(t => clearTimeout(t)); revealTimers = []; }

  function alInit() {
    gauge = makeGauge(document.getElementById('al-gauge-ring'), document.getElementById('al-gauge-num'));
    btnApprove.addEventListener('click', () => showToast('Demo only'));
    btnReject .addEventListener('click', () => showToast('Demo only'));
  }

  function renderTabs() {
    if (!scenario || !scenario.alerts) return;
    tabsEl.innerHTML = scenario.alerts.map((al, i) => {
      const label    = `Alert ${i+1} · ${al.severity === 'Critical' ? 'Quarantined' : 'Restricted'}`;
      const isFired  = firedAlerts.includes(al.id);
      const isActive = al.id === activeAlertId;
      return `<button class="al-tab ${isActive?'active':''} ${!isFired?'dim':''}" data-alertid="${al.id}">${label}</button>`;
    }).join('');
    tabsEl.querySelectorAll('.al-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        if (!firedAlerts.includes(btn.dataset.alertid)) return;
        show(btn.dataset.alertid, { animate: true });
      });
    });
  }

  function renderMeta(al) {
    const agentData = scenario.agents.find(a => a.id === al.agent);
    const role = agentData ? agentData.role : al.agent;
    const sevCls = al.severity === 'Critical' ? 'al-sev-critical' : 'al-sev-high';
    metaEl.innerHTML = `Agent: <strong>${al.agent}</strong> · Role: ${role} · Raised at ${fmtTime(al.raisedAt)} <span class="al-severity-badge ${sevCls}">${al.severity.toUpperCase()}</span>`;
  }

  function renderCompare(al) {
    const isQ = al.score >= 90;
    compareVerd.textContent = isQ ? 'QUARANTINED' : 'RESTRICTED';
    compareVerd.className   = `al-compare-verdict ${isQ ? 'al-verdict-quarantine' : 'al-verdict-restrict'}`;
    compareIcon.textContent = isQ ? '☣' : '🛡';
    compareDg.classList.toggle('glow-quarantine', isQ);
    compareDg.classList.toggle('glow-restrict',   !isQ);
  }

  function renderSignals(al, animate) {
    signalsCol.innerHTML = (al.signals || []).map((sig, i) => {
      const firedCls = sig.fired ? (SIG_FIRED[i] || 'fired-red') : 'dim';
      return `<div class="al-signal-chip ${firedCls}" style="${animate?`opacity:0;transition-delay:${i*120}ms`:''}">
        <span>${sig.name}</span><span class="al-signal-pts">${sig.fired?`+${sig.points}`:'clear'}</span>
      </div>`;
    }).join('');
    if (animate) {
      signalsCol.querySelectorAll('.al-signal-chip').forEach((chip, i) => {
        const t = setTimeout(() => { chip.style.opacity = ''; }, 100 + i*130);
        revealTimers.push(t);
      });
    }
  }

  function renderStackedBar(al, animate) {
    stackedBar.style.width = animate ? '0%' : al.score + '%';
    stackedBar.innerHTML   = al.reasons.map((r, i) => `<div class="al-stacked-seg" style="flex:${r.points};background:${SEG_COLORS[i%SEG_COLORS.length]}"></div>`).join('');
    stackedLeg.innerHTML   = al.reasons.map((r, i) => `
      <div class="al-legend-item"><div class="al-legend-swatch" style="background:${SEG_COLORS[i%SEG_COLORS.length]}"></div><span>${r.text.substring(0,32)}… (+${r.points})</span></div>`).join('');
    if (animate) {
      const t = setTimeout(() => { stackedBar.style.transition = 'width 0.8s ease'; stackedBar.style.width = al.score + '%'; }, 300);
      revealTimers.push(t);
    }
  }

  function renderReasons(al, animate) {
    const maxPts = Math.max(...al.reasons.map(r => r.points));
    reasonsList.innerHTML = al.reasons.map((r, i) => {
      const color = SEG_TEXT_COLORS[i%SEG_TEXT_COLORS.length];
      return `<div class="al-reason-row" data-idx="${i}">
        <span class="al-reason-icon" style="color:${color}">◆</span>
        <span class="al-reason-text">${r.text}</span>
        <span class="al-reason-pts" style="color:${color}">+${r.points}</span>
        <div class="al-reason-bar-wrap"><div class="al-reason-bar-fill" style="width:${(r.points/maxPts)*100}%;background:${color}"></div></div>
      </div>`;
    }).join('');
    scoreTotal.textContent = `Total risk score: ${al.score} / 100`;
    if (animate) {
      reasonsList.querySelectorAll('.al-reason-row').forEach((row, i) => {
        const t = setTimeout(() => row.classList.add('revealed'), 800 + i*400);
        if (i === al.reasons.length - 1) setTimeout(() => autoScrollTo(reasonsList), 850 + i*400);
        revealTimers.push(t);
      });
    } else {
      reasonsList.querySelectorAll('.al-reason-row').forEach(r => r.classList.add('revealed'));
    }
  }

  function renderEvidence(al) {
    let html = '';
    if (al.priorEvent) {
      html += `<div class="al-ev-item"><span class="al-ev-time">${fmtTime(al.raisedAt-25)}</span><span class="al-ev-text">${al.priorEvent}</span></div>
               <div class="al-ev-connector"><div class="al-ev-conn-line"></div><span class="al-ev-conn-label">🔗 Linked</span></div>`;
    }
    html += `<div class="al-ev-item" style="border-color:var(--restricted)"><span class="al-ev-time">${fmtTime(al.raisedAt)}</span><span class="al-ev-text">${al.triggerEvent}</span></div>`;
    evidTrail.innerHTML = html;
  }

  function renderLadder(al) {
    const steps = [
      { name:'Allow',     icon:'✓', range:'0 – 29',   max:29  },
      { name:'Ask human', icon:'?', range:'30 – 59',  max:59  },
      { name:'Restrict',  icon:'⊘', range:'60 – 89',  max:89  },
      { name:'Quarantine',icon:'☣', range:'90 – 100', max:100 },
    ];
    const activeIdx = al.score >= 90 ? 3 : al.score >= 60 ? 2 : al.score >= 30 ? 1 : 0;
    ladderEl.innerHTML = steps.map((s, i) => {
      const cls = i < activeIdx ? 'filled' : i === activeIdx ? 'active' : 'dim';
      return `<div class="al-ladder-step ${cls}">
        <div class="al-ladder-icon">${s.icon}</div>
        <div class="al-ladder-name">${s.name}</div>
        <div class="al-ladder-range">${s.range}</div>
        ${i === activeIdx ? '<div class="al-ladder-active-dot"></div>' : ''}
      </div>`;
    }).join('');
  }

  function renderChecklist(al, animate) {
    checklistEl.innerHTML = (al.actions || []).map((action, i) => `
      <div class="al-check-item" data-ci="${i}"><div class="al-check-icon">✓</div><span>${action}</span></div>`).join('');
    if (animate) {
      checklistEl.querySelectorAll('.al-check-item').forEach((item, i) => {
        const t = setTimeout(() => {
          item.classList.add('checked');
          if (i === (al.actions || []).length - 1) autoScrollTo(document.querySelector('.al-response-panel'));
        }, 2200 + i*500);
        revealTimers.push(t);
      });
    } else {
      checklistEl.querySelectorAll('.al-check-item').forEach(item => item.classList.add('checked'));
    }
  }

  function show(id, opts) {
    const al = getAlert(id);
    if (!al) return;
    const animate = opts && opts.animate;
    clearTimers();
    if (!firedAlerts.includes(id)) firedAlerts.push(id);
    activeAlertId = id;
    emptyEl.style.display = 'none';
    bodyEl.style.display  = 'flex';
    renderTabs(); renderMeta(al); renderCompare(al);
    renderSignals(al, animate); renderStackedBar(al, animate);
    renderReasons(al, animate); renderEvidence(al);
    judgeQuote.textContent = al.judgeNote || '';
    renderLadder(al); renderChecklist(al, animate);
    if (animate) {
      autoScrollTo(document.querySelector('.al-compare-strip'));
      const stageTimer = setTimeout(() => autoScrollTo(document.querySelector('.al-stacked-bar-wrap')), 700);
      const ladderTimer = setTimeout(() => autoScrollTo(ladderEl), 1800);
      revealTimers.push(stageTimer, ladderTimer);
    }
    if (animate) { gauge.reset(); const t = setTimeout(() => gauge.animateTo(al.score, 800), 200); revealTimers.push(t); }
    else gauge.setValue(al.score);
  }

  function onNavigate() { if (activeAlertId) renderTabs(); }

  function reset() {
    clearTimers(); firedAlerts = []; activeAlertId = null;
    if (gauge) gauge.reset();
    emptyEl.style.display = 'flex';
    bodyEl.style.display  = 'none';
    renderTabs();
  }

  return { init: alInit, show, reset, onNavigate };
})();

// ══════════════════════════════════════════════════════════════════════
// DRIFT SCREEN MODULE
// ══════════════════════════════════════════════════════════════════════
const driftScreen = (() => {
  let mainChart = null, naiveChart = null, revealed = 0, started = false, revealTimer = null;

  const mainPanelEl = document.getElementById('dr-main-panel');
  const overlayEl   = document.getElementById('dr-overlay-msg');
  const statusChipEl= document.getElementById('dr-status-chip');
  const naiveStatEl = document.getElementById('dr-naive-status');
  const calloutsEl  = document.getElementById('dr-callouts-list');
  const explainersEl= document.getElementById('dr-explainers');

  const GRID = cssColor('--chart-grid');
  const TICK = cssColor('--text-muted');
  const LEGEND = cssColor('--text');
  const FF = "'Inter',sans-serif";

  function dsc(extra) {
    return Object.assign({ grid: { color: GRID }, ticks: { color: TICK, font: { family: FF, size: 11 } } }, extra || {});
  }

  const alertPlugin = {
    id: 'alertRegion',
    afterDraw(chart, _a, opts) {
      if (!opts || opts.alertIndex === undefined || opts.revealedDays === undefined) return;
      if (opts.revealedDays <= opts.alertIndex) return;
      const { ctx, chartArea, scales } = chart;
      const xScale = scales['x'];
      if (!xScale) return;
      const x0 = xScale.getPixelForValue(opts.alertIndex), x1 = chartArea.right;
      ctx.save();
      ctx.fillStyle = cssColor('--danger-region');
      ctx.fillRect(x0, chartArea.top, x1 - x0, chartArea.bottom - chartArea.top);
      ctx.strokeStyle = cssColor('--quarantined'); ctx.lineWidth = 1.5; ctx.setLineDash([4,3]);
      ctx.beginPath(); ctx.moveTo(x0, chartArea.top); ctx.lineTo(x0, chartArea.bottom); ctx.stroke();
      ctx.setLineDash([]); ctx.fillStyle = cssColor('--quarantined'); ctx.font = `600 11px ${FF}`;
      ctx.fillText('Alert raised', x0+5, chartArea.top+14);
      ctx.restore();
    },
  };

  function buildMainChart(d, days) {
    const labels  = d.labels.slice(0, days);
    const frozen  = d.frozen.slice(0, days);
    const rolling = d.rolling.slice(0, days);
    const drift   = rolling.map((v,i) => parseFloat((v-(d.frozen[i]||0)).toFixed(4)));
    const cusum   = d.cusum.slice(0, days);
    const thresh  = Array(days).fill(d.threshold);
    const canvas  = document.getElementById('dr-main-canvas');
    if (mainChart) mainChart.destroy();
    mainChart = new Chart(canvas, {
      type: 'line', plugins: [alertPlugin],
      data: { labels, datasets: [
        { label:'Frozen baseline',  data:frozen,  borderColor:cssColor('--frozen-baseline'), borderDash:[6,3], borderWidth:1.5, pointRadius:0, tension:0, yAxisID:'yLeft', fill:false },
        { label:'Rolling baseline', data:rolling, borderColor:cssColor('--watching'), borderWidth:2, pointRadius:3, pointBackgroundColor:cssColor('--watching'), tension:0.3, yAxisID:'yLeft', fill:false },
        { label:'Drift from frozen',data:drift,   borderColor:cssColor('--quarantined'), borderWidth:1.5, pointRadius:0, tension:0.3, yAxisID:'yLeft', fill:true, backgroundColor:cssColor('--danger-fill') },
        { label:'CUSUM',            data:cusum,   borderColor:cssColor('--restricted'), borderWidth:3, pointRadius:4, pointBackgroundColor:cssColor('--restricted'), tension:0.2, yAxisID:'yRight', fill:false },
        { label:'Alert threshold',  data:thresh,  borderColor:cssColor('--neutral-line'), borderDash:[5,4], borderWidth:1.5, pointRadius:0, tension:0, yAxisID:'yRight', fill:false },
      ]},
      options: {
        responsive:true, maintainAspectRatio:false, animation:{ duration:400 },
        plugins: {
          alertRegion: { alertIndex:d.alertIndex, revealedDays:days },
          legend: { position:'bottom', labels:{ color:LEGEND, font:{family:FF,size:11}, usePointStyle:true, pointStyleWidth:20, padding:16 } },
          tooltip: { backgroundColor:cssColor('--panel'), borderColor:cssColor('--border'), borderWidth:1, titleColor:cssColor('--text'), bodyColor:cssColor('--text-muted'), padding:10 },
        },
        scales: {
          x: { ...dsc(), border:{ color:GRID } },
          yLeft:  { ...dsc(), position:'left',  min:0, max:0.7, border:{color:GRID}, title:{display:true, text:'Distance from approved behavior', color:TICK, font:{family:FF,size:11}} },
          yRight: { ...dsc({ grid:{ display:false } }), position:'right', min:0, max:16, border:{color:GRID}, title:{display:true, text:'CUSUM (cumulative drift)', color:TICK, font:{family:FF,size:11}} },
        },
      },
    });
  }

  function updateMainChart(d, days) {
    if (!mainChart) { buildMainChart(d, days); return; }
    const rolling = d.rolling.slice(0,days);
    mainChart.data.labels           = d.labels.slice(0,days);
    mainChart.data.datasets[0].data = d.frozen.slice(0,days);
    mainChart.data.datasets[1].data = rolling;
    mainChart.data.datasets[2].data = rolling.map((v,i) => parseFloat((v-(d.frozen[i]||0)).toFixed(4)));
    mainChart.data.datasets[3].data = d.cusum.slice(0,days);
    mainChart.data.datasets[4].data = Array(days).fill(d.threshold);
    mainChart.options.plugins.alertRegion.revealedDays = days;
    mainChart.update('active');
  }

  function buildNaiveChart(d, days) {
    const canvas = document.getElementById('dr-naive-canvas');
    if (naiveChart) naiveChart.destroy();
    const n      = Math.min(days, d.rolling.length);
    const labels = d.labels.slice(1,n);
    const deltas = d.rolling.slice(1,n).map((v,i) => parseFloat((v-d.rolling[i]).toFixed(4)));
    const thr    = d.naiveThreshold || 0.15;
    naiveChart = new Chart(canvas, {
      type:'bar',
      data: { labels, datasets: [
        { label:'Day-over-day change', data:deltas, backgroundColor:cssColor('--warning-chart-fill'), borderColor:cssColor('--watching'), borderWidth:1, borderRadius:3 },
        { label:'Naive alert threshold', data:Array(labels.length).fill(thr), type:'line', borderColor:cssColor('--neutral-line'), borderDash:[4,3], borderWidth:1.5, pointRadius:0, fill:false },
      ]},
      options: {
        responsive:true, maintainAspectRatio:false, animation:{duration:300},
        plugins: {
          legend:  { position:'bottom', labels:{ color:LEGEND, font:{family:FF,size:10}, usePointStyle:true, padding:10 } },
          tooltip: { backgroundColor:cssColor('--panel'), borderColor:cssColor('--border'), borderWidth:1, titleColor:cssColor('--text'), bodyColor:cssColor('--text-muted'), padding:8 },
        },
        scales: { x:dsc({ border:{color:GRID} }), y:{ ...dsc(), min:0, max:thr*2, border:{color:GRID} } },
      },
    });
  }

  function updateNaiveChart(d, days) {
    if (!naiveChart) { buildNaiveChart(d, days); return; }
    const n      = Math.min(days, d.rolling.length);
    const labels = d.labels.slice(1,n);
    const deltas = d.rolling.slice(1,n).map((v,i) => parseFloat((v-d.rolling[i]).toFixed(4)));
    naiveChart.data.labels           = labels;
    naiveChart.data.datasets[0].data = deltas;
    naiveChart.data.datasets[1].data = Array(labels.length).fill(d.naiveThreshold||0.15);
    naiveChart.update('active');
  }

  function renderCallouts() {
    if (!scenario) return;
    calloutsEl.innerHTML = (scenario.drift.callouts||[]).map((c,i) => `
      <div class="dr-callout-row" id="dr-callout-${i}">
        <div class="dr-callout-num">${String(i+1).padStart(2,'0')}</div>
        <div class="dr-callout-text">${c.text}</div>
      </div>`).join('');
  }

  function lightCallouts(days) {
    if (!scenario) return;
    const d = scenario.drift;
    (d.callouts||[]).forEach((c,i) => {
      const el = document.getElementById(`dr-callout-${i}`);
      if (!el) return;
      if (days > c.index) {
        el.classList.remove('lit','lit-alert');
        el.classList.add(c.index === d.alertIndex ? 'lit-alert' : 'lit');
      }
    });
  }

  function renderExplainers() {
    if (!scenario) return;
    explainersEl.innerHTML = (scenario.drift.explainers||[]).map(e => `
      <div class="dr-explainer-card">
        <div class="dr-explainer-title">${e.title}</div>
        <div class="dr-explainer-text">${e.text}</div>
      </div>`).join('');
  }

  function revealStep() {
    if (!scenario) return;
    const d = scenario.drift;
    revealed++;
    overlayEl.classList.add('hidden');
    updateMainChart(d, revealed); updateNaiveChart(d, revealed); lightCallouts(revealed);
    autoScrollTo(mainPanelEl);
    if (revealed > d.alertIndex) {
      statusChipEl.textContent = `Drift detected at day ${d.alertIndex+1}`;
      statusChipEl.classList.add('alert');
      mainPanelEl.classList.add('alert-flash');
      setTimeout(() => mainPanelEl.classList.remove('alert-flash'), 1200);
    }
    if (revealed >= d.labels.length) { naiveStatEl.classList.add('visible'); autoScrollTo(explainersEl); return; }
    revealTimer = setTimeout(revealStep, 800 / speed);
  }

  function drInit() { renderCallouts(); renderExplainers(); }

  function drStart() {
    if (started) return;
    started = true;
    if (!scenario) return;
    buildMainChart(scenario.drift, 1); buildNaiveChart(scenario.drift, 1);
    autoScrollTo(mainPanelEl);
    revealed = 1; overlayEl.classList.add('hidden'); lightCallouts(1);
    revealTimer = setTimeout(revealStep, 800 / speed);
  }

  function drOnNavigate() {
    if (!started) return;
    if (mainChart)  mainChart.resize();
    if (naiveChart) naiveChart.resize();
  }

  function drReset() {
    if (revealTimer) { clearTimeout(revealTimer); revealTimer = null; }
    if (mainChart)  { mainChart.destroy();  mainChart  = null; }
    if (naiveChart) { naiveChart.destroy(); naiveChart = null; }
    started = false; revealed = 0;
    overlayEl.classList.remove('hidden');
    statusChipEl.textContent = 'Monitoring'; statusChipEl.classList.remove('alert');
    naiveStatEl.classList.remove('visible');
    mainPanelEl.classList.remove('alert-flash');
    renderCallouts();
  }

  return { init: drInit, start: drStart, onNavigate: drOnNavigate, reset: drReset };
})();

// ══════════════════════════════════════════════════════════════════════
// CHAIN SCREEN MODULE
// ══════════════════════════════════════════════════════════════════════
const chainScreen = (() => {
  const NS = 'http://www.w3.org/2000/svg';
  const svgEl        = document.getElementById('ch-svg');
  const edgesG       = document.getElementById('ch-edges-g');
  const nodesG       = document.getElementById('ch-nodes-g');
  const packetsG     = document.getElementById('ch-packets-g');
  const overlayTxt   = document.getElementById('ch-svg-overlay');
  const captionEl    = document.getElementById('ch-caption');
  const toggleWith   = document.getElementById('ch-toggle-with');
  const toggleWithout= document.getElementById('ch-toggle-without');
  const cntComp      = document.getElementById('ch-cnt-compromised');
  const cntAff       = document.getElementById('ch-cnt-affected');
  const cntCut       = document.getElementById('ch-cnt-cut');
  const authListEl   = document.getElementById('ch-auth-list');
  const authNoteEl   = document.getElementById('ch-auth-note');
  const logFeedEl    = document.getElementById('ch-log-feed');

  const CAPTIONS = {
    with:    'Taint and authority are tracked across every agent-to-agent call',
    without: 'Illustrative: how one compromise could spread through the chain',
  };

  const STATUS_CFG = {
    healthy:     { fill:cssColor('--ok-bg'), stroke:cssColor('--ok'), textColor:cssColor('--text'), dot:cssColor('--ok-text') },
    watching:    { fill:cssColor('--watching-bg'), stroke:cssColor('--watching'), textColor:cssColor('--text'), dot:cssColor('--watching-text') },
    restricted:  { fill:cssColor('--restricted-bg'), stroke:cssColor('--restricted'), textColor:cssColor('--text'), dot:cssColor('--restricted-text') },
    quarantined: { fill:cssColor('--quarantined-bg'), stroke:cssColor('--quarantined'), textColor:cssColor('--text'), dot:cssColor('--quarantined') },
    untrusted:   { fill:cssColor('--watching-bg'), stroke:cssColor('--watching'), textColor:cssColor('--text'), dot:cssColor('--watching-text'), dashed:true },
    blocked:     { fill:cssColor('--quarantined-bg'), stroke:cssColor('--quarantined'), textColor:cssColor('--text'), dot:cssColor('--quarantined') },
  };

  const ICONS = { doc:'📄', robot:'🤖', cloud:'☁' };
  const NW = 180, NH = 78, NR = 14;

  let mode='with', started=false, stepIdx=0, stepTimer=null, packetRAFs=[], logStart=0;

  function svgEl_(tag, attrs) {
    const el = document.createElementNS(NS, tag);
    Object.entries(attrs||{}).forEach(([k,v]) => el.setAttribute(k,v));
    return el;
  }

  function nodeCx(n) { return n.x + NW/2; }
  function nodeCy(n) { return n.y + NH/2; }

  function edgePts(fn, tn) {
    return { fx:fn.x+NW, fy:fn.y+NH/2, tx:tn.x, ty:tn.y+NH/2 };
  }

  function drawNodes(ns) {
    nodesG.innerHTML = '';
    scenario.chain.nodes.forEach(n => {
      const status = (ns&&ns[n.id]) || 'healthy';
      const cfg    = STATUS_CFG[status] || STATUS_CFG.healthy;
      const g      = svgEl_('g', { id:`ch-node-${n.id}` });
      const rect   = svgEl_('rect', { x:n.x, y:n.y, width:NW, height:NH, rx:NR, ry:NR,
        fill:cfg.fill, stroke:cfg.stroke, 'stroke-width':'2',
        'stroke-dasharray': cfg.dashed?'6 3':'none' });
      if (status==='quarantined') rect.style.animation='chPulse 2s ease-in-out infinite';
      g.appendChild(rect);

      const badge = svgEl_('circle',{ cx:n.x+24, cy:n.y+NH/2, r:16, fill:cfg.fill, stroke:cfg.stroke, 'stroke-width':'1' });
      g.appendChild(badge);

      const icon = svgEl_('text', { x:n.x+24, y:n.y+NH/2, 'text-anchor':'middle', 'dominant-baseline':'middle', 'font-size':'14' });
      icon.textContent = ICONS[n.icon]||'▪'; g.appendChild(icon);

      const label = svgEl_('text', { x:n.x+50, y:n.y+26, 'text-anchor':'start', 'dominant-baseline':'middle', 'font-family':'Inter,sans-serif','font-size':'12','font-weight':'700', fill:cfg.textColor });
      label.textContent = n.label; g.appendChild(label);

      const sub = svgEl_('text', { x:n.x+50, y:n.y+44, 'text-anchor':'start', 'dominant-baseline':'middle', 'font-family':'Inter,sans-serif','font-size':'10', fill:cssColor('--text-muted') });
      sub.textContent = n.subtitle||''; g.appendChild(sub);

      const dot = svgEl_('circle', { cx:n.x+NW-16, cy:n.y+16, r:4, fill:cfg.dot });
      g.appendChild(dot);

      const statTxt = svgEl_('text', { x:n.x+50, y:n.y+62, 'text-anchor':'start', 'dominant-baseline':'middle', 'font-family':'Inter,sans-serif','font-size':'8','font-weight':'700', fill:cfg.dot });
      statTxt.textContent = status.toUpperCase(); g.appendChild(statTxt);

      nodesG.appendChild(g);
    });
  }

  function drawEdges(es) {
    edgesG.innerHTML = '';
    scenario.chain.edges.forEach(e => {
      const fn = scenario.chain.nodes.find(n=>n.id===e.from);
      const tn = scenario.chain.nodes.find(n=>n.id===e.to);
      if (!fn||!tn) return;
      const key   = `${e.from}>${e.to}`;
      const state = (es&&es[key])||'normal';
      const { fx,fy,tx,ty } = edgePts(fn,tn);
      const isP = state==='poisoned', isC = state==='cut';
      const strokeColor = (isP||isC) ? cssColor('--quarantined') : cssColor('--edge');
      const dashArr     = (isP||isC)?'6 3':'none';
      const markerId    = isC?'arr-cut':isP?'arr-poison':'arr-normal';
      const g = svgEl_('g');
      const line = svgEl_('line', { x1:fx,y1:fy,x2:tx-8,y2:ty, stroke:strokeColor,'stroke-width':(isP||isC)?'2':'1.5','stroke-dasharray':dashArr,'marker-end':`url(#${markerId})`,opacity:(isP||isC)?'1':'0.6' });
      g.appendChild(line);
      const mx=(fx+tx)/2, my=(fy+ty)/2;
      const bgRect = svgEl_('rect', { x:mx-36,y:my-9,width:72,height:18,rx:4,fill:cssColor('--panel'),stroke:strokeColor,'stroke-width':'0.8',opacity:'0.96' });
      g.appendChild(bgRect);
      const scopeTxt = svgEl_('text', { x:mx,y:my,'text-anchor':'middle','dominant-baseline':'middle','font-family':'Inter,sans-serif','font-size':'9',fill:(isC||isP)?cssColor('--quarantined'):cssColor('--text-muted') });
      scopeTxt.textContent = isC?'✂ cut':(e.scope||''); g.appendChild(scopeTxt);
      edgesG.appendChild(g);
    });
  }

  function animatePacket(pkt, onDone) {
    if (!pkt) { if(onDone) onDone(); return; }
    const fn = scenario.chain.nodes.find(n=>n.id===pkt.from);
    const tn = scenario.chain.nodes.find(n=>n.id===pkt.to);
    if (!fn||!tn) { if(onDone) onDone(); return; }
    const { fx,fy,tx,ty } = edgePts(fn,tn);
    const endX = pkt.cut?(fx+tx)/2:tx, endY = pkt.cut?(fy+ty)/2:ty;
    const circle = svgEl_('circle', { r:6, fill:pkt.poison?cssColor('--quarantined'):cssColor('--ok'), opacity:'0.95' });
    packetsG.appendChild(circle);
    const startTime = performance.now(), dur = 800;
    function frame(now) {
      const t=Math.min((now-startTime)/dur,1), ease=t<0.5?2*t*t:-1+(4-2*t)*t;
      circle.setAttribute('cx', fx+(endX-fx)*ease);
      circle.setAttribute('cy', fy+(endY-fy)*ease);
      if (t<1) { const id=requestAnimationFrame(frame); packetRAFs.push(id); }
      else { circle.remove(); if(onDone) onDone(); }
    }
    packetRAFs.push(requestAnimationFrame(frame));
  }

  function flashUnaffected(ids) {
    if (!ids) return;
    ids.forEach(id => {
      const n = scenario.chain.nodes.find(x=>x.id===id);
      if (!n) return;
      const ring = svgEl_('circle', { cx:nodeCx(n),cy:nodeCy(n),r:NW/2+4,fill:'none',stroke:cssColor('--ok'),'stroke-width':'2',opacity:'1' });
      nodesG.appendChild(ring);
      let t=0;
      function fade() {
        t+=0.04; ring.setAttribute('opacity', String(Math.max(0,1-t)));
        if (t<1) { packetRAFs.push(requestAnimationFrame(fade)); } else ring.remove();
      }
      packetRAFs.push(requestAnimationFrame(fade));
    });
  }

  function renderAuthorityRows() {
    authListEl.innerHTML = scenario.chain.nodes.map(node => `
      <div class="ch-auth-row" data-auth-node="${node.id}">
        <span class="ch-auth-label">${node.label}</span>
        <div class="ch-auth-bar-bg"><div class="ch-auth-bar-fill"></div></div>
      </div>`).join('');
  }

  function updateAuthority(auth, nodeStatus, selectedMode = mode) {
    if (!auth) return;
    authNoteEl.innerHTML = selectedMode === 'without'
      ? 'Without DriftGate nothing narrows: every agent keeps full authority <span class="ch-auth-extra-label">Full access inherited</span>'
      : 'Delegated authority can only narrow, never grow';
    scenario.chain.nodes.forEach(node => {
      const row = authListEl.querySelector(`[data-auth-node="${node.id}"]`);
      if (!row) return;
      const fill = row.querySelector('.ch-auth-bar-fill');
      const pct = selectedMode === 'without' || auth[node.id] === undefined ? 100 : auth[node.id];
      const status = nodeStatus && nodeStatus[node.id];
      const compromised = ['quarantined', 'blocked'].includes(status);
      const color = selectedMode === 'without' && compromised
        ? 'var(--quarantined)'
        : pct === 0 ? 'var(--quarantined)' : pct < 60 ? 'var(--restricted)' : 'var(--ok)';
      fill.style.width = `${pct}%`;
      fill.style.backgroundColor = color;
    });
  }

  function updateCounters(c) {
    if (!c) return;
    cntComp.textContent=c[0]; cntAff.textContent=c[1]; cntCut.textContent=c[2];
    cntComp.style.color = c[0]>0?'var(--quarantined)':'var(--text)';
    cntAff.style.color  = c[1]>0?'var(--quarantined)':'var(--text)';
    cntCut.style.color  = c[2]>0?'var(--restricted-text)':'var(--text)';
  }

  function appendLog(text) {
    const elapsed = ((performance.now()-logStart)/1000).toFixed(1);
    const row = document.createElement('div');
    row.className = 'ch-log-entry';
    row.innerHTML = `<span class="ch-log-time">+${elapsed}s</span><span class="ch-log-text">${text}</span>`;
    logFeedEl.appendChild(row);
    logFeedEl.scrollTop = logFeedEl.scrollHeight;
    autoScrollTo(document.querySelector('.ch-graph-panel'));
  }

  function runStep() {
    const steps = mode==='with' ? scenario.chain.steps : scenario.chain.stepsWithout;
    if (!steps || stepIdx >= steps.length) { toggleWith.disabled=false; toggleWithout.disabled=false; return; }
    const step = steps[stepIdx++];
    drawEdges(step.edgeState); drawNodes(step.nodeStatus);
    updateCounters(step.counters); updateAuthority(step.authority, step.nodeStatus);
    if (step.log) appendLog(step.log);
    if (step.unaffected) flashUnaffected(step.unaffected);
    const interval = 1400/speed;
    if (step.packet) animatePacket(step.packet, () => { stepTimer=setTimeout(runStep, interval-800); });
    else stepTimer=setTimeout(runStep, interval);
  }

  function clearAll() {
    if (stepTimer) { clearTimeout(stepTimer); stepTimer=null; }
    packetRAFs.forEach(id=>cancelAnimationFrame(id)); packetRAFs=[];
    packetsG.innerHTML='';
  }

  function restart() {
    clearAll(); started=true; stepIdx=0; logStart=performance.now();
    logFeedEl.innerHTML=''; overlayTxt.textContent='';
    toggleWith.disabled=true; toggleWithout.disabled=true;
    runStep();
  }

  function chInit() {
    renderAuthorityRows();
    updateAuthority(scenario.chain.steps[0].authority, scenario.chain.steps[0].nodeStatus, 'with');
    toggleWith.addEventListener('click', () => {
      if (toggleWith.disabled) return;
      if (mode === 'with' && started) return;
      mode = 'with'; toggleWith.classList.add('active'); toggleWithout.classList.remove('active');
      captionEl.textContent = CAPTIONS.with;
      updateAuthority(scenario.chain.steps[0].authority, scenario.chain.steps[0].nodeStatus, mode);
      if (started) restart();
    });
    toggleWithout.addEventListener('click', () => {
      if (toggleWithout.disabled) return;
      if (mode === 'without' && started) return;
      mode = 'without'; toggleWithout.classList.add('active'); toggleWith.classList.remove('active');
      captionEl.textContent = CAPTIONS.without;
      updateAuthority(scenario.chain.stepsWithout[0].authority, scenario.chain.stepsWithout[0].nodeStatus, mode);
      if (started) restart();
    });
  }

  function chStart(m) {
    if (started) return;
    mode=m||mode||'with'; started=true; stepIdx=0; logStart=performance.now();
    toggleWith.classList.toggle('active', mode === 'with');
    toggleWithout.classList.toggle('active', mode === 'without');
    captionEl.textContent = CAPTIONS[mode];
    overlayTxt.textContent=''; logFeedEl.innerHTML='';
    toggleWith.disabled=true; toggleWithout.disabled=true;
    const initialStep = (mode === 'with' ? scenario.chain.steps : scenario.chain.stepsWithout)[0];
    updateAuthority(initialStep.authority, initialStep.nodeStatus, mode);
    runStep();
  }

  function chOnNavigate() {}

  function chReset() {
    clearAll(); started=false; stepIdx=0; mode='with';
    toggleWith.classList.add('active'); toggleWithout.classList.remove('active');
    toggleWith.disabled=false; toggleWithout.disabled=false;
    captionEl.textContent=CAPTIONS.with;
    edgesG.innerHTML=''; nodesG.innerHTML=''; logFeedEl.innerHTML='';
    cntComp.textContent='0'; cntAff.textContent='0'; cntCut.textContent='0';
    cntComp.style.color=cntAff.style.color=cntCut.style.color='var(--text)';
    overlayTxt.textContent='Chain scenario not started yet';
    if (!authListEl.firstElementChild) renderAuthorityRows();
    updateAuthority(scenario.chain.steps[0].authority, scenario.chain.steps[0].nodeStatus, 'with');
  }

  return { init: chInit, start: chStart, onNavigate: chOnNavigate, reset: chReset };
})();

// ── Start ──────────────────────────────────────────────────────────────
init();
