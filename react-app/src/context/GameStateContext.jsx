import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useRoomSync } from '../hooks/useRoomSync';
import { sb } from '../lib/supabaseClient';
import { saveMatchResult, saveBalanceHistory, upsertPlayer } from '../hooks/useGamePersistence';
import { isoWeekKey } from '../lib/helpers';
import { getAvatar, setAvatar as persistAvatar } from '../lib/avatarStore';

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
          avatar: player.avatar || null,
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
  // Tracks the latest state synchronously so rapid taps (before React re-renders
  // and recreates these callbacks) always build on top of each other instead of a
  // stale render-closure `state`, which was causing dropped/rolled-back points.
  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; }, [state]);

  useEffect(() => {
    roomSync.loadState().catch(() => false);
  }, [roomSync.loadState]);

  const updateState = useCallback((updater) => {
    const prev = stateRef.current;
    const next = normalizeState(typeof updater === 'function' ? updater(prev) : updater);
    stateRef.current = next;
    setState(next);
    roomSync.saveState();
    return next;
  }, [roomSync]);

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
        avatar: player.avatar || getAvatar(player.id) || null,
      })),
      roomId,
    });
    // Push immediately (not debounced) so collaborators see the new session right away.
    roomSync.pushSync(next).catch(() => {});
  }, [updateState, roomSync]);

  const tapPlayer = useCallback((idx, subtract = false, event = null) => {
    if (!stateRef.current.active || !roomSync.canEdit) return;
    updateState((current) => {
      const nextPlayers = current.players.map((player, playerIdx) => {
        if (playerIdx !== idx) return player;
        const delta = subtract || (event && event.currentTarget && event.clientY > event.currentTarget.getBoundingClientRect().top + event.currentTarget.getBoundingClientRect().height / 2)
          ? -current.pointsPerRound
          : current.pointsPerRound;
        return { ...player, roundScore: asNumber(player.roundScore) + delta };
      });
      return { ...current, players: nextPlayers, focusedIdx: idx };
    });
  }, [updateState, roomSync]);

  const applyRemain = useCallback((idx) => {
    if (!stateRef.current.active || !roomSync.canEdit) return;
    updateState((current) => {
      const player = current.players[idx];
      if (!player || asNumber(player.roundScore) !== 0) return current;
      const others = current.players.filter((_, i) => i !== idx);
      if (others.length === 0 || others.some((p) => asNumber(p.roundScore) === 0)) return current;
      const othersSum = others.reduce((sum, p) => sum + asNumber(p.roundScore), 0);
      if (othersSum === 0) return current;
      const nextPlayers = current.players.map((p, i) => (i === idx ? { ...p, roundScore: asNumber(p.roundScore) - othersSum } : p));
      return { ...current, players: nextPlayers, focusedIdx: idx };
    });
  }, [updateState, roomSync]);

  const resetRoundScore = useCallback((idx) => {
    if (!stateRef.current.active || !roomSync.canEdit) return;
    updateState((current) => {
      const nextPlayers = current.players.map((player, playerIdx) => (playerIdx === idx ? { ...player, roundScore: 0 } : player));
      return { ...current, players: nextPlayers, focusedIdx: idx };
    });
  }, [updateState, roomSync]);

  const setPlayerColor = useCallback((idx, color) => {
    if (!roomSync.canEdit) return;
    updateState((current) => {
      const nextPlayers = current.players.map((player, playerIdx) => (playerIdx === idx ? { ...player, color } : player));
      return { ...current, players: nextPlayers };
    });
    upsertPlayer({ ...stateRef.current.players[idx], color }).catch(() => {});
  }, [updateState, roomSync]);

  const setPlayerAvatar = useCallback((idx, avatar) => {
    if (!roomSync.canEdit) return;
    updateState((current) => {
      const nextPlayers = current.players.map((player, playerIdx) => (playerIdx === idx ? { ...player, avatar } : player));
      return { ...current, players: nextPlayers };
    });
    // Avatars are cosmetic-only and stored client-side to avoid requiring a
    // Supabase schema change; not sent through upsertPlayer.
    const player = stateRef.current.players[idx];
    if (player?.id) persistAvatar(player.id, avatar);
  }, [updateState, roomSync]);

  const nextRound = useCallback(() => {
    if (!roomSync.canEdit) return;
    updateState((current) => {
      const historyRow = { round: current.round, scores: current.players.map((p) => asNumber(p.roundScore)) };
      const nextPlayers = current.players.map((player) => ({
        ...player,
        totalScore: asNumber(player.totalScore) + asNumber(player.roundScore),
        roundScore: 0,
      }));
      return {
        ...current,
        round: current.round + 1,
        history: [...current.history, historyRow],
        players: nextPlayers,
        focusedIdx: null,
      };
    });
  }, [updateState, roomSync]);

  const endSession = useCallback(() => {
    if (!roomSync.canEdit) return;
    const state = stateRef.current;
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
  }, [updateState, roomSync]);

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
    setPlayerColor,
    setPlayerAvatar,
    getRoundTotal: () => getRoundTotal(state),
    ...roomSync,
  }), [applyRemain, endSession, nextRound, resetRoundScore, roomSync, setPlayerColor, setPlayerAvatar, setPlayers, startSession, state, tapPlayer]);

  return <GameStateContext.Provider value={value}>{children}</GameStateContext.Provider>;
}

export function useGameState() {
  const ctx = useContext(GameStateContext);
  if (!ctx) throw new Error('useGameState must be used within GameProvider');
  return ctx;
}
