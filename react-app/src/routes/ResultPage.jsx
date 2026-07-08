import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useGameState } from '../context/GameStateContext';
import { asNumber, escHtml } from '../lib/helpers';
import HistoryModal from '../components/game/HistoryModal';

const MEDALS = ['🥇', '🥈', '🥉'];

export default function ResultPage() {
  const navigate = useNavigate();
  const { state, setState } = useGameState();
  const [showHistory, setShowHistory] = useState(false);
  const players = Array.isArray(state.players) ? state.players : [];

  const sorted = useMemo(() => [...players].sort((a, b) => asNumber(b.totalScore) - asNumber(a.totalScore)), [players]);
  const best = asNumber(sorted[0]?.totalScore);
  const winners = sorted.filter((p) => asNumber(p.totalScore) === best);

  const rounds = useMemo(() => {
    const rows = [
      ...state.history.map((r) => r.scores),
      state.active ? players.map((p) => asNumber(p.roundScore)) : [],
    ].filter((row) => row.length);
    return rows;
  }, [state.history, state.active, players]);

  const maxAbs = Math.max(1, ...rounds.flat().map((v) => Math.abs(v)), 1);

  const playAgain = () => {
    setState((current) => ({
      ...current,
      active: false,
      ended: false,
      round: 1,
      focusedIdx: null,
      history: [],
      players: (current.players || []).map((player) => ({ ...player, totalScore: 0, roundScore: 0 })),
    }));
    navigate('/');
  };

  let rankPos = 0;

  return (
    <div className="screen active overflow-y-auto flex flex-col items-center bg-gradient-to-br from-[#160429] via-[#3a0c6e] to-[#160429] min-h-screen">
      <div className="w-full max-w-md px-4 py-6">
        <div className="bg-white rounded-3xl shadow-2xl p-7 flex flex-col items-center gap-6">
          <div className="text-center w-full">
            {winners.length === 1 ? (
              <>
                <span className="trophy-anim text-7xl">🏆</span>
                <div className="font-display text-5xl mt-3 drop-shadow-sm" style={{ color: winners[0].color }}>
                  {escHtml(winners[0].name)}
                </div>
                <div className="font-display text-xl tracking-[3px] text-gray-400 mt-1">WINS!</div>
              </>
            ) : (
              <>
                <span className="trophy-anim text-7xl">🤝</span>
                <div className="font-display text-3xl mt-3 text-gray-700">
                  {winners.map((w) => escHtml(w.name)).join(' & ')}
                </div>
                <div className="font-display text-xl tracking-[3px] text-gray-400 mt-1">IT'S A TIE!</div>
              </>
            )}
          </div>

          <div className="w-full flex flex-col gap-3">
            {sorted.map((p, i) => {
              if (i > 0 && asNumber(p.totalScore) < asNumber(sorted[i - 1].totalScore)) rankPos = i;
              const medal = MEDALS[rankPos] ?? `#${rankPos + 1}`;
              return (
                <div
                  key={p.id ?? `${p.name}-${i}`}
                  className="score-item flex items-center gap-3 p-3.5 rounded-2xl bg-purple-50 border-l-4"
                  style={{ borderColor: p.color, animationDelay: `${i * 80}ms` }}
                >
                  <span className="text-2xl min-w-[2rem] text-center">{medal}</span>
                  <span className="font-display text-xl flex-1 text-gray-800">{escHtml(p.name)}</span>
                  <span className="font-display text-xl font-bold" style={{ color: p.color }}>{asNumber(p.totalScore)} pts</span>
                </div>
              );
            })}
          </div>

          <div className="w-full">
            <div className="flex items-center justify-between mb-2">
              <span className="font-display text-sm text-purple-700">Performance</span>
              <span className="text-[10px] uppercase tracking-[2px] text-gray-400">1 cell = 1 round</span>
            </div>
            <div className="w-full flex flex-col gap-2">
              {!players.length || !rounds.length ? (
                <div className="text-sm text-gray-400">No round data yet.</div>
              ) : (
                players.map((p, idx) => (
                  <div key={p.id ?? p.name ?? idx} className="flex items-center gap-2">
                    <div className="w-20 shrink-0">
                      <div className="font-display text-xs leading-none truncate" style={{ color: p.color }}>{escHtml(p.name)}</div>
                      <div className="text-[10px] text-gray-400">{asNumber(p.totalScore)} pts</div>
                    </div>
                    <div className="flex-1 flex gap-1 overflow-x-auto pb-1">
                      {rounds.map((round, roundIdx) => {
                        const value = asNumber(round[idx]);
                        const alpha = Math.min(1, Math.max(0.2, Math.abs(value) / maxAbs));
                        const bg = value > 0 ? `rgba(16, 172, 132, ${alpha})` : value < 0 ? `rgba(192, 57, 43, ${alpha})` : 'rgba(156, 163, 175, .18)';
                        return (
                          <span
                            key={roundIdx}
                            className="performance-cell"
                            style={{ background: bg }}
                            title={`Round ${roundIdx + 1}: ${value > 0 ? '+' : ''}${value}`}
                          />
                        );
                      })}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={() => setShowHistory(true)}
            className="w-full py-3 rounded-full font-display text-lg text-white bg-gradient-to-r from-indigo-500 to-purple-600 shadow-lg active:scale-95 transition-transform select-none"
          >
            📋 View History
          </button>
          <button
            type="button"
            onClick={playAgain}
            className="w-full py-4 rounded-full font-display text-2xl text-white bg-gradient-to-r from-purple-800 to-purple-500 shadow-lg shadow-purple-500/40 active:scale-95 transition-transform select-none"
          >
            🔄 Play Again!
          </button>
          <Link to="/" className="text-sm text-gray-400 underline">Back to setup</Link>
        </div>
      </div>

      <HistoryModal open={showHistory} onClose={() => setShowHistory(false)} state={state} />
    </div>
  );
}
