// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import type { CatalogInput, LinkFormat } from "./catalog";
import type { ValueOrRef } from "./types";

/** Whether records in one step input will render as links, and in what dialect.
 * `gated` means they would, if the named sibling held one of `equals`. */
export type LinkState =
  | { kind: "linked"; format: LinkFormat }
  | { kind: "gated"; gate: { input: string; equals: readonly string[] } }
  | { kind: "off" };

/** The value the run will send for a sibling input: the node's stored literal, else
 * the declaration's default (which carries the allowlist pins). A variable-valued
 * sibling yields undefined — links stay OFF rather than guessed. */
function effectiveLiteral(
  inputs: Record<string, ValueOrRef>,
  declared: Record<string, CatalogInput>,
  name: string
): string | number | boolean | undefined {
  const stored = inputs[name];
  if (stored?.kind === "literal" && !Array.isArray(stored.value)) {
    return stored.value as string | number | boolean;
  }
  if (stored !== undefined) return undefined;
  const fallback = declared[name]?.defaultValue;
  return typeof fallback === "object" ? undefined : fallback;
}

/**
 * The one verdict on whether `name` linkifies, read by BOTH the executors
 * (`resolveStepInputs`) and the builder's hints (`notices.ts`) — the hint and the
 * run agree because they cannot ask separately. `inputs` are the node's stored
 * values; `declared` is every input the step declares (an integration's `inputs`
 * and `advancedInputs` merged).
 */
export function linkState(
  inputs: Record<string, ValueOrRef>,
  declared: Record<string, CatalogInput>,
  name: string
): LinkState {
  const links = declared[name]?.links;
  if (links === undefined) return { kind: "off" };
  const gate = links.when;
  if (gate === undefined) return { kind: "linked", format: links.format };
  const held = effectiveLiteral(inputs, declared, gate.input);
  if (gate.equals.includes(String(held ?? ""))) {
    return { kind: "linked", format: links.format };
  }
  return { kind: "gated", gate };
}
