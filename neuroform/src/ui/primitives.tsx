/** Interface primitives shared by every view. */

import { useEffect, useId, useState, type CSSProperties, type ReactNode } from 'react';
import { Icon } from './icons.tsx';

export function Panel({ title, meta, actions, children, className = '', style, bodyClass = '', id }: { title?: ReactNode; meta?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; style?: CSSProperties; bodyClass?: string; id?: string }) {
  return (
    <section className={`panel glass ${className}`} style={style} id={id}>
      {(title || actions) && (
        <header className="panel__head">
          <div className="panel__title">
            {typeof title === 'string' ? <h2>{title}</h2> : title}
            {meta && <span className="label">{meta}</span>}
          </div>
          {actions && <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>{actions}</div>}
        </header>
      )}
      <div className={`panel__body ${bodyClass}`}>{children}</div>
    </section>
  );
}

export function Section({ label, actions, children, hint }: { label: ReactNode; actions?: ReactNode; children?: ReactNode; hint?: ReactNode }) {
  return (
    <div className="section">
      <div className="section__head">
        <span className="label">{label}</span>
        {actions}
      </div>
      {hint && <p className="hint">{hint}</p>}
      {children}
    </div>
  );
}

export function Stat({ label, value, unit, note, size, color, wide }: { label: ReactNode; value: ReactNode; unit?: string; note?: ReactNode; size?: 'sm' | 'xl'; color?: string; wide?: boolean }) {
  return (
    <div className={`stat ${size ? `stat--${size}` : ''} ${wide ? 'stat--span2' : ''}`}>
      <span className="label">{label}</span>
      <span className="stat__value" style={color ? { color } : undefined}>
        {value}
        {unit && <small>{unit}</small>}
      </span>
      {note && <span className="stat__note">{note}</span>}
    </div>
  );
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: string; disabled?: boolean }) {
  return <button type="button" className="toggle" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)} />;
}

export function ToggleRow({ label, checked, onChange, hint, disabled }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void; hint?: string; disabled?: boolean }) {
  return (
    <label className="toggle-row" title={hint}>
      <span>{label}</span>
      <Toggle checked={checked} onChange={onChange} disabled={disabled} label={typeof label === 'string' ? label : undefined} />
    </label>
  );
}

export function Slider({ label, value, min, max, step = 0.01, onChange, format, onCommit, log }: { label?: ReactNode; value: number; min: number; max: number; step?: number; onChange: (v: number) => void; onCommit?: (v: number) => void; format?: (v: number) => string; log?: boolean }) {
  const id = useId();
  const toPos = (v: number) => (log ? Math.log(v / min) / Math.log(max / min) : (v - min) / (max - min));
  const fromPos = (p: number) => (log ? min * Math.pow(max / min, p) : min + p * (max - min));
  const pos = Math.max(0, Math.min(1, toPos(value)));
  return (
    <div className="field">
      {label !== undefined && (
        <div className="field__row">
          <label className="field__label" htmlFor={id}>{label}</label>
          <span className="field__value">{format ? format(value) : value.toFixed(2)}</span>
        </div>
      )}
      <input
        id={id}
        className="range"
        type="range"
        min={0}
        max={1000}
        step={log ? 1 : Math.max(1, Math.round((step / (max - min)) * 1000))}
        value={Math.round(pos * 1000)}
        style={{ '--fill': `${pos * 100}%` } as CSSProperties}
        onChange={(e) => {
          let v = fromPos(Number(e.target.value) / 1000);
          if (!log) v = Math.round(v / step) * step;
          onChange(Number(v.toPrecision(6)));
        }}
        onPointerUp={() => onCommit?.(value)}
        onKeyUp={() => onCommit?.(value)}
      />
    </div>
  );
}

/** Numeric input that validates on commit (Enter / blur). */
export function NumberField({ label, value, onCommit, min, max, step = 0.1, unit, hint, disabled }: { label: ReactNode; value: number; onCommit: (v: number) => void | Promise<void>; min?: number; max?: number; step?: number; unit?: string; hint?: string; disabled?: boolean }) {
  const [text, setText] = useState(fmtNum(value));
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setText(fmtNum(value)), [value]);
  const commit = async () => {
    const v = Number(text);
    if (!Number.isFinite(v)) return setError('Enter a number');
    if (min !== undefined && v < min) return setError(`Minimum ${min}`);
    if (max !== undefined && v > max) return setError(`Maximum ${max}`);
    setError(null);
    if (v !== value) {
      try {
        await onCommit(v);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setText(fmtNum(value));
      }
    }
  };
  return (
    <div className="field" title={hint}>
      <div className="field__row">
        <span className="field__label">{label}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input
            className={`input input--num ${error ? 'is-invalid' : ''}`}
            style={{ width: 92 }}
            inputMode="decimal"
            value={text}
            disabled={disabled}
            step={step}
            onChange={(e) => setText(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') {
                setText(fmtNum(value));
                setError(null);
              }
              e.stopPropagation();
            }}
          />
          {unit && <span className="dim" style={{ fontSize: 11, minWidth: 22 }}>{unit}</span>}
        </div>
      </div>
      {error && <span className="error-text">{error}</span>}
    </div>
  );
}

