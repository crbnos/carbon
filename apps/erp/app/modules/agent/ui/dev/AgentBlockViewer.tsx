import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  IconButton
} from "@carbon/react";
import type { UIMessage } from "ai";
import { LuFlaskConical } from "react-icons/lu";
import { BLOCK_FIXTURES, type BlockFixture } from "./blockFixtures";

// Dev-only: inject a synthetic assistant message so we can preview any UI block while
// developing. Flows through the identical render path (no backend, no special-casing).
export function AgentBlockViewer({
  setMessages
}: {
  setMessages: (updater: (prev: UIMessage[]) => UIMessage[]) => void;
}) {
  if (!import.meta.env.DEV) return null;

  function inject(fixture: BlockFixture) {
    const rand = () => Math.random().toString(36).slice(2, 8);
    const msg = {
      id: `preview-${fixture.label}-${rand()}`,
      role: "assistant",
      parts: [
        { type: "text", text: `**[${fixture.label}]** preview` },
        ...fixture.blocks.map((b) => ({
          type: `tool-${b.toolName}`,
          toolCallId: `prev-${rand()}`,
          state: "output-available",
          input: b.input,
          output: { shown: true }
        }))
      ]
    } as unknown as UIMessage;
    setMessages((prev) => [...prev, msg]);
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton
          aria-label="Preview UI blocks (dev)"
          icon={<LuFlaskConical />}
          variant="ghost"
          size="sm"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {BLOCK_FIXTURES.map((f) => (
          <DropdownMenuItem key={f.label} onSelect={() => inject(f)}>
            {f.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
