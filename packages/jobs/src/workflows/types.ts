import type { Origin, RunTrigger } from "@carbon/workflows";

/** A workflowTriggerEvent row joined to its workflow's owner. */
export type Subscriber = {
  workflowId: string;
  workflowVersionId: string;
  eventId: string;
  origin: Origin;
  ownerId: string;
};

/** `workflowId` is null only when the causing run row has been purged. */
export type CausingRun = {
  id: string;
  workflowId: string | null;
  rootRunId: string | null;
  depth: number;
  path: string[];
};

/** The chain-tracking columns for the run(s) an announcement creates. */
export type RunTrace = {
  rootRunId: string | null;
  causedByRunId: string | null;
  depth: number;
  path: string[];
};

export type MatchInput = {
  companyId: string;
  workflowRunId: string | null;
  sourceEventId: string;
  eventIds: string[];
  trigger: RunTrigger;
  triggerTable: string | null;
  triggerRecordId: string | null;
};
