import { IconButton, useShortcutKeys } from "@carbon/react";
import { LuSparkles } from "react-icons/lu";
import { useCompanySettings } from "~/hooks/useCompanySettings";
import { usePlanGate } from "~/hooks/usePlanGate";
import { useAgentStore } from "~/stores/agent";
import { AgentPanel } from "./AgentPanel";

export function AgentBubble() {
  const isOpen = useAgentStore((s) => s.isOpen);
  const toggleAgent = useAgentStore((s) => s.toggleAgent);

  // Mirror the server gate: hide the agent entirely when the company's plan doesn't
  // include it (usePlanGate) or an admin turned it off — so users never see a bubble
  // that would 402/403 on send. Matches how AuditLog etc. gate their UI.
  const settings = useCompanySettings();
  const { isGated } = usePlanGate({ feature: "AI_AGENT" });
  const unavailable = isGated || settings?.aiAgentEnabled === false;

  useShortcutKeys({
    shortcut: { key: "L", modifiers: ["mod"] },
    action: () => toggleAgent(),
    disabled: unavailable,
    enabledOnInputElements: true
  });

  if (unavailable) return null;

  return (
    <>
      {isOpen && <AgentPanel />}
      {!isOpen && (
        <IconButton
          aria-label="Open assistant (⌘L)"
          icon={<LuSparkles />}
          variant="primary"
          size="lg"
          className="fixed bottom-4 right-4 z-40 rounded-full shadow-lg"
          onClick={() => toggleAgent()}
        />
      )}
    </>
  );
}
