import { useState } from 'react';

const PREFIX = 'roadmap-anywhere-ui-';

/** useState that remembers its value in this browser (layout conveniences only). */
export function usePersistentState<T>(key: string, initial: T): [T, (v: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(PREFIX + key);
      return raw === null ? initial : (JSON.parse(raw) as T);
    } catch {
      return initial;
    }
  });
  const set = (v: T | ((prev: T) => T)) => {
    setValue((prev) => {
      const next = typeof v === 'function' ? (v as (p: T) => T)(prev) : v;
      try {
        localStorage.setItem(PREFIX + key, JSON.stringify(next));
      } catch {
        // Storage may be unavailable; the setting just won't be remembered.
      }
      return next;
    });
  };
  return [value, set];
}
