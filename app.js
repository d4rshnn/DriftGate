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
  alertScreen.init();
  driftScreen.init();
  chainScreen.init();
}

// ── Navigation ─────────────────────────────────────────────────────────
function switchScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const screenEl = document.getElementById('screen-' + name);
  const navEl    = document.querySelector(`.nav-item[data-screen="${name}"]`);
  if (screenEl) screenEl.classList.add('active');
  if (navEl)    navEl.classList.add('active');
  if (name === 'alert') alertScreen.onNavigate();
  if (name === 'drift') driftScreen.onNavigate();
  if (name === 'chain') chainScreen.onNavigate();
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

  if (ev.screen && !isSilent) {
    switchScreen(ev.screen);
  }

  if (ev.agent) {
    const a = agents.find(x => x.id === ev.agent);
    if (a) {
      if (ev.status !== undefined) a.status     = ev.status;
      if (ev.score  !== undefined) a.score      = ev.score;
      if (ev.text   !== undefined) a.lastAction = ev.text;
    }
  }

  renderAgentTable();

  if (ev.agent) timeline.addEvent(ev);

  if (!isSilent && ev.agent && ev.screen === 'timeline') {
    const notable = (ev.tags && ev.tags.length > 0) || (ev.score && ev.score >= 14);
    if (notable) timeline.autoSelectAgent(ev.agent);
  }

  // Alert hook
  if (ev.alertId && !isSilent) {
    alertScreen.show(ev.alertId, { animate: true });
  }

  // Drift hook
  if (!isSilent && ev.screen === 'drift') {
    driftScreen.start();
  }

  // Chain hook
  if (!isSilent && ev.screen === 'chain') {
    chainScreen.start('with');
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
  alertScreen.reset();
  driftScreen.reset();
  chainScreen.reset();
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
// SHARED GAUGE HELPER
// ══════════════════════════════════════════════════════════════════════
function makeGauge(ringEl, numEl) {
  const CIRC = 2 * Math.PI * 64; // r=64 => ~402.12
  let current = 0;
  let target  = 0;
  let raf     = null;

  function setValue(val) {
    const pct    = Math.min(Math.max(val, 0), 100) / 100;
    const offset = CIRC * (1 - pct);
    const color  = scoreColor(val);
    ringEl.style.strokeDashoffset = offset;
    ringEl.style.stroke = color;
    if (numEl) {
      numEl.textContent = val;
      numEl.setAttribute('fill', color);
    }
  }

  function animateTo(tgt, duration) {
    target = tgt;
    if (raf) cancelAnimationFrame(raf);
    const start     = current;
    const startTime = performance.now();
    const dur       = duration || 600;

    function step(now) {
      const t    = Math.min((now - startTime) / dur, 1);
      const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
      const val  = Math.round(start + (target - start) * ease);
      setValue(val);
      if (t < 1) { raf = requestAnimationFrame(step); }
      else        { current = target; raf = null; }
    }
    raf = requestAnimationFrame(step);
  }

  function reset() {
    if (raf) cancelAnimationFrame(raf);
    current = 0; target = 0; raf = null;
    setValue(0);
  }

  setValue(0);
  return { animateTo, reset, setValue };
}

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

  let gauge = null; // initialized after DOM ready

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
    if (!ev.tags || ev.tags.length === 0) return '';
    if (ev.tags.includes('UNTRUSTED INPUT'))  return 'border-watching';
    if (ev.tags.includes('OUT OF ROLE'))      return 'border-restricted';
    if (ev.tags.includes('CANARY HIT'))       return 'border-quarantined';
    if (ev.tags.includes('NEW DESTINATION'))  return 'border-quarantined';
    return '';
  }

  function nodeClass(status) {
    const map = { healthy: 'tl-node-healthy', watching: 'tl-node-watching',
                  restricted: 'tl-node-restricted', quarantined: 'tl-node-quarantined' };
    return map[status] || 'tl-node-healthy';
  }

  function pillStyle(score) {
    const c = scoreColor(score);
    return `color:${c};border-color:${c}33;`;
  }

  function buildTagsHtml(tags) {
    if (!tags || tags.length === 0) return '';
    return tags.map(t => {
      const cfg = TAG_CFG[t] || { cls: '', icon: '' };
      return `<span class="tl-tag ${cfg.cls}">${cfg.icon} ${t}</span>`;
    }).join('');
  }

  function buildCaptionHtml(tags) {
    if (!tags || tags.length === 0) return '';
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

  function hasLinkToPrev(evList, currentIdx) {
    const ev = evList[currentIdx];
    if (!ev.tags) return false;
    const needsLink = ev.tags.includes('OUT OF ROLE') || ev.tags.includes('NEW DESTINATION');
    if (!needsLink) return false;
    for (let i = currentIdx - 1; i >= 0; i--) {
      if (evList[i].tags && evList[i].tags.includes('UNTRUSTED INPUT')) return true;
      if (evList[i].tags && evList[i].tags.length > 0) break;
    }
    return false;
  }

  function buildRow(ev, evList, idx) {
    const wrapper = document.createElement('div');
    wrapper.className = 'tl-row';
    if (filterMode === 'flagged' && (!ev.tags || ev.tags.length === 0))
      wrapper.classList.add('hidden');

    const tagsHtml    = buildTagsHtml(ev.tags);
    const captionHtml = buildCaptionHtml(ev.tags);
    const badgeHtml   = buildBadgeHtml(ev.status);
    const border      = cardBorderClass(ev);
    const scoreVal    = ev.score !== undefined ? ev.score : 0;

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

  function renderFeed() {
    feedEl.innerHTML = '';
    const evList = history[selectedAgent] || [];
    if (evList.length === 0) {
      feedEl.appendChild(emptyEl);
      emptyEl.style.display = 'flex';
      return;
    }
    evList.forEach((ev, idx) => feedEl.appendChild(buildRow(ev, evList, idx)));
    scrollFeedToBottom(false);
  }

  function scrollFeedToBottom(smooth) {
    feedEl.scrollTo({ top: feedEl.scrollHeight, behavior: smooth ? 'smooth' : 'instant' });
  }

  function updateRiskPanel() {
    const evList = history[selectedAgent] || [];
    const agent  = agents.find(a => a.id === selectedAgent);
    const score  = agent ? agent.score : 0;
    const status = agent ? agent.status : 'healthy';

    const flaggedCount = evList.filter(e => e.tags && e.tags.length > 0).length;
    const blockedCount = evList.filter(e => e.status === 'restricted' || e.status === 'quarantined').length;
    cntEvents.textContent  = evList.length;
    cntFlagged.textContent = flaggedCount;
    cntBlocked.textContent = blockedCount;

    statusChip.textContent = status;
    statusChip.className   = `status-chip ${chipClass(status)}`;

    if (gauge) gauge.animateTo(score, 600);

    renderSparkline(evList);
  }

  function renderSparkline(evList) {
    if (evList.length === 0) {
      sparkLine.setAttribute('points', '');
      sparkDots.innerHTML = '';
      return;
    }
    const W = 240, H = 60, PAD = 6;
    const scores = evList.map(e => e.score !== undefined ? e.score : 0);
    const maxS   = Math.max(100, ...scores);
    const pts    = scores.map((s, i) => {
      const x = PAD + (scores.length === 1 ? W / 2 - PAD : (i / (scores.length - 1)) * (W - PAD * 2));
      const y = H - PAD - (s / maxS) * (H - PAD * 2);
      return `${x},${y}`;
    });
    sparkLine.setAttribute('points', pts.join(' '));
    sparkDots.innerHTML = pts.map(p => {
      const [x, y] = p.split(',');
      return `<circle class="tl-sparkline-dot" cx="${x}" cy="${y}" r="2.5"/>`;
    }).join('');
  }

  function renderAgentCards() {
    agentCardsEl.innerHTML = agents.map(a => {
      const isSelected = a.id === selectedAgent;
      const color      = scoreColor(a.score);
      return `
        <div class="tl-agent-card ${isSelected ? 'selected' : ''}" data-agentid="${a.id}">
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
        renderAgentCards();
        renderFeed();
        updateRiskPanel();
      });
    });
  }

  function applyFilter() {
    feedEl.querySelectorAll('.tl-row').forEach(row => {
      const hasTag = row.querySelector('.tl-tag') !== null;
      if (filterMode === 'flagged' && !hasTag) row.classList.add('hidden');
      else row.classList.remove('hidden');
    });
  }

  function tlInit() {
    if (scenario) scenario.agents.forEach(a => { history[a.id] = []; });

    gauge = makeGauge(
      document.getElementById('tl-gauge-ring'),
      document.getElementById('tl-gauge-num')
    );

    renderAgentCards();
    renderFeed();
    updateRiskPanel();

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

  function tlAddEvent(ev) {
    if (!ev.agent) return;
    if (!history[ev.agent]) history[ev.agent] = [];
    const evList = history[ev.agent];
    evList.push(ev);

    renderAgentCards();

    if (ev.agent === selectedAgent) {
      const existingEmpty = feedEl.querySelector('.tl-empty');
      if (existingEmpty) existingEmpty.remove();
      const idx = evList.length - 1;
      const row = buildRow(ev, evList, idx);
      feedEl.appendChild(row);
      scrollFeedToBottom(true);
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
    renderAgentCards();
    renderFeed();
    updateRiskPanel();
  }

  function tlReset() {
    Object.keys(history).forEach(k => { history[k] = []; });
    selectedAgent = 'procurement-01';
    if (gauge) gauge.reset();
    renderAgentCards();
    renderFeed();
    updateRiskPanel();
  }

  return { init: tlInit, addEvent: tlAddEvent, autoSelectAgent: tlAutoSelectAgent, reset: tlReset };
})();

// ══════════════════════════════════════════════════════════════════════
// ALERT SCREEN MODULE
// ══════════════════════════════════════════════════════════════════════
const alertScreen = (() => {
  let firedAlerts   = [];   // ids of alerts that have been shown
  let activeAlertId = null;
  let gauge         = null;
  let revealTimers  = [];

  // DOM
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

  // Palette for reason segments / bars
  const SEG_COLORS = ['#b3122a', '#e8742a', '#e0a030', '#2fa66a', '#6a3fa0'];

  // Signal chip color by index
  const SIG_FIRED_CLS = [
    'fired-red', 'fired-orange', 'fired-amber', 'fired-green', 'fired-red',
  ];

  function fmtTime(sec) {
    return String(Math.floor(sec / 60)).padStart(2, '0') + ':' +
           String(Math.floor(sec % 60)).padStart(2, '0');
  }

  function getAlert(id) {
    return scenario && scenario.alerts ? scenario.alerts.find(a => a.id === id) : null;
  }

  function clearTimers() {
    revealTimers.forEach(t => clearTimeout(t));
    revealTimers = [];
  }

  function alInit() {
    gauge = makeGauge(
      document.getElementById('al-gauge-ring'),
      document.getElementById('al-gauge-num')
    );

    btnApprove.addEventListener('click', () => showToast('Demo only'));
    btnReject .addEventListener('click', () => showToast('Demo only'));
  }

  function renderTabs() {
    if (!scenario || !scenario.alerts) return;
    tabsEl.innerHTML = scenario.alerts.map(al => {
      const label = al.severity === 'Critical'
        ? `Alert ${al.id === 'a1' ? '1' : '2'} · Quarantined`
        : `Alert ${al.id === 'a1' ? '1' : '2'} · Restricted`;
      const isFired  = firedAlerts.includes(al.id);
      const isActive = al.id === activeAlertId;
      return `<button class="al-tab ${isActive ? 'active' : ''} ${!isFired ? 'dim' : ''}"
                data-alertid="${al.id}">${label}</button>`;
    }).join('');

    tabsEl.querySelectorAll('.al-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.alertid;
        if (!firedAlerts.includes(id)) return;
        show(id, { animate: true });
      });
    });
  }

  function renderMeta(al) {
    const agentData = scenario.agents.find(a => a.id === al.agent);
    const role = agentData ? agentData.role : al.agent;
    const sevCls = al.severity === 'Critical' ? 'al-sev-critical' : 'al-sev-high';
    metaEl.innerHTML = `
      Agent: <strong>${al.agent}</strong> · Role: ${role} · Raised at ${fmtTime(al.raisedAt)}
      <span class="al-severity-badge ${sevCls}">${al.severity.toUpperCase()}</span>
    `;
  }

  function renderCompare(al) {
    const isQ = al.score >= 90;
    if (isQ) {
      compareVerd.textContent = 'QUARANTINED';
      compareVerd.className   = 'al-compare-verdict al-verdict-quarantine';
      compareIcon.textContent = '☣';
      compareCap.textContent  = 'Behavior no longer matches the declared role';
      compareDg.classList.remove('glow-restrict');
      compareDg.classList.add('glow-quarantine');
    } else {
      compareVerd.textContent = 'RESTRICTED';
      compareVerd.className   = 'al-compare-verdict al-verdict-restrict';
      compareIcon.textContent = '🛡';
      compareCap.textContent  = 'Behavior no longer matches the declared role';
      compareDg.classList.remove('glow-quarantine');
      compareDg.classList.add('glow-restrict');
    }
  }

  function renderSignals(al, animate) {
    signalsCol.innerHTML = (al.signals || []).map((sig, i) => {
      const firedCls = sig.fired ? (SIG_FIRED_CLS[i] || 'fired-red') : 'dim';
      const ptsText  = sig.fired ? `+${sig.points}` : 'clear';
      return `
        <div class="al-signal-chip ${firedCls}"
             style="${animate ? `opacity:0;transition-delay:${i * 120}ms` : ''}">
          <span>${sig.name}</span>
          <span class="al-signal-pts">${ptsText}</span>
        </div>
      `;
    }).join('');

    if (animate) {
      const chips = signalsCol.querySelectorAll('.al-signal-chip');
      chips.forEach((chip, i) => {
        const t = setTimeout(() => { chip.style.opacity = ''; }, 100 + i * 130);
        revealTimers.push(t);
      });
    }
  }

  function renderStackedBar(al, animate) {
    const total   = al.score;
    const maxPts  = Math.max(...al.reasons.map(r => r.points));
    const segments = al.reasons.map((r, i) => ({
      pct:   (r.points / 100) * 100,
      color: SEG_COLORS[i % SEG_COLORS.length],
      label: r.text,
      pts:   r.points,
    }));

    stackedBar.style.width = (animate ? '0%' : total + '%');
    stackedBar.innerHTML   = segments.map(s =>
      `<div class="al-stacked-seg"
            style="flex:${s.pts};background:${s.color}"></div>`
    ).join('');

    stackedLeg.innerHTML = segments.map((s, i) => `
      <div class="al-legend-item">
        <div class="al-legend-swatch" style="background:${s.color}"></div>
        <span>${al.reasons[i].text.substring(0, 32)}… (+${s.pts})</span>
      </div>
    `).join('');

    if (animate) {
      const t = setTimeout(() => {
        stackedBar.style.transition = 'width 0.8s ease';
        stackedBar.style.width      = total + '%';
      }, 300);
      revealTimers.push(t);
    }
  }

  function renderReasons(al, animate) {
    const maxPts = Math.max(...al.reasons.map(r => r.points));
    reasonsList.innerHTML = al.reasons.map((r, i) => {
      const color = SEG_COLORS[i % SEG_COLORS.length];
      const barW  = (r.points / maxPts) * 100;
      return `
        <div class="al-reason-row" data-idx="${i}">
          <span class="al-reason-icon" style="color:${color}">◆</span>
          <span class="al-reason-text">${r.text}</span>
          <span class="al-reason-pts" style="color:${color}">+${r.points}</span>
          <div class="al-reason-bar-wrap">
            <div class="al-reason-bar-fill"
                 style="width:${barW}%;background:${color}"></div>
          </div>
        </div>
      `;
    }).join('');

    scoreTotal.textContent = `Total risk score: ${al.score} / 100`;

    if (animate) {
      const rows = reasonsList.querySelectorAll('.al-reason-row');
      rows.forEach((row, i) => {
        const t = setTimeout(() => row.classList.add('revealed'), 800 + i * 400);
        revealTimers.push(t);
      });
    } else {
      reasonsList.querySelectorAll('.al-reason-row').forEach(r => r.classList.add('revealed'));
    }
  }

  function renderEvidence(al) {
    let html = '';
    if (al.priorEvent) {
      html += `
        <div class="al-ev-item">
          <span class="al-ev-time">${fmtTime(al.raisedAt - 25)}</span>
          <span class="al-ev-text">${al.priorEvent}</span>
        </div>
        <div class="al-ev-connector">
          <div class="al-ev-conn-line"></div>
          <span class="al-ev-conn-label">🔗 Linked</span>
        </div>
      `;
    }
    html += `
      <div class="al-ev-item" style="border-color:var(--restricted)">
        <span class="al-ev-time">${fmtTime(al.raisedAt)}</span>
        <span class="al-ev-text">${al.triggerEvent}</span>
      </div>
    `;
    evidTrail.innerHTML = html;
  }

  function renderJudge(al) {
    judgeQuote.textContent = al.judgeNote || '';
  }

  function renderLadder(al) {
    const steps = [
      { name: 'Allow',      icon: '✓', range: '0 – 29',  max: 29  },
      { name: 'Ask human',  icon: '?', range: '30 – 59', max: 59  },
      { name: 'Restrict',   icon: '⊘', range: '60 – 89', max: 89  },
      { name: 'Quarantine', icon: '☣', range: '90 – 100',max: 100 },
    ];
    const activeIdx = al.score >= 90 ? 3 : al.score >= 60 ? 2 : al.score >= 30 ? 1 : 0;

    ladderEl.innerHTML = steps.map((s, i) => {
      let cls = '';
      if (i < activeIdx)  cls = 'filled';
      if (i === activeIdx) cls = 'active';
      if (i > activeIdx)  cls = 'dim';
      return `
        <div class="al-ladder-step ${cls}">
          <div class="al-ladder-icon">${s.icon}</div>
          <div class="al-ladder-name">${s.name}</div>
          <div class="al-ladder-range">${s.range}</div>
          ${i === activeIdx ? '<div class="al-ladder-active-dot"></div>' : ''}
        </div>
      `;
    }).join('');
  }

  function renderChecklist(al, animate) {
    checklistEl.innerHTML = (al.actions || []).map((action, i) => `
      <div class="al-check-item" data-ci="${i}">
        <div class="al-check-icon">✓</div>
        <span>${action}</span>
      </div>
    `).join('');

    if (animate) {
      const items = checklistEl.querySelectorAll('.al-check-item');
      items.forEach((item, i) => {
        const delay = 2200 + i * 500;
        const t = setTimeout(() => item.classList.add('checked'), delay);
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

    // show body
    emptyEl.style.display  = 'none';
    bodyEl.style.display   = 'flex';

    renderTabs();
    renderMeta(al);
    renderCompare(al);
    renderSignals(al, animate);
    renderStackedBar(al, animate);
    renderReasons(al, animate);
    renderEvidence(al);
    renderJudge(al);
    renderLadder(al);
    renderChecklist(al, animate);

    // Animate gauge from 0
    if (animate) {
      gauge.reset();
      const t = setTimeout(() => gauge.animateTo(al.score, 800), 200);
      revealTimers.push(t);
    } else {
      gauge.setValue(al.score);
    }
  }

  function onNavigate() {
    if (activeAlertId) {
      // already rendered — just re-render tabs with current state, no animation
      renderTabs();
    }
  }

  function reset() {
    clearTimers();
    firedAlerts   = [];
    activeAlertId = null;
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
  let mainChart   = null;
  let naiveChart  = null;
  let revealed    = 0;       // how many days have been drawn (0 = none)
  let started     = false;   // whether start() has been called
  let revealTimer = null;

  // DOM
  const mainPanelEl  = document.getElementById('dr-main-panel');
  const chartWrapEl  = document.getElementById('dr-chart-wrap');
  const overlayEl    = document.getElementById('dr-overlay-msg');
  const statusChipEl = document.getElementById('dr-status-chip');
  const naiveStatEl  = document.getElementById('dr-naive-status');
  const calloutsEl   = document.getElementById('dr-callouts-list');
  const explainersEl = document.getElementById('dr-explainers');

  // ── Chart.js shared dark defaults ──────────────────────────────────
  const GRID_COLOR  = '#3a1018';
  const TICK_COLOR  = 'rgba(239,230,218,0.70)';
  const FONT_FAMILY = "'Inter', sans-serif";

  function darkScaleDefaults(extra) {
    return Object.assign({
      grid:  { color: GRID_COLOR },
      ticks: { color: TICK_COLOR, font: { family: FONT_FAMILY, size: 11 } },
    }, extra || {});
  }

  // ── Alert-region plugin (inline) ─────────────────────────────────────
  const alertRegionPlugin = {
    id: 'alertRegion',
    afterDraw(chart, args, opts) {
      if (!opts || opts.alertIndex === undefined || opts.revealedDays === undefined) return;
      if (opts.revealedDays <= opts.alertIndex) return;

      const { ctx, chartArea, scales } = chart;
      const xScale = scales['x'];
      if (!xScale) return;

      const x0 = xScale.getPixelForValue(opts.alertIndex);
      const x1 = chartArea.right;

      // Shaded region
      ctx.save();
      ctx.fillStyle = 'rgba(229,56,79,0.12)';
      ctx.fillRect(x0, chartArea.top, x1 - x0, chartArea.bottom - chartArea.top);

      // Vertical line
      ctx.strokeStyle = 'rgba(229,56,79,0.75)';
      ctx.lineWidth   = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(x0, chartArea.top);
      ctx.lineTo(x0, chartArea.bottom);
      ctx.stroke();
      ctx.setLineDash([]);

      // Label
      ctx.fillStyle = 'rgba(229,56,79,0.9)';
      ctx.font      = `600 11px ${FONT_FAMILY}`;
      ctx.fillText('Alert raised', x0 + 5, chartArea.top + 14);
      ctx.restore();
    },
  };

  // ── Build main chart ─────────────────────────────────────────────────
  function buildMainChart(d, days) {
    const labels  = d.labels.slice(0, days);
    const frozen  = d.frozen.slice(0, days);
    const rolling = d.rolling.slice(0, days);
    const drift   = rolling.map((v, i) => parseFloat((v - (d.frozen[i] || 0)).toFixed(4)));
    const cusum   = d.cusum.slice(0, days);
    const thresh  = Array(days).fill(d.threshold);

    const canvas = document.getElementById('dr-main-canvas');
    if (mainChart) mainChart.destroy();

    mainChart = new Chart(canvas, {
      type: 'line',
      plugins: [alertRegionPlugin],
      data: {
        labels,
        datasets: [
          {
            label: 'Frozen baseline',
            data: frozen,
            borderColor: '#8a9bb0',
            borderDash: [6, 3],
            borderWidth: 1.5,
            pointRadius: 0,
            tension: 0,
            yAxisID: 'yLeft',
            fill: false,
          },
          {
            label: 'Rolling baseline',
            data: rolling,
            borderColor: '#e0a030',
            borderWidth: 2,
            pointRadius: 3,
            pointBackgroundColor: '#e0a030',
            tension: 0.3,
            yAxisID: 'yLeft',
            fill: false,
          },
          {
            label: 'Drift from frozen',
            data: drift,
            borderColor: '#e5384f',
            borderWidth: 1.5,
            pointRadius: 0,
            tension: 0.3,
            yAxisID: 'yLeft',
            fill: true,
            backgroundColor: 'rgba(229,56,79,0.15)',
          },
          {
            label: 'CUSUM',
            data: cusum,
            borderColor: '#e8742a',
            borderWidth: 3,
            pointRadius: 4,
            pointBackgroundColor: '#e8742a',
            tension: 0.2,
            yAxisID: 'yRight',
            fill: false,
          },
          {
            label: 'Alert threshold',
            data: thresh,
            borderColor: 'rgba(239,230,218,0.60)',
            borderDash: [5, 4],
            borderWidth: 1.5,
            pointRadius: 0,
            tension: 0,
            yAxisID: 'yRight',
            fill: false,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 400 },
        plugins: {
          alertRegion: { alertIndex: d.alertIndex, revealedDays: days },
          legend: {
            position: 'bottom',
            labels: {
              color: TICK_COLOR,
              font: { family: FONT_FAMILY, size: 11 },
              usePointStyle: true,
              pointStyleWidth: 20,
              padding: 16,
            },
          },
          tooltip: {
            backgroundColor: '#1a0a0e',
            borderColor: '#b3122a',
            borderWidth: 1,
            titleColor: '#efe6da',
            bodyColor: 'rgba(239,230,218,0.75)',
            padding: 10,
          },
        },
        scales: {
          x: {
            ...darkScaleDefaults(),
            border: { color: GRID_COLOR },
          },
          yLeft: {
            ...darkScaleDefaults(),
            position: 'left',
            min: 0,
            max: 0.7,
            border: { color: GRID_COLOR },
            title: {
              display: true,
              text: 'Distance from approved behavior',
              color: TICK_COLOR,
              font: { family: FONT_FAMILY, size: 11 },
            },
          },
          yRight: {
            ...darkScaleDefaults({ grid: { display: false } }),
            position: 'right',
            min: 0,
            max: 16,
            border: { color: GRID_COLOR },
            title: {
              display: true,
              text: 'CUSUM (cumulative drift)',
              color: TICK_COLOR,
              font: { family: FONT_FAMILY, size: 11 },
            },
          },
        },
      },
    });
  }

  // ── Rebuild main chart with updated day count ─────────────────────────
  function updateMainChart(d, days) {
    if (!mainChart) { buildMainChart(d, days); return; }

    const labels  = d.labels.slice(0, days);
    const frozen  = d.frozen.slice(0, days);
    const rolling = d.rolling.slice(0, days);
    const drift   = rolling.map((v, i) => parseFloat((v - (d.frozen[i] || 0)).toFixed(4)));
    const cusum   = d.cusum.slice(0, days);
    const thresh  = Array(days).fill(d.threshold);

    mainChart.data.labels             = labels;
    mainChart.data.datasets[0].data   = frozen;
    mainChart.data.datasets[1].data   = rolling;
    mainChart.data.datasets[2].data   = drift;
    mainChart.data.datasets[3].data   = cusum;
    mainChart.data.datasets[4].data   = thresh;
    mainChart.options.plugins.alertRegion.revealedDays = days;
    mainChart.update('active');
  }

  // ── Build naive bar chart ────────────────────────────────────────────
  function buildNaiveChart(d, days) {
    const canvas = document.getElementById('dr-naive-canvas');
    if (naiveChart) naiveChart.destroy();

    const n = Math.min(days, d.rolling.length);
    const barLabels = d.labels.slice(1, n);
    const deltas    = d.rolling.slice(1, n).map((v, i) =>
      parseFloat((v - d.rolling[i]).toFixed(4))
    );
    const threshold  = d.naiveThreshold || 0.15;
    const threshLine = Array(barLabels.length).fill(threshold);

    naiveChart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: barLabels,
        datasets: [
          {
            label: 'Day-over-day change',
            data: deltas,
            backgroundColor: 'rgba(224,160,48,0.55)',
            borderColor: '#e0a030',
            borderWidth: 1,
            borderRadius: 3,
          },
          {
            label: 'Naive alert threshold',
            data: threshLine,
            type: 'line',
            borderColor: 'rgba(239,230,218,0.5)',
            borderDash: [4, 3],
            borderWidth: 1.5,
            pointRadius: 0,
            fill: false,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 300 },
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              color: TICK_COLOR,
              font: { family: FONT_FAMILY, size: 10 },
              usePointStyle: true,
              padding: 10,
            },
          },
          tooltip: {
            backgroundColor: '#1a0a0e',
            borderColor: '#b3122a',
            borderWidth: 1,
            titleColor: '#efe6da',
            bodyColor: 'rgba(239,230,218,0.75)',
            padding: 8,
          },
        },
        scales: {
          x: darkScaleDefaults({ border: { color: GRID_COLOR } }),
          y: {
            ...darkScaleDefaults(),
            min: 0,
            max: threshold * 2,
            border: { color: GRID_COLOR },
          },
        },
      },
    });
  }

  function updateNaiveChart(d, days) {
    if (!naiveChart) { buildNaiveChart(d, days); return; }
    const n = Math.min(days, d.rolling.length);
    const barLabels = d.labels.slice(1, n);
    const deltas    = d.rolling.slice(1, n).map((v, i) =>
      parseFloat((v - d.rolling[i]).toFixed(4))
    );
    const threshold  = d.naiveThreshold || 0.15;
    const threshLine = Array(barLabels.length).fill(threshold);

    naiveChart.data.labels           = barLabels;
    naiveChart.data.datasets[0].data = deltas;
    naiveChart.data.datasets[1].data = threshLine;
    naiveChart.update('active');
  }

  // ── Callouts ─────────────────────────────────────────────────────────
  function renderCallouts() {
    if (!scenario) return;
    const d = scenario.drift;
    calloutsEl.innerHTML = (d.callouts || []).map((c, i) => `
      <div class="dr-callout-row" id="dr-callout-${i}">
        <div class="dr-callout-num">${String(i + 1).padStart(2, '0')}</div>
        <div class="dr-callout-text">${c.text}</div>
      </div>
    `).join('');
  }

  function lightCallouts(days) {
    if (!scenario) return;
    const d = scenario.drift;
    (d.callouts || []).forEach((c, i) => {
      const el = document.getElementById(`dr-callout-${i}`);
      if (!el) return;
      if (days > c.index) {
        el.classList.remove('lit', 'lit-alert');
        el.classList.add(c.index === d.alertIndex ? 'lit-alert' : 'lit');
      }
    });
  }

  // ── Explainers ───────────────────────────────────────────────────────
  function renderExplainers() {
    if (!scenario) return;
    const exps = scenario.drift.explainers || [];
    explainersEl.innerHTML = exps.map(e => `
      <div class="dr-explainer-card">
        <div class="dr-explainer-title">${e.title}</div>
        <div class="dr-explainer-text">${e.text}</div>
      </div>
    `).join('');
  }

  // ── Reveal step ──────────────────────────────────────────────────────
  function revealStep() {
    if (!scenario) return;
    const d    = scenario.drift;
    const total = d.labels.length;

    revealed++;
    overlayEl.classList.add('hidden');

    updateMainChart(d, revealed);
    updateNaiveChart(d, revealed);
    lightCallouts(revealed);

    // Alert moment
    if (revealed > d.alertIndex) {
      statusChipEl.textContent = `Drift detected at day ${d.alertIndex + 1}`;
      statusChipEl.classList.add('alert');
      mainPanelEl.classList.add('alert-flash');
      setTimeout(() => mainPanelEl.classList.remove('alert-flash'), 1200);
    }

    // After last day, show naive status
    if (revealed >= total) {
      naiveStatEl.classList.add('visible');
      return; // done
    }

    // Schedule next step
    const interval = (800 / speed);
    revealTimer = setTimeout(revealStep, interval);
  }

  // ── Public: init ─────────────────────────────────────────────────────
  function drInit() {
    renderCallouts();
    renderExplainers();
  }

  // ── Public: start ─────────────────────────────────────────────────────
  function drStart() {
    if (started) return;
    started = true;
    if (!scenario) return;

    const d = scenario.drift;
    // Build charts at 1 day so axes are visible immediately
    buildMainChart(d, 1);
    buildNaiveChart(d, 1);
    revealed = 1;
    overlayEl.classList.add('hidden');
    lightCallouts(1);

    revealTimer = setTimeout(revealStep, 800 / speed);
  }

  // ── Public: onNavigate ───────────────────────────────────────────────
  function drOnNavigate() {
    if (!started) return;
    // Resize charts in case canvas was hidden during layout
    if (mainChart)  mainChart.resize();
    if (naiveChart) naiveChart.resize();
  }

  // ── Public: reset ────────────────────────────────────────────────────
  function drReset() {
    if (revealTimer) { clearTimeout(revealTimer); revealTimer = null; }
    if (mainChart)  { mainChart.destroy();  mainChart  = null; }
    if (naiveChart) { naiveChart.destroy(); naiveChart = null; }

    started  = false;
    revealed = 0;

    overlayEl.classList.remove('hidden');
    statusChipEl.textContent = 'Monitoring';
    statusChipEl.classList.remove('alert');
    naiveStatEl.classList.remove('visible');
    mainPanelEl.classList.remove('alert-flash');

    renderCallouts(); // re-render dim callouts
  }

  return { init: drInit, start: drStart, onNavigate: drOnNavigate, reset: drReset };
})();

// ══════════════════════════════════════════════════════════════════════
// CHAIN SCREEN MODULE
// ══════════════════════════════════════════════════════════════════════
const chainScreen = (() => {
  const NS = 'http://www.w3.org/2000/svg';

  // DOM
  const svgEl       = document.getElementById('ch-svg');
  const edgesG      = document.getElementById('ch-edges-g');
  const nodesG      = document.getElementById('ch-nodes-g');
  const packetsG    = document.getElementById('ch-packets-g');
  const overlayTxt  = document.getElementById('ch-svg-overlay');
  const captionEl   = document.getElementById('ch-caption');
  const toggleWith  = document.getElementById('ch-toggle-with');
  const toggleWithout = document.getElementById('ch-toggle-without');
  const cntComp     = document.getElementById('ch-cnt-compromised');
  const cntAff      = document.getElementById('ch-cnt-affected');
  const cntCut      = document.getElementById('ch-cnt-cut');
  const authListEl  = document.getElementById('ch-auth-list');
  const logFeedEl   = document.getElementById('ch-log-feed');

  const CAPTIONS = {
    with:    'Taint and authority are tracked across every agent-to-agent call',
    without: 'Illustrative: how one compromise could spread through the chain',
  };

  // Node visual config by status
  const STATUS_CFG = {
    healthy:     { fill: '#0d2218', stroke: '#2fa66a', textColor: '#2fa66a', dot: '#2fa66a'  },
    watching:    { fill: '#2a2008', stroke: '#e0a030', textColor: '#e0a030', dot: '#e0a030'  },
    restricted:  { fill: '#2a1208', stroke: '#e8742a', textColor: '#e8742a', dot: '#e8742a'  },
    quarantined: { fill: '#2a0a10', stroke: '#e5384f', textColor: '#e5384f', dot: '#e5384f'  },
    untrusted:   { fill: '#2a2208', stroke: '#e0a030', textColor: '#e0a030', dot: '#e0a030', dashed: true },
    blocked:     { fill: '#2a0a10', stroke: '#e5384f', textColor: '#e5384f', dot: '#e5384f'  },
  };

  const ICONS = {
    doc:   '📄',
    robot: '🤖',
    cloud: '☁',
  };

  // state
  let mode       = 'with';
  let started    = false;
  let stepIdx    = 0;
  let stepTimer  = null;
  let packetRAFs = [];
  let logStart   = 0;

  // ── SVG helpers ──────────────────────────────────────────────────────
  function svgEl_(tag, attrs) {
    const el = document.createElementNS(NS, tag);
    Object.entries(attrs || {}).forEach(([k, v]) => el.setAttribute(k, v));
    return el;
  }

  function txt(x, y, str, attrs) {
    const el = svgEl_('text', Object.assign({ x, y, 'text-anchor': 'middle', 'dominant-baseline': 'middle' }, attrs));
    el.textContent = str;
    return el;
  }

  // ── Node geometry ─────────────────────────────────────────────────────
  const NW = 190, NH = 78, NR = 14;

  function nodeCx(n) { return n.x + NW / 2; }
  function nodeCy(n) { return n.y + NH / 2; }

  // Edge connection points (left or right side of nodes)
  function edgePts(fromNode, toNode) {
    const fx = fromNode.x + NW, fy = fromNode.y + NH / 2;
    const tx = toNode.x,       ty = toNode.y + NH / 2;
    return { fx, fy, tx, ty };
  }

  // ── Draw all nodes ───────────────────────────────────────────────────
  function drawNodes(nodeStatuses) {
    nodesG.innerHTML = '';
    const chain = scenario.chain;

    chain.nodes.forEach(n => {
      const status = (nodeStatuses && nodeStatuses[n.id]) || 'healthy';
      const cfg    = STATUS_CFG[status] || STATUS_CFG.healthy;
      const g      = svgEl_('g', { id: `ch-node-${n.id}`, class: 'ch-node' });

      // Glow filter
      const glowFilter = (status === 'quarantined') ? 'url(#glow-red)'
                       : (status === 'healthy')     ? ''
                       : '';

      // Background rect
      const rect = svgEl_('rect', {
        x: n.x, y: n.y, width: NW, height: NH, rx: NR, ry: NR,
        fill: cfg.fill, stroke: cfg.stroke, 'stroke-width': cfg.dashed ? '1.5' : '1.5',
        'stroke-dasharray': cfg.dashed ? '6 3' : 'none',
        ...(glowFilter ? { filter: glowFilter } : {}),
      });
      if (status === 'quarantined') {
        rect.style.animation = 'chPulse 2s ease-in-out infinite';
      }
      g.appendChild(rect);

      // Icon badge circle
      const badge = svgEl_('circle', {
        cx: n.x + 24, cy: n.y + NH / 2, r: 16,
        fill: '#120608', stroke: cfg.stroke, 'stroke-width': '1',
      });
      g.appendChild(badge);

      // Icon text
      const icon = svgEl_('text', {
        x: n.x + 24, y: n.y + NH / 2,
        'text-anchor': 'middle', 'dominant-baseline': 'middle',
        'font-size': '14',
      });
      icon.textContent = ICONS[n.icon] || '▪';
      g.appendChild(icon);

      // Label
      const label = svgEl_('text', {
        x: n.x + 50, y: n.y + 26,
        'text-anchor': 'start', 'dominant-baseline': 'middle',
        'font-family': 'Oswald,sans-serif', 'font-size': '13',
        'font-weight': '600', fill: cfg.textColor,
      });
      label.textContent = n.label;
      g.appendChild(label);

      // Subtitle
      const sub = svgEl_('text', {
        x: n.x + 50, y: n.y + 44,
        'text-anchor': 'start', 'dominant-baseline': 'middle',
        'font-family': 'Inter,sans-serif', 'font-size': '10',
        fill: 'rgba(138,122,110,0.8)',
      });
      sub.textContent = n.subtitle || '';
      g.appendChild(sub);

      // Status dot
      const dot = svgEl_('circle', {
        cx: n.x + NW - 28, cy: n.y + NH - 16, r: 4,
        fill: cfg.dot,
      });
      g.appendChild(dot);

      // Status text
      const statTxt = svgEl_('text', {
        x: n.x + NW - 20, y: n.y + NH - 16,
        'text-anchor': 'start', 'dominant-baseline': 'middle',
        'font-family': 'Inter,sans-serif', 'font-size': '9',
        'font-weight': '600',
        fill: cfg.dot, 'text-transform': 'uppercase',
      });
      statTxt.textContent = status.toUpperCase();
      g.appendChild(statTxt);

      nodesG.appendChild(g);
    });
  }

  // ── Draw all edges ───────────────────────────────────────────────────
  function drawEdges(edgeStates) {
    edgesG.innerHTML = '';
    const chain = scenario.chain;

    chain.edges.forEach(e => {
      const fromNode = chain.nodes.find(n => n.id === e.from);
      const toNode   = chain.nodes.find(n => n.id === e.to);
      if (!fromNode || !toNode) return;

      const key   = `${e.from}>${e.to}`;
      const state = (edgeStates && edgeStates[key]) || 'normal';

      const { fx, fy, tx, ty } = edgePts(fromNode, toNode);

      const isPoison = state === 'poisoned';
      const isCut    = state === 'cut';

      const strokeColor = isCut ? '#e5384f' : isPoison ? '#e5384f' : '#3a1018';
      const dashArr     = (isCut || isPoison) ? '6 3' : 'none';
      const markerId    = isCut ? 'arr-cut' : isPoison ? 'arr-poison' : 'arr-normal';
      const opacity     = (isCut || isPoison) ? '1' : '0.6';

      const g = svgEl_('g');

      // Check if vertical (same x) or angled path needed
      const line = svgEl_('line', {
        x1: fx, y1: fy, x2: tx - 8, y2: ty,
        stroke: strokeColor, 'stroke-width': (isCut || isPoison) ? '2' : '1.5',
        'stroke-dasharray': dashArr,
        'marker-end': `url(#${markerId})`,
        opacity,
      });
      g.appendChild(line);

      // Scope badge
      const mx = (fx + tx) / 2;
      const my = (fy + ty) / 2;

      const bgRect = svgEl_('rect', {
        x: mx - 36, y: my - 9, width: 72, height: 18, rx: 4,
        fill: '#1a0a0e', stroke: strokeColor, 'stroke-width': '0.8',
        opacity: '0.9',
      });
      g.appendChild(bgRect);

      const scopeTxt = svgEl_('text', {
        x: mx, y: my,
        'text-anchor': 'middle', 'dominant-baseline': 'middle',
        'font-family': 'Inter,sans-serif', 'font-size': '9',
        fill: isCut || isPoison ? '#e5384f' : 'rgba(138,122,110,0.9)',
      });
      scopeTxt.textContent = isCut ? '✂ cut' : (e.scope || '');
      g.appendChild(scopeTxt);

      edgesG.appendChild(g);
    });
  }

  // ── Animate packet along an edge ─────────────────────────────────────
  function animatePacket(packetDef, onDone) {
    if (!packetDef) { if (onDone) onDone(); return; }

    const chain    = scenario.chain;
    const fromNode = chain.nodes.find(n => n.id === packetDef.from);
    const toNode   = chain.nodes.find(n => n.id === packetDef.to);
    if (!fromNode || !toNode) { if (onDone) onDone(); return; }

    const { fx, fy, tx, ty } = edgePts(fromNode, toNode);
    const endX = packetDef.cut ? (fx + tx) / 2 : tx;
    const endY = packetDef.cut ? (fy + ty) / 2 : ty;

    const circle = svgEl_('circle', {
      r: 6, fill: packetDef.poison ? '#e5384f' : '#3a5a4a',
      opacity: '0.9',
      ...(packetDef.poison ? { filter: 'url(#glow-red)' } : {}),
    });
    packetsG.appendChild(circle);

    const startTime = performance.now();
    const duration  = 800;

    function frame(now) {
      const t    = Math.min((now - startTime) / duration, 1);
      const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
      circle.setAttribute('cx', fx + (endX - fx) * ease);
      circle.setAttribute('cy', fy + (endY - fy) * ease);
      if (t < 1) {
        const id = requestAnimationFrame(frame);
        packetRAFs.push(id);
      } else {
        circle.remove();
        if (onDone) onDone();
      }
    }

    const id = requestAnimationFrame(frame);
    packetRAFs.push(id);
  }

  // ── Unaffected ring flash ────────────────────────────────────────────
  function flashUnaffected(nodeIds) {
    if (!nodeIds) return;
    nodeIds.forEach(id => {
      const g = document.getElementById(`ch-node-${id}`);
      if (!g) return;
      const chain   = scenario.chain;
      const n       = chain.nodes.find(x => x.id === id);
      if (!n) return;
      const ring = svgEl_('circle', {
        cx: nodeCx(n), cy: nodeCy(n), r: NW / 2 + 4,
        fill: 'none', stroke: '#2fa66a', 'stroke-width': '2',
        opacity: '1',
      });
      nodesG.appendChild(ring);
      let t = 0;
      function fade() {
        t += 0.04;
        ring.setAttribute('opacity', String(Math.max(0, 1 - t)));
        if (t < 1) { const rid = requestAnimationFrame(fade); packetRAFs.push(rid); }
        else ring.remove();
      }
      const rid = requestAnimationFrame(fade);
      packetRAFs.push(rid);
    });
  }

  // ── Update authority bars ─────────────────────────────────────────────
  function updateAuthority(authority) {
    if (!authority) return;
    const chain = scenario.chain;
    authListEl.innerHTML = chain.nodes.map(n => {
      const pct = authority[n.id] !== undefined ? authority[n.id] : 100;
      const col = pct === 0 ? 'var(--quarantined)' : pct < 60 ? 'var(--restricted)' : 'var(--ok)';
      return `
        <div class="ch-auth-row">
          <span class="ch-auth-label">${n.label}</span>
          <div class="ch-auth-bar-bg">
            <div class="ch-auth-bar-fill" style="width:${pct}%;background:${col}"></div>
          </div>
        </div>
      `;
    }).join('');
  }

  // ── Update counters ───────────────────────────────────────────────────
  function updateCounters(counters) {
    if (!counters) return;
    cntComp.textContent = counters[0];
    cntAff.textContent  = counters[1];
    cntCut.textContent  = counters[2];
    cntComp.style.color = counters[0] > 0 ? 'var(--quarantined)' : 'var(--text)';
    cntAff.style.color  = counters[1] > 0 ? 'var(--quarantined)' : 'var(--text)';
    cntCut.style.color  = counters[2] > 0 ? 'var(--restricted)'  : 'var(--text)';
  }

  // ── Append log entry ──────────────────────────────────────────────────
  function appendLog(text) {
    const elapsed = ((performance.now() - logStart) / 1000).toFixed(1);
    const row = document.createElement('div');
    row.className = 'ch-log-entry';
    row.innerHTML = `<span class="ch-log-time">+${elapsed}s</span><span class="ch-log-text">${text}</span>`;
    logFeedEl.appendChild(row);
    logFeedEl.scrollTop = logFeedEl.scrollHeight;
  }

  // ── Apply a step ─────────────────────────────────────────────────────
  function applyStep(step, withAnimation) {
    drawEdges(step.edgeState);
    drawNodes(step.nodeStatus);
    updateCounters(step.counters);
    updateAuthority(step.authority);
    if (step.log) appendLog(step.log);
    if (step.unaffected) flashUnaffected(step.unaffected);
  }

  // ── Run sequence ─────────────────────────────────────────────────────
  function runStep() {
    const steps = mode === 'with' ? scenario.chain.steps : scenario.chain.stepsWithout;
    if (!steps || stepIdx >= steps.length) {
      // done — unlock toggle
      toggleWith.disabled    = false;
      toggleWithout.disabled = false;
      return;
    }

    const step = steps[stepIdx];
    stepIdx++;

    // Draw edges & nodes immediately, then animate packet, then schedule next
    drawEdges(step.edgeState);
    drawNodes(step.nodeStatus);
    updateCounters(step.counters);
    updateAuthority(step.authority);
    if (step.log) appendLog(step.log);
    if (step.unaffected) flashUnaffected(step.unaffected);

    const interval = 1400 / speed;
    if (step.packet) {
      animatePacket(step.packet, () => {
        stepTimer = setTimeout(runStep, interval - 800);
      });
    } else {
      stepTimer = setTimeout(runStep, interval);
    }
  }

  // ── Init ─────────────────────────────────────────────────────────────
  function chInit() {
    toggleWith.addEventListener('click', () => {
      if (toggleWith.disabled) return;
      if (mode === 'with' && started) return;
      mode = 'with';
      toggleWith.classList.add('active');
      toggleWithout.classList.remove('active');
      captionEl.textContent = CAPTIONS.with;
      if (started) restart();
    });

    toggleWithout.addEventListener('click', () => {
      if (toggleWithout.disabled) return;
      mode = 'without';
      toggleWithout.classList.add('active');
      toggleWith.classList.remove('active');
      captionEl.textContent = CAPTIONS.without;
      if (started) restart();
    });
  }

  function restart() {
    clearAll();
    started  = true;
    stepIdx  = 0;
    logStart = performance.now();
    logFeedEl.innerHTML = '';
    overlayTxt.textContent = '';
    // Lock toggle while running
    toggleWith.disabled    = true;
    toggleWithout.disabled = true;
    runStep();
  }

  // ── Public: start ─────────────────────────────────────────────────────
  function chStart(m) {
    if (started) return;
    mode    = m || 'with';
    started = true;
    stepIdx = 0;
    logStart = performance.now();
    overlayTxt.textContent = '';
    logFeedEl.innerHTML    = '';
    toggleWith.disabled    = true;
    toggleWithout.disabled = true;
    runStep();
  }

  // ── Public: onNavigate ────────────────────────────────────────────────
  function chOnNavigate() {
    // Nothing extra needed; SVG is always in DOM
  }

  // ── Clear animation state ─────────────────────────────────────────────
  function clearAll() {
    if (stepTimer)    { clearTimeout(stepTimer); stepTimer = null; }
    packetRAFs.forEach(id => cancelAnimationFrame(id));
    packetRAFs = [];
    packetsG.innerHTML = '';
  }

  // ── Public: reset ─────────────────────────────────────────────────────
  function chReset() {
    clearAll();
    started  = false;
    stepIdx  = 0;
    mode     = 'with';

    toggleWith.classList.add('active');
    toggleWithout.classList.remove('active');
    toggleWith.disabled    = false;
    toggleWithout.disabled = false;
    captionEl.textContent  = CAPTIONS.with;

    edgesG.innerHTML       = '';
    nodesG.innerHTML       = '';
    logFeedEl.innerHTML    = '';
    authListEl.innerHTML   = '';
    cntComp.textContent    = '0';
    cntAff.textContent     = '0';
    cntCut.textContent     = '0';
    cntComp.style.color    = 'var(--text)';
    cntAff.style.color     = 'var(--text)';
    cntCut.style.color     = 'var(--text)';

    overlayTxt.textContent = 'Chain scenario not started yet';
  }

  return { init: chInit, start: chStart, onNavigate: chOnNavigate, reset: chReset };
})();

// ── Start ──────────────────────────────────────────────────────────────
init();
