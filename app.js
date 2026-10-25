/* =====================================================================
   DriftGate – app.js
   ===================================================================== */

'use strict';

// ── State ──────────────────────────────────────────────────────────────
let scenario   = null;
let metrics    = null;
let agents     = [];
let elapsed    = 0;
let speed      = 1;
let playing    = false;
let rafId      = null;
let lastTs     = null;
let eventIdx   = 0;

// ── DOM refs (shared) ──────────────────────────────────────────────────
const clockEl    = document.getElementById('clock');
const btnPlay    = document.getElementById('btnPlay');
const btnPause   = document.getElementById('btnPause');
const btnReset   = document.getElementById('btnReset');
const btnSpeed   = document.getElementById('btnSpeed');
const kpiRow     = document.getElementById('kpi-row');
const agentTbody = document.getElementById('agent-tbody');
const toastEl    = document.getElementById('toast');

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
    console.error('DriftGate: failed to load data', e);
    return;
  }

  agents = scenario.agents.map(a => ({ ...a }));

  renderKpi();
  renderAgentTable();
  updateClock();
  updateButtons();
  timeline.init();
}

// ── Navigation ─────────────────────────────────────────────────────────
function switchScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const screenEl = document.getElementById('screen-' + name);
  const navEl    = document.querySelector(`.nav-item[data-screen="${name}"]`);
  if (screenEl) screenEl.classList.add('active');
  if (navEl)    navEl.classList.add('active');
}

document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', () => switchScreen(item.dataset.screen));
});

// ── KPI tiles ──────────────────────────────────────────────────────────
function formatMetric(val) {
  return (val === null || val === undefined) ? '&mdash;' : val;
}

function renderKpi() {
  const defs = [
    { key: 'detectionRate',          label: 'Detection Rate'           },
    { key: 'falseAlarmRate',         label: 'False-Alarm Rate'         },
    { key: 'actionsUntilCaught',     label: 'Actions Until Caught'     },
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

// ── Agent table (Overview) ─────────────────────────────────────────────
function scoreColor(score) {
  if (score <= 29) return '#2fa66a';
  if (score <= 59) return '#e0a030';
  if (score <= 89) return '#e8742a';
  return '#e5384f';
}

function chipClass(status) {
  const map = {
    healthy: 'chip-healthy', watching: 'chip-watching',
    restricted: 'chip-restricted', quarantined: 'chip-quarantined',
  };
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

// ── Clock ──────────────────────────────────────────────────────────────
function updateClock() {
  const m = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const s = String(Math.floor(elapsed % 60)).padStart(2, '0');
  clockEl.textContent = `${m}:${s}`;
}

// ── Playback engine ────────────────────────────────────────────────────
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
  const isSilent = !!ev.silent;

  // Screen switch: skip for silent events; also skip screen-only events
  // (events with no agent but a screen field like drift at t=100)
  if (ev.screen && !isSilent) {
    switchScreen(ev.screen);
  }

  // Update agent state
  if (ev.agent) {
    const a = agents.find(x => x.id === ev.agent);
    if (a) {
      if (ev.status !== undefined) a.status     = ev.status;
      if (ev.score  !== undefined) a.score      = ev.score;
      if (ev.text   !== undefined) a.lastAction = ev.text;
    }
  }

  renderAgentTable();

  // Hook into timeline module
  if (ev.agent) timeline.addEvent(ev);

  // Auto-select agent on timeline screen for notable events only
  if (!isSilent && ev.agent && ev.screen === 'timeline') {
    const notable = (ev.tags && ev.tags.length > 0) || (ev.score && ev.score >= 14);
    if (notable) timeline.autoSelectAgent(ev.agent);
  }
}

// ── Controls ───────────────────────────────────────────────────────────
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
  timeline.reset();
});

