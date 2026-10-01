// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

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
