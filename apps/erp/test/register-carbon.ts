// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { registerCarbon } from "@carbon/api/carbon.server";
import { createServiceContext } from "@carbon/api/service-fn.server";

/**
 * A route test that mocks building blocks and runs a loader: the loader reads
 * through `carbonFor(auth)`, so the modules it calls must be registered
 * (`registerTestCarbon({ sales })`, a namespace import of `sales.server`).
 * The gate is not under test, so the caller acts as the system, with the
 * route's own client as its caller client.
 */
export function registerTestCarbon(modules: object) {
  registerCarbon({
    router: modules as never,
    context: (auth) =>
      createServiceContext({
        actor: { type: "system", onBehalfOf: auth.userId ?? "user" },
        company: { id: auth.companyId, groupId: auth.companyGroupId ?? "" },
        caller: auth.client,
        system: () => auth.client,
        pg: () => {
          throw new Error("route tests have no database");
        },
        kv: () => {
          throw new Error("route tests have no kv");
        }
      })
  });
}
