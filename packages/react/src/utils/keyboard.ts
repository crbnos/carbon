/**
 * True when the event target (or given element) is a text-entry surface that
 * owns its own keys: INPUT, TEXTAREA, SELECT, contenteditable, ProseMirror,
 * cmdk list, or an open listbox/menu. Every shortcut hook/guard uses this —
 * never re-implement the check at a call site.
 */
export function isEditableTarget(
  target: EventTarget | Element | null
): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return true;
  if (target.isContentEditable) return true;
  return Boolean(
    target.closest(".ProseMirror, [cmdk-root], [role='listbox'], [role='menu']")
  );
}
