import { useState, useEffect, useCallback, useRef, createContext, useContext } from "react";
import { CheckCircle2, AlertTriangle, XCircle, Info, X, Keyboard } from "lucide-react";

/* ─────────────────────────────────────────────────────────────────────────
   usePersisted — like useState, but survives reloads via localStorage.
   Why: the terminal has ~10 tabs and a long config form; losing all of it
   on every refresh was the single biggest friction point in the UI.
   ───────────────────────────────────────────────────────────────────────── */
const NS = "tt:";

export function loadPersisted(key, fallback) {
  try {
    const raw = localStorage.getItem(NS + key);
    if (raw == null) return fallback;
    const v = JSON.parse(raw);
    // Merge objects so a newly added config field still gets its default
    if (v && typeof v === "object" && !Array.isArray(v) &&
        fallback && typeof fallback === "object" && !Array.isArray(fallback)) {
      return { ...fallback, ...v };
    }
    return v;
  } catch { return fallback; }
}

export function usePersisted(key, fallback) {
  const [v, setV] = useState(() => loadPersisted(key, fallback));
  useEffect(() => {
    try { localStorage.setItem(NS + key, JSON.stringify(v)); } catch { /* quota or private mode */ }
  }, [key, v]);
  return [v, setV];
}

export function clearPersisted() {
  try {
    Object.keys(localStorage).filter(k => k.startsWith(NS)).forEach(k => localStorage.removeItem(k));
  } catch { /* ignore */ }
}

/* ─────────────────────────────────────────────────────────────────────────
   Toasts — non-blocking feedback. Announced via an aria-live region so
   screen-reader users hear the same confirmations sighted users see.
   ───────────────────────────────────────────────────────────────────────── */
const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);

const ICONS = { ok: CheckCircle2, err: XCircle, warn: AlertTriangle, info: Info };

export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const idRef = useRef(0);

  const dismiss = useCallback(id => setItems(a => a.filter(t => t.id !== id)), []);

  const push = useCallback((msg, kind = "info", ms = 4200) => {
    const id = ++idRef.current;
    setItems(a => [...a.slice(-3), { id, msg, kind }]);
    if (ms > 0) setTimeout(() => dismiss(id), ms);
    return id;
  }, [dismiss]);

  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toast-wrap" role="region" aria-label="Notifications">
        {items.map(t => {
          const Ic = ICONS[t.kind] || Info;
          return (
            <div key={t.id} className={`toast ${t.kind}`} role={t.kind === "err" ? "alert" : "status"}>
              <Ic size={15} />
              <span>{t.msg}</span>
              <button className="toast-x" onClick={() => dismiss(t.id)} aria-label="Dismiss notification">
                <X size={13} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastCtx.Provider>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   Status / error / empty primitives with the right ARIA roles baked in,
   so async panels announce themselves instead of changing silently.
   ───────────────────────────────────────────────────────────────────────── */
export function Loading({ children = "Loading…", inline = false }) {
  return (
    <div className={inline ? "loading-inline" : "loading"} role="status" aria-live="polite">
      {children}
    </div>
  );
}

export function ErrBox({ children, title }) {
  return (
    <div className="err-box" role="alert">
      <AlertTriangle size={15} />
      <div>{title ? <strong>{title}</strong> : null}{children}</div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   Roving-tabindex tablist. One Tab stop for the whole bar; arrows move
   between tabs, Home/End jump to the ends (WAI-ARIA tabs pattern).
   ───────────────────────────────────────────────────────────────────────── */
export function useTablist(ids, active, setActive) {
  const ref = useRef(null);

  const onKeyDown = useCallback(e => {
    const i = ids.indexOf(active);
    let n = -1;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") n = (i + 1) % ids.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") n = (i - 1 + ids.length) % ids.length;
    else if (e.key === "Home") n = 0;
    else if (e.key === "End") n = ids.length - 1;
    else return;
    e.preventDefault();
    setActive(ids[n]);
    // Move real DOM focus so the next arrow press keeps working
    requestAnimationFrame(() => {
      ref.current?.querySelector(`[data-tabid="${ids[n]}"]`)?.focus();
    });
  }, [ids, active, setActive]);

  return { ref, onKeyDown };
}

/* ─────────────────────────────────────────────────────────────────────────
   Keyboard shortcut help (Shift + ?). Traps nothing; Escape closes.
   ───────────────────────────────────────────────────────────────────────── */
export function ShortcutHelp({ rows, onClose }) {
  const cardRef = useRef(null);

  useEffect(() => {
    cardRef.current?.focus();
    const onKey = e => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="kbd-scrim" onClick={onClose}>
      <div
        className="kbd-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="kbd-title"
        tabIndex={-1}
        ref={cardRef}
        onClick={e => e.stopPropagation()}
      >
        <h2 id="kbd-title"><Keyboard size={16} /> Keyboard shortcuts</h2>
        {rows.map(([k, d]) => (
          <div className="kbd-row" key={k}>
            <span>{d}</span>
            <span>{k.split("+").map(part => <kbd key={part}>{part}</kbd>)}</span>
          </div>
        ))}
        <p className="kbd-hint">
          Shortcuts are ignored while you are typing in a field. Press <kbd>Esc</kbd> or click
          outside to close. Tab order follows the visual layout; use <kbd>←</kbd> <kbd>→</kbd> on
          the tab bar to switch views.
        </p>
      </div>
    </div>
  );
}

/* True when focus is in a text-entry control, so global shortcuts stand down. */
export function isTyping(el = document.activeElement) {
  if (!el) return false;
  const t = el.tagName;
  return t === "INPUT" || t === "TEXTAREA" || t === "SELECT" || el.isContentEditable;
}
