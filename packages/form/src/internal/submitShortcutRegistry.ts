/**
 * Registry of Submit buttons currently mounted with an ACTIVE save shortcut,
 * in mount order, each with the <form> it submits. The focus-aware guard uses
 * it two ways: `count === 1` decides whether the no-focus fallback may fire
 * (ambiguity means no-op, never "submit them all"), and first-mounted-wins
 * picks ONE owner when a single form has several active Submits — otherwise
 * one ⌘Enter would click every submit button in the form.
 * Module-level because the shortcut is a document-level concern; only touched
 * from effects, so it never runs during SSR.
 */
const registry = new Map<symbol, HTMLFormElement | null>();

export function registerSubmitShortcut(
  id: symbol,
  form: HTMLFormElement | null
) {
  registry.set(id, form);
}

export function unregisterSubmitShortcut(id: symbol) {
  registry.delete(id);
}

export function submitShortcutCount() {
  return registry.size;
}

/** Is `id` the first-mounted active Submit registered for `form`? */
export function isSubmitShortcutOwner(
  id: symbol,
  form: HTMLFormElement | null
): boolean {
  if (!form) return false;
  for (const [key, value] of registry) {
    if (value === form) return key === id;
  }
  return false;
}

/**
 * Pure decision core for the save-shortcut guard — exported for tests.
 * Truth table (see the spec's acceptance criteria):
 * - focus inside a form → fire only for that form's OWNER Submit (the
 *   first-mounted active one, so a form with "Save" + "Save & continue"
 *   submits once, not twice)
 * - focus in any other editable surface (agent chat textarea, ProseMirror…) → never
 * - focus on a non-editable element/body → fire only the sole active Submit
 */
export function shouldSubmitOnShortcut(args: {
  ownForm: object | null;
  activeForm: object | null;
  activeIsEditable: boolean;
  activeSubmitCount: number;
  ownsForm: boolean;
}): boolean {
  const { ownForm, activeForm, activeIsEditable, activeSubmitCount, ownsForm } =
    args;
  if (activeForm) {
    return activeForm === ownForm && ownForm !== null && ownsForm;
  }
  if (activeIsEditable) return false;
  return activeSubmitCount === 1;
}
