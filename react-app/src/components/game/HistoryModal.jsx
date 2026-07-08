import { asNumber, escHtml } from '../../lib/helpers';

export default function HistoryModal({ open, onClose, state }) {
  const players = state.players;
  const rows = [...state.history];
  if (state.active) rows.push({ round: state.round, scores: players.map((p) => asNumber(p.roundScore)), current: true });

  return (
    <div
      className={`fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm transition-opacity duration-250 ${open ? 'modal-visible' : 'hidden'}`}
      style={{ opacity: open ? 1 : 0 }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full max-w-lg bg-white rounded-t-3xl shadow-2xl flex flex-col max-h-[80vh] transition-transform duration-250"
        style={{ transform: open ? 'translateY(0)' : 'translateY(100%)' }}
      >
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-gray-100 shrink-0">
          <span className="font-display text-2xl text-purple-800">📋 Round History</span>
          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center font-display text-xl text-gray-500 active:scale-90 transition-transform"
          >
            ✕
          </button>
        </div>
        <div className="overflow-y-auto px-3 pb-6 pt-2">
          <table className="w-full border-collapse text-sm font-[Nunito]">
            <thead>
              <tr className="border-b-2 border-purple-100">
                <th className="text-left py-2 px-2 text-gray-400 font-black uppercase tracking-wider text-[10px]">Rnd</th>
                {players.map((p) => (
                  <th key={p.id || p.name} className="min-w-[3rem] text-center px-1 py-2">
                    <span className="inline-block w-2.5 h-2.5 rounded-full mr-1" style={{ background: p.color }} />
                    <span className="font-display text-xs" style={{ color: p.color }}>{escHtml(p.name)}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIdx) => (
                <tr key={row.current ? 'current' : row.round ?? rowIdx} className={row.current ? 'bg-purple-50 font-black' : 'border-b border-gray-100'}>
                  <td className="py-2 px-2 font-display text-purple-700">{row.current ? '▶' : row.round}</td>
                  {row.scores.map((s, idx) => {
                    const val = asNumber(s);
                    const color = val > 0 ? '#10ac84' : val < 0 ? '#c0392b' : '#9ca3af';
                    return (
                      <td key={idx} className="min-w-[3rem] text-center px-1 py-2 font-display tabular-nums" style={{ color }}>
                        {val > 0 ? '+' : ''}{val}
                      </td>
                    );
                  })}
                </tr>
              ))}
              <tr className="border-t-2 border-purple-200 bg-white">
                <td className="py-2 px-2 font-display text-[10px] uppercase tracking-wider text-gray-400">Total</td>
                {players.map((p) => (
                  <td key={p.id || p.name} className="min-w-[3rem] text-center px-1 py-2 font-display font-black tabular-nums text-purple-700">
                    {asNumber(p.totalScore) + asNumber(p.roundScore)}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
