import { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import { sb } from '../lib/supabaseClient';
import { SETTINGS_TABLE } from '../lib/config';
import { fetchPlayers } from '../hooks/useGamePersistence';

const SettingsContext = createContext(null);

const DEFAULT_SETTINGS = {
  setup: {
    pointsPerRound: 10,
    selectedPlayers: [],
  },
  playerManagement: {
    selectedPlayerIds: [],
  },
};

function normalizeSelectedPlayers(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter(Boolean)
    .map((player) => ({
      ...player,
      id: String(player.id ?? ''),
      name: String(player.name ?? ''),
      color: player.color ?? null,
    }))
    .filter((player) => player.id);
}

function normalizeSelectedPlayerIds(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((id) => String(id ?? '')).filter(Boolean))];
}

function normalizeConfig(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return {
    count: Number.isFinite(Number(value.count)) ? Number(value.count) : normalizeSelectedPlayers(value.players).length,
    pointsPerRound: Number.isFinite(Number(value.pointsPerRound)) ? Number(value.pointsPerRound) : 10,
    players: normalizeSelectedPlayers(value.players),
  };
}

export function SettingsProvider({ children }) {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(Boolean(sb));
  const [error, setError] = useState(null);

  const loadSettings = useCallback(async () => {
    if (!sb) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    const { data, error: queryError } = await sb
      .from(SETTINGS_TABLE)
      .select('key, value')
      .in('key', ['config', 'selected_player_ids']);

    if (queryError) {
      setError(queryError);
      setLoading(false);
      return;
    }

    const byKey = Object.fromEntries((data ?? []).map((row) => [row.key, row.value]));
    const config = normalizeConfig(byKey.config);
    const selectedPlayerIds = normalizeSelectedPlayerIds(byKey.selected_player_ids);
    const players = await fetchPlayers().catch(() => []);
    const selectedPlayers = players.filter((player) => selectedPlayerIds.includes(String(player.id ?? '')));

    setSettings({
      setup: {
        pointsPerRound: config?.pointsPerRound ?? DEFAULT_SETTINGS.setup.pointsPerRound,
        selectedPlayers: selectedPlayers.length ? selectedPlayers : (config?.players ?? DEFAULT_SETTINGS.setup.selectedPlayers),
      },
      playerManagement: {
        selectedPlayerIds,
      },
    });
    setLoading(false);
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const saveConfig = useCallback(async (nextConfig) => {
    const normalized = normalizeConfig(nextConfig);
    const payload = normalized ?? { count: 0, pointsPerRound: 10, players: [] };
    const selectedPlayerIds = payload.players.map((player) => String(player.id ?? '')).filter(Boolean);
    setSettings((current) => ({
      ...current,
      setup: {
        pointsPerRound: payload.pointsPerRound,
        selectedPlayers: payload.players,
      },
      playerManagement: {
        selectedPlayerIds,
      },
    }));

    if (!sb) return payload;

    const { error: writeError } = await sb.from(SETTINGS_TABLE).upsert({
      key: 'config',
      value: payload,
      updated_at: new Date().toISOString(),
    });

    if (writeError) setError(writeError);
    return payload;
  }, []);

  const saveSelectedPlayerIds = useCallback(async (nextIds) => {
    const selectedPlayerIds = normalizeSelectedPlayerIds(nextIds);
    setSettings((current) => ({
      ...current,
      playerManagement: { selectedPlayerIds },
    }));

    if (!sb) return selectedPlayerIds;

    const { error: writeError } = await sb.from(SETTINGS_TABLE).upsert({
      key: 'selected_player_ids',
      value: selectedPlayerIds,
      updated_at: new Date().toISOString(),
    });

    if (writeError) setError(writeError);
    return selectedPlayerIds;
  }, []);

  const value = useMemo(
    () => ({
      settings,
      loading,
      error,
      reloadSettings: loadSettings,
      saveConfig,
      saveSelectedPlayerIds,
      setSettings,
    }),
    [settings, loading, error, loadSettings, saveConfig, saveSelectedPlayerIds],
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used within SettingsProvider');
  return ctx;
}
