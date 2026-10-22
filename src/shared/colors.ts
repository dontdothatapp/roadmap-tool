import { partsIndex, umbrellaOf } from './parts.ts';
import type { ID, Item, Op, RoadmapState } from './types.ts';

// The team board's pastel colours. Initiatives on their own share the default, and each can pick another; the
// parts of an umbrella all wear the umbrella's colour, which is picked to stand apart from the other umbrellas.

export interface BoardColor {
  id: string;
  name: string;
  hex: string;
}

export const DEFAULT_BOARD_COLOR = 'mist';

/** The default first, then the rest in the order umbrellas get them (neighbours far apart in hue). */
export const BOARD_COLORS: BoardColor[] = [
  { id: 'mist', name: 'Mist', hex: '#d6deea' },
  { id: 'sky', name: 'Sky', hex: '#b9dbf6' },
  { id: 'peach', name: 'Peach', hex: '#fdd1ac' },
  { id: 'mint', name: 'Mint', hex: '#bde7c7' },
  { id: 'lavender', name: 'Lavender', hex: '#d8ccf8' },
  { id: 'butter', name: 'Butter', hex: '#f7e39a' },
  { id: 'rose', name: 'Rose', hex: '#f7c2cb' },
  { id: 'aqua', name: 'Aqua', hex: '#b1e4e2' },
  { id: 'lilac', name: 'Lilac', hex: '#edc5eb' },
  { id: 'lime', name: 'Lime', hex: '#d9eba3' },
  { id: 'coral', name: 'Coral', hex: '#f8bfac' },
  { id: 'periwinkle', name: 'Periwinkle', hex: '#c5cff9' },
  { id: 'sand', name: 'Sand', hex: '#e7d8bc' },
  { id: 'sage', name: 'Sage', hex: '#cfdcbf' },
  { id: 'blush', name: 'Blush', hex: '#f5d2e3' },
  { id: 'cornflower', name: 'Cornflower', hex: '#a9c3ee' },
  { id: 'apricot', name: 'Apricot', hex: '#fbc88e' },
  { id: 'plum', name: 'Plum', hex: '#d6b3e0' },
  { id: 'moss', name: 'Moss', hex: '#c7d799' },
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

/** The colour an initiative wears on the team board: its umbrella's for a part, else its own or the default. */
export function boardColorOf(state: RoadmapState, item: Item): BoardColor {
  const umbrella = umbrellaOf(state, item);
  const colors = umbrellaColors(state);
  return boardColor(umbrella ? colors.get(umbrella.id) : (colors.get(item.id) ?? item.color));
}

/**
 * Ops that give each umbrella formed between `before` and `after` (and with no colour of its own) the colour
 * least used on the board, umbrellas and recoloured initiatives alike, so it stands out and then keeps it.
 */
export function pinUmbrellaColors(before: RoadmapState, after: RoadmapState): Op[] {
  const formed = [...partsIndex(after).keys()].filter((id) => !partsIndex(before).has(id) && !after.items[id]?.color);
  if (formed.length === 0) return [];
  const counts = new Map<string, number>();
  const count = (id: string) => counts.set(id, (counts.get(id) ?? 0) + 1);
  const colors = umbrellaColors(after);
  for (const [id, color] of colors) if (!formed.includes(id)) count(color);
  for (const item of Object.values(after.items)) if (item.color && !colors.has(item.id) && !umbrellaOf(after, item)) count(item.color);
  return formed.map((id) => {
    const color = leastUsed(counts);
    count(color);
    return { kind: 'update', entity: 'item', id, patch: { color } };
  });
}
