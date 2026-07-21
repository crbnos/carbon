import { useCompanySettings } from "~/hooks/useCompanySettings";
import { usePlanGate } from "~/hooks/usePlanGate";

/**
 * Whether the in-app agent ("Ask Carbon") is available to the current company.
 *
 * Mirrors the server gate: the agent is hidden when the company's plan doesn't
 * include it (`usePlanGate`) or an admin turned it off — so the trigger never
 * appears where a send would 402/403. Shared by the topbar trigger (AskDocs)
 * and the always-mounted panel host (AgentRoot).
 */
export function useAgentAvailable(): boolean {
  const settings = useCompanySettings();
  const { isGated } = usePlanGate({ feature: "AI_AGENT" });
  return !isGated && settings?.aiAgentEnabled !== false;
}
