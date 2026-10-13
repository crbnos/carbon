// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import type { Database } from "@carbon/database";

// Row types derive from the generated database types only. This file never
// imports a server file, so the client-safe barrel stays out of the server
// graph (commercial-licensing.md, "Bundling gotcha").

type Tables = Database["public"]["Tables"];

export type IndirectPool = Tables["indirectPool"]["Row"];
export type IndirectPoolAccount = Tables["indirectPoolAccount"]["Row"];
export type IndirectRate = Tables["indirectRate"]["Row"];
export type IndirectExpenseStatementLine =
  Tables["indirectExpenseStatement"]["Row"];
export type IndirectRateRun = Tables["indirectRateRun"]["Row"];
export type CustomerContractRateCeiling =
  Tables["customerContractRateCeiling"]["Row"];
