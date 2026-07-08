'use strict';

// ── Constants ────────────────────────────────────────────────────────────
const PLAYER_COLORS = ['#FF6B6B','#4ECDC4','#45B7D1','#FFA07A','#C39BD3','#82E0AA','#F7DC6F','#85C1E9'];
const SUPABASE_URL  = 'https://aaskpurumzrcjotaidym.supabase.co';
const SUPABASE_KEY  = 'sb_publishable_KZxdfL1QlPxdsZ2UEwUrKg_VM_jUQaE';
const SUPABASE_TABLE = 'game_sessions';
const PLAYER_TABLE = 'players';
const MATCH_TABLE = 'matches';
const BALANCE_HISTORY_TABLE = 'player_balance_history';
const SETTINGS_TABLE = 'app_settings';
const MIN_PLAYERS   = 2;
const MAX_PLAYERS   = 8;

const sb = window.supabase?.createClient ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY) : null;
let syncChannel = null;
// The room id is the single anchor for the current game's persisted state.
// It lives in the URL (?room=...) rather than in browser storage, so state
// survives reloads without needing localStorage. If no room is present in
// the URL, a fresh one is generated and written into the URL bar.
let syncRoomId = new URLSearchParams(location.search).get('room') || '';
let syncEnabled = false;
let syncTimer = null;
const appMode = new URLSearchParams(location.search).get('mode') || 'local';
const playerColorTimers = new Map();

// ── Settings persistence (Supabase key/value table, replaces localStorage) ─
async function getSetting(key, fallback) {
  if (!sb) return fallback;
  try {
    const { data, error } = await sb.from(SETTINGS_TABLE).select('value').eq('key', key).maybeSingle();
    if (error || !data) return fallback;
    return data.value ?? fallback;
  } catch (_) {
    return fallback;
  }
}
async function setSetting(key, value) {
  if (!sb) return;
  await sb.from(SETTINGS_TABLE).upsert({ key, value, updated_at: new Date().toISOString() });
}
async function deleteSetting(key) {
  if (!sb) return;
  await sb.from(SETTINGS_TABLE).delete().eq('key', key);
}

// ── Config persistence ───────────────────────────────────────────────────
async function saveConfig(players, pointsPerRound) {
  await setSetting('config', {
    count: players.length,
    pointsPerRound,
    players: players.map(p => ({ id: p.id, name: p.name, color: p.color })),
  }).catch(() => {});
}

async function loadConfig() {
  return await getSetting('config', null);
}

async function clearConfig() { await deleteSetting('config').catch(() => {}); }
async function loadSelectedPlayerIds() {
  return await getSetting('selected_player_ids', []);
}
async function saveSelectedPlayerIds(ids) {
  await setSetting('selected_player_ids', ids).catch(() => {});
}

// ── State ────────────────────────────────────────────────────────────────
let state = freshState();

function freshState() {
  return { active: false, ended: false, round: 1, pointsPerRound: 10, focusedIdx: null, history: [], players: [] };
}

