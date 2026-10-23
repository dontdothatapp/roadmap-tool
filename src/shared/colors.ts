import { partsIndex, umbrellaOf } from './parts.ts';
import type { ID, Item, Op, RoadmapState } from './types.ts';

// Umbrella colours for the team board. Every bar on the board is drawn alike, in the default pastel; what tells
// umbrellas apart is the small tag on each part, with the umbrella's name and a dot in its colour. Each umbrella
// gets a colour picked to stand apart from the other umbrellas, and keeps it.

export interface BoardColor {
  id: string;
  name: string;
  /** The pastel: the board's bars (the default one), and a light background where an umbrella is named. */
  hex: string;
  /** A deeper shade of the same hue, readable on white: an umbrella's tag on its parts (name and dot). */
  ink: string;
}

export const DEFAULT_BOARD_COLOR = 'mist';

/** The default first, then the rest in the order umbrellas get them (neighbours far apart in hue). */
export const BOARD_COLORS: BoardColor[] = [
  { id: 'mist', name: 'Mist', hex: '#d6deea', ink: '#56637a' },
  { id: 'sky', name: 'Sky', hex: '#b9dbf6', ink: '#1f6fb2' },
  { id: 'peach', name: 'Peach', hex: '#fdd1ac', ink: '#b4560f' },
  { id: 'mint', name: 'Mint', hex: '#bde7c7', ink: '#22804a' },
  { id: 'lavender', name: 'Lavender', hex: '#d8ccf8', ink: '#6a4fcf' },
  { id: 'butter', name: 'Butter', hex: '#f7e39a', ink: '#866a00' },
  { id: 'rose', name: 'Rose', hex: '#f7c2cb', ink: '#c03454' },
  { id: 'aqua', name: 'Aqua', hex: '#b1e4e2', ink: '#127a76' },
  { id: 'lilac', name: 'Lilac', hex: '#edc5eb', ink: '#a23b9c' },
  { id: 'lime', name: 'Lime', hex: '#d9eba3', ink: '#587609' },
  { id: 'coral', name: 'Coral', hex: '#f8bfac', ink: '#c2452a' },
  { id: 'periwinkle', name: 'Periwinkle', hex: '#c5cff9', ink: '#4256d0' },
  { id: 'sand', name: 'Sand', hex: '#e7d8bc', ink: '#85683a' },
  { id: 'sage', name: 'Sage', hex: '#cfdcbf', ink: '#56743d' },
  { id: 'blush', name: 'Blush', hex: '#f5d2e3', ink: '#b5427a' },
  { id: 'cornflower', name: 'Cornflower', hex: '#a9c3ee', ink: '#2d5bb5' },
  { id: 'apricot', name: 'Apricot', hex: '#fbc88e', ink: '#a65d08' },
  { id: 'plum', name: 'Plum', hex: '#d6b3e0', ink: '#86399f' },
  { id: 'moss', name: 'Moss', hex: '#c7d799', ink: '#5a7016' },
];

export const BOARD_COLOR_IDS = BOARD_COLORS.map((c) => c.id);
const BY_ID = new Map(BOARD_COLORS.map((c) => [c.id, c]));
const FOR_UMBRELLAS = BOARD_COLOR_IDS.filter((id) => id !== DEFAULT_BOARD_COLOR);

export function boardColor(id: string | null | undefined): BoardColor {
  return BY_ID.get(id ?? '') ?? BY_ID.get(DEFAULT_BOARD_COLOR)!;
}

/** The least used umbrella colour (the first of them on a tie). */
function leastUsed(counts: Map<string, number>): string {
  return FOR_UMBRELLAS.reduce((best, id) => ((counts.get(id) ?? 0) < (counts.get(best) ?? 0) ? id : best));
}

const cache = new WeakMap<RoadmapState, Map<ID, string>>();

/**
 * umbrella id → its colour. Its own when set (new umbrellas get one when they form, see `pinUmbrellaColors`);
 * otherwise, for umbrellas from before colours, the least used one, handed out in id order so it stays put.
 */
export function umbrellaColors(state: RoadmapState): Map<ID, string> {
  let out = cache.get(state);
  if (out) return out;
  out = new Map();
  const counts = new Map<string, number>();
  const ids = [...partsIndex(state).keys()].sort();
  for (const id of ids) {
    const own = state.items[id]?.color;
    if (!own) continue;
    out.set(id, own);
    counts.set(own, (counts.get(own) ?? 0) + 1);
  }
  for (const id of ids) {
    if (out.has(id)) continue;
    const pick = leastUsed(counts);
    out.set(id, pick);
    counts.set(pick, (counts.get(pick) ?? 0) + 1);
  }
  cache.set(state, out);
  return out;
}

/** An initiative's colour: its umbrella's for a part, an umbrella's own, else the one stored on it or the default. */
export function boardColorOf(state: RoadmapState, item: Item): BoardColor {
  const umbrella = umbrellaOf(state, item);
  const colors = umbrellaColors(state);
  return boardColor(umbrella ? colors.get(umbrella.id) : (colors.get(item.id) ?? item.color));
}

/**
 * Ops that give each umbrella formed between `before` and `after` (and with no colour of its own) the colour
 * least used by the other umbrellas, so it stands out and then keeps it.
 */
export function pinUmbrellaColors(before: RoadmapState, after: RoadmapState): Op[] {
  const formed = [...partsIndex(after).keys()].filter((id) => !partsIndex(before).has(id) && !after.items[id]?.color);
  if (formed.length === 0) return [];
  const counts = new Map<string, number>();
  const count = (id: string) => counts.set(id, (counts.get(id) ?? 0) + 1);
  const colors = umbrellaColors(after);
  for (const [id, color] of colors) if (!formed.includes(id)) count(color);
  return formed.map((id) => {
    const color = leastUsed(counts);
    count(color);
    return { kind: 'update', entity: 'item', id, patch: { color } };
  });
}
