import { Status } from "@carbon/react";
import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";

type RunStatusValue =
  | "Succeeded"
  | "Failed"
  | "Running"
  | "Queued"
  | "Blocked"
  | "Skipped";

type StepStatusValue = "Running" | "Succeeded" | "Failed" | "Skipped";

const RUN_COLOR_MAP: Record<
  RunStatusValue,
  "green" | "red" | "blue" | "gray" | "orange" | "purple"
> = {
  Succeeded: "green",
  Failed: "red",
  Running: "blue",
  Queued: "gray",
  Blocked: "orange",
  Skipped: "purple"
};

const STEP_COLOR_MAP: Record<
  StepStatusValue,
  "green" | "red" | "blue" | "purple"
> = {
  Running: "blue",
  Succeeded: "green",
  Failed: "red",
  Skipped: "purple"
};

const RUN_LABEL_MAP: Record<RunStatusValue, MessageDescriptor> = {
  Succeeded: msg`Succeeded`,
  Failed: msg`Failed`,
  Running: msg`Running`,
  Queued: msg`Queued`,
  Blocked: msg`Blocked`,
  Skipped: msg`Skipped`
};

const STEP_LABEL_MAP: Record<StepStatusValue, MessageDescriptor> = {
  Running: msg`Running`,
  Succeeded: msg`Succeeded`,
  Failed: msg`Failed`,
  Skipped: msg`Skipped`
};

export function RunStatus({ status }: { status: string }) {
  const { t } = useLingui();
  const s = status as RunStatusValue;
  const color = RUN_COLOR_MAP[s] ?? "gray";
  const label = RUN_LABEL_MAP[s] ? t(RUN_LABEL_MAP[s]) : status;
  return <Status color={color}>{label}</Status>;
}

/** A test run really happened and really wrote, so it sits in the same list — this
 * is what stops it being read as production traffic. */
export function TestRunBadge() {
  const { t } = useLingui();
  return <Status color="yellow">{t`Test`}</Status>;
}

export function StepStatus({ status }: { status: string }) {
  const { t } = useLingui();
  const s = status as StepStatusValue;
  const color = STEP_COLOR_MAP[s] ?? "gray";
  const label = STEP_LABEL_MAP[s] ? t(STEP_LABEL_MAP[s]) : status;
  return <Status color={color}>{label}</Status>;
}
