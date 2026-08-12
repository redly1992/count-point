import { sb } from '../lib/supabaseClient';
import { asNumber } from '../lib/helpers';

export const PLAYER_TABLE = 'players';
export const MATCH_TABLE = 'matches';
export const BALANCE_HISTORY_TABLE = 'player_balance_history';

export async function fetchPlayers() {
  if (!sb) return [];
  const { data, error } = await sb.from(PLAYER_TABLE).select('*').order('name', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function upsertPlayer(player) {
  if (!sb) return;
  const payload = {
    id: player.id || crypto.randomUUID(),
    name: player.name,
    balance: asNumber(player.balance),
    transfer_status: player.transfer_status || 'transferred',
    color: player.color || '#a855f7',
    updated_at: new Date().toISOString(),
  };
  const { error } = await sb.from(PLAYER_TABLE).upsert(payload);
  if (error) throw error;
}

export async function markPlayerTransferred(playerId) {
  if (!sb) return;
  const { error } = await sb
    .from(PLAYER_TABLE)
    .update({ balance: 0, transfer_status: 'transferred', updated_at: new Date().toISOString() })
    .eq('id', playerId);
  if (error) throw error;
}

export async function resetAppData() {
  if (!sb) return;
  const { error: delMatchesErr } = await sb.from(MATCH_TABLE).delete().not('id', 'is', null);
  if (delMatchesErr) throw delMatchesErr;
  const { error: delHistoryErr } = await sb.from(BALANCE_HISTORY_TABLE).delete().not('id', 'is', null);
  if (delHistoryErr) throw delHistoryErr;
  const { error: resetPlayersErr } = await sb
    .from(PLAYER_TABLE)
    .update({ balance: 0, transfer_status: 'transferred', updated_at: new Date().toISOString() })
    .not('id', 'is', null);
  if (resetPlayersErr) throw resetPlayersErr;
}

export async function fetchMatches() {
  if (!sb) return [];
  const { data, error } = await sb.from(MATCH_TABLE).select('*').order('played_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function saveMatchResult(match) {
  if (!sb) return;
  const { error } = await sb.from(MATCH_TABLE).upsert(match);
  if (error) throw error;
}

export async function deleteMatch(matchId) {
  if (!sb) return;
  const { error } = await sb.from(MATCH_TABLE).delete().eq('id', matchId);
  if (error) throw error;
}

export async function saveBalanceHistory(rows) {
  if (!sb || !rows.length) return;
  const { error } = await sb.from(BALANCE_HISTORY_TABLE).insert(rows);
  if (error) throw error;
}

export async function fetchBalanceHistory() {
  if (!sb) return [];
  const { data, error } = await sb.from(BALANCE_HISTORY_TABLE).select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}
