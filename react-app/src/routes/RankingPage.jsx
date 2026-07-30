import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { asNumber, escHtml } from '../lib/helpers';
import { fetchMatches } from '../hooks/useGamePersistence';

function toDateInputValue(date) {
  const d = new Date(date);
  const tzOffsetMs = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tzOffsetMs).toISOString().slice(0, 10);
}

function endOfDay(dateStr) {
  const d = new Date(`${dateStr}T23:59:59.999`);
  return d.getTime();
}

function startOfDay(dateStr) {
  const d = new Date(`${dateStr}T00:00:00.000`);
  return d.getTime();
}

function getMedal(rank) {
  if (rank === 1) return '🥇';
  if (rank === 2) return '🥈';
  if (rank === 3) return '🥉';
  const rem100 = rank % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${rank}th`;
  switch (rank % 10) {
    case 1: return `${rank}st`;
    case 2: return `${rank}nd`;
    case 3: return `${rank}rd`;
    default: return `${rank}th`;
  }
}

// Competition ranking: ties share a rank, next distinct value skips accordingly.
function getRanks(values) {
  const sorted = [...values].sort((a, b) => b - a);
  return values.map((v) => sorted.findIndex((s) => s === v) + 1);
}

export default function RankingPage() {
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  useEffect(() => {
    fetchMatches()
      .then((ms) => {
        const list = ms || [];
        setMatches(list);
        const playedTimes = list.map((m) => new Date(m.played_at || Date.now()).getTime()).filter(Number.isFinite);
        const oldest = playedTimes.length ? Math.min(...playedTimes) : Date.now();
        setFromDate(toDateInputValue(oldest));
        setToDate(toDateInputValue(Date.now()));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const filteredMatches = useMemo(() => {
    if (!fromDate || !toDate) return matches;
    const from = startOfDay(fromDate);
    const to = endOfDay(toDate);
    return matches.filter((m) => {
      const t = new Date(m.played_at || 0).getTime();
      return t >= from && t <= to;
    });
  }, [matches, fromDate, toDate]);

  const ranking = useMemo(() => {
    const byPlayer = new Map();
    filteredMatches.forEach((match) => {
      const players = Array.isArray(match.result?.players) ? match.result.players : [];
      players.forEach((p) => {
        const key = p.id || p.name;
        if (!key) return;
        const current = byPlayer.get(key) || { id: key, name: p.name, color: p.color, totalDelta: 0, matchesPlayed: 0, wins: 0 };
        current.totalDelta += asNumber(p.delta);
        current.matchesPlayed += 1;
        current.name = p.name || current.name;
        current.color = p.color || current.color;
        byPlayer.set(key, current);
      });

      // Track wins: highest total in that match (ties = no single winner counted per player, all sharing top delta don't get a win bump... use top total instead)
      if (players.length) {
        const maxTotal = Math.max(...players.map((p) => asNumber(p.total)));
        players.filter((p) => asNumber(p.total) === maxTotal).forEach((p) => {
          const key = p.id || p.name;
          const current = byPlayer.get(key);
          if (current) current.wins += 1;
        });
      }
    });

    const rows = [...byPlayer.values()];
    const ranks = getRanks(rows.map((r) => r.totalDelta));
    return rows
      .map((r, i) => ({ ...r, rank: ranks[i] }))
      .sort((a, b) => a.rank - b.rank);
  }, [filteredMatches]);

  return (
    <div className="screen active overflow-y-auto flex flex-col items-center bg-gradient-to-br from-[#160429] via-[#3a0c6e] to-[#160429] min-h-screen">
      <div className="w-full max-w-2xl px-4 py-6">
        <div className="bg-white rounded-3xl shadow-2xl p-6 flex flex-col gap-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-display text-3xl text-purple-800">🏆 Total Ranking</h2>
            <Link to="/" className="px-4 py-2 rounded-full bg-gray-100 font-black text-sm text-gray-600">Back</Link>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex flex-col gap-1">
              <label htmlFor="ranking-from" className="text-[10px] font-black uppercase tracking-[2px] text-gray-400">From date</label>
              <input
                id="ranking-from"
                type="date"
                value={fromDate}
                max={toDate || undefined}
                onChange={(e) => setFromDate(e.target.value)}
                className="h-11 rounded-xl border-2 border-gray-200 px-3 outline-none focus:border-purple-500"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="ranking-to" className="text-[10px] font-black uppercase tracking-[2px] text-gray-400">To date</label>
              <input
                id="ranking-to"
                type="date"
                value={toDate}
                min={fromDate || undefined}
                onChange={(e) => setToDate(e.target.value)}
                className="h-11 rounded-xl border-2 border-gray-200 px-3 outline-none focus:border-purple-500"
              />
            </div>
          </div>

          <div className="flex flex-col gap-3">
            {loading ? (
              <div className="rounded-2xl bg-gray-50 p-4 text-sm text-gray-500">Loading…</div>
            ) : !ranking.length ? (
              <div className="rounded-2xl bg-gray-50 p-4 text-sm text-gray-500">No matches found in this date range.</div>
            ) : (
              ranking.map((row) => (
                <div key={row.id} className="flex items-center gap-3 p-3 rounded-2xl bg-purple-50 border-l-4" style={{ borderColor: row.color || '#a855f7' }}>
                  <span className="font-display text-2xl min-w-[3rem] text-center text-purple-800">{getMedal(row.rank)}</span>
                  <div
                    className="w-10 h-10 rounded-full shrink-0 border-2 border-white"
                    style={{ background: row.color || '#a855f7' }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="font-black text-gray-800 truncate">{escHtml(row.name)}</div>
                    <div className="text-xs text-gray-400">{row.matchesPlayed} match{row.matchesPlayed === 1 ? '' : 'es'} · {row.wins} win{row.wins === 1 ? '' : 's'}</div>
                  </div>
                  <div className="font-display text-2xl font-black" style={{ color: row.color || '#6b21a8' }}>
                    {row.totalDelta > 0 ? `+${row.totalDelta}` : row.totalDelta}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
