// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { type Check, checksOf } from "./check";
import { checks as accounting } from "./conformance/accounting";
import { checks as authz } from "./conformance/authz";
import { checks as dataAccess } from "./conformance/data-access";
import { checks as drift } from "./conformance/drift";
import { checks as licensing } from "./conformance/licensing";
import { checks as migrations } from "./conformance/migrations";
import { checks as modules } from "./conformance/modules";
import { checks as numbers } from "./conformance/numbers";
import { checks as routes } from "./conformance/routes";
import * as server from "./conformance/server";
import { checks as tests } from "./conformance/tests";
import { checks as ui } from "./conformance/ui";

/**
 * Every conformance check, by subject. A check is registered in the `checks`
 * list at the end of its subject's file, or, in a file that exports only
 * checks, by being exported (`checksOf`); a new subject is one line here.
 */
export const CHECKS: Check[] = [
  ...accounting,
  ...authz,
  ...dataAccess,
  ...drift,
  ...licensing,
  ...migrations,
  ...modules,
  ...numbers,
  ...routes,
  ...checksOf(server),
  ...tests,
  ...ui
];
