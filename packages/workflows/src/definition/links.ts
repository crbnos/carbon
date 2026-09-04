import type { CatalogInput, LinkFormat } from "./catalog";
import type { IntegrationNode } from "./schema";

/** Whether records in one integration input will render as links, and in what dialect.
 * `gated` means they would, if the named sibling held one of `equals`. */
export type LinkState =
  | { kind: "linked"; format: LinkFormat }
  | { kind: "gated"; gate: { input: string; equals: readonly string[] } }
  | { kind: "off" };

/** The value the run will send for a sibling input: the node's stored literal, else
 * the declaration's default (which carries the allowlist pins). A variable-valued
 * sibling yields undefined — links stay OFF rather than guessed. */
function effectiveLiteral(
  node: IntegrationNode,
  declared: Record<string, CatalogInput>,
  name: string
): string | number | boolean | undefined {
  const stored = node.data.inputs[name];
  if (stored?.kind === "literal" && !Array.isArray(stored.value)) {
    return stored.value as string | number | boolean;
  }
  if (stored !== undefined) return undefined;
  const fallback = declared[name]?.defaultValue;
  return typeof fallback === "object" ? undefined : fallback;
}

/**
 * The one verdict on whether `name` linkifies, read by BOTH the executor
 * (`runtime/integration.ts`) and the builder's hints (`notices.ts`) — the hint and
 * the run agree because they cannot ask separately. `declared` is the step's
 * `inputs` and `advancedInputs` merged.
 */
export function linkState(
  node: IntegrationNode,
  declared: Record<string, CatalogInput>,
  name: string
): LinkState {
  const links = declared[name]?.links;
  if (links === undefined) return { kind: "off" };
  const gate = links.when;
  if (gate === undefined) return { kind: "linked", format: links.format };
  const held = effectiveLiteral(node, declared, gate.input);
  if (gate.equals.includes(String(held ?? ""))) {
    return { kind: "linked", format: links.format };
  }
  return { kind: "gated", gate };
}
