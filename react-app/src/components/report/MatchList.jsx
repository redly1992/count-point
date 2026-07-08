export default function MatchList({ matches, onSelect }) {
  if (!matches.length) return <div className="text-gray-400 text-sm">No matches in this week.</div>;
  return (
    <div className="flex flex-col gap-3">
      {matches.map((match) => (
        <button
          key={match.id}
          type="button"
          onClick={() => onSelect(match)}
          className="text-left rounded-2xl border-2 border-purple-100 p-3"
        >
          <div className="flex items-center justify-between">
            <div className="font-black text-gray-800">{match.playedLabel}</div>
            <div className="text-xs text-gray-500">{match.week_key}</div>
          </div>
        </button>
      ))}
    </div>
  );
}
