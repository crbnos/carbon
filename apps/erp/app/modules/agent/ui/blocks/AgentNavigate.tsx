import { useEffect } from "react";
import { useNavigate } from "react-router";
import { NAVIGABLE, navigateBlock } from "../../agent.blocks";

// Fire-once guard across re-renders/remounts. navigate parts are never persisted,
// so history reconstruction never contains them → they can't re-fire on reload.
const fired = new Set<string>();

export function AgentNavigate({
  input,
  toolCallId
}: {
  input: unknown;
  toolCallId: string;
}) {
  const navigate = useNavigate();
  useEffect(() => {
    if (fired.has(toolCallId)) return;
    // Safeguard: only a validated, allowlisted entity resolves; anything else no-ops.
    const parsed = navigateBlock.safeParse(input);
    if (!parsed.success) return;
    fired.add(toolCallId);
    navigate(NAVIGABLE[parsed.data.entity](parsed.data.id));
  }, [input, toolCallId, navigate]);
  return null;
}
