export default function WeekTabs({ weeks, activeWeek, onChange }) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      {weeks.map((week, i) => (
        <button
          key={week.key}
          type="button"
          onClick={() => onChange(week.key)}
          className={`px-3 py-2 rounded-full text-sm font-black whitespace-nowrap ${
            week.key === activeWeek ? 'bg-purple-700 text-white' : 'bg-gray-100 text-gray-600'
          }`}
        >
          {week.key}
        </button>
      ))}
    </div>
  );
}
