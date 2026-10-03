// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useLocalSearchParams } from "expo-router";
import { InspectionView } from "~/features/inspection/InspectionView";
import { backOrBoard } from "~/lib/navigation/backOrBoard";

/**
 * An inspection operation, addressed by the OPERATION id — as on the web,
 * where the route is `/x/inspection/$operationId`. The lot is found or created
 * by the read itself, so the operation is the only id a caller has.
 *
 * Outside the tabs on purpose. An inspection fills the screen and the dock,
 * and it is reached from an operation rather than browsed to, so a tab bar
 * under it would offer a way out of a half-recorded lot that looks like part
 * of the screen.
 */
export default function InspectionRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <InspectionView operationId={id ?? ""} onBack={backOrBoard} />;
}
