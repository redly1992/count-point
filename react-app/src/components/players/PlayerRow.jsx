import { asNumber, escHtml } from '../../lib/helpers';

export function PlayerRow({ player, selected, onToggle, onColorChange, onTransfer }) {
  const pending = player.transfer_status === 'pending';
  return (
    <div className={`rounded-2xl border-2 p-3 flex items-center gap-3 ${selected ? 'border-purple-500 bg-purple-50' : 'border-purple-100 bg-white'}`}>
      <label className="flex items-center gap-2 cursor-pointer shrink-0" title="Select this player for the next match">
        <input type="checkbox" checked={selected} onChange={() => onToggle(player.id)} />
        <span className={`text-[10px] uppercase tracking-[2px] ${selected ? 'text-purple-700' : 'text-gray-400'}`}>Use</span>
      </label>
      <div className="flex-1 min-w-0">
        <div className="font-black truncate" style={{ color: player.color || '#6b21a8' }}>{escHtml(player.name)}</div>
        <div className="mt-1 flex items-center gap-2 flex-wrap">
          <span className={`inline-flex items-center px-2 py-1 rounded-full text-[10px] font-black uppercase tracking-[1px] ${pending ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
            {escHtml(player.transfer_status || 'transferred')}
          </span>
          <input
            type="color"
            className="w-8 h-8 rounded-full border-0 bg-transparent p-0 cursor-pointer"
            value={player.color || '#ffffff'}
            title="Change player color"
            onChange={(e) => onColorChange(player.id, e.target.value)}
          />
          <span className="text-xs text-gray-500">Balance</span>
          <span className="font-display text-2xl text-purple-800">{asNumber(player.balance)}</span>
        </div>
      </div>
      <button
        type="button"
        className="px-3 py-2 rounded-full bg-green-600 text-white text-sm font-black"
        onClick={() => onTransfer(player)}
      >
        Transferred
      </button>
    </div>
  );
}
