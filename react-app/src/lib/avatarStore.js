// Client-side only avatar persistence (localStorage), kept separate from the
// Supabase `players` table so we don't need a schema migration to add a column.
const KEY = 'point-count-avatars-v1';

export const AVATAR_OPTIONS = [
  '🥷', '🧙‍♂️', '🧙‍♀️', '🧝‍♀️', '🧝‍♂️', '🦸‍♂️', '🦸‍♀️', '🦹‍♂️',
  '🦹‍♀️', '🧛‍♂️', '🧛‍♀️', '🧟‍♂️', '🧞‍♂️', '🧞‍♀️', '🤖', '👽',
  '🐉', '🦄', '🐺', '🦊', '🐼', '🐯', '🦁', '🐸',
];

function readMap() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || {};
  } catch {
    return {};
  }
}

export function getAvatar(playerId) {
  if (!playerId) return null;
  return readMap()[playerId] || null;
}

export function setAvatar(playerId, avatar) {
  if (!playerId) return;
  const map = readMap();
  map[playerId] = avatar;
  localStorage.setItem(KEY, JSON.stringify(map));
}

export function randomAvatar(exclude) {
  const pool = exclude ? AVATAR_OPTIONS.filter((a) => a !== exclude) : AVATAR_OPTIONS;
  return pool[Math.floor(Math.random() * pool.length)];
}

export function randomColor() {
  const hue = Math.floor(Math.random() * 360);
  const sat = 65 + Math.floor(Math.random() * 25);
  const light = 45 + Math.floor(Math.random() * 15);
  return hslToHex(hue, sat, light);
}

function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const toHex = (n) => Math.round(255 * f(n)).toString(16).padStart(2, '0');
  return `#${toHex(0)}${toHex(8)}${toHex(4)}`;
}
