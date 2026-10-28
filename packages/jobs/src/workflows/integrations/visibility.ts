// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { AllowlistPropOverride } from "./allowlist";
import type { PieceOption, PieceProperty } from "./types";

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

/** A dropdown's options when the piece lists them statically; undefined for a
 * fetched dropdown, or anything else. The one reading of `property.options`. */
export function staticOptions(
  property: PieceProperty
): readonly PieceOption[] | undefined {
  const options = property.options;
  if (typeof options !== "object" || options === null) return undefined;
  return Array.isArray(options.options) ? options.options : undefined;
}

/** The one value a single-option dropdown can hold, or undefined when it has more
 * (or fewer) than one. There is nothing to decide, so the field is hidden — but the
 * value still has to be SENT, exactly as a required default is. */
function singleChoiceValue(property: PieceProperty): unknown {
  const list = staticOptions(property);
  if (list === undefined || list.length !== 1) return undefined;
  const only: unknown = list[0];
  return typeof only === "object" && only !== null && "value" in only
    ? only.value
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