// ── Storage (Supabase-backed, keyed by the room id in the URL) ───────────
function saveState()  {
  scheduleSync();
}
async function clearState() {
  clearTimeout(syncTimer); // drop any pending debounced write from the previous game
  state = freshState();
  if (sb && syncRoomId) {
    await sb.from(SUPABASE_TABLE).upsert({ id: syncRoomId, payload: syncPayload() }, { onConflict: 'id' }).catch(() => {});
  }
}
async function loadState()  {
  if (!sb || !syncRoomId) return false;
  try {
    const payload = await loadRemoteRoom(syncRoomId);
    if (payload?.state) {
      state = payload.state;
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

async function fetchPlayers() {
  if (!sb) return [];
  const { data, error } = await sb.from(PLAYER_TABLE).select('*').order('name', { ascending: true });
  if (error) throw error;
  return data || [];
}

async function upsertPlayer(player) {
  if (!sb) return;
  const payload = {
    id: player.id || crypto.randomUUID(),
    name: player.name,
    balance: asNumber(player.balance),
    transfer_status: player.transfer_status || 'transferred',
    color: player.color || '#a855f7',
    updated_at: new Date().toISOString(),
  };
  const { error } = await sb.from(PLAYER_TABLE).upsert(payload);
  if (error) throw error;
}

async function markPlayerTransferred(playerId) {
  if (!sb) return;
  const { error } = await sb.from(PLAYER_TABLE)
    .update({ balance: 0, transfer_status: 'transferred', updated_at: new Date().toISOString() })
    .eq('id', playerId);
  if (error) throw error;
}

// Wipes match history, balance history, and resets every player's balance/status
// while keeping their name and color intact.
async function resetAppData() {
  if (!sb) return;
  const { error: delMatchesErr } = await sb.from(MATCH_TABLE).delete().not('id', 'is', null);
  if (delMatchesErr) throw delMatchesErr;
  const { error: delHistoryErr } = await sb.from(BALANCE_HISTORY_TABLE).delete().not('id', 'is', null);
  if (delHistoryErr) throw delHistoryErr;
  const { error: resetPlayersErr } = await sb.from(PLAYER_TABLE)
    .update({ balance: 0, transfer_status: 'transferred', updated_at: new Date().toISOString() })
    .not('id', 'is', null);
  if (resetPlayersErr) throw resetPlayersErr;
  await clearState();
  await clearConfig();
}

async function fetchMatches() {
  if (!sb) return [];
  const { data, error } = await sb.from(MATCH_TABLE).select('*').order('played_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

async function saveMatchResult(match) {
  if (!sb) return;
  const { error } = await sb.from(MATCH_TABLE).upsert(match);
  if (error) throw error;
}

async function saveBalanceHistory(rows) {
  if (!sb || !rows.length) return;
  const { error } = await sb.from(BALANCE_HISTORY_TABLE).insert(rows);
  if (error) throw error;
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
  // maybeSingle() returns null (not an error) when the room hasn't been
  // saved yet — normal for a freshly generated room id.
  const { data, error } = await sb.from(SUPABASE_TABLE).select('payload').eq('id', roomId).maybeSingle();
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

function isoWeekKey(date = new Date()) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

function asNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
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
let setupCount = 0;

async function initSetup() {
  const cfg = await loadConfig().catch(() => null);
  const selected = await getSelectedPlayers().catch(() => []);
  setupCount = selected.length;
  await buildPlayerConfigs(selected.length ? { count: selected.length, pointsPerRound: cfg ? cfg.pointsPerRound : 10, players: selected } : cfg).catch(() => {});
  document.getElementById('points-per-round').value = cfg ? cfg.pointsPerRound : 10;
}

async function resetConfig() {
  await clearConfig();
  setupCount = 0;
  await buildPlayerConfigs(null);
  document.getElementById('points-per-round').value = 10;
}

async function getSelectedPlayers() {
  const ids = await loadSelectedPlayerIds();
  const players = await fetchPlayers().catch(() => []);
  return players.filter(p => ids.includes(p.id));
}

async function buildPlayerConfigs(cfg) {
  const wrap = document.getElementById('player-configs');
  wrap.innerHTML = '';
  const selectedPlayers = cfg?.players || await getSelectedPlayers().catch(() => []);
  if (!selectedPlayers.length) {
    wrap.innerHTML = '<div class="rounded-2xl bg-gray-50 p-4 text-sm text-gray-500">No players selected in Player Management yet.</div>';
    return;
  }
  selectedPlayers.forEach((p, i) => {
    const row = document.createElement('div');
    row.className = 'flex items-center gap-3 p-3 rounded-2xl border-l-4 bg-purple-50 transition-colors';
    row.style.borderColor = p.color || PLAYER_COLORS[i % PLAYER_COLORS.length];
    row.innerHTML = `
      <span class="font-display text-lg text-gray-400 min-w-[1.6rem] text-center">P${i + 1}</span>
      <div class="w-10 h-10 rounded-full shrink-0 border-2 border-white" style="background:${p.color || PLAYER_COLORS[i % PLAYER_COLORS.length]}"></div>
      <div class="flex-1 min-w-0">
        <div class="font-black text-gray-800 truncate">${escHtml(p.name)}</div>
        <div class="text-xs text-gray-400">Selected from Player Management</div>
      </div>
    `;
    wrap.appendChild(row);
  });
}

async function renderPlayersAdmin() {
  const host = document.getElementById('players-admin-list');
  if (!host) return;
  const players = await fetchPlayers().catch(() => []);
  const selected = new Set(await loadSelectedPlayerIds());
  const validIds = players.filter(p => selected.has(p.id)).map(p => p.id);
  if (validIds.length !== selected.size) await saveSelectedPlayerIds(validIds);
  const selectedSet = new Set(validIds);
  const selectedCount = validIds.length;
  if (!players.length) {
    host.innerHTML = '<div class="text-gray-400 text-sm">No players yet.</div>';
    return;
  }

  const selectedInfo = document.getElementById('selected-players-info');
  if (selectedInfo) selectedInfo.textContent = `${selectedCount} selected`;

  host.innerHTML = players.map(p => `
    <div class="rounded-2xl border-2 p-3 flex items-center gap-3 ${selected.has(p.id) ? 'border-purple-500 bg-purple-50' : 'border-purple-100 bg-white'}">
      <label class="flex items-center gap-2 cursor-pointer shrink-0" title="Select this player for the next match">
        <input type="checkbox" class="player-select" data-id="${p.id}" ${selected.has(p.id) ? 'checked' : ''} />
        <span class="text-[10px] uppercase tracking-[2px] ${selected.has(p.id) ? 'text-purple-700' : 'text-gray-400'}">Use</span>
      </label>
      <div class="flex-1 min-w-0">
        <div class="font-black truncate" style="color:${p.color || '#6b21a8'}">${escHtml(p.name)}</div>
        <div class="mt-1 flex items-center gap-2 flex-wrap">
          <span class="inline-flex items-center px-2 py-1 rounded-full text-[10px] font-black uppercase tracking-[1px] ${p.transfer_status === 'pending' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}">
            ${escHtml(p.transfer_status || 'transferred')}
          </span>
          <input type="color" class="player-color-input w-8 h-8 rounded-full border-0 bg-transparent p-0 cursor-pointer" data-id="${p.id}" value="${p.color || '#ffffff'}" title="Change player color" />
          <span class="text-xs text-gray-500">Balance</span>
          <span class="font-display text-2xl text-purple-800">${asNumber(p.balance)}</span>
        </div>
      </div>
      <button class="px-3 py-2 rounded-full bg-green-600 text-white text-sm font-black transfer-btn" data-id="${p.id}">Transferred</button>
    </div>
  `).join('');

  host.querySelectorAll('.player-select').forEach(cb => {
    cb.addEventListener('change', async () => {
      const ids = new Set(await loadSelectedPlayerIds());
      if (cb.checked) ids.add(cb.dataset.id); else ids.delete(cb.dataset.id);
      await saveSelectedPlayerIds([...ids]);
      renderPlayersAdmin();
    });
  });
  host.querySelectorAll('.transfer-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const row = btn.closest('div.rounded-2xl');
      const name = row?.querySelector('.font-black')?.textContent || 'this player';
      if (!confirm(`Mark ${name} as transferred and set balance to 0?`)) return;
      await markPlayerTransferred(btn.dataset.id);
      renderPlayersAdmin();
    });
  });
  host.querySelectorAll('.player-color-input').forEach(input => {
    const saveColor = (color) => {
      clearTimeout(playerColorTimers.get(input.dataset.id));
      playerColorTimers.set(input.dataset.id, setTimeout(async () => {
        const players = await fetchPlayers().catch(() => []);
        const player = players.find(p => p.id === input.dataset.id);
        if (!player) return;
        await upsertPlayer({ ...player, color }).catch(() => {});
        renderPlayersAdmin();
      }, 300));
    };
    input.addEventListener('input', () => {
      const color = input.value;
      const name = input.closest('.rounded-2xl')?.querySelector('.font-black');
      if (name) name.style.color = color;
      saveColor(color);
    });
    input.addEventListener('change', () => {
      const color = input.value;
      const name = input.closest('.rounded-2xl')?.querySelector('.font-black');
      if (name) name.style.color = color;
      saveColor(color);
    });
  });
}

async function renderWeeklyReport() {
  const weeks = await fetchMatches().catch(() => []);
  const tabs = document.getElementById('week-tabs');
  const list = document.getElementById('week-report-list');
  if (!tabs || !list) return;
  const grouped = Object.values(weeks.reduce((acc, m) => {
    const key = m.week_key || isoWeekKey(new Date(m.played_at || Date.now()));
    (acc[key] ||= []).push(m);
    return acc;
  }, {}));
  const weekKeys = [...new Set(weeks.map(m => m.week_key || isoWeekKey(new Date(m.played_at || Date.now()))))];
  const activeWeek = weekKeys[0] || isoWeekKey();
  tabs.innerHTML = weekKeys.map((w, i) => `<button class="week-tab px-3 py-2 rounded-full text-sm font-black ${i === 0 ? 'bg-purple-700 text-white' : 'bg-gray-100 text-gray-600'}" data-week="${w}">${w}</button>`).join('');
  const renderWeek = (w) => {
    const rows = weeks.filter(m => (m.week_key || isoWeekKey(new Date(m.played_at || Date.now()))) === w);
    list.innerHTML = rows.length ? rows.map(m => `
      <button class="text-left rounded-2xl border-2 border-purple-100 p-3" data-match-id="${m.id}">
        <div class="flex items-center justify-between">
          <div class="font-black text-gray-800">${new Date(m.played_at || Date.now()).toLocaleString()}</div>
          <div class="text-xs text-gray-500">${w}</div>
        </div>
      </button>
    `).join('') : '<div class="text-gray-400 text-sm">No matches in this week.</div>';
    list.querySelectorAll('[data-match-id]').forEach(btn => btn.addEventListener('click', () => openMatchDetail(btn.dataset.matchId)));
  };
  renderWeek(activeWeek);
  tabs.querySelectorAll('.week-tab').forEach(btn => btn.addEventListener('click', () => {
    tabs.querySelectorAll('.week-tab').forEach(x => x.className = 'week-tab px-3 py-2 rounded-full text-sm font-black bg-gray-100 text-gray-600');
    btn.className = 'week-tab px-3 py-2 rounded-full text-sm font-black bg-purple-700 text-white';
    renderWeek(btn.dataset.week);
  }));
}

async function openMatchDetail(matchId) {
  const modal = document.getElementById('match-detail-modal');
  const title = document.getElementById('match-detail-title');
  const body = document.getElementById('match-detail-body');
  const matches = await fetchMatches().catch(() => []);
  const match = matches.find(m => m.id === matchId);
  if (!match) return;
  const result = match.result || {};
  const players = Array.isArray(result.players) ? result.players : [];
  const history = Array.isArray(result.history) ? result.history : [];
  const totalPlayers = players.length;
  const winner = [...players].sort((a, b) => asNumber(b.total) - asNumber(a.total))[0];

  title.textContent = new Date(match.played_at || Date.now()).toLocaleString();
  body.innerHTML = `
    <div class="flex flex-col gap-4">
      <div class="grid grid-cols-3 gap-2">
        <div class="rounded-2xl bg-purple-50 p-3">
          <div class="text-[10px] uppercase tracking-[2px] text-gray-400">Players</div>
          <div class="font-display text-2xl text-purple-800">${totalPlayers}</div>
        </div>
        <div class="rounded-2xl bg-purple-50 p-3">
          <div class="text-[10px] uppercase tracking-[2px] text-gray-400">Rounds</div>
          <div class="font-display text-2xl text-purple-800">${history.length || (result.round || 0)}</div>
        </div>
        <div class="rounded-2xl bg-purple-50 p-3">
          <div class="text-[10px] uppercase tracking-[2px] text-gray-400">Winner</div>
          <div class="font-display text-lg text-purple-800 truncate">${winner ? escHtml(winner.name) : '-'}</div>
        </div>
      </div>

      <div class="rounded-2xl border-2 border-purple-100 p-3">
        <div class="flex items-center justify-between mb-3">
          <div class="font-display text-lg text-purple-800">Final Scores</div>
          <div class="text-xs text-gray-400">${match.week_key || ''}</div>
        </div>
        <div class="flex flex-col gap-2">
          ${players.map((p, i) => `
            <div class="flex items-center gap-3 rounded-2xl bg-gray-50 p-3">
              <div class="w-3 h-3 rounded-full shrink-0" style="background:${p.color || '#999'}"></div>
              <div class="flex-1 min-w-0">
                <div class="font-black text-gray-800 truncate">${escHtml(p.name)}</div>
                <div class="text-[11px] text-gray-400">Round delta: ${asNumber(p.delta) >= 0 ? '+' : ''}${asNumber(p.delta)}</div>
              </div>
              <div class="font-display text-xl font-black" style="color:${p.color || '#6b21a8'}">${asNumber(p.total)}</div>
            </div>
          `).join('')}
        </div>
      </div>

      <div class="rounded-2xl border-2 border-purple-100 p-3">
        <div class="font-display text-lg text-purple-800 mb-2">Round Timeline</div>
        <div class="flex flex-col gap-2">
          ${history.map((row, idx) => `
            <div class="rounded-2xl bg-gray-50 p-3">
              <div class="flex items-center justify-between mb-2">
                <div class="font-black text-gray-700">Round ${row.round ?? idx + 1}</div>
                <div class="text-[11px] text-gray-400">${(row.scores || []).reduce((s, v) => s + asNumber(v), 0) >= 0 ? '+' : ''}${(row.scores || []).reduce((s, v) => s + asNumber(v), 0)}</div>
              </div>
              <div class="grid gap-2" style="grid-template-columns: repeat(${Math.max(players.length, 1)}, minmax(0,1fr));">
                ${(row.scores || []).map((s, pi) => `
                  <div class="rounded-xl px-2 py-2 text-center text-xs font-black text-white" style="background:${players[pi]?.color || '#7c3aed'}">
                    ${players[pi]?.name ? escHtml(players[pi].name) : `P${pi + 1}`}<br>
                    ${asNumber(s) >= 0 ? '+' : ''}${asNumber(s)}
                  </div>
                `).join('')}
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    </div>`;
  modal.classList.remove('hidden');
}

async function startSession() {
  const ppr = Math.max(1, parseInt(document.getElementById('points-per-round').value) || 10);
  const players = [];
  state = { active: true, ended: false, round: 1, pointsPerRound: ppr, focusedIdx: null, history: [], players, roomId: syncRoomId || '' };
  const selected = await getSelectedPlayers().catch(() => []);
  const fallback = Array.from({ length: setupCount }, (_, i) => ({
    id: `local-${i}-${Date.now()}`,
    name: `Player ${i + 1}`,
    color: PLAYER_COLORS[i % PLAYER_COLORS.length],
    balance: 0,
  }));
  const source = selected.length ? selected : fallback;
  state.players = source.map(p => ({
    id: p.id,
    name: p.name,
    color: p.color || PLAYER_COLORS[0],
    balance: asNumber(p.balance),
    totalScore: 0,
    roundScore: 0,
  }));
  saveSelectedPlayerIds(state.players.map(p => p.id)).catch(() => {});
  saveConfig(state.players, ppr).catch(() => {});
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
      const remainBtn = event.target.closest('.remain-btn');
      if (remainBtn) {
        event.stopPropagation();
        applyRemain(i);
        return;
      }
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
  refreshRemainButtons();
}

function setCellContent(cell, player) {
  const rs       = player.roundScore;
  const scoreStr = rs > 0 ? `+${rs}` : `${rs}`;
  const idx = Number(cell.dataset.idx);
  const remain = getRemainDelta(idx);
  cell.innerHTML = `
    <span class="score-display">${scoreStr}</span>
    <div class="flex flex-col items-center mt-1 gap-0.5 leading-none">
      <span class="name-display">${escHtml(player.name)}</span>
      <span class="total-display">🏆 ${player.totalScore}</span>
    </div>
    <div class="absolute bottom-1 left-1/2 -translate-x-1/2 text-[10px] font-black tracking-[2px] uppercase opacity-75 pointer-events-none">
      top + / bottom -
    </div>
    <button class="remain-btn absolute right-2 top-1/2 -translate-y-1/2 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-[1px] bg-white/90 text-purple-800 shadow-md ${remain === null ? 'hidden' : ''}">
      Remain
    </button>
  `;
}

function getRemainDelta(idx) {
  if (!state.players[idx] || state.players[idx].roundScore !== 0) return null;
  const othersAllNonZero = state.players.every((p, i) => i === idx || p.roundScore !== 0);
  if (!othersAllNonZero || state.players.length <= 1) return null;
  const othersSum = state.players.reduce((s, p, i) => i === idx ? s : s + p.roundScore, 0);
  return othersSum !== 0 ? -othersSum : null;
}

function applyRemain(idx) {
  if (!state.active || !canEdit()) return;
  const delta = getRemainDelta(idx);
  if (delta === null) return;
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
}

function refreshRemainButtons() {
  document.querySelectorAll('.player-area').forEach(cell => {
    const idx = Number(cell.dataset.idx);
    const btn = cell.querySelector('.remain-btn');
    if (!btn) return;
    const delta = getRemainDelta(idx);
    btn.classList.toggle('hidden', delta === null);
  });
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

  state.players[idx].roundScore += delta;
  state.focusedIdx = idx;
  saveState();

  const cell = document.querySelector(`.player-area[data-idx="${idx}"]`);
  if (!cell) return;

  document.querySelectorAll('.player-area').forEach(c => c.classList.remove('focused'));
  cell.classList.add('focused');
  setCellContent(cell, state.players[idx]);
  refreshRemainButtons();
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
  refreshRemainButtons();
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
  const finalTotals = state.players.map(p => asNumber(p.totalScore) + asNumber(p.roundScore));
  const deltas = state.players.map((p, i) => finalTotals[i] - asNumber(p.balance || 0));
  state.players.forEach((p, i) => {
    p.totalScore = finalTotals[i];
    p.roundScore = 0;
  });
  state.active = false;
  state.ended  = true;
  saveState();
  if (sb) {
    const playedAt = new Date().toISOString();
    const weekKey = isoWeekKey(new Date());
    const result = {
      round: state.round,
      players: state.players.map((p, i) => ({
        id: p.id || p.name,
        name: p.name,
        color: p.color,
        delta: deltas[i],
        total: p.totalScore,
      })),
      history: state.history,
    };
    saveMatchResult({ id: state.roomId || crypto.randomUUID(), played_at: playedAt, week_key: weekKey, result, created_at: playedAt }).catch(() => {});
    const historyRows = state.players.map((p, i) => ({
      id: crypto.randomUUID(),
      player_id: p.id || p.name,
      match_id: state.roomId || '',
      balance_before: asNumber(p.balance || 0),
      delta: asNumber(deltas[i]),
      balance_after: asNumber(p.balance || 0) + asNumber(deltas[i]),
      note: 'match result',
      created_at: playedAt,
    }));
    Promise.all([
      saveBalanceHistory(historyRows),
      Promise.all(state.players.map((p, i) => {
        const balance = asNumber(p.balance || 0) + asNumber(deltas[i]);
        p.balance = balance;
        p.transfer_status = balance !== 0 ? 'pending' : 'transferred';
        return upsertPlayer(p);
      })),
    ]).catch(() => {});
  }
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
document.addEventListener('DOMContentLoaded', async () => {

  document.getElementById('start-btn').addEventListener('click', startSession);
  document.getElementById('reset-config-btn').addEventListener('click', resetConfig);
  document.getElementById('manage-players-btn').addEventListener('click', async () => {
    showScreen('players-screen');
    await renderPlayersAdmin();
  });
  document.getElementById('weekly-report-btn').addEventListener('click', async () => {
    showScreen('report-screen');
    await renderWeeklyReport();
  });
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
  document.getElementById('play-again-btn').addEventListener('click', async () => {
    try {
      await clearState();
      await initSetup();
    } catch (err) {
      console.error('play-again failed:', err);
    }
    showScreen('setup-screen');
  });
  document.getElementById('players-back-btn').addEventListener('click', async () => {
    try { await initSetup(); } catch (err) { console.error('back to setup failed:', err); }
    showScreen('setup-screen');
  });
  document.getElementById('report-back-btn').addEventListener('click', async () => {
    try { await initSetup(); } catch (err) { console.error('back to setup failed:', err); }
    showScreen('setup-screen');
  });
  document.getElementById('add-player-btn').addEventListener('click', async () => {
    const input = document.getElementById('new-player-name');
    const name = input.value.trim();
    if (!name) return;
    await upsertPlayer({ name, balance: 0, transfer_status: 'transferred' }).catch(() => {});
    input.value = '';
    renderPlayersAdmin();
  });
  document.getElementById('reset-app-btn').addEventListener('click', async () => {
    if (!confirm('Reset all reports and balances? Player names and colors will be kept. This cannot be undone.')) return;
    try {
      await resetAppData();
      await renderPlayersAdmin();
      alert('App data has been reset.');
    } catch (e) {
      alert('Failed to reset app data.');
    }
  });
  document.getElementById('match-detail-close').addEventListener('click', () => document.getElementById('match-detail-modal').classList.add('hidden'));
  document.getElementById('match-detail-modal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) e.currentTarget.classList.add('hidden');
  });

  if (sb) {
    // Ensure a room id always exists so state persists via the database,
    // anchored in the URL instead of localStorage.
    if (!syncRoomId) {
      syncRoomId = crypto.randomUUID();
      const url = new URL(location.href);
      url.searchParams.set('room', syncRoomId);
      history.replaceState(null, '', url.toString());
    }
    await startRealtime(syncRoomId);
    const restored = await loadState();
    if (restored && state.active) {
      renderGame();
      showScreen('game-screen');
    } else if (restored && state.ended) {
      showResults();
      showScreen('result-screen');
    } else {
      try { await initSetup(); } catch (err) { console.error('initSetup failed:', err); }
      showScreen('setup-screen');
    }
    setShareUi(true);
  } else {
    try { await initSetup(); } catch (err) { console.error('initSetup failed:', err); }
    showScreen('setup-screen');
    setShareUi(false);
  }

  if (appMode === 'view') {
    document.getElementById('share-view-btn')?.remove();
    document.getElementById('share-edit-btn')?.remove();
  }
});
