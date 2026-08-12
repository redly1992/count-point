import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useGameState } from '../context/GameStateContext';
import { asNumber, contrastColor, escHtml } from '../lib/helpers';
import HistoryModal from '../components/game/HistoryModal';
import { AVATAR_OPTIONS, randomColor, randomAvatar } from '../lib/avatarStore';

function getGridCols(n) {
  const map = {
    1: '1fr',
    2: 'repeat(2,1fr)',
    3: 'repeat(2,1fr)',
    4: 'repeat(2,1fr)',
    5: 'repeat(6,1fr)',
    6: 'repeat(3,1fr)',
    7: 'repeat(3,1fr)',
    8: 'repeat(4,1fr)',
  };
  return map[n] ?? `repeat(${Math.ceil(Math.sqrt(n))},1fr)`;
}

function getCellColumnStyle(n, idx) {
  if (n === 3 && idx === 2) return '1 / -1';
  if (n === 5) return idx < 3 ? 'span 2' : 'span 3';
  if (n === 7 && idx === 6) return '2 / 3';
  return undefined;
}

function getRemainDelta(players, idx) {
  const player = players[idx];
  if (!player || asNumber(player.roundScore) !== 0) return null;
  const othersAllNonZero = players.every((p, i) => i === idx || asNumber(p.roundScore) !== 0);
  if (!othersAllNonZero || players.length <= 1) return null;
  const othersSum = players.reduce((sum, p, i) => (i === idx ? sum : sum + asNumber(p.roundScore)), 0);
  return othersSum !== 0 ? -othersSum : null;
}

function ordinal(n) {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

// Competition ranking (ties share a rank, next distinct value skips accordingly).
function getRoundRanks(scores) {
  const sorted = [...scores].sort((a, b) => b - a);
  return scores.map((score) => sorted.findIndex((s) => s === score) + 1);
}

function getMedal(rank) {
  if (rank === 1) return '🥇';
  if (rank === 2) return '🥈';
  if (rank === 3) return '🥉';
  return ordinal(rank);
}

function getLastRoundBadges(state) {
  if (!state.history.length) return null;
  const last = state.history[state.history.length - 1];
  const scores = last.scores || [];
  if (!scores.length || scores.every((s) => s === 0)) return null;
  const ranks = getRoundRanks(scores);
  return scores.map((delta, i) => ({ rank: ranks[i], delta }));
}

function spawnFloatScore(cell, text, color) {
  const rect = cell.getBoundingClientRect();
  const f = document.createElement('div');
  f.className = 'float-score';
  f.textContent = text;
  f.style.color = color;
  f.style.left = `${rect.left + rect.width / 2}px`;
  f.style.top = `${rect.top + rect.height / 2}px`;
  document.body.appendChild(f);
  setTimeout(() => f.remove(), 950);
}

function LiveChart({ history, active, players }) {
  const hostRef = useRef(null);
  const [width, setWidth] = useState(320);

  useEffect(() => {
    if (!hostRef.current) return undefined;
    const observer = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect?.width;
      if (w) setWidth(w);
    });
    observer.observe(hostRef.current);
    return () => observer.disconnect();
  }, []);

  const roundScores = [...history.map((r) => r.scores)];
  if (active) roundScores.push(players.map((p) => asNumber(p.roundScore)));

  const ranked = [...players]
    .map((p, idx) => ({ ...p, idx, rankScore: asNumber(p.totalScore) + asNumber(p.roundScore) }))
    .sort((a, b) => b.rankScore - a.rankScore);

  if (!roundScores.length) {
    return (
      <div className="live-chart-card w-full rounded-none p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="font-display text-sm text-white">Live Performance</span>
          <span className="text-[10px] uppercase tracking-[2px] text-white/50">per round</span>
        </div>
        <div className="w-full h-28 flex items-center justify-center text-white/45 text-sm">No chart data yet</div>
      </div>
    );
  }

  const height = 100;
  const pad = 12;
  const chartH = height - pad * 2;
  const chartW = width - pad * 2;
  const maxVal = Math.max(1, ...roundScores.flat().map((v) => Math.abs(v)));
  const xStep = roundScores.length > 0 ? chartW / roundScores.length : chartW;
  const barW = Math.max(2, xStep * 0.18);
  const zeroY = pad + chartH * 0.5;

  return (
    <div className="live-chart-card w-full rounded-none p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="font-display text-sm text-white">Live Performance</span>
        <span className="text-[10px] uppercase tracking-[2px] text-white/50">per round</span>
      </div>
      <div className="mb-2 flex flex-wrap gap-2">
        {ranked.map((p, rankIdx) => (
          <div key={p.id || p.name} className="flex items-center gap-1.5 rounded-full bg-white/10 px-2 py-1 text-white/90">
            <span className="text-[10px] font-black">{rankIdx + 1}.</span>
            <span className="w-2.5 h-2.5 rounded-full" style={{ background: p.color }} />
            <span className="text-[11px] font-black truncate max-w-[7rem]">{escHtml(p.name)}</span>
          </div>
        ))}
      </div>
      <div ref={hostRef} className="w-full h-28">
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-full block">
          <rect x="0" y="0" width={width} height={height} rx="12" fill="rgba(0,0,0,.12)" />
          {[0.25, 0.5, 0.75].map((r) => (
            <line key={r} x1={pad} y1={pad + chartH * r} x2={width - pad} y2={pad + chartH * r} stroke="rgba(255,255,255,.12)" strokeWidth="1" />
          ))}
          <line x1={pad} y1={zeroY} x2={width - pad} y2={zeroY} stroke="rgba(255,255,255,.22)" strokeWidth="1.2" />
          {players.map((p, idx) =>
            roundScores.map((round, roundIdx) => {
              const value = round[idx] ?? 0;
              const barH = Math.max(1, (Math.abs(value) / maxVal) * (chartH * 0.45));
              const x = pad + roundIdx * xStep + xStep / 2 + idx * (barW + 1) - ((players.length - 1) * (barW + 1)) / 2;
              const y = value >= 0 ? zeroY - barH : zeroY;
              return (
                <rect
                  key={`${idx}-${roundIdx}`}
                  x={x}
                  y={y}
                  width={barW}
                  height={barH}
                  rx={Math.min(2, barW / 2)}
                  fill={p.color}
                  opacity={value ? 0.9 : 0.25}
                />
              );
            }),
          )}
        </svg>
      </div>
    </div>
  );
}

