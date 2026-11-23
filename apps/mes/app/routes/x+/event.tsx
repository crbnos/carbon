// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { getDatabaseClient } from "~/services/database.server";
import { productionEventAction } from "~/services/production-event.server";
import { generateFirstArticlesForStartedJob } from "~/services/quality.server";
import { assignSerialNumberOnFirstTouch } from "~/services/serial-number.server";
import { path, requestReferrer } from "~/utils/path";

export async function action(args: ActionFunctionArgs) {
  const result = await startOrEnd(args);
  // A press before the page hydrates submits the start/stop form as a full
  // page POST, which would leave the operator on this resource route with a
  // bare JSON body. Send them back to the page they came from, keeping the
  // flash cookie, so the outcome shows as a toast there.
  if (args.request.headers.get("Sec-Fetch-Mode") === "navigate") {
    const headers =
      result instanceof Response ? result.headers : result.init?.headers;
    throw redirect(requestReferrer(args.request) ?? path.to.operations, {
      headers
    });
  }
  return result;
}

async function startOrEnd({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {});
  return productionEventAction(
    {
      client,
      serviceRole: getCarbonServiceRole(),
      db: getDatabaseClient,
      permitted: async (permission) => {
        try {
          await requirePermissions(request, permission);
          return true;
        } catch (thrown) {
          if (thrown instanceof Response) return false;
          throw thrown;
        }
      },
      numberUnit: assignSerialNumberOnFirstTouch,
      generateFirstArticles: generateFirstArticlesForStartedJob
    },
    { request, companyId, userId }
  );
}
