import { useShortcutKeys } from "@carbon/react";
import { useEffect } from "react";
import { useAgentStore } from "~/stores/agent";
import { useAgentAvailable } from "../hooks/useAgentAvailable";
import { AgentPanel } from "./AgentPanel";

/**
 * Always-mounted host for the in-app agent: renders the chat panel when open and
 * owns the ⌘L shortcut. The trigger that opens it ("Ask Carbon") lives in the top
 * bar — see `components/Layout/Topbar/AskDocs.tsx`.
 */
export function AgentRoot() {
  const isOpen = useAgentStore((s) => s.isOpen);
  const toggleAgent = useAgentStore((s) => s.toggleAgent);
  const available = useAgentAvailable();

  // Restore the persisted open state + last thread from sessionStorage. Deferred to
  // this client effect (store uses skipHydration) so SSR and first render agree.
  useEffect(() => {
    void useAgentStore.persist.rehydrate();
  }, []);

  useShortcutKeys({
    shortcut: { key: "L", modifiers: ["mod"] },
    action: () => toggleAgent(),
    disabled: !available,
    enabledOnInputElements: true
  });

  if (!available) return null;
  return isOpen ? <AgentPanel /> : null;
}
