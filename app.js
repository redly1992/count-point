'use strict';

// ── Constants ────────────────────────────────────────────────────────────
const PLAYER_COLORS = ['#FF6B6B','#4ECDC4','#45B7D1','#FFA07A','#C39BD3','#82E0AA','#F7DC6F','#85C1E9'];
const STORAGE_KEY   = 'point-count-session';
const CONFIG_KEY    = 'point-count-config';
const SUPABASE_URL  = 'https://aaskpurumzrcjotaidym.supabase.co';
const SUPABASE_KEY  = 'sb_publishable_KZxdfL1QlPxdsZ2UEwUrKg_VM_jUQaE';
const SUPABASE_TABLE = 'game_sessions';
const MIN_PLAYERS   = 2;
const MAX_PLAYERS   = 8;

const sb = window.supabase?.createClient ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY) : null;
let syncChannel = null;
let syncRoomId = new URLSearchParams(location.search).get('room') || '';
let syncEnabled = false;
let syncTimer = null;
const appMode = new URLSearchParams(location.search).get('mode') || 'local';

// ── Config persistence ───────────────────────────────────────────────────
function saveConfig(players, pointsPerRound) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify({
    count: players.length,
    pointsPerRound,
    players: players.map(p => ({ name: p.name, color: p.color })),
  }));
}

function loadConfig() {
  try {
    const c = localStorage.getItem(CONFIG_KEY);
    if (c) return JSON.parse(c);
  } catch (_) {}
  return null;
}

function clearConfig() { localStorage.removeItem(CONFIG_KEY); }

// ── State ────────────────────────────────────────────────────────────────
let state = freshState();

function freshState() {
  return { active: false, ended: false, round: 1, pointsPerRound: 10, focusedIdx: null, history: [], players: [] };
}

// ── Storage ──────────────────────────────────────────────────────────────
function saveState()  {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  scheduleSync();
}
function clearState() { localStorage.removeItem(STORAGE_KEY); state = freshState(); }
function loadState()  {
  try {
    const s = localStorage.getItem(STORAGE_KEY);
    if (s) {
      state = JSON.parse(s);
      if (state.focusedIdx === undefined) state.focusedIdx = null; // migrate old saves
      if (!Array.isArray(state.history))   state.history = [];      // migrate old saves
      return true;
    }
  } catch (_) {}
  return false;
}

function syncPayload() {
  return {
    state,
    updatedAt: new Date().toISOString(),
  };
}

async function ensureRoom() {
  if (!syncRoomId) syncRoomId = crypto.randomUUID();
  return syncRoomId;
}

function roomUrl() {
  const url = new URL(location.href);
  url.searchParams.set('room', syncRoomId);
  url.searchParams.set('mode', 'view');
  return url.toString();
}

function editRoomUrl() {
  const url = new URL(location.href);
  url.searchParams.set('room', syncRoomId);
  url.searchParams.set('mode', 'edit');
  return url.toString();
}

function setShareUi(enabled) {
  document.getElementById('share-view-btn')?.toggleAttribute('disabled', !enabled);
  document.getElementById('share-edit-btn')?.toggleAttribute('disabled', !enabled);
}

function scheduleSync() {
  if (!sb || !syncEnabled || !syncRoomId) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => { pushSync().catch(() => {}); }, 3000);
}

async function pushSync() {
  if (!sb || !syncEnabled || !syncRoomId) return;
  const payload = syncPayload();
  const { error } = await sb.from(SUPABASE_TABLE).upsert({ id: syncRoomId, payload }, { onConflict: 'id' });
  if (error) throw error;
}

async function loadRemoteRoom(roomId) {
  if (!sb) throw new Error('Supabase not available');
  const { data, error } = await sb.from(SUPABASE_TABLE).select('payload').eq('id', roomId).single();
  if (error) throw error;
  return data?.payload;
}

