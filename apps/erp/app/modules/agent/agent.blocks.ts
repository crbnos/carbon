import { z } from "zod";

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
// Only allow safe link targets: absolute http(s) URLs or root-relative in-app paths.
// Blocks javascript:/data:/vbscript: and other script-bearing schemes the model could emit.
const safeUrl = z.string().refine(
  (u) => {
    if (u.startsWith("/")) return true; // in-app relative link
    try {
      const { protocol } = new URL(u);
      return protocol === "http:" || protocol === "https:";
    } catch {
      return false;
    }
  },
  { message: "Unsafe or invalid URL" }
);

export const linkBlock = z.object({ label: z.string(), url: safeUrl });
export const buttonBlock = z.object({ label: z.string(), message: z.string() });

// navigate never takes a freehand URL. The model discovers a page with `find_page` and sends
// back its `key` (a `path.to` key) plus any `params` (e.g. a record id it looked up). The
// client resolves that key against the generated page manifest (agent.pages.ts) — an unknown
// key or one outside the safe /x page set simply no-ops. See agent.pages.ts for the allowlist.
export const navigateBlock = z.object({
  key: z.string().min(1),
  // Positional args the page needs, in order — usually a single record id. Omit for a page
  // that takes none (a list/module page).
  params: z.array(z.string()).optional(),
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
