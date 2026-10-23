import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import type { Figure } from '../../shared/impact.ts';
import { STATUS_LABELS, type Status } from '../../shared/types.ts';
import { displayName, initials } from '../../shared/util.ts';
import { STATUS_COLORS } from '../lib/model.ts';

export function StatusPill({ status, onClick }: { status: Status; onClick?: () => void }) {
  const Tag = onClick ? 'button' : 'span';
  return (
    <Tag className={`status-pill st-${status}`} style={{ '--c': STATUS_COLORS[status] } as React.CSSProperties} onClick={onClick} type={onClick ? 'button' : undefined}>
      <span className="status-dot" />
      {STATUS_LABELS[status]}
    </Tag>
  );
}

/** Expected impact figures: "+5%", or "+3% → +5%" with the older figure quieter when comparing versions. */
export function Figures({ figures, sep = ' · ' }: { figures: Figure[]; sep?: string }) {
  return (
    <>
      {figures.map((f, k) => (
        <Fragment key={f.unit}>
          {k > 0 && sep}
          {f.was !== null && <span className="fig-was">{f.was} → </span>}
          {f.now}
        </Fragment>
      ))}
    </>
  );
}

export function StatusDot({ status }: { status: Status }) {
  return <span className={`status-dot st-${status}`} style={{ '--c': STATUS_COLORS[status] } as React.CSSProperties} title={STATUS_LABELS[status]} />;
}

export function TeamChip({ name, color, onClick }: { name: string; color: string; onClick?: () => void }) {
  const Tag = onClick ? 'button' : 'span';
  return (
    <Tag className="team-chip" style={{ '--c': color } as React.CSSProperties} onClick={onClick} type={onClick ? 'button' : undefined}>
      {name}
    </Tag>
  );
}

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  label,
  size = 'md',
}: {
  value: T;
  options: { value: T; label: ReactNode; title?: string }[];
  onChange: (v: T) => void;
  label: string;
  size?: 'sm' | 'md';
}) {
  return (
    <div className={`segmented ${size}`} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          className={o.value === value ? 'is-on' : ''}
          onClick={() => onChange(o.value)}
          title={o.title}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, label, id }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; id: string }) {
  return (
    <label className="toggle" htmlFor={id}>
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-track" aria-hidden="true">
        <span className="toggle-thumb" />
      </span>
      <span className="toggle-label">{label}</span>
    </label>
  );
}

export function Avatar({ name, size = 26, title }: { name: string; size?: number; title?: string }) {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  const hue = Math.abs(hash) % 360;
  return (
    <span
      className="avatar"
      style={{ width: size, height: size, fontSize: size * 0.4, '--h': hue } as React.CSSProperties}
      title={title ?? displayName(name)}
    >
      {initials(name)}
    </span>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}

/** Open popovers, oldest first: one can open inside another (the tag list in the filters). */
const openPopovers: HTMLElement[] = [];
const escaped = new WeakSet<Event>();

/**
 * A floating panel anchored to a trigger element. Closes on outside click and Escape. A click in a popover opened
 * on top of it (from inside it) counts as inside, and Escape closes only the topmost one.
 */
export function Popover({
  anchor,
  open,
  onClose,
  children,
  align = 'start',
  width,
}: {
  anchor: HTMLElement | null;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  align?: 'start' | 'end';
  width?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (!open || !anchor) return;
    const place = () => {
      const r = anchor.getBoundingClientRect();
      const w = ref.current?.offsetWidth ?? width ?? 280;
      const h = ref.current?.offsetHeight ?? 300;
      let left = align === 'end' ? r.right - w : r.left;
      left = Math.min(Math.max(8, left), window.innerWidth - w - 8);
      let top = r.bottom + 6;
      if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 6);
      setPos({ left, top });
    };
    place();
    // Follow the trigger when what's around it scrolls, and re-place when the content changes size (a list
    // filtered as you type), so a panel shown above its trigger stays against it.
    const resized = new ResizeObserver(place);
    if (ref.current) resized.observe(ref.current);
    resized.observe(anchor);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      resized.disconnect();
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, anchor, align, width]);

  // Its place in the stack is when it opened (not when its listeners were last set up).
  useEffect(() => {
    const el = ref.current;
    if (!open || !el) return;
    openPopovers.push(el);
    return () => {
      openPopovers.splice(openPopovers.indexOf(el), 1);
    };
  }, [open]);

  useEffect(() => {
    const el = ref.current;
    if (!open || !el) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (el.contains(t) || anchor?.contains(t)) return;
      if (openPopovers.slice(openPopovers.indexOf(el) + 1).some((above) => above.contains(t))) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      // Closing the top one can take it off the stack before the next one hears the key: one Escape, one popover.
      if (e.key === 'Escape' && openPopovers[openPopovers.length - 1] === el && !escaped.has(e)) {
        escaped.add(e);
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open, anchor, onClose]);

  if (!open) return null;
  return createPortal(
    <div ref={ref} className="popover" style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999, width }}>
      {children}
    </div>,
    document.body,
  );
}

export function Modal({ title, onClose, children, width = 460, footer }: { title: ReactNode; onClose: () => void; children: ReactNode; width?: number; footer?: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  return createPortal(
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width }} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/** Two-step button for destructive actions (the browser's confirm() isn't available everywhere). */
export function ConfirmButton({
  children,
  confirmLabel,
  onConfirm,
  className = 'btn ghost danger',
  disabled,
  title,
}: {
  children: ReactNode;
  confirmLabel: ReactNode;
  onConfirm: () => void;
  className?: string;
  disabled?: boolean;
  title?: string;
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button
      type="button"
      className={`${className}${armed ? ' is-armed' : ''}`}
      disabled={disabled}
      title={title}
      onClick={() => {
        if (armed) {
          setArmed(false);
          onConfirm();
        } else setArmed(true);
      }}
    >
      {armed ? confirmLabel : children}
    </button>
  );
}

export function Empty({ title, children, icon }: { title: string; children?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="empty">
      {icon && <div className="empty-icon">{icon}</div>}
      <div className="empty-title">{title}</div>
      {children && <div className="empty-body">{children}</div>}
    </div>
  );
}
