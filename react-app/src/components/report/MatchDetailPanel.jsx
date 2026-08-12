import { asNumber, escHtml } from '../../lib/helpers';

export default function MatchDetailPanel({ match, onClose, onDelete }) {
  if (!match) return null;
  const result = match.result || {};
  const players = Array.isArray(result.players) ? result.players : [];
  const history = Array.isArray(result.history) ? result.history : [];
  const winner = [...players].sort((a, b) => asNumber(b.total) - asNumber(a.total))[0];

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-center justify-center px-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-lg bg-white rounded-3xl shadow-2xl p-5 max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between gap-3 mb-4 shrink-0">
          <h3 className="font-display text-2xl text-purple-800">{match.playedLabel}</h3>
          <div className="flex items-center gap-2 shrink-0">
            {onDelete ? (
              <button
                type="button"
                onClick={() => onDelete(match)}
                className="w-9 h-9 rounded-full bg-red-50 text-red-500 font-black"
                aria-label="Delete report"
                title="Delete report"
              >
                🗑
              </button>
            ) : null}
            <button type="button" onClick={onClose} className="w-9 h-9 rounded-full bg-gray-100 font-black shrink-0">✕</button>
          </div>
        </div>
        <div className="text-sm overflow-y-auto pr-1">
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-2xl bg-purple-50 p-3">
                <div className="text-[10px] uppercase tracking-[2px] text-gray-400">Players</div>
                <div className="font-display text-2xl text-purple-800">{players.length}</div>
              </div>
              <div className="rounded-2xl bg-purple-50 p-3">
                <div className="text-[10px] uppercase tracking-[2px] text-gray-400">Rounds</div>
                <div className="font-display text-2xl text-purple-800">{history.length || result.round || 0}</div>
              </div>
              <div className="rounded-2xl bg-purple-50 p-3">
                <div className="text-[10px] uppercase tracking-[2px] text-gray-400">Winner</div>
                <div className="font-display text-lg text-purple-800 truncate">{winner ? escHtml(winner.name) : '-'}</div>
              </div>
            </div>

            <div className="rounded-2xl border-2 border-purple-100 p-3">
              <div className="flex items-center justify-between mb-3">
                <div className="font-display text-lg text-purple-800">Final Scores</div>
                <div className="text-xs text-gray-400">{match.week_key || ''}</div>
              </div>
              <div className="flex flex-col gap-2">
                {players.map((p, i) => (
                  <div key={p.id || p.name || i} className="flex items-center gap-3 rounded-2xl bg-gray-50 p-3">
                    <div className="w-3 h-3 rounded-full shrink-0" style={{ background: p.color || '#999' }} />
                    <div className="flex-1 min-w-0">
                      <div className="font-black text-gray-800 truncate">{escHtml(p.name)}</div>
                      <div className="text-[11px] text-gray-400">Round delta: {asNumber(p.delta) >= 0 ? '+' : ''}{asNumber(p.delta)}</div>
                    </div>
                    <div className="font-display text-xl font-black" style={{ color: p.color || '#6b21a8' }}>{asNumber(p.total)}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border-2 border-purple-100 p-3">
              <div className="font-display text-lg text-purple-800 mb-2">Round Timeline</div>
              <div className="flex flex-col gap-2">
                {history.map((row, idx) => {
                  const total = (row.scores || []).reduce((sum, v) => sum + asNumber(v), 0);
                  return (
                    <div key={row.round ?? idx} className="rounded-2xl bg-gray-50 p-3">
                      <div className="flex items-center justify-between mb-2">
                        <div className="font-black text-gray-700">Round {row.round ?? idx + 1}</div>
                        <div className="text-[11px] text-gray-400">{total >= 0 ? '+' : ''}{total}</div>
                      </div>
                      <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.max(players.length, 1)}, minmax(0,1fr))` }}>
                        {(row.scores || []).map((s, pi) => (
                          <div
                            key={pi}
                            className="rounded-xl px-2 py-2 text-center text-xs font-black text-white"
                            style={{ background: players[pi]?.color || '#7c3aed' }}
                          >
                            {escHtml(players[pi]?.name || `P${pi + 1}`)}<br />
                            {asNumber(s) >= 0 ? '+' : ''}{asNumber(s)}
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
