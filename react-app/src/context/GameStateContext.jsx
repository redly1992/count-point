import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useRoomSync } from '../hooks/useRoomSync';
import { sb } from '../lib/supabaseClient';
import { saveMatchResult, saveBalanceHistory, upsertPlayer } from '../hooks/useGamePersistence';
import { isoWeekKey } from '../lib/helpers';

const DEFAULT_STATE = {
  active: false,
  ended: false,
  round: 1,
  pointsPerRound: 10,
  focusedIdx: null,
  history: [],
  players: [],
  roomId: '',
};

const GameStateContext = createContext(null);

function asNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function normalizeState(nextState) {
  return {
    ...DEFAULT_STATE,
    ...nextState,
    focusedIdx: nextState?.focusedIdx ?? null,
    history: Array.isArray(nextState?.history) ? nextState.history : [],
    players: Array.isArray(nextState?.players)
      ? nextState.players.map((player) => ({
          id: player.id,
          name: player.name,
          color: player.color,
          balance: asNumber(player.balance),
          totalScore: asNumber(player.totalScore),
          roundScore: asNumber(player.roundScore),
          transfer_status: player.transfer_status,
        }))
      : [],
  };
}

function getRoundTotal(state) {
  return state.players.reduce((sum, player) => sum + asNumber(player.roundScore), 0);
}

export function GameProvider({ children }) {
  const [state, setState] = useState(DEFAULT_STATE);
  const roomSync = useRoomSync(state, setState);

  useEffect(() => {
    roomSync.loadState().catch(() => false);
  }, [roomSync.loadState]);

  const updateState = useCallback((updater) => {
    const next = normalizeState(typeof updater === 'function' ? updater(state) : updater);
    setState(next);
    roomSync.saveState();
    return next;
  }, [roomSync, state]);

  const setPlayers = useCallback((players) => {
    updateState((current) => ({ ...current, players }));
  }, [updateState]);

  const startSession = useCallback((players, pointsPerRound = 10, roomId = '') => {
    const next = updateState({
      ...DEFAULT_STATE,
      active: true,
      ended: false,
      round: 1,
      pointsPerRound: Math.max(1, asNumber(pointsPerRound) || 10),
      focusedIdx: null,
      history: [],
      players: (players || []).map((player) => ({
        id: player.id,
        name: player.name,
        color: player.color,
        balance: asNumber(player.balance),
        totalScore: 0,
        roundScore: 0,
        transfer_status: player.transfer_status,
      })),
      roomId,
    });
    // Push immediately (not debounced) so collaborators see the new session right away.
    roomSync.pushSync(next).catch(() => {});
  }, [updateState, roomSync]);

  const tapPlayer = useCallback((idx, subtract = false, event = null) => {
    if (!state.active || !roomSync.canEdit) return;
    const nextPlayers = state.players.map((player, playerIdx) => {
      if (playerIdx !== idx) return player;
      const delta = subtract || (event && event.currentTarget && event.clientY > event.currentTarget.getBoundingClientRect().top + event.currentTarget.getBoundingClientRect().height / 2)
        ? -state.pointsPerRound
        : state.pointsPerRound;
      return { ...player, roundScore: asNumber(player.roundScore) + delta };
    });
    updateState({ ...state, players: nextPlayers, focusedIdx: idx });
  }, [state, updateState, roomSync]);

  const applyRemain = useCallback((idx) => {
    if (!state.active || !roomSync.canEdit) return;
    const player = state.players[idx];
    if (!player || asNumber(player.roundScore) !== 0) return;
    const others = state.players.filter((_, i) => i !== idx);
    if (others.length === 0 || others.some((p) => asNumber(p.roundScore) === 0)) return;
    const othersSum = others.reduce((sum, p) => sum + asNumber(p.roundScore), 0);
    if (othersSum === 0) return;
    const nextPlayers = state.players.map((p, i) => (i === idx ? { ...p, roundScore: asNumber(p.roundScore) - othersSum } : p));
    updateState({ ...state, players: nextPlayers, focusedIdx: idx });
  }, [state, updateState, roomSync]);

  const resetRoundScore = useCallback((idx) => {
    if (!state.active || !roomSync.canEdit) return;
    const nextPlayers = state.players.map((player, playerIdx) => (playerIdx === idx ? { ...player, roundScore: 0 } : player));
    updateState({ ...state, players: nextPlayers, focusedIdx: idx });
  }, [state, updateState, roomSync]);

  const nextRound = useCallback(() => {
    if (!roomSync.canEdit) return;
    const historyRow = { round: state.round, scores: state.players.map((p) => asNumber(p.roundScore)) };
    const nextPlayers = state.players.map((player) => ({
      ...player,
      totalScore: asNumber(player.totalScore) + asNumber(player.roundScore),
      roundScore: 0,
    }));
    updateState({
      ...state,
      round: state.round + 1,
      history: [...state.history, historyRow],
      players: nextPlayers,
      focusedIdx: null,
    });
  }, [state, updateState, roomSync]);

  const endSession = useCallback(() => {
    if (!roomSync.canEdit) return;
    const history = state.players.some((p) => asNumber(p.roundScore) !== 0)
      ? [...state.history, { round: state.round, scores: state.players.map((p) => asNumber(p.roundScore)) }]
      : state.history;
    const finalTotals = state.players.map((p) => asNumber(p.totalScore) + asNumber(p.roundScore));
    const deltas = state.players.map((p, i) => finalTotals[i] - asNumber(p.balance || 0));
    const players = state.players.map((player, idx) => ({
      ...player,
      totalScore: finalTotals[idx],
      roundScore: 0,
    }));
    const next = updateState({
      ...state,
      active: false,
      ended: true,
      history,
      players,
    });

    // Persist match result + balance history + updated player balances (mirrors original app.js endSession).
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
          total: finalTotals[i],
        })),
        history,
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
          return upsertPlayer({
            ...p,
            balance,
            transfer_status: balance !== 0 ? 'pending' : 'transferred',
          });
        })),
      ]).catch(() => {});
    }
    // Push immediately so viewers see the final result without waiting for the debounce.
    roomSync.pushSync(next).catch(() => {});
  }, [state, updateState, roomSync]);

  const value = useMemo(() => ({
    state,
    setState,
    setPlayers,
    startSession,
    tapPlayer,
    applyRemain,
    resetRoundScore,
    nextRound,
    endSession,
    getRoundTotal: () => getRoundTotal(state),
    ...roomSync,
  }), [applyRemain, endSession, nextRound, resetRoundScore, roomSync, setPlayers, startSession, state, tapPlayer]);

  return <GameStateContext.Provider value={value}>{children}</GameStateContext.Provider>;
}

export function useGameState() {
  const ctx = useContext(GameStateContext);
  if (!ctx) throw new Error('useGameState must be used within GameProvider');
  return ctx;
}
