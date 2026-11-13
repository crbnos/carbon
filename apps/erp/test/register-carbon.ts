// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { bindServiceFns } from "@carbon/api/carbon.server";
import { createServiceContext } from "@carbon/api/service-fn.server";

let router: object = {};

/**
 * A route test that mocks `authorize` and building blocks and runs a loader:
 * the loader reads through `api`, so register the modules it calls
 * (`registerTestCarbon({ sales })`, a namespace import of `sales.server`), and
 * return `withTestApi(caller)` from the mocked `authorize`.
 */
export function registerTestCarbon(modules: object) {
  router = modules;
}

/**
 * What a mocked `authorize` returns: `auth` with `api` bound to the registered
 * modules. The gate is not under test, so the caller acts as the system, with
 * the route's own client as its caller client.
 */
export function withTestApi<
  A extends { client: unknown; companyId: string; companyGroupId?: string; userId?: string }
>(auth: A) {
  const client = auth.client as never;
  return {
    ...auth,
    api: bindServiceFns(
      router,
      createServiceContext({
        actor: { type: "system", onBehalfOf: auth.userId ?? "user" },
        company: { id: auth.companyId, groupId: auth.companyGroupId ?? "" },
        caller: client,
        system: () => client,
        pg: () => {
          throw new Error("route tests have no database");
        },
        kv: () => {
          throw new Error("route tests have no kv");
        }
      })
    )
  };
}
