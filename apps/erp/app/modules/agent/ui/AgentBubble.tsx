import { IconButton, useShortcutKeys } from "@carbon/react";
import { LuSparkles } from "react-icons/lu";
import { useAgentStore } from "~/stores/agent";
import { AgentPanel } from "./AgentPanel";

export function AgentBubble() {
  const isOpen = useAgentStore((s) => s.isOpen);
  const toggleAgent = useAgentStore((s) => s.toggleAgent);

  useShortcutKeys({
    shortcut: { key: "L", modifiers: ["mod"] },
    action: () => toggleAgent(),
    enabledOnInputElements: true
  });

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
