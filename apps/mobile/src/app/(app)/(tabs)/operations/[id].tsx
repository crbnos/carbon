// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { router, useLocalSearchParams } from "expo-router";
import { OperationDetailView } from "~/features/operations/OperationDetailView";

/**
 * The operation screen as its own route — a phone, a portrait tablet, and
 * anything reached by a scan or a deep link.
 *
 * On a landscape tablet the operations list renders `OperationDetailView`
 * beside itself instead of pushing this route, so the screen exists in one
 * place and the two layouts cannot disagree about what Start does.
 */
export default function OperationDetailRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <OperationDetailView operationId={id ?? ""} onBack={() => router.back()} />
  );
}
