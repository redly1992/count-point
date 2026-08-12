export default function MatchList({ matches, onSelect, onDelete }) {
  if (!matches.length) return <div className="text-gray-400 text-sm">No matches in this week.</div>;
  return (
    <div className="flex flex-col gap-3">
      {matches.map((match) => (
        <div key={match.id} className="flex items-stretch gap-2">
          <button
            type="button"
            onClick={() => onSelect(match)}
            className="flex-1 text-left rounded-2xl border-2 border-purple-100 p-3"
          >
            <div className="flex items-center justify-between">
              <div className="font-black text-gray-800">{match.playedLabel}</div>
              <div className="text-xs text-gray-500">{match.week_key}</div>
            </div>
          </button>
          {onDelete ? (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onDelete(match); }}
              className="shrink-0 w-11 rounded-2xl bg-red-50 text-red-500 font-black text-lg active:scale-95"
              aria-label="Delete report"
              title="Delete report"
            >
              🗑
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}
