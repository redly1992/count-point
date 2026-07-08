import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useSettings } from '../context/SettingsContext';
import { useGameState } from '../context/GameStateContext';
import { PLAYER_COLORS } from '../lib/config';
import { escHtml } from '../lib/helpers';

export default function SetupPage() {
  const navigate = useNavigate();
  const { settings, loading, saveConfig, saveSelectedPlayerIds, reloadSettings } = useSettings();
  const { startSession } = useGameState();
  const [pointsPerRound, setPointsPerRound] = useState(10);

  const selectedPlayers = settings?.setup?.selectedPlayers ?? [];

  useEffect(() => {
    if (!loading) setPointsPerRound(settings?.setup?.pointsPerRound ?? 10);
  }, [loading, settings?.setup?.pointsPerRound]);

  const resetPlayers = async () => {
    await saveConfig({ count: 0, pointsPerRound: 10, players: [] });
    await saveSelectedPlayerIds([]);
    setPointsPerRound(10);
    reloadSettings();
  };

  const start = async () => {
    const ppr = Math.max(1, Number.parseInt(pointsPerRound, 10) || 10);
    const source = selectedPlayers.length ? selectedPlayers : [];
    await saveConfig({
      count: source.length,
      pointsPerRound: ppr,
      players: source.map((p, i) => ({ id: p.id, name: p.name, color: p.color || PLAYER_COLORS[i % PLAYER_COLORS.length] })),
    });
    startSession(source, ppr);
    navigate('/game');
  };

  return (
    <div className="screen active overflow-y-auto flex flex-col items-center bg-gradient-to-br from-[#160429] via-[#3a0c6e] to-[#160429] min-h-screen">
      <div className="w-full max-w-md px-4 py-6">
        <div className="bg-white rounded-3xl shadow-2xl p-6 flex flex-col gap-5">
          <h1 className="font-display text-5xl text-center text-purple-800" style={{ textShadow: '3px 3px 0 rgba(100,30,180,.12)' }}>
            🎮 Point Count!
          </h1>

          <div className="flex flex-col gap-2">
            <label htmlFor="points-per-round" className="text-[11px] font-black uppercase tracking-[2.5px] text-gray-400">
              Points per Tap
            </label>
            <input
              id="points-per-round"
              type="number"
              min={1}
              max={999}
              value={pointsPerRound}
              onChange={(e) => setPointsPerRound(e.target.value)}
              className="w-28 h-12 rounded-xl border-2 border-gray-200 text-center font-display text-2xl text-gray-700 outline-none focus:border-purple-500 transition-colors bg-white"
            />
          </div>

          <div id="player-configs" className="flex flex-col gap-3">
            {loading ? (
              <div className="rounded-2xl bg-gray-50 p-4 text-sm text-gray-500">Loading…</div>
            ) : !selectedPlayers.length ? (
              <div className="rounded-2xl bg-gray-50 p-4 text-sm text-gray-500">No players selected in Player Management yet.</div>
            ) : (
              selectedPlayers.map((p, i) => (
                <div
                  key={p.id ?? `${p.name}-${i}`}
                  className="flex items-center gap-3 p-3 rounded-2xl border-l-4 bg-purple-50 transition-colors"
                  style={{ borderColor: p.color || PLAYER_COLORS[i % PLAYER_COLORS.length] }}
                >
                  <span className="font-display text-lg text-gray-400 min-w-[1.6rem] text-center">P{i + 1}</span>
                  <div
                    className="w-10 h-10 rounded-full shrink-0 border-2 border-white"
                    style={{ background: p.color || PLAYER_COLORS[i % PLAYER_COLORS.length] }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="font-black text-gray-800 truncate">{escHtml(p.name)}</div>
                    <div className="text-xs text-gray-400">Selected from Player Management</div>
                  </div>
                </div>
              ))
            )}
          </div>

          <button
            id="start-btn"
            type="button"
            disabled={!selectedPlayers.length}
            onClick={start}
            className="w-full py-4 rounded-full font-display text-2xl text-white mt-1 bg-gradient-to-r from-purple-800 to-purple-500 shadow-lg shadow-purple-500/40 active:scale-95 transition-transform select-none disabled:opacity-50"
          >
            🚀 Start!
          </button>

          <button
            id="reset-config-btn"
            type="button"
            onClick={resetPlayers}
            className="w-full py-2 rounded-full font-display text-sm text-gray-400 border-2 border-gray-200 active:scale-95 transition-transform select-none"
          >
            🗑 Reset players
          </button>

          <div className="grid grid-cols-2 gap-3">
            <Link id="manage-players-btn" to="/players" className="w-full py-3 rounded-full bg-purple-700 text-white font-black text-center">
              Players
            </Link>
            <Link id="weekly-report-btn" to="/report" className="w-full py-3 rounded-full bg-indigo-600 text-white font-black text-center">
              Report
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
