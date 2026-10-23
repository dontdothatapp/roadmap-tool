import { useEffect, useRef, useState } from 'react';
import { Check, X } from 'lucide-react';
import type { RoadmapState } from '../../shared/types.ts';
import { normalizeTag, tagChoices } from '../lib/model.ts';
import { Popover } from './ui.tsx';

/**
 * Tags as chips in a field that also takes typing, with a list under it of every tag in use and how many
 * initiatives carry each: tick as many as you like (the list stays open), typing narrows it. With `allowNew`, what's
 * typed can become a new tag (a comma adds it too). ↑ ↓ and Enter tick, Backspace in the empty field takes off the
 * last tag, Escape closes the list. Used for an initiative's tags and for the tag filter.
 */
export function TagPicker({
  id,
  state,
  selected,
  onToggle,
  allowNew = false,
  readOnly = false,
  placeholder,
}: {
  id: string;
  state: RoadmapState;
  selected: string[];
  onToggle: (tag: string) => void;
  allowNew?: boolean;
  readOnly?: boolean;
  /** Shown in the empty field; "Add…" once there are tags. */
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const { tags, create } = tagChoices(state, q);
  const rows = [...tags, ...(allowNew && create ? [{ tag: create, count: 0, isNew: true }] : [])];
  const at = Math.min(active, rows.length - 1);

  useEffect(() => {
    if (open) document.getElementById(`${id}-opt-${at}`)?.scrollIntoView({ block: 'nearest' });
  }, [open, at, id]);

  const toggle = (tag: string) => {
    if (!tag) return;
    onToggle(tag);
    // Back to the whole list, on the tag just ticked, for the next one.
    if (q) {
      setQ('');
      setActive(Math.max(0, tagChoices(state, '').tags.findIndex((t) => t.tag === tag)));
    }
  };
  const show = () => {
    if (readOnly || open) return;
    setOpen(true);
    setActive(0);
  };
  const close = () => {
    setOpen(false);
    setQ('');
  };

  return (
    <div
      ref={wrap}
      className={`tag-input${readOnly ? ' is-readonly' : ''}`}
      onClick={() => {
        if (readOnly) return;
        input.current?.focus();
        show();
      }}
    >
      {selected.map((t) => (
        <span key={t} className="tag">
          #{t}
          {!readOnly && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onToggle(t);
              }}
              aria-label={`Remove tag ${t}`}
            >
              <X size={11} />
            </button>
          )}
        </span>
      ))}
      {!readOnly && (
        <input
          ref={input}
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          aria-activedescendant={open && rows.length ? `${id}-opt-${at}` : undefined}
          autoComplete="off"
          spellCheck={false}
          value={q}
          placeholder={selected.length ? 'Add…' : placeholder}
          onBlur={close}
          onChange={(e) => {
            setQ(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              if (!open) return show();
              setActive((a) => (Math.min(a, rows.length - 1) + (e.key === 'ArrowDown' ? 1 : rows.length - 1)) % Math.max(1, rows.length));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              if (open && rows[at]) toggle(rows[at].tag);
              else if (allowNew) toggle(normalizeTag(q));
            } else if (e.key === ',' && allowNew) {
              e.preventDefault();
              const tag = normalizeTag(q);
              if (tag && !selected.includes(tag)) toggle(tag);
            } else if (e.key === 'Backspace' && !q && selected.length) {
              onToggle(selected[selected.length - 1]);
            }
          }}
        />
      )}
      <Popover anchor={wrap.current} open={open} onClose={close} width={wrap.current?.offsetWidth}>
        <div id={`${id}-list`} className="picker-options" role="listbox" aria-multiselectable="true" onMouseDown={(e) => e.preventDefault()}>
          {rows.length === 0 && <div className="picker-empty muted sm">{q ? 'No tag matches.' : 'No tags yet: type one.'}</div>}
          {rows.map((row, k) => {
            const on = selected.includes(row.tag);
            return (
              <div
                key={row.tag}
                id={`${id}-opt-${k}`}
                role="option"
                aria-selected={on}
                className={`picker-option${'isNew' in row ? ' is-action' : ''}${k === at ? ' is-active' : ''}`}
                onMouseMove={() => k !== at && setActive(k)}
                onClick={() => toggle(row.tag)}
              >
                {'isNew' in row ? (
                  <span className="picker-label">＋ New tag #{row.tag}</span>
                ) : (
                  <>
                    <span className={`picker-box${on ? ' is-on' : ''}`}>{on && <Check size={11} strokeWidth={3} />}</span>
                    <span className="picker-label">#{row.tag}</span>
                    <span className="picker-hint">{row.count}</span>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </Popover>
    </div>
  );
}