btnSpeed.addEventListener('click', () => {
  speed = speed === 1 ? 2 : 1;
  btnSpeed.textContent = speed + 'x';
  btnSpeed.classList.toggle('active', speed === 2);
});

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
// TIMELINE MODULE
// ══════════════════════════════════════════════════════════════════════
const timeline = (() => {
  // per-agent event history: { agentId: [ev, ...] }
  const history = {};
  let selectedAgent = 'procurement-01';
  let filterMode    = 'all';   // 'all' | 'flagged'

  // DOM
  const agentCardsEl = document.getElementById('tl-agent-cards');
  const feedEl       = document.getElementById('tl-feed');
  const feedWrapEl   = document.getElementById('tl-feed-wrap');
  const emptyEl      = document.getElementById('tl-empty');
  const filterAllBtn = document.getElementById('tl-filter-all');
  const filterFlagBtn= document.getElementById('tl-filter-flagged');

  // Risk panel DOM
  const gaugeRing    = document.getElementById('tl-gauge-ring');
  const gaugeNum     = document.getElementById('tl-gauge-num');
  const statusChip   = document.getElementById('tl-risk-status-chip');
  const sparkLine    = document.getElementById('tl-sparkline-line');
  const sparkDots    = document.getElementById('tl-sparkline-dots');
  const cntEvents    = document.getElementById('tl-cnt-events');
  const cntFlagged   = document.getElementById('tl-cnt-flagged');
  const cntBlocked   = document.getElementById('tl-cnt-blocked');

  // Gauge animation state
  let gaugeCurrentScore = 0;
  let gaugeTargetScore  = 0;
  let gaugeRafId        = null;
  const CIRCUMFERENCE   = 2 * Math.PI * 64; // ~402.12

  // ── Format time ──────────────────────────────────────────────────────
  function fmtTime(sec) {
    const m = String(Math.floor(sec / 60)).padStart(2, '0');
    const s = String(Math.floor(sec % 60)).padStart(2, '0');
    return `${m}:${s}`;
  }

  // ── Tag config ───────────────────────────────────────────────────────
  const TAG_CFG = {
    'UNTRUSTED INPUT': {
      cls:     'tl-tag-untrusted',
      icon:    '⚠',
      caption: 'Content from outside the organization entered the session',
    },
    'OUT OF ROLE': {
      cls:     'tl-tag-outrole',
      icon:    '⛔',
      caption: 'Outside the declared role contract',
    },
    'CANARY HIT': {
      cls:     'tl-tag-canary',
      icon:    '🐦',
      caption: 'Decoy file touched, likely compromise',
    },
    'NEW DESTINATION': {
      cls:     'tl-tag-newdest',
      icon:    '📤',
      caption: 'Data sent to an unapproved destination',
    },
  };

  // ── Card border class from tags ───────────────────────────────────────
  function cardBorderClass(ev) {
    if (!ev.tags || ev.tags.length === 0) return '';
    if (ev.tags.includes('UNTRUSTED INPUT'))  return 'border-watching';
    if (ev.tags.includes('OUT OF ROLE'))      return 'border-restricted';
    if (ev.tags.includes('CANARY HIT'))       return 'border-quarantined';
    if (ev.tags.includes('NEW DESTINATION'))  return 'border-quarantined';
    return '';
  }

  // ── Node color class from status ─────────────────────────────────────
  function nodeClass(status) {
    const map = {
      healthy: 'tl-node-healthy', watching: 'tl-node-watching',
      restricted: 'tl-node-restricted', quarantined: 'tl-node-quarantined',
    };
    return map[status] || 'tl-node-healthy';
  }

  // ── Score pill color ──────────────────────────────────────────────────
  function pillStyle(score) {
    const c = scoreColor(score);
    return `color:${c};border-color:${c}33;`;
  }

  // ── Build tag chips HTML ──────────────────────────────────────────────
  function buildTagsHtml(tags) {
    if (!tags || tags.length === 0) return '';
    return tags.map(t => {
      const cfg = TAG_CFG[t] || { cls: '', icon: '' };
      return `<span class="tl-tag ${cfg.cls}">${cfg.icon} ${t}</span>`;
    }).join('');
  }

  // ── Build caption HTML ────────────────────────────────────────────────
  function buildCaptionHtml(tags) {
    if (!tags || tags.length === 0) return '';
    for (const t of tags) {
      if (TAG_CFG[t] && TAG_CFG[t].caption) {
        return `<div class="tl-card-caption">${TAG_CFG[t].caption}</div>`;
      }
    }
    return '';
  }

  // ── Build response badge HTML ─────────────────────────────────────────
  function buildBadgeHtml(status) {
    if (status === 'restricted')
      return `<span class="tl-resp-badge tl-resp-restricted">⊘ RESTRICTED</span>`;
    if (status === 'quarantined')
      return `<span class="tl-resp-badge tl-resp-quarantined">☣ QUARANTINED</span>`;
    return '';
  }

  // ── Check link condition ──────────────────────────────────────────────
  // Returns true if this event follows an UNTRUSTED INPUT event for the same agent
  function hasLinkToPrev(evList, currentIdx) {
    const ev = evList[currentIdx];
    if (!ev.tags) return false;
    const needsLink = ev.tags.includes('OUT OF ROLE') || ev.tags.includes('NEW DESTINATION');
    if (!needsLink) return false;
    for (let i = currentIdx - 1; i >= 0; i--) {
      if (evList[i].tags && evList[i].tags.includes('UNTRUSTED INPUT')) return true;
      // Stop looking if we hit another non-ambient event
      if (evList[i].tags && evList[i].tags.length > 0) break;
    }
    return false;
  }

  // ── Build a single feed row element ──────────────────────────────────
  function buildRow(ev, evList, idx) {
    const wrapper = document.createElement('div');
    wrapper.className = 'tl-row';
    if (filterMode === 'flagged' && (!ev.tags || ev.tags.length === 0)) {
      wrapper.classList.add('hidden');
    }

    const tagsHtml   = buildTagsHtml(ev.tags);
    const captionHtml= buildCaptionHtml(ev.tags);
    const badgeHtml  = buildBadgeHtml(ev.status);
    const border     = cardBorderClass(ev);
    const scoreVal   = ev.score !== undefined ? ev.score : 0;

    wrapper.innerHTML = `
      <div class="tl-node ${nodeClass(ev.status)}"></div>
      ${hasLinkToPrev(evList, idx) ? `
        <div class="tl-link-connector">
          <div class="tl-link-line"></div>
          <span class="tl-link-chip">🔗 Linked: came right after untrusted input</span>
        </div>` : ''}
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

  // ── Render the full feed for the selected agent ───────────────────────
  function renderFeed() {
    feedEl.innerHTML = '';
    const evList = history[selectedAgent] || [];

    if (evList.length === 0) {
      feedEl.appendChild(emptyEl);
      emptyEl.style.display = 'flex';
      return;
    }

    evList.forEach((ev, idx) => {
      feedEl.appendChild(buildRow(ev, evList, idx));
    });

    scrollFeedToBottom(false);
  }

  // ── Scroll feed to bottom ─────────────────────────────────────────────
  function scrollFeedToBottom(smooth) {
    feedEl.scrollTo({ top: feedEl.scrollHeight, behavior: smooth ? 'smooth' : 'instant' });
  }

  // ── Update risk panel for selected agent ──────────────────────────────
  function updateRiskPanel() {
    const evList = history[selectedAgent] || [];
    const agent  = agents.find(a => a.id === selectedAgent);
    const score  = agent ? agent.score : 0;
    const status = agent ? agent.status : 'healthy';

    // Counters
    const flaggedCount = evList.filter(e => e.tags && e.tags.length > 0).length;
    const blockedCount = evList.filter(e => e.status === 'restricted' || e.status === 'quarantined').length;
    cntEvents.textContent  = evList.length;
    cntFlagged.textContent = flaggedCount;
    cntBlocked.textContent = blockedCount;

    // Status chip
    statusChip.textContent = status;
    statusChip.className   = `status-chip ${chipClass(status)}`;

    // Gauge
    animateGauge(score);

    // Sparkline
    renderSparkline(evList);
  }

  // ── Animate gauge ─────────────────────────────────────────────────────
  function animateGauge(target) {
    gaugeTargetScore = target;
    if (gaugeRafId) cancelAnimationFrame(gaugeRafId);

    const startScore = gaugeCurrentScore;
    const startTime  = performance.now();
    const duration   = 600;

    function step(now) {
      const t = Math.min((now - startTime) / duration, 1);
      const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
      const val  = Math.round(startScore + (gaugeTargetScore - startScore) * ease);
      setGaugeValue(val);
      if (t < 1) gaugeRafId = requestAnimationFrame(step);
      else { gaugeCurrentScore = gaugeTargetScore; gaugeRafId = null; }
    }
    gaugeRafId = requestAnimationFrame(step);
  }

  function setGaugeValue(val) {
    const pct    = Math.min(Math.max(val, 0), 100) / 100;
    const offset = CIRCUMFERENCE * (1 - pct);
    const color  = scoreColor(val);
    gaugeRing.style.strokeDashoffset = offset;
    gaugeRing.style.stroke = color;
    gaugeNum.textContent   = val;
    gaugeNum.setAttribute('fill', color);
  }

  // ── Sparkline ─────────────────────────────────────────────────────────
  function renderSparkline(evList) {
    if (evList.length === 0) {
      sparkLine.setAttribute('points', '');
      sparkDots.innerHTML = '';
      return;
    }

    const W = 240, H = 60, PAD = 6;
    const scores = evList.map(e => e.score !== undefined ? e.score : 0);
    const minS   = 0;
    const maxS   = Math.max(100, ...scores);
    const pts    = scores.map((s, i) => {
      const x = PAD + (scores.length === 1 ? W / 2 - PAD : (i / (scores.length - 1)) * (W - PAD * 2));
      const y = H - PAD - ((s - minS) / (maxS - minS)) * (H - PAD * 2);
      return `${x},${y}`;
    });

    sparkLine.setAttribute('points', pts.join(' '));
    sparkDots.innerHTML = pts.map(p => {
      const [x, y] = p.split(',');
      return `<circle class="tl-sparkline-dot" cx="${x}" cy="${y}" r="2.5"/>`;
    }).join('');
  }

  // ── Render agent cards ────────────────────────────────────────────────
  function renderAgentCards() {
    agentCardsEl.innerHTML = agents.map(a => {
      const isSelected = a.id === selectedAgent;
      const evList = history[a.id] || [];
      const score  = a.score;
      const color  = scoreColor(score);
      return `
        <div class="tl-agent-card ${isSelected ? 'selected' : ''}" data-agentid="${a.id}">
          <div class="tl-card-id">${a.id}</div>
          <div class="tl-card-role">${a.role}</div>
          <div class="tl-card-meta">
            <span class="status-chip ${chipClass(a.status)}">${a.status}</span>
            <span class="tl-card-score" style="color:${color}">${score}</span>
          </div>
        </div>
      `;
    }).join('');

    agentCardsEl.querySelectorAll('.tl-agent-card').forEach(card => {
      card.addEventListener('click', () => {
        selectedAgent = card.dataset.agentid;
        renderAgentCards();
        renderFeed();
        updateRiskPanel();
      });
    });
  }

  // ── Public: init ──────────────────────────────────────────────────────
  function tlInit() {
    // Pre-populate history buckets
    if (scenario) {
      scenario.agents.forEach(a => { history[a.id] = []; });
    }

    renderAgentCards();
    renderFeed();
    updateRiskPanel();

    // Filter chips
    filterAllBtn.addEventListener('click', () => {
      filterMode = 'all';
      filterAllBtn.classList.add('active');
      filterFlagBtn.classList.remove('active');
      applyFilter();
    });
    filterFlagBtn.addEventListener('click', () => {
      filterMode = 'flagged';
      filterFlagBtn.classList.add('active');
      filterAllBtn.classList.remove('active');
      applyFilter();
    });
  }

  function applyFilter() {
    feedEl.querySelectorAll('.tl-row').forEach(row => {
      // find a tag chip inside it
      const hasTag = row.querySelector('.tl-tag') !== null;
      if (filterMode === 'flagged' && !hasTag) {
        row.classList.add('hidden');
      } else {
        row.classList.remove('hidden');
      }
    });
  }

  // ── Public: addEvent ──────────────────────────────────────────────────
  function tlAddEvent(ev) {
    if (!ev.agent) return;
    if (!history[ev.agent]) history[ev.agent] = [];

    const evList = history[ev.agent];
    evList.push(ev);

    // Always refresh agent cards (score/status might have changed)
    renderAgentCards();

    // If this event is for the selected agent, append a row to the live feed
    if (ev.agent === selectedAgent) {
      // Remove empty state if present
      const existingEmpty = feedEl.querySelector('.tl-empty');
      if (existingEmpty) existingEmpty.remove();

      const idx = evList.length - 1;
      const row = buildRow(ev, evList, idx);
      feedEl.appendChild(row);
      scrollFeedToBottom(true);

      // Flash feed border for high-risk events
      if (ev.score && ev.score >= 60) {
        feedWrapEl.classList.add('alert-flash');
        setTimeout(() => feedWrapEl.classList.remove('alert-flash'), 1200);
      }

      updateRiskPanel();
    } else {
      // Still update risk panel counters/sparkline when agent is selected
      // but also update for non-selected agents so cards refresh
      updateRiskPanel();
    }
  }

  // ── Public: autoSelectAgent ────────────────────────────────────────────
  function tlAutoSelectAgent(agentId) {
    if (selectedAgent === agentId) return;
    selectedAgent = agentId;
    renderAgentCards();
    renderFeed();
    updateRiskPanel();
  }

  // ── Public: reset ─────────────────────────────────────────────────────
  function tlReset() {
    Object.keys(history).forEach(k => { history[k] = []; });
    selectedAgent     = 'procurement-01';
    gaugeCurrentScore = 0;
    gaugeTargetScore  = 0;
    if (gaugeRafId) { cancelAnimationFrame(gaugeRafId); gaugeRafId = null; }

    setGaugeValue(0);
    renderAgentCards();
    renderFeed();
    updateRiskPanel();
  }

  return {
    init:            tlInit,
    addEvent:        tlAddEvent,
    autoSelectAgent: tlAutoSelectAgent,
    reset:           tlReset,
  };
})();

// ── Start ──────────────────────────────────────────────────────────────
init();
