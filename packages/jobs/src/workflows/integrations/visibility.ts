import { type AllowlistPropOverride, PIECE_ALLOWLIST } from "./allowlist";
import type { PieceProperty } from "./types";

/**
 * Which of a piece's props a person actually sees.
 *
 * A vendor writes props for its OWN builder, so an action arrives carrying API
 * trivia beside the two or three fields that are a real business decision. The
 * rules below are generic — they cost nothing per action and apply to every piece
 * we ever add. The allowlist's per-action overrides are the rare exception, for a
 * default that is WRONG for us rather than merely uninteresting.
 *
 * Nothing is ever lost: a hidden input is emitted as `advancedInputs` and rendered
 * in the node's Advanced section, so being wrong here costs a click, not a release.
 */

export type Visibility =
  | { show: true }
  /** Hidden, and this value is merged in at run time. */
  | { show: false; omit?: false; value?: unknown }
  /** Not part of the step at all — neither the form nor Advanced. */
  | { show: false; omit: true; value?: unknown };

/** A dropdown with exactly one possible answer is not a choice. */
/** The one value a single-option dropdown can hold, or undefined when it has more
 * (or fewer) than one. There is nothing to decide, so the field is hidden — but the
 * value still has to be SENT, exactly as a required default is. */
function singleChoiceValue(property: PieceProperty): unknown {
  const options = property.options;
  if (typeof options !== "object" || options === null) return undefined;
  const list = (options as { options?: readonly unknown[] }).options;
  if (!Array.isArray(list) || list.length !== 1) return undefined;
  const only = list[0];
  return typeof only === "object" && only !== null && "value" in only
    ? (only as { value: unknown }).value
    : undefined;
}

export function visibilityOf(
  property: PieceProperty,
  override: AllowlistPropOverride | undefined
): Visibility {
  // Tier 2 — a reviewed decision for this exact action.
  // Display-only: Activepieces `Property.MarkDown` renders text and never collects a
  // value, so there is no input to offer.
  if (property.type === "MARKDOWN") return { show: false, omit: true };
  if (override?.omit === true) {
    return override.value === undefined
      ? { show: false, omit: true }
      : { show: false, omit: true, value: override.value };
  }
  if (override?.hidden === true) {
    return override.value === undefined
      ? { show: false }
      : { show: false, value: override.value };
  }

  // Tier 1 — generic, derived, no per-action data.
  // Required with a default the vendor already chose: nothing for a person to
  // decide, so hide it — but SEND the default rather than omitting the prop.
  // `defaultValue` is what a piece pre-fills its own FORM with; nothing applies it
  // at run time, and `run()` destructures `propsValue` and uses the field directly.
  // Omitting it handed Google Calendar's get-events `event_types: undefined` and it
  // died on `event_types.length` — an unreadable vendor crash for a field the
  // author was never shown.
  if (property.required === true && property.defaultValue !== undefined) {
    return { show: false, value: property.defaultValue };
  }
  // A dropdown with exactly one option decides itself. Hiding it WITHOUT the value
  // hard-failed catalog generation for any required prop of this shape, for a case
  // the code already knows the answer to.
  const only = singleChoiceValue(property);
  if (only !== undefined) return { show: false, value: only };

  return { show: true };
}

/**
 * A required prop hidden with no value to send — from us OR from the piece — would
 * make the vendor call go out incomplete and fail in front of a customer. Refuse at
 * build time instead.
 */
export function assertHiddenPropIsSatisfied(
  piece: string,
  action: string,
  name: string,
  property: PieceProperty,
  visibility: Visibility
): void {
  if (visibility.show) return;
  if (property.required !== true) return;
  // The VALUE is the only thing that satisfies this. A `defaultValue` used to
  // count on its own, on the assumption the piece would apply it — it does not,
  // so that let a hidden required prop reach the vendor as `undefined`.
  // `visibilityOf` now carries the default through as the value, so a prop that
  // has one still passes here, by actually sending it.
  if (visibility.value !== undefined) return;
  throw new Error(
    `${piece}.${action}.${name} is required but hidden or omitted with no value to send.`
  );
}

/**
 * Every value a hidden prop must carry at run time, for one action.
 *
 * Derived from `visibilityOf` rather than restating its rules, so what the form
 * hides and what the call sends can never drift: a prop hidden here with a value
 * is exactly a prop the author was not shown and the vendor still needs. Covers
 * both the allowlist's pins and a vendor `defaultValue` we hid on the author's
 * behalf — a piece applies neither for itself.
 *
 * Not stored on the node, so changing a pin fixes every saved workflow at once.
 */
export function pinnedValues(
  piece: string,
  action: string,
  props: Record<string, PieceProperty> = {}
): Record<string, unknown> {
  const overrides = PIECE_ALLOWLIST[piece]?.props?.[action] ?? {};
  const pinned: Record<string, unknown> = {};

  for (const [name, property] of Object.entries(props)) {
    const visibility = visibilityOf(property, overrides[name]);
    if (!visibility.show && visibility.value !== undefined) {
      pinned[name] = visibility.value;
    }
  }

  // The allowlist's own pins, for every prop `props` did not cover. Callers that
  // have no piece schema to hand pass none at all, so this loop — not the one
  // above — is what carries a reviewed pin in that case.
  //
  // A pin for a prop the piece no longer declares still lands here and is then
  // dropped by `toPropsValue`, which walks the piece's props: you cannot send a
  // field the action has no slot for.
  for (const [name, override] of Object.entries(overrides)) {
    if (override.value !== undefined && !(name in pinned)) {
      pinned[name] = override.value;
    }
  }

  return pinned;
}

/**
 * Props the step must never send from a node value — omitted by the allowlist or
 * display-only. The catalog leaves them out of both input maps, but a node saved
 * before the omit (or a definition posted by hand) can still carry a value for
 * them, and `toPropsValue` lets a node value win. Strip those first; the pin, if
 * any, is still applied.
 */
export function omittedProps(
  piece: string,
  action: string,
  props: Record<string, PieceProperty> = {}
): Set<string> {
  const overrides = PIECE_ALLOWLIST[piece]?.props?.[action] ?? {};
  const omitted = new Set<string>();
  for (const [name, property] of Object.entries(props)) {
    const visibility = visibilityOf(property, overrides[name]);
    if (!visibility.show && visibility.omit === true) omitted.add(name);
  }
  return omitted;
}
