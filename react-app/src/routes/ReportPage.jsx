import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { asNumber, isoWeekKey } from '../lib/helpers';
import { fetchMatches, deleteMatch } from '../hooks/useGamePersistence';
import WeekTabs from '../components/report/WeekTabs';
import MatchList from '../components/report/MatchList';
import MatchDetailPanel from '../components/report/MatchDetailPanel';

const playedLabel = (value) => new Date(value || Date.now()).toLocaleString();

export default function ReportPage() {
  const [matches, setMatches] = useState([]);
  const [activeWeek, setActiveWeek] = useState('');
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    fetchMatches().then((ms) => setMatches(ms || [])).catch(() => {});
  }, []);

  const normalized = useMemo(
    () =>
      matches.map((match) => ({
        ...match,
        week_key: match.week_key || isoWeekKey(new Date(match.played_at || Date.now())),
        playedLabel: playedLabel(match.played_at),
      })),
    [matches],
  );

  const weekKeys = useMemo(() => [...new Set(normalized.map((m) => m.week_key))], [normalized]);

  useEffect(() => {
    if (!activeWeek && weekKeys[0]) setActiveWeek(weekKeys[0]);
  }, [activeWeek, weekKeys]);

  const weeks = weekKeys.map((key) => ({ key, count: normalized.filter((m) => m.week_key === key).length }));
  const weekMatches = normalized.filter((match) => match.week_key === activeWeek);

  const handleDelete = async (match) => {
    if (!window.confirm('Delete this report? This cannot be undone.')) return;
    try {
      await deleteMatch(match.id);
      setMatches((prev) => prev.filter((m) => m.id !== match.id));
      setSelected((prev) => (prev && prev.id === match.id ? null : prev));
    } catch {
      window.alert('Failed to delete report.');
    }
  };

  return (
    <div className="screen active overflow-y-auto flex flex-col items-center bg-gradient-to-br from-[#160429] via-[#3a0c6e] to-[#160429] min-h-screen">
      <div className="w-full max-w-2xl px-4 py-6">
        <div className="bg-white rounded-3xl shadow-2xl p-6 flex flex-col gap-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-display text-3xl text-purple-800">Weekly Report</h2>
            <Link to="/" className="px-4 py-2 rounded-full bg-gray-100 font-black text-sm text-gray-600">Back</Link>
          </div>
          <WeekTabs weeks={weeks} activeWeek={activeWeek} onChange={setActiveWeek} />
          <MatchList matches={weekMatches} onSelect={setSelected} onDelete={handleDelete} />
        </div>
      </div>
      {selected ? <MatchDetailPanel match={selected} onClose={() => setSelected(null)} onDelete={handleDelete} /> : null}
    </div>
  );
}