async function startRealtime(roomId) {
  if (!sb) return;
  if (syncChannel) {
    await sb.removeChannel(syncChannel);
    syncChannel = null;
  }
  syncRoomId = roomId;
  syncEnabled = true;
  syncChannel = sb.channel(`room:${roomId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: SUPABASE_TABLE, filter: `id=eq.${roomId}` }, async () => {
      if (!syncEnabled) return;
      const payload = await loadRemoteRoom(roomId);
      if (payload?.state) {
        state = payload.state;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        renderGame();
        if (state.ended) {
          showResults();
          showScreen('result-screen');
        }
      }
    })
    .subscribe();
}

function isViewerMode() {
  return appMode === 'view';
}

function canEdit() {
  return appMode !== 'view';
}

// ── Screen management ────────────────────────────────────────────────────
// Wake Lock – keep screen on while the game is active
let wakeLock = null;

async function acquireWakeLock() {
  if (!('wakeLock' in navigator)) return;
  try {
    if (wakeLock) return; // already held
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  } catch (_) {}
}

function releaseWakeLock() {
  if (wakeLock) { wakeLock.release(); wakeLock = null; }
}

// Re-acquire after the tab comes back into focus (wake lock is released on hide)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.active) acquireWakeLock();
});

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  if (id === 'game-screen') acquireWakeLock();
  else releaseWakeLock();
}

// ══════════════════════════════════════════════════════════════════════════
// SETUP SCREEN
// ══════════════════════════════════════════════════════════════════════════
let setupCount = 2;

function initSetup() {
  const cfg = loadConfig();
  setupCount = cfg ? cfg.count : 2;
  refreshCountUI();
  buildPlayerConfigs(cfg);
  document.getElementById('points-per-round').value = cfg ? cfg.pointsPerRound : 10;
}

function resetConfig() {
  clearConfig();
  setupCount = 2;
  refreshCountUI();
  buildPlayerConfigs(null);
  document.getElementById('points-per-round').value = 10;
}

function refreshCountUI() {
  document.getElementById('player-count-display').textContent = setupCount;
  document.querySelector('[data-dir="-1"]').disabled = setupCount <= MIN_PLAYERS;
  document.querySelector('[data-dir="1"]').disabled  = setupCount >= MAX_PLAYERS;
}

function buildPlayerConfigs(cfg) {
  const wrap = document.getElementById('player-configs');
  wrap.innerHTML = '';

  for (let i = 0; i < setupCount; i++) {
    const savedColor = cfg && cfg.players[i] ? cfg.players[i].color : PLAYER_COLORS[i % PLAYER_COLORS.length];
    const savedName  = cfg && cfg.players[i] ? cfg.players[i].name  : `Player ${i + 1}`;
    const row   = document.createElement('div');
    row.className = 'flex items-center gap-3 p-3 rounded-2xl border-l-4 bg-purple-50 transition-colors';
    row.style.borderColor = savedColor;

    row.innerHTML = `
      <span class="font-display text-lg text-gray-400 min-w-[1.6rem] text-center">P${i + 1}</span>
      <input type="color" id="color-${i}" value="${savedColor}"
        class="w-10 h-10 rounded-full cursor-pointer border-0 bg-transparent p-0.5 shrink-0" />
      <input type="text" id="name-${i}" value="${escHtml(savedName)}" maxlength="12"
        placeholder="Player ${i + 1}"
        class="flex-1 h-10 rounded-xl border-2 border-purple-100 px-3 text-gray-700
               outline-none focus:border-purple-400 bg-white transition-colors" />
    `;

    row.querySelector(`#color-${i}`).addEventListener('input', e => {
      row.style.borderColor = e.target.value;
    });
    wrap.appendChild(row);
  }
}

function startSession() {
  const ppr = Math.max(1, parseInt(document.getElementById('points-per-round').value) || 10);
  const players = Array.from({ length: setupCount }, (_, i) => ({
    name:       (document.getElementById(`name-${i}`).value.trim() || `Player ${i + 1}`).slice(0, 12),
    color:      document.getElementById(`color-${i}`).value,
    totalScore: 0,
    roundScore: 0,
  }));

  state = { active: true, ended: false, round: 1, pointsPerRound: ppr, focusedIdx: null, history: [], players, roomId: syncRoomId || '' };
  saveConfig(players, ppr);
  saveState();
  renderGame();
  showScreen('game-screen');
  if (sb) {
    ensureRoom().then(async () => {
      state.roomId = syncRoomId;
      await startRealtime(syncRoomId);
      await pushSync();
      setShareUi(true);
    }).catch(() => {});
  }
}

