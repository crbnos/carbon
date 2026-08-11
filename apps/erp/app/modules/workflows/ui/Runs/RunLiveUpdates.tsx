import { useDebouncedRealtime } from "~/hooks/useDebouncedRealtime";

export function RunsLiveUpdates({ companyId }: { companyId: string }) {
  useDebouncedRealtime("workflowRun", `companyId=eq.${companyId}`);
  return null;
}

export function RunLiveUpdates({ runId }: { runId: string }) {
  useDebouncedRealtime("workflowStepRun", `runId=eq.${runId}`);
  useDebouncedRealtime("workflowRun", `id=eq.${runId}`);
  return null;
}
