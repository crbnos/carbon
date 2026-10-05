// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { router, useLocalSearchParams } from "expo-router";
import { OperationDetailView } from "~/features/operations/OperationDetailView";

/**
 * The operation screen, as its own route.
 *
 * It sits OUTSIDE the tabs, like `assembly/[id]` and `inspection/[id]`, and
 * for the same reason: an operator on a job is on that job, and a nav rail
 * offering five other places is not what the screen is for. That is also
 * what let the three queues become tabs of their own — they were trapped
 * inside a stack whose only other member was this route.
 *
 * (An earlier version of this comment said a landscape tablet renders
 * `OperationDetailView` beside the list instead of pushing this route. It
 * does not, and never did: nothing but this file imports that component.)
 */
export default function OperationDetailRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <OperationDetailView operationId={id ?? ""} onBack={() => router.back()} />
  );
}