// ══════════════════════════════════════════════════════════════════════════
// GAME SCREEN
// ══════════════════════════════════════════════════════════════════════════
function renderGame() {
  // Reset next-round button to default state (in case a confirm was pending)
  const nextBtn = document.getElementById('next-round-btn');
  if (nextBtn) {
    nextBtn.textContent = '⏭ Next Round';
    nextBtn.classList.remove('from-yellow-500','to-orange-500');
    nextBtn.classList.add('from-blue-500','to-violet-600');
  }
  document.getElementById('round-display').textContent = state.round;
  updateRoundTotal();
  renderLiveChart();
  rebuildGrid();
}

// Show sum of all players' current round scores in the header
function updateRoundTotal() {
  const total = state.players.reduce((sum, p) => sum + p.roundScore, 0);
  const el = document.getElementById('round-total');
  if (el) el.textContent = total > 0 ? `+${total}` : `${total}`;
}

function renderLiveChart() {
  const host = document.getElementById('live-chart');
  const legend = document.getElementById('live-chart-legend');
  if (!host || !state.players.length) return;

  const rounds = state.history.map(r => r.scores);
  if (state.active) rounds.push(state.players.map(p => p.roundScore));

  if (!rounds.length) {
    host.innerHTML = '<div class="h-full flex items-center justify-center text-white/45 text-sm">No chart data yet</div>';
    return;
  }

  const roundScores = [...state.history.map(r => r.scores)];
  if (state.active) roundScores.push(state.players.map(p => p.roundScore));

  const ranked = [...state.players]
    .map((p, idx) => ({ ...p, idx, rankScore: p.totalScore + p.roundScore }))
    .sort((a, b) => b.rankScore - a.rankScore);

  if (legend) {
    legend.innerHTML = ranked.map((p, rankIdx) => `
      <div class="flex items-center gap-1.5 rounded-full bg-white/10 px-2 py-1 text-white/90">
        <span class="text-[10px] font-black">${rankIdx + 1}.</span>
        <span class="w-2.5 h-2.5 rounded-full" style="background:${p.color}"></span>
        <span class="text-[11px] font-black truncate max-w-[7rem]">${escHtml(p.name)}</span>
      </div>
    `).join('');
  }

  const width = Math.max(1, host.getBoundingClientRect().width || host.clientWidth || 0);
  const height = 100;
  const pad = 12;
  const chartH = height - pad * 2;
  const chartW = width - pad * 2;
  const maxVal = Math.max(1, ...roundScores.flat().map(v => Math.abs(v)));
  const xStep = roundScores.length > 0 ? chartW / roundScores.length : chartW;
  const barW = Math.max(2, xStep * 0.18);
  const zeroY = pad + chartH * 0.5;

  const bars = state.players.map((p, idx) => {
    const series = roundScores.map((round, roundIdx) => {
      const value = round[idx] ?? 0;
      const barH = Math.max(1, Math.abs(value) / maxVal * (chartH * 0.45));
      const x = pad + roundIdx * xStep + xStep / 2 + idx * (barW + 1) - ((state.players.length - 1) * (barW + 1)) / 2;
      const y = value >= 0 ? zeroY - barH : zeroY;
      return `<rect x="${x}" y="${y}" width="${barW}" height="${barH}" rx="${Math.min(2, barW/2)}" fill="${p.color}" opacity="${value ? 0.9 : 0.25}" />`;
    }).join('');
    return series;
  }).join('');

  const gridLines = [0.25, 0.5, 0.75].map(r => {
    const y = pad + chartH * r;
    return `<line x1="${pad}" y1="${y}" x2="${width - pad}" y2="${y}" stroke="rgba(255,255,255,.12)" stroke-width="1" />`;
  }).join('');

  host.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" class="w-full h-full block">
      <rect x="0" y="0" width="${width}" height="${height}" rx="12" fill="rgba(0,0,0,.12)" />
      ${gridLines}
      <line x1="${pad}" y1="${zeroY}" x2="${width - pad}" y2="${zeroY}" stroke="rgba(255,255,255,.22)" stroke-width="1.2" />
      ${bars}
    </svg>`;
}

// ── Player grid ──────────────────────────────────────────────────────────
function rebuildGrid() {
  const grid = document.getElementById('players-grid');
  grid.innerHTML = '';
  const n = state.players.length;

  grid.style.gridTemplateColumns = getGridCols(n);

  state.players.forEach((p, i) => {
    const cell = document.createElement('div');
    cell.className = 'player-area';
    cell.dataset.idx = i;
    cell.style.backgroundColor = p.color;
    cell.style.color = contrastColor(p.color);
    setCellContent(cell, p);

    // Track whether a long-press just fired so the click handler can ignore it
    let longPressFired = false;

    cell.addEventListener('click', (event) => {
      if (longPressFired) { longPressFired = false; return; }
      tapPlayer(i, false, event);
    });

    // 2-finger touch → subtract
    cell.addEventListener('touchstart', (e) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        tapPlayer(i, true);
      }
    }, { passive: false });

    // Prevent OS context menu on long-press (iOS/Android)
    cell.addEventListener('contextmenu', (e) => e.preventDefault());

    // Long-press (3 s) → reset round score to 0
    let holdTimer      = null;
    let holdStartPos   = null;
    const MOVE_LIMIT   = 12; // px — allow micro-wobble without cancelling

    const startHold = (e) => {
      if (e.touches && e.touches.length !== 1) return; // single touch only
      holdStartPos = e.touches
        ? { x: e.touches[0].clientX, y: e.touches[0].clientY }
        : null;
      cell.classList.add('holding');
      holdTimer = setTimeout(() => {
        holdTimer = null;
        longPressFired = true;
        cell.classList.remove('holding');
        resetRoundScore(i);
      }, 500);
    };

    const cancelHold = () => {
      if (!holdTimer) return;
      clearTimeout(holdTimer);
      holdTimer = null;
      cell.classList.remove('holding');
    };

    const cancelHoldOnMove = (e) => {
      if (!holdTimer || !holdStartPos || !e.touches) return;
      const dx = Math.abs(e.touches[0].clientX - holdStartPos.x);
      const dy = Math.abs(e.touches[0].clientY - holdStartPos.y);
      if (dx > MOVE_LIMIT || dy > MOVE_LIMIT) cancelHold();
    };

    cell.addEventListener('touchstart',  startHold,       { passive: true });
    cell.addEventListener('touchend',    cancelHold);
    cell.addEventListener('touchmove',   cancelHoldOnMove, { passive: true });
    // NOTE: intentionally no touchcancel listener — OS long-press fires touchcancel
    // which would kill the timer before 3 s; contextmenu is prevented above instead.
    cell.addEventListener('mousedown',   startHold);
    cell.addEventListener('mouseup',     cancelHold);
    cell.addEventListener('mouseleave',  cancelHold);
    grid.appendChild(cell);
  });

  // Special column spans for asymmetric layouts
  applySpecialSpans(grid.querySelectorAll('.player-area'), n);

  // Restore focused cell highlight
  if (state.focusedIdx !== null) {
    const focusedCell = grid.querySelector(`.player-area[data-idx="${state.focusedIdx}"]`);
    if (focusedCell) focusedCell.classList.add('focused');
  }
}

function setCellContent(cell, player) {
  const rs       = player.roundScore;
  const scoreStr = rs > 0 ? `+${rs}` : `${rs}`;
  cell.innerHTML = `
    <span class="score-display">${scoreStr}</span>
    <div class="flex flex-col items-center mt-1 gap-0.5 leading-none">
      <span class="name-display">${escHtml(player.name)}</span>
      <span class="total-display">🏆 ${player.totalScore}</span>
    </div>
    <div class="absolute bottom-1 left-1/2 -translate-x-1/2 text-[10px] font-black tracking-[2px] uppercase opacity-75 pointer-events-none">
      top + / bottom -
    </div>
  `;
}

function getGridCols(n) {
  const map = {
    1: '1fr',
    2: 'repeat(2,1fr)',
    3: 'repeat(2,1fr)',     // 2 + 1 full-width
    4: 'repeat(2,1fr)',     // 2×2
    5: 'repeat(6,1fr)',     // 3 × span-2  +  2 × span-3
    6: 'repeat(3,1fr)',     // 2×3
    7: 'repeat(3,1fr)',     // 3+3+1 centred
    8: 'repeat(4,1fr)',     // 2×4
  };
  return map[n] ?? `repeat(${Math.ceil(Math.sqrt(n))},1fr)`;
}

function applySpecialSpans(cells, n) {
  if (n === 3) {
    cells[2].style.gridColumn = '1 / -1';
  } else if (n === 5) {
    [0,1,2].forEach(i => { cells[i].style.gridColumn = 'span 2'; });
    [3,4].forEach(i =>   { cells[i].style.gridColumn = 'span 3'; });
  } else if (n === 7) {
    // Last cell alone on row 3, centred in 3-col grid
    cells[6].style.gridColumn = '2 / 3';
  }
}

// ── Player tap ───────────────────────────────────────────────────────────
// tap above midpoint → add; below midpoint → subtract
function tapPlayer(idx, subtract = false, event = null) {
  if (!state.active || !canEdit()) return;

  if (event && !subtract) {
    const rect = event.currentTarget.getBoundingClientRect();
    subtract = event.clientY > rect.top + rect.height / 2;
  }

  let delta = subtract ? -state.pointsPerRound : state.pointsPerRound;

  // Auto-balance: if this is the only player still at 0 and all others are non-zero,
  // fill the value that makes the round total exactly 0
  if (!subtract && state.players[idx].roundScore === 0) {
    const othersAllNonZero = state.players.every((p, i) => i === idx || p.roundScore !== 0);
    if (othersAllNonZero && state.players.length > 1) {
      const othersSum = state.players.reduce((s, p, i) => i === idx ? s : s + p.roundScore, 0);
      if (othersSum !== 0) delta = -othersSum;
    }
  }
  state.players[idx].roundScore += delta;
  state.focusedIdx = idx;
  saveState();

  const cell = document.querySelector(`.player-area[data-idx="${idx}"]`);
  if (!cell) return;

  document.querySelectorAll('.player-area').forEach(c => c.classList.remove('focused'));
  cell.classList.add('focused');
  setCellContent(cell, state.players[idx]);
  updateRoundTotal();
  renderLiveChart();

  cell.classList.remove('tapped');
  requestAnimationFrame(() => requestAnimationFrame(() => {
    cell.classList.add('tapped');
    setTimeout(() => cell.classList.remove('tapped'), 360);
  }));

  const rect = cell.getBoundingClientRect();
  const f    = document.createElement('div');
  f.className    = 'float-score';
  f.textContent  = delta > 0 ? `+${delta}` : `${delta}`;
  f.style.color  = delta > 0 ? '#00e676' : '#ff5252';
  f.style.left   = `${rect.left + rect.width  / 2}px`;
  f.style.top    = `${rect.top  + rect.height / 2}px`;
  document.body.appendChild(f);
  setTimeout(() => f.remove(), 950);
}

// Long-press reset: zero out a player's round score
function resetRoundScore(idx) {
  if (!state.active || !canEdit()) return;
  state.players[idx].roundScore = 0;
  state.focusedIdx = idx;
  saveState();

  const cell = document.querySelector(`.player-area[data-idx="${idx}"]`);
  if (!cell) return;

  document.querySelectorAll('.player-area').forEach(c => c.classList.remove('focused'));
  cell.classList.add('focused');
  setCellContent(cell, state.players[idx]);
  updateRoundTotal();
  renderLiveChart();

  // "RESET" float indicator
  const rect = cell.getBoundingClientRect();
  const f = document.createElement('div');
  f.className   = 'float-score';
  f.textContent = '✕ 0';
  f.style.color = '#ffffffcc';
  f.style.left  = `${rect.left + rect.width  / 2}px`;
  f.style.top   = `${rect.top  + rect.height / 2}px`;
  document.body.appendChild(f);
  setTimeout(() => f.remove(), 950);

  // Brief shake animation on the cell
  cell.classList.add('reset-shake');
  setTimeout(() => cell.classList.remove('reset-shake'), 400);
}

// ══════════════════════════════════════════════════════════════════════════
// ROUND MANAGEMENT
// ══════════════════════════════════════════════════════════════════════════
function nextRound() {
  // Snapshot this round into history before resetting
  state.history.push({
    round:  state.round,
    scores: state.players.map(p => p.roundScore),
  });
  state.players.forEach(p => { p.totalScore += p.roundScore; p.roundScore = 0; });
  state.round++;
  state.focusedIdx = null; // clear focus for the new round
  saveState();
  renderGame();

  // Flash the round number
  const el = document.getElementById('round-display');
  el.classList.remove('round-pop');
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('round-pop')));
  setTimeout(() => el.classList.remove('round-pop'), 550);
}

// ══════════════════════════════════════════════════════════════════════════
// SESSION END
// ══════════════════════════════════════════════════════════════════════════
function endSession() {
  // Snapshot final round if it has any score
  if (state.players.some(p => p.roundScore !== 0)) {
    state.history.push({
      round:  state.round,
      scores: state.players.map(p => p.roundScore),
    });
  }
  state.players.forEach(p => { p.totalScore += p.roundScore; p.roundScore = 0; });
  state.active = false;
  state.ended  = true;
  saveState();
  showResults();
  showScreen('result-screen');
}

// ══════════════════════════════════════════════════════════════════════════
// HISTORY MODAL
// ══════════════════════════════════════════════════════════════════════════
function showHistory() {
  const modal   = document.getElementById('history-modal');
  const content = document.getElementById('history-content');
  const players = state.players;

  // Build rows: past rounds plus the live round if the session is still active
  const rows = [...state.history];
  if (state.active) {
    rows.push({ round: state.round, scores: players.map(p => p.roundScore), current: true });
  }

  // Header row
  const colW = 'min-w-[3rem] text-center px-1';
  let html = `
    <table class="w-full border-collapse text-sm font-[Nunito]">
      <thead>
        <tr class="border-b-2 border-purple-100">
          <th class="text-left py-2 px-2 text-gray-400 font-black uppercase tracking-wider text-[10px]">Rnd</th>
          ${players.map(p => `
            <th class="${colW} py-2">
              <span class="inline-block w-2.5 h-2.5 rounded-full mr-1"
                    style="background:${p.color}"></span>
              <span class="font-display text-xs" style="color:${p.color}">${escHtml(p.name)}</span>
            </th>`).join('')}
        </tr>
      </thead>
      <tbody>`;

  rows.forEach(row => {
    const isCurrent = row.current;
    const rowClass  = isCurrent
      ? 'bg-purple-50 font-black'
      : 'border-b border-gray-100';
    html += `<tr class="${rowClass}">
      <td class="py-2 px-2 font-display text-purple-700">
        ${isCurrent ? '▶' : row.round}
      </td>`;
    row.scores.forEach((s, idx) => {
      const color = s > 0 ? '#10ac84' : s < 0 ? '#c0392b' : '#9ca3af';
      html += `<td class="${colW} py-2 font-display tabular-nums" style="color:${color}">
        ${s > 0 ? '+' : ''}${s}
      </td>`;
    });
    html += `</tr>`;
  });

  // Totals row (running totals + current round scores)
  html += `<tr class="border-t-2 border-purple-200 bg-white">
    <td class="py-2 px-2 font-display text-[10px] uppercase tracking-wider text-gray-400">Total</td>`;
  players.forEach(p => {
    const t = p.totalScore + p.roundScore;
    html += `<td class="${colW} py-2 font-display font-black tabular-nums text-purple-700">${t}</td>`;
  });
  html += `</tr></tbody></table>`;

  content.innerHTML = html;
  modal.classList.remove('hidden');
  requestAnimationFrame(() => modal.classList.add('modal-visible'));
}

function closeHistory() {
  const modal = document.getElementById('history-modal');
  modal.classList.remove('modal-visible');
  setTimeout(() => modal.classList.add('hidden'), 250);
}

// ══════════════════════════════════════════════════════════════════════════
// RESULT SCREEN
// ══════════════════════════════════════════════════════════════════════════
function showResults() {
  const sorted  = [...state.players].sort((a, b) => b.totalScore - a.totalScore);
  const best    = sorted[0].totalScore;
  const winners = sorted.filter(p => p.totalScore === best);
  const rounds = [
    ...state.history.map(r => r.scores),
    state.active ? state.players.map(p => p.roundScore) : [],
  ].filter(row => row.length);

  const banner = document.getElementById('winner-banner');
  if (winners.length === 1) {
    banner.innerHTML = `
      <span class="trophy-anim text-7xl">🏆</span>
      <div class="font-display text-5xl mt-3 drop-shadow-sm" style="color:${winners[0].color}">
        ${escHtml(winners[0].name)}
      </div>
      <div class="font-display text-xl tracking-[3px] text-gray-400 mt-1">WINS!</div>`;
  } else {
    banner.innerHTML = `
      <span class="trophy-anim text-7xl">🤝</span>
      <div class="font-display text-3xl mt-3 text-gray-700">
        ${winners.map(w => escHtml(w.name)).join(' & ')}
      </div>
      <div class="font-display text-xl tracking-[3px] text-gray-400 mt-1">IT'S A TIE!</div>`;
  }

  const medals = ['🥇','🥈','🥉'];
  const list   = document.getElementById('scores-list');
  list.innerHTML = '';

  let rankPos = 0;
  sorted.forEach((p, i) => {
    if (i > 0 && p.totalScore < sorted[i - 1].totalScore) rankPos = i;

    const item = document.createElement('div');
    item.className = 'score-item flex items-center gap-3 p-3.5 rounded-2xl bg-purple-50 border-l-4';
    item.style.borderColor       = p.color;
    item.style.animationDelay    = `${i * 80}ms`;
    item.innerHTML = `
      <span class="text-2xl min-w-[2rem] text-center">${medals[rankPos] ?? `#${rankPos + 1}`}</span>
      <span class="font-display text-xl flex-1 text-gray-800">${escHtml(p.name)}</span>
      <span class="font-display text-xl font-bold" style="color:${p.color}">${p.totalScore} pts</span>`;
    list.appendChild(item);
  });

  renderPerformanceChart(rounds);
}

function renderPerformanceChart(rounds) {
  const chart = document.getElementById('performance-chart');
  if (!chart) return;

  const players = state.players;
  if (!players.length || !rounds.length) {
    chart.innerHTML = '<div class="text-sm text-gray-400">No round data yet.</div>';
    return;
  }

  const maxAbs = Math.max(1, ...rounds.flat().map(v => Math.abs(v)));
  chart.innerHTML = players.map((p, idx) => {
    const cells = rounds.map((round, roundIdx) => {
      const value = round[idx] ?? 0;
      const alpha = Math.min(1, Math.max(0.2, Math.abs(value) / maxAbs));
      const bg = value > 0 ? `rgba(16, 172, 132, ${alpha})` : value < 0 ? `rgba(192, 57, 43, ${alpha})` : 'rgba(156, 163, 175, .18)';
      return `<span class="performance-cell ${value ? 'performance-cell--filled' : ''}" style="background:${bg}" title="Round ${roundIdx + 1}: ${value > 0 ? '+' : ''}${value}"></span>`;
    }).join('');

    return `
      <div class="flex items-center gap-2">
        <div class="w-20 shrink-0">
          <div class="font-display text-xs leading-none truncate" style="color:${p.color}">${escHtml(p.name)}</div>
          <div class="text-[10px] text-gray-400">${p.totalScore} pts</div>
        </div>
        <div class="flex-1 flex gap-1 overflow-x-auto pb-1">
          ${cells}
        </div>
      </div>`;
  }).join('');
}

// ── Utilities ────────────────────────────────────────────────────────────
function contrastColor(hex) {
  if (!hex || hex.length < 7) return '#ffffff';
  const r = parseInt(hex.slice(1,3), 16);
  const g = parseInt(hex.slice(3,5), 16);
  const b = parseInt(hex.slice(5,7), 16);
  if (isNaN(r) || isNaN(g) || isNaN(b)) return '#ffffff';
  return (0.299*r + 0.587*g + 0.114*b) / 255 > 0.6 ? '#1a1a2e' : '#ffffff';
}

function escHtml(s) {
  return String(s)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}

// ══════════════════════════════════════════════════════════════════════════
// BOOT – wire events, restore or start fresh
// ══════════════════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {

  // Setup: stepper buttons
  document.querySelectorAll('.stepper-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      setupCount = Math.min(MAX_PLAYERS, Math.max(MIN_PLAYERS, setupCount + parseInt(btn.dataset.dir)));
      refreshCountUI();
      // Preserve what the user has already typed by snapshotting current inputs
      const currentCfg = { players: Array.from({ length: MAX_PLAYERS }, (_, i) => ({
        name:  document.getElementById(`name-${i}`)  ? document.getElementById(`name-${i}`).value  : PLAYER_COLORS[i],
        color: document.getElementById(`color-${i}`) ? document.getElementById(`color-${i}`).value : PLAYER_COLORS[i % PLAYER_COLORS.length],
      })) };
      buildPlayerConfigs(currentCfg);
    });
  });

  document.getElementById('start-btn').addEventListener('click', startSession);
  document.getElementById('reset-config-btn').addEventListener('click', resetConfig);
  document.getElementById('share-view-btn').addEventListener('click', async () => {
    if (!syncRoomId) return;
    await navigator.clipboard.writeText(roomUrl());
  });
  document.getElementById('share-edit-btn').addEventListener('click', async () => {
    if (!syncRoomId) return;
    await navigator.clipboard.writeText(editRoomUrl());
  });

  // Game: history modal
  document.getElementById('history-btn').addEventListener('click', showHistory);
  document.getElementById('result-history-btn').addEventListener('click', showHistory);
  document.getElementById('history-close-btn').addEventListener('click', closeHistory);
  document.getElementById('history-modal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeHistory(); // tap backdrop to close
  });

  // Game: next round – confirm if round total ≠ 0
  let nextPending = false;
  let nextTimer   = null;
  const nextBtn   = document.getElementById('next-round-btn');

  nextBtn.addEventListener('click', () => {
    if (!canEdit()) return;
    const roundTotal = state.players.reduce((s, p) => s + p.roundScore, 0);

    if (nextPending) {
      clearTimeout(nextTimer);
      nextPending = false;
      nextBtn.textContent = '⏭ Next Round';
      nextBtn.classList.remove('from-yellow-500','to-orange-500');
      nextBtn.classList.add('from-blue-500','to-violet-600');
      nextRound();
      return;
    }

    if (roundTotal !== 0) {
      // Ask for confirmation
      nextPending = true;
      const sign = roundTotal > 0 ? '+' : '';
      nextBtn.textContent = `⚠️ Total ${sign}${roundTotal} — Sure?`;
      nextBtn.classList.remove('from-blue-500','to-violet-600');
      nextBtn.classList.add('from-yellow-500','to-orange-500');
      nextTimer = setTimeout(() => {
        nextPending = false;
        nextBtn.textContent = '⏭ Next Round';
        nextBtn.classList.remove('from-yellow-500','to-orange-500');
        nextBtn.classList.add('from-blue-500','to-violet-600');
      }, 2500);
    } else {
      nextRound();
    }
  });

  // Game: end session – double-tap protection to prevent accidents
  let endPending = false;
  let endTimer   = null;
  const endBtn   = document.getElementById('end-session-btn');

  endBtn.addEventListener('click', () => {
    if (!canEdit()) return;
    if (endPending) {
      clearTimeout(endTimer);
      endPending = false;
      endBtn.textContent = '🏁 End';
      endSession();
    } else {
      endPending = true;
      endBtn.textContent = '⚠️ Sure?';
      endTimer = setTimeout(() => {
        endPending = false;
        endBtn.textContent = '🏁 End';
      }, 2500);
    }
  });

  // Results: play again
  document.getElementById('play-again-btn').addEventListener('click', () => {
    clearState();
    initSetup();
    showScreen('setup-screen');
  });

  if (syncRoomId && sb && (appMode === 'view' || appMode === 'edit')) {
    loadRemoteRoom(syncRoomId).then(async payload => {
      if (payload?.state) {
        state = payload.state;
        renderGame();
        if (state.ended) {
          showResults();
          showScreen('result-screen');
        } else {
          showScreen('game-screen');
        }
        await startRealtime(syncRoomId);
        setShareUi(true);
      }
    }).catch(() => {
      initSetup();
      showScreen('setup-screen');
    });
  } else {
    const restored = loadState();
    if (restored && state.active) {
      renderGame();
      showScreen('game-screen');
      setShareUi(true);
    } else if (restored && state.ended) {
      showResults();
      showScreen('result-screen');
      setShareUi(true);
    } else {
      initSetup();
      showScreen('setup-screen');
      setShareUi(false);
    }
  }

  if (appMode === 'view') {
    document.getElementById('share-view-btn')?.remove();
    document.getElementById('share-edit-btn')?.remove();
  }
});
