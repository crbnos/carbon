import { z } from "zod";
import { path } from "~/utils/path";

// Input schemas for the agent's UI-block tools. Each schema IS the block's data shape,
// validated by the AI SDK when the model calls the tool.
export const choiceBlock = z.object({
  prompt: z.string().optional(),
  options: z
    .array(z.object({ id: z.string(), label: z.string(), value: z.string() }))
    .min(1),
  multiSelect: z.boolean().optional(),
  allowFreeText: z.boolean().optional(),
  freeTextPlaceholder: z.string().optional()
});
export const linkBlock = z.object({ label: z.string(), url: z.string() });
export const buttonBlock = z.object({ label: z.string(), message: z.string() });

// navigate never takes a freehand path — the model picks a known entity + a real id
// (from a read tool) and we build the actual route via `path.to` (the single source of
// truth for URLs). This is the ONE curated allowlist of navigable record types; the enum
// and the client-side path builder both derive from it, so there's nothing to keep in sync.
export const NAVIGABLE = {
  part: path.to.part,
  job: path.to.job,
  salesOrder: path.to.salesOrder,
  purchaseOrder: path.to.purchaseOrder,
  quote: path.to.quote,
  supplier: path.to.supplier,
  customer: path.to.customer
} as const;

export type NavigableEntity = keyof typeof NAVIGABLE;

export const navigateBlock = z.object({
  entity: z.enum(
    Object.keys(NAVIGABLE) as [NavigableEntity, ...NavigableEntity[]]
  ),
  id: z.string().min(1), // reject empty ids → path.to.x("") would build a broken "/x/part" route
  label: z.string().optional()
});

export type ChoiceBlock = z.infer<typeof choiceBlock>;
export type LinkBlock = z.infer<typeof linkBlock>;
export type ButtonBlock = z.infer<typeof buttonBlock>;
export type NavigateBlock = z.infer<typeof navigateBlock>;

// Tool names that render as rich UI blocks (vs the quiet read-tool step line).
export const UI_BLOCK_TOOLS = [
  "present_choice",
  "present_link",
  "present_button",
  "navigate"
] as const;

// Ephemeral tools: never persisted, fire-once, never replayed on history load.
export const EPHEMERAL_TOOLS = new Set<string>(["navigate"]);

export const isEphemeralTool = (name: string) => EPHEMERAL_TOOLS.has(name);
export const isUiBlockTool = (name: string) =>
  (UI_BLOCK_TOOLS as readonly string[]).includes(name);