function PlayerCell({ player, idx, totalPlayers, focused, canEdit, onTap, onRemain, onReset, onColorChange, onAvatarChange, lastRoundBadge, totalRank }) {
  const cellRef = useRef(null);
  const colorInputRef = useRef(null);
  const holdTimerRef = useRef(null);
  const holdStartRef = useRef(null);
  const longPressFiredRef = useRef(false);
  const [holding, setHolding] = useState(false);
  const [tapped, setTapped] = useState(false);
  const [showAvatarPicker, setShowAvatarPicker] = useState(false);

  const roundScore = asNumber(player.roundScore);
  const remainDelta = onRemain.getDelta();
  const remainVisible = remainDelta !== null;

  const MOVE_LIMIT = 12;

  const clearHold = () => {
    clearTimeout(holdTimerRef.current);
    holdTimerRef.current = null;
    setHolding(false);
  };

  const startHold = (clientX, clientY) => {
    if (!canEdit) return;
    holdStartRef.current = { x: clientX, y: clientY };
    setHolding(true);
    holdTimerRef.current = setTimeout(() => {
      holdTimerRef.current = null;
      longPressFiredRef.current = true;
      setHolding(false);
      onReset();
      if (cellRef.current) spawnFloatScore(cellRef.current, '✕ 0', '#ffffffcc');
    }, 500);
  };

  const moveHold = (clientX, clientY) => {
    if (!holdTimerRef.current || !holdStartRef.current) return;
    const dx = Math.abs(clientX - holdStartRef.current.x);
    const dy = Math.abs(clientY - holdStartRef.current.y);
    if (dx > MOVE_LIMIT || dy > MOVE_LIMIT) clearHold();
  };

  const handleClick = (event) => {
    if (longPressFiredRef.current) { longPressFiredRef.current = false; return; }
    if (!canEdit) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const subtract = event.clientY > rect.top + rect.height / 2;
    const delta = onTap(subtract);
    if (delta == null) return;
    setTapped(false);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      setTapped(true);
      setTimeout(() => setTapped(false), 360);
    }));
    if (cellRef.current) spawnFloatScore(cellRef.current, delta > 0 ? `+${delta}` : `${delta}`, delta > 0 ? '#00e676' : '#ff5252');
  };

  return (
    <button
      ref={cellRef}
      type="button"
      data-idx={idx}
      className={`player-area${tapped ? ' tapped' : ''}${focused ? ' focused' : ''}${holding ? ' holding' : ''}`}
      style={{
        backgroundColor: player.color,
        color: contrastColor(player.color),
        gridColumn: getCellColumnStyle(totalPlayers, idx),
      }}
      onClick={handleClick}
      onContextMenu={(e) => e.preventDefault()}
      onMouseDown={(e) => startHold(e.clientX, e.clientY)}
      onMouseUp={clearHold}
      onMouseLeave={clearHold}
      onTouchStart={(e) => {
        if (e.touches.length === 2) {
          e.preventDefault();
          const delta = onTap(true);
          if (delta != null && cellRef.current) spawnFloatScore(cellRef.current, `${delta}`, '#ff5252');
          return;
        }
        if (e.touches.length === 1) startHold(e.touches[0].clientX, e.touches[0].clientY);
      }}
      onTouchEnd={clearHold}
      onTouchMove={(e) => {
        if (e.touches[0]) moveHold(e.touches[0].clientX, e.touches[0].clientY);
      }}
    >
      <span className="score-display">{roundScore > 0 ? `+${roundScore}` : `${roundScore}`}</span>
      <div className="flex flex-col items-center mt-1 gap-0.5 leading-none">
        {player.avatar ? <span className="avatar-anim text-6xl leading-none">{player.avatar}</span> : null}
        <span className="name-display">{escHtml(player.name)}</span>
      </div>
      {lastRoundBadge ? (
        <span className="absolute top-2 left-2 text-[2rem] font-black tracking-[0.5px] bg-black/20 rounded-full px-6 py-3 shadow-md">
          ({ordinal(lastRoundBadge.rank)}:{lastRoundBadge.delta > 0 ? `+${lastRoundBadge.delta}` : `${lastRoundBadge.delta}`})
        </span>
      ) : null}
      <span className="absolute top-2 right-2 text-[2.25rem] font-black tracking-[0.5px] bg-black/20 rounded-full px-8 py-4 shadow-md">
        {getMedal(totalRank)}: {asNumber(player.totalScore)}
      </span>
      {canEdit ? (
        <>
          <div
            className="absolute bottom-1.5 inset-x-1.5 z-20 flex items-center justify-center gap-2.5 rounded-2xl bg-black/35 backdrop-blur-sm px-2 py-2"
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="color-swatch-btn w-12 h-12 shrink-0 rounded-full border-[3px] border-white/90 shadow-lg active:scale-90 transition-transform touch-manipulation"
              style={{ backgroundColor: player.color }}
              aria-label={`Change ${player.name}'s color`}
              onClick={(e) => {
                e.preventDefault();
                colorInputRef.current?.click();
              }}
            />
            <button
              type="button"
              className="w-12 h-12 shrink-0 rounded-full border-[3px] border-white/90 shadow-lg active:scale-90 transition-transform touch-manipulation bg-white/25 flex items-center justify-center text-2xl"
              aria-label={`Random color and avatar for ${player.name}`}
              title="Random color & avatar"
              onClick={(e) => {
                e.preventDefault();
                onColorChange(randomColor());
                onAvatarChange(randomAvatar(player.avatar));
              }}
            >
              🎲
            </button>
            <button
              type="button"
              className="w-12 h-12 shrink-0 rounded-full border-[3px] border-white/90 shadow-lg active:scale-90 transition-transform touch-manipulation bg-white/25 flex items-center justify-center text-2xl"
              aria-label={`Pick avatar for ${player.name}`}
              title="Pick avatar"
              onClick={(e) => {
                e.preventDefault();
                setShowAvatarPicker(true);
              }}
            >
              🎭
            </button>
            {remainVisible ? (
              <button
                type="button"
                className="remain-btn shrink-0 px-4 h-12 rounded-full text-sm font-black uppercase tracking-[1px] bg-white/90 text-purple-800 shadow-md active:scale-90 transition-transform touch-manipulation"
                onClick={(e) => {
                  e.preventDefault();
                  onRemain.apply();
                }}
              >
                Remain
              </button>
            ) : null}
          </div>
          <input
            ref={colorInputRef}
            type="color"
            value={player.color}
            className="absolute bottom-1.5 left-1.5 w-12 h-12 opacity-0 pointer-events-none"
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => onColorChange(e.target.value)}
          />
          {showAvatarPicker
            ? createPortal(
                <div
                  className="fixed inset-0 z-[200] bg-black/70 backdrop-blur-sm flex items-center justify-center px-4"
                  onClick={() => setShowAvatarPicker(false)}
                  onMouseDown={(e) => e.stopPropagation()}
                  onTouchStart={(e) => e.stopPropagation()}
                >
                  <div
                    className="w-full max-w-sm bg-[#1c0b33] rounded-3xl p-4 shadow-2xl"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="flex items-center justify-between mb-3">
                      <span className="font-display text-lg text-white">Pick Avatar</span>
                      <button
                        type="button"
                        className="w-10 h-10 rounded-full bg-white/15 text-white font-black active:scale-90 transition-transform"
                        onClick={() => setShowAvatarPicker(false)}
                      >
                        ✕
                      </button>
                    </div>
                    <div className="grid grid-cols-4 gap-3">
                      {AVATAR_OPTIONS.map((emoji) => (
                        <button
                          key={emoji}
                          type="button"
                          className="w-16 h-16 rounded-2xl bg-white/10 text-3xl flex items-center justify-center active:scale-90 transition-transform touch-manipulation"
                          onClick={() => {
                            onAvatarChange(emoji);
                            setShowAvatarPicker(false);
                          }}
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                    <button
                      type="button"
                      className="w-full mt-3 py-3 rounded-2xl bg-white/10 text-sm font-black uppercase tracking-[1px] text-white/80 active:scale-95 transition-transform touch-manipulation"
                      onClick={() => {
                        onAvatarChange(null);
                        setShowAvatarPicker(false);
                      }}
                    >
                      Remove Avatar
                    </button>
                  </div>
                </div>,
                document.body,
              )
            : null}
        </>
      ) : null}
    </button>
  );
}

export default function GamePage() {
  const navigate = useNavigate();
  const { state, tapPlayer, applyRemain, resetRoundScore, nextRound, endSession, setPlayerColor, setPlayerAvatar, canEdit, roomUrl, editRoomUrl, roomId } = useGameState();
  const [showHistory, setShowHistory] = useState(false);
  const [nextPending, setNextPending] = useState(false);
  const [endPending, setEndPending] = useState(false);
  const nextTimerRef = useRef(null);
  const endTimerRef = useRef(null);

  const players = state.players;
  const roundTotal = useMemo(() => players.reduce((sum, p) => sum + asNumber(p.roundScore), 0), [players]);
  const lastRoundBadges = useMemo(() => getLastRoundBadges(state), [state.history]);
  const totalRanks = useMemo(() => getRoundRanks(players.map((p) => asNumber(p.totalScore))), [players]);

  useEffect(() => () => {
    clearTimeout(nextTimerRef.current);
    clearTimeout(endTimerRef.current);
  }, []);

  const doTap = (idx, subtract) => {
    if (!state.active || !canEdit) return null;
    const delta = subtract ? -state.pointsPerRound : state.pointsPerRound;
    tapPlayer(idx, subtract);
    return delta;
  };

  const doRemain = (idx) => {
    if (!state.active || !canEdit) return;
    applyRemain(idx);
  };

  const doReset = (idx) => {
    if (!state.active || !canEdit) return;
    resetRoundScore(idx);
  };

  const handleNextRound = () => {
    if (!canEdit) return;
    if (nextPending) {
      clearTimeout(nextTimerRef.current);
      setNextPending(false);
      nextRound();
      return;
    }
    if (roundTotal !== 0) {
      setNextPending(true);
      nextTimerRef.current = setTimeout(() => setNextPending(false), 2500);
    } else {
      nextRound();
    }
  };

  const handleEndSession = () => {
    if (!canEdit) return;
    if (endPending) {
      clearTimeout(endTimerRef.current);
      setEndPending(false);
      endSession();
      navigate('/result');
      return;
    }
    setEndPending(true);
    endTimerRef.current = setTimeout(() => setEndPending(false), 2500);
  };

  const copyShare = async (getUrl) => {
    if (!roomId) return;
    await navigator.clipboard.writeText(getUrl());
  };

  return (
    <div className="screen active flex flex-col bg-[#0d0120] min-h-screen">
      <div className="flex-none flex items-center justify-between px-4 py-2 bg-black/50 backdrop-blur-sm safe-top gap-3">
        <div className="flex flex-col items-center leading-none">
          <span className="text-white/40 text-[9px] font-black uppercase tracking-[2.5px]">Round</span>
          <span className="font-display text-[2rem] text-white leading-none tabular-nums">{state.round}</span>
        </div>
        <div className="flex flex-col items-center leading-none">
          <span className="text-white/40 text-[9px] font-black uppercase tracking-[2.5px]">Total</span>
          <span className="font-display text-[2rem] text-white leading-none tabular-nums">{roundTotal > 0 ? `+${roundTotal}` : roundTotal}</span>
        </div>
      </div>

      <div className="flex-none w-full px-0 pt-2">
        <LiveChart history={state.history} active={state.active} players={players} />
      </div>

      <div
        className="flex-1 min-h-0 grid auto-rows-fr gap-1.5 p-1.5 overflow-hidden"
        style={{ gridTemplateColumns: getGridCols(players.length) }}
      >
        {players.map((player, idx) => (
          <PlayerCell
            key={player.id || player.name || idx}
            player={player}
            idx={idx}
            totalPlayers={players.length}
            focused={state.focusedIdx === idx}
            canEdit={canEdit && state.active}
            onTap={(subtract) => doTap(idx, subtract)}
            onRemain={{ getDelta: () => getRemainDelta(players, idx), apply: () => doRemain(idx) }}
            onReset={() => doReset(idx)}
            onColorChange={(color) => setPlayerColor(idx, color)}
            onAvatarChange={(avatar) => setPlayerAvatar(idx, avatar)}
            lastRoundBadge={asNumber(player.roundScore) === 0 && lastRoundBadges ? lastRoundBadges[idx] : null}
            totalRank={totalRanks[idx]}
          />
        ))}
      </div>

      <div className="flex-none flex items-center gap-2.5 px-4 py-2 bg-black/50 backdrop-blur-sm safe-bot">
        <button
          type="button"
          onClick={() => setShowHistory(true)}
          className="py-3 px-4 rounded-full font-display text-base text-white whitespace-nowrap bg-gradient-to-r from-indigo-500 to-purple-600 shadow-lg active:scale-95 transition-transform select-none"
        >
          📋
        </button>
        <button
          type="button"
          onClick={() => copyShare(roomUrl)}
          className="py-3 px-3 rounded-full font-display text-base text-white whitespace-nowrap bg-gradient-to-r from-emerald-500 to-teal-600 shadow-lg active:scale-95 transition-transform select-none"
        >
          👀
        </button>
        <button
          type="button"
          onClick={() => copyShare(editRoomUrl)}
          className="py-3 px-3 rounded-full font-display text-base text-white whitespace-nowrap bg-gradient-to-r from-fuchsia-500 to-pink-600 shadow-lg active:scale-95 transition-transform select-none"
        >
          🔗
        </button>
        <button
          type="button"
          onClick={handleNextRound}
          className={`flex-1 py-3 rounded-full font-display text-base text-white shadow-lg active:scale-95 transition-transform select-none bg-gradient-to-r ${nextPending ? 'from-yellow-500 to-orange-500' : 'from-blue-500 to-violet-600'}`}
        >
          {nextPending ? `⚠️ Total ${roundTotal > 0 ? '+' : ''}${roundTotal} — Sure?` : '⏭ Next Round'}
        </button>
        <button
          type="button"
          onClick={handleEndSession}
          className="py-3 px-5 rounded-full font-display text-base text-white whitespace-nowrap bg-gradient-to-r from-orange-500 to-red-600 shadow-lg active:scale-95 transition-transform select-none"
        >
          {endPending ? '⚠️ Sure?' : '🏁 End'}
        </button>
      </div>

      <HistoryModal open={showHistory} onClose={() => setShowHistory(false)} state={state} />
    </div>
  );
}
