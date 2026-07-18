import { useEffect } from "react";
import { useNavigate } from "react-router";
import { navigateBlock } from "../../agent.blocks";
import { resolvePage } from "../../agent.pages";

// Fire-once guard across re-renders/remounts. navigate parts are never persisted,
// so history reconstruction never contains them → they can't re-fire on reload.
const fired = new Set<string>();

export function AgentNavigate({
  input,
  state,
  toolCallId
}: {
  input: unknown;
  state: string;
  toolCallId: string;
}) {
  const navigate = useNavigate();
  useEffect(() => {
    if (fired.has(toolCallId)) return;
    // Only act once the input has FULLY streamed in. Firing during "input-streaming"
    // uses a truncated id (e.g. "6uApsOM" of "6uApsOMhi3YiEVlme6o3I") → a dead route.
    if (state !== "input-available" && state !== "output-available") return;
    const parsed = navigateBlock.safeParse(input);
    if (!parsed.success) return;
    const dest = resolvePage(parsed.data.key, parsed.data.params);
    if (!dest) return; // unknown/unsafe key → no-op rather than a broken route
    fired.add(toolCallId);
    navigate(dest);
  }, [input, state, toolCallId, navigate]);
  return null;
}
