import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { sb } from '../lib/supabaseClient';
import { SUPABASE_TABLE } from '../lib/config';

const DEFAULT_MODE = 'local';
const DEBOUNCE_MS = 3000;

function readSearchParams() {
  return new URLSearchParams(window.location.search);
}

function getModeFromSearch() {
  const mode = readSearchParams().get('mode') || DEFAULT_MODE;
  return ['view', 'edit', 'local'].includes(mode) ? mode : DEFAULT_MODE;
}

function getRoomFromSearch() {
  return readSearchParams().get('room') || '';
}

function syncUrl(roomId, mode) {
  const url = new URL(window.location.href);
  url.searchParams.set('room', roomId);
  url.searchParams.set('mode', mode);
  window.history.replaceState({}, '', url);
}

export function useRoomSync(state, setState) {
  const [roomId, setRoomId] = useState(() => getRoomFromSearch());
  const [mode, setMode] = useState(() => getModeFromSearch());
  const channelRef = useRef(null);
  const timerRef = useRef(null);
  const roomRef = useRef(roomId);
  const modeRef = useRef(mode);
  const stateRef = useRef(state);

  useEffect(() => { roomRef.current = roomId; }, [roomId]);
  useEffect(() => { modeRef.current = mode; }, [mode]);
  useEffect(() => { stateRef.current = state; }, [state]);

  const ensureRoom = useCallback(() => {
    const nextRoom = roomRef.current || crypto.randomUUID();
    roomRef.current = nextRoom;
    setRoomId(nextRoom);
    syncUrl(nextRoom, modeRef.current);
    return nextRoom;
  }, []);

  const roomUrl = useCallback((nextMode = 'view') => {
    const nextRoom = roomRef.current || ensureRoom();
    const url = new URL(window.location.href);
    url.searchParams.set('room', nextRoom);
    url.searchParams.set('mode', nextMode);
    return url.toString();
  }, [ensureRoom]);

  const editRoomUrl = useCallback(() => roomUrl('edit'), [roomUrl]);

  const loadRemoteRoom = useCallback(async (nextRoom) => {
    if (!sb || !nextRoom) return null;
    const { data, error } = await sb.from(SUPABASE_TABLE).select('payload').eq('id', nextRoom).maybeSingle();
    if (error) throw error;
    return data?.payload ?? null;
  }, []);

  const pushSync = useCallback(async (overrideState) => {
    if (!sb || !roomRef.current || modeRef.current === 'view') return;
    await sb.from(SUPABASE_TABLE).upsert({
      id: roomRef.current,
      payload: { state: overrideState ?? stateRef.current, updatedAt: new Date().toISOString() },
    }, { onConflict: 'id' });
  }, []);

  const scheduleSync = useCallback(() => {
    if (!sb || !roomRef.current || modeRef.current === 'view') return;
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => { pushSync().catch(() => {}); }, DEBOUNCE_MS);
  }, [pushSync]);

  const loadState = useCallback(async () => {
    const currentRoom = ensureRoom();
    if (!sb) return false;
    const payload = await loadRemoteRoom(currentRoom);
    if (payload?.state) {
      setState(payload.state);
      return true;
    }
    return false;
  }, [ensureRoom, loadRemoteRoom, setState]);

  useEffect(() => {
    syncUrl(roomId || ensureRoom(), mode);
  }, [ensureRoom, mode, roomId]);

  useEffect(() => {
    if (!sb || !roomId) return undefined;
    let cancelled = false;
    const channel = sb.channel(`room:${roomId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: SUPABASE_TABLE, filter: `id=eq.${roomId}` }, async () => {
        if (cancelled) return;
        const payload = await loadRemoteRoom(roomId);
        if (payload?.state) setState(payload.state);
      })
      .subscribe();
    channelRef.current = channel;
    return () => {
      cancelled = true;
      clearTimeout(timerRef.current);
      if (channelRef.current) sb.removeChannel(channelRef.current);
      channelRef.current = null;
    };
  }, [loadRemoteRoom, roomId, setState]);

  useEffect(() => () => {
    clearTimeout(timerRef.current);
    if (channelRef.current && sb) sb.removeChannel(channelRef.current);
  }, []);

  const canEdit = useMemo(() => mode !== 'view', [mode]);
  const isViewerMode = useMemo(() => mode === 'view', [mode]);

  return {
    roomId,
    mode,
    setMode,
    ensureRoom,
    roomUrl,
    editRoomUrl,
    loadState,
    saveState: scheduleSync,
    pushSync,
    canEdit,
    isViewerMode,
  };
}