export function fmtNum(v: number): string {
  if (!Number.isFinite(v)) return '';
  const a = Math.abs(v);
  if (a !== 0 && (a < 0.001 || a >= 1e6)) return v.toExponential(3);
  return String(Number(v.toPrecision(5)));
}

export function Segmented<T extends string | number>({ value, options, onChange, wrap, label }: { value: T; options: { value: T; label: ReactNode; title?: string }[]; onChange: (v: T) => void; wrap?: boolean; label?: string }) {
  return (
    <div className={`segmented ${wrap ? 'segmented--wrap' : ''}`} role="group" aria-label={label}>
      {options.map((o) => (
        <button type="button" key={String(o.value)} aria-pressed={o.value === value} onClick={() => onChange(o.value)} title={o.title}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Select<T extends string | number>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label?: ReactNode }) {
  const id = useId();
  const select = (
    <select id={id} className="select" value={String(value)} onChange={(e) => {
      const o = options.find((x) => String(x.value) === e.target.value);
      if (o) onChange(o.value);
    }}>
      {options.map((o) => (
        <option key={String(o.value)} value={String(o.value)}>{o.label}</option>
      ))}
    </select>
  );
  if (label === undefined) return select;
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>{label}</label>
      {select}
    </div>
  );
}

export function IconButton({ icon, label, onClick, active, disabled, large, kbd }: { icon: ReactNode; label: string; onClick?: () => void; active?: boolean; disabled?: boolean; large?: boolean; kbd?: string }) {
  return (
    <button type="button" className={`icon-btn ${large ? 'icon-btn--lg' : ''} ${active ? 'is-active' : ''}`} aria-label={label} title={kbd ? `${label} (${kbd})` : label} onClick={onClick} disabled={disabled} aria-pressed={active}>
      {icon}
    </button>
  );
}

export function Dialog({ title, meta, onClose, children, footer, size = '' }: { title: ReactNode; meta?: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; size?: '' | 'wide' | 'narrow' }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', k, true);
    return () => window.removeEventListener('keydown', k, true);
  }, [onClose]);
  return (
    <div className="scrim" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <section className={`dialog glass panel ${size ? `dialog--${size}` : ''}`} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined}>
        <header className="panel__head">
          <div className="panel__title">
            {typeof title === 'string' ? <h2>{title}</h2> : title}
            {meta && <span className="label">{meta}</span>}
          </div>
          <IconButton icon={Icon.close()} label="Close" onClick={onClose} kbd="Esc" />
        </header>
        <div className="panel__body">{children}</div>
        {footer && <footer className="dialog__foot">{footer}</footer>}
      </section>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="hint" style={{ padding: '18px 4px', textAlign: 'center' }}>{children}</p>;
}

export function Kbd({ children }: { children: ReactNode }) {
  return <span className="kbd">{children}</span>;
}

export function Meter({ value, max = 1, color }: { value: number; max?: number; color?: string }) {
  const w = Math.max(0, Math.min(100, (value / (max || 1)) * 100));
  return (
    <div className="bar" aria-hidden="true">
      <i style={{ width: `${w}%`, ...(color ? { background: color } : {}) }} />
    </div>
  );
}

export const fmt = {
  int: (v: number) => (Number.isFinite(v) ? Math.round(v).toLocaleString('en-GB') : '—'),
  num: (v: number, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : '—'),
  compact: (v: number) => {
    if (!Number.isFinite(v)) return '—';
    const a = Math.abs(v);
    if (a >= 1e9) return `${(v / 1e9).toFixed(2)} G`;
    if (a >= 1e6) return `${(v / 1e6).toFixed(a >= 1e7 ? 1 : 2)} M`;
    if (a >= 1e4) return `${(v / 1e3).toFixed(1)} k`;
    return Math.round(v).toLocaleString('en-GB');
  },
  time: (ms: number) => {
    if (!Number.isFinite(ms)) return '—';
    if (ms < 1000) return `${ms.toFixed(1)} ms`;
    if (ms < 60_000) return `${(ms / 1000).toFixed(3)} s`;
    const m = Math.floor(ms / 60_000);
    return `${m}:${((ms % 60_000) / 1000).toFixed(2).padStart(5, '0')}`;
  },
  speed: (s: number) => (!Number.isFinite(s) ? 'MAX' : s >= 1 ? `${s}×` : `${s}×`),
};
