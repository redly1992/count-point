import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSettings } from '../context/SettingsContext';
import { fetchPlayers, resetAppData, upsertPlayer } from '../hooks/useGamePersistence';
import { PlayerRow } from '../components/players/PlayerRow';

export default function PlayersPage() {
  const { settings, saveSelectedPlayerIds } = useSettings();
  const [players, setPlayers] = useState([]);
  const [name, setName] = useState('');
  const [selectedIds, setSelectedIds] = useState(settings.playerManagement.selectedPlayerIds || []);
  const colorTimers = useRef({});

  const reload = useCallback(() => fetchPlayers().then(setPlayers).catch(() => {}), []);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    setSelectedIds(settings.playerManagement.selectedPlayerIds || []);
  }, [settings.playerManagement.selectedPlayerIds]);

  const persistSelection = useCallback(
    (next) => {
      setSelectedIds(next);
      saveSelectedPlayerIds(next).catch(() => {});
    },
    [saveSelectedPlayerIds],
  );

  const addPlayer = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    await upsertPlayer({ name: trimmed, balance: 0, transfer_status: 'transferred' }).catch(() => {});
    setName('');
    reload();
  };

  const toggleSelected = (playerId) => {
    const next = selectedIds.includes(playerId) ? selectedIds.filter((id) => id !== playerId) : [...selectedIds, playerId];
    persistSelection(next);
  };

  const onColorChange = (playerId, color) => {
    setPlayers((current) => current.map((p) => (p.id === playerId ? { ...p, color } : p)));
    clearTimeout(colorTimers.current[playerId]);
    colorTimers.current[playerId] = setTimeout(async () => {
      const player = players.find((p) => p.id === playerId);
      if (!player) return;
      await upsertPlayer({ ...player, color }).catch(() => {});
      reload();
    }, 300);
  };

  const onTransfer = async (player) => {
    if (!window.confirm(`Mark ${player.name} as transferred and set balance to 0?`)) return;
    await upsertPlayer({ ...player, balance: 0, transfer_status: 'transferred' }).catch(() => {});
    reload();
  };

  const resetData = async () => {
    if (!window.confirm('Reset all reports and balances? Player names and colors will be kept. This cannot be undone.')) return;
    try {
      await resetAppData();
      reload();
      window.alert('App data has been reset.');
    } catch (e) {
      window.alert('Failed to reset app data.');
    }
  };

  const selectedCount = useMemo(() => selectedIds.length, [selectedIds]);

  return (
    <div className="screen active overflow-y-auto flex flex-col items-center bg-gradient-to-br from-[#160429] via-[#3a0c6e] to-[#160429] min-h-screen">
      <div className="w-full max-w-2xl px-4 py-6">
        <div className="bg-white rounded-3xl shadow-2xl p-6 flex flex-col gap-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-display text-3xl text-purple-800">Players</h2>
            <div className="flex items-center gap-2">
              <span className="text-xs font-black uppercase tracking-[2px] text-gray-400">{selectedCount} selected</span>
              <Link to="/" className="px-4 py-2 rounded-full bg-gray-100 font-black text-sm text-gray-600">Back</Link>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Player name"
              className="flex-1 h-11 rounded-xl border-2 border-purple-100 px-3 outline-none"
            />
            <button type="button" onClick={addPlayer} className="h-11 px-4 rounded-full bg-purple-700 text-white font-black">
              Add
            </button>
          </div>
          <div className="flex flex-col gap-3">
            {players.length ? (
              players.map((player) => (
                <PlayerRow
                  key={player.id}
                  player={player}
                  selected={selectedIds.includes(player.id)}
                  onToggle={toggleSelected}
                  onColorChange={onColorChange}
                  onTransfer={onTransfer}
                />
              ))
            ) : (
              <div className="text-gray-400 text-sm">No players yet.</div>
            )}
          </div>
          <button
            type="button"
            onClick={resetData}
            className="mt-2 h-11 rounded-full bg-red-50 text-red-600 border-2 border-red-200 font-black text-sm"
          >
            ⚠️ Reset App Data (keep player names/colors)
          </button>
        </div>
      </div>
    </div>
  );
}
