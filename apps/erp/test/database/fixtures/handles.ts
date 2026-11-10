// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  createServiceContext,
  type ServiceContext
} from "@carbon/api/service-fn.server";
import type { PostingHandles } from "../../../app/modules/shared/shared.service";

/** The handles a fixture's context holds, for a ported posting run as the system. */
export function handlesOf(ctx: {
  db: PostingHandles["db"];
  companyId: string;
  userId: string;
}): PostingHandles {
  return { db: ctx.db, companyId: ctx.companyId, userId: ctx.userId };
}

/** The same caller as a `ServiceContext`: the system actor on behalf of
 *  `ctx.userId`, over `ctx.db`. For a building block or an operation called
 *  directly. It has no Supabase client and no kv: a body that reaches for
 *  one fails the test, as `alwaysPostFixture`'s `service` does. */
export function systemServiceOf(
  ctx: { db: PostingHandles["db"]; companyId: string; userId: string },
  groupId: string
): ServiceContext {
  return createServiceContext({
    actor: { type: "system", onBehalfOf: ctx.userId },
    company: { id: ctx.companyId, groupId },
    caller: unavailable("caller client"),
    system: () => unavailable("service-role client"),
    pg: () => ctx.db,
    kv: () => unavailable("kv")
  });
}

/** A handle a posting body never takes: any use of it fails the test. */
function unavailable(name: string): never {
  return new Proxy({} as never, {
    get() {
      throw new Error(`A posting body has no ${name}`);
    }
  });
}
