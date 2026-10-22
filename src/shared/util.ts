/** Short random ids. Works without `crypto.randomUUID`, which browsers only expose on HTTPS. */
export function uid(length = 10): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}

/** Only allow web and mail links; anything else (e.g. `javascript:`) is dropped. Bare domains get https://. */
export function safeUrl(input: unknown): string {
  if (typeof input !== 'string') return '';
  const url = input.trim();
  if (!url) return '';
  if (/^(https?:\/\/|mailto:)/i.test(url)) return url.slice(0, 2000);
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return '';
  return `https://${url}`.slice(0, 2000);
}

export function str(value: unknown, max = 500): string {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function stableEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Readable name from an actor id: "anna.kowalski@acme.com" → "Anna Kowalski". */
export function displayName(actor: string): string {
  if (!actor) return 'Someone';
  if (!actor.includes('@')) return actor;
  const local = actor.split('@')[0];
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((p) => p[0].toUpperCase() + p.slice(1))
    .join(' ');
}

export function initials(name: string): string {
  const parts = displayName(name).split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function pluralize(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}
