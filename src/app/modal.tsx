"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

const focusableSelector = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

/**
 * A modal dialog that behaves like one for keyboard and screen-reader users: focus moves to the
 * first control on open, Tab and Shift+Tab stay inside, Escape and a backdrop press close it, and
 * focus returns to whatever opened it. Callers mark the rest of the page `inert` while it is open.
 */
export function Modal({ className, labelledBy, onClose, children }: { className: string; labelledBy: string; onClose: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLElement | null>(null);
  const close = useRef(onClose);
  close.current = onClose;
  // Read during the first render: once the page behind is marked inert, the browser has already blurred the opener.
  const [opener] = useState(() => typeof document !== "undefined" && document.activeElement instanceof HTMLElement ? document.activeElement : null);

  useEffect(() => {
    const first = dialog.current?.querySelector<HTMLElement>(focusableSelector);
    (first ?? dialog.current)?.focus();
    // After unmount the page is no longer inert, so the opener can take focus back.
    return () => { if (opener?.isConnected) window.requestAnimationFrame(() => opener.focus()); };
  }, [opener]);

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") { event.stopPropagation(); close.current(); return; }
    if (event.key !== "Tab" || !dialog.current) return;
    const items = [...dialog.current.querySelectorAll<HTMLElement>(focusableSelector)].filter(element => element.getClientRects().length > 0);
    if (!items.length) { event.preventDefault(); return; }
    const first = items[0], last = items[items.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) close.current(); }}>
    <section ref={dialog} className={className} role="dialog" aria-modal="true" aria-labelledby={labelledBy} tabIndex={-1} onKeyDown={onKeyDown}>{children}</section>
  </div>;
}

/** An in-app replacement for `window.confirm`, styled and announced like the rest of the app. */
export function ConfirmDialog({ title, body, confirmLabel, onConfirm, onCancel }: { title: string; body: ReactNode; confirmLabel: string; onConfirm: () => void; onCancel: () => void }) {
  const titleId = useId();
  return <Modal className="age-modal confirm-modal" labelledBy={titleId} onClose={onCancel}>
    <h2 id={titleId}>{title}</h2>
    <p>{body}</p>
    <div className="age-actions">
      <button className="button button-quiet" type="button" onClick={onCancel}>Cancel</button>
      <button className="button button-danger" type="button" onClick={onConfirm}>{confirmLabel}</button>
    </div>
  </Modal>;
}
