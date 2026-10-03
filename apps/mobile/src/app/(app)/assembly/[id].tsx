// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useLocalSearchParams } from "expo-router";
import { AssemblyView } from "~/features/assembly/AssemblyView";
import { backOrBoard } from "~/lib/navigation/backOrBoard";

/**
 * An assembly operation, addressed by the OPERATION id — as on the web, where
 * the route is `/x/assembly/$operationId`.
 *
 * Outside the tabs, like the inspection screen and for the same reason: an
 * assembly fills the screen and the dock, and it is reached from an operation
 * rather than browsed to, so a tab bar under it would cost the work a row and
 * offer a way out that looks like part of the screen.
 */
export default function AssemblyRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <AssemblyView operationId={id ?? ""} onBack={backOrBoard} />;
}
