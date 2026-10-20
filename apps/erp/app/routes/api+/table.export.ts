// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { trigger } from "@carbon/jobs";
import { releaseTableJobLock, takeTableJobLock } from "@carbon/jobs/inngest";
import { getLogger } from "@carbon/logger";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { z } from "zod";
import { getListDefinition } from "~/utils/list-registry/index.server";
import {
  newTableExportId,
  TABLE_JOBS_FULL_MESSAGE,
  type TableJobRefusal,
  tableJobBusyMessage,
  tableJobBusyRefusal
} from "~/utils/table-jobs";

const logger = getLogger("erp", "table-export");

export const config = {
  runtime: "nodejs"
};

const exportRequestValidator = z.object({
  listKey: z.string().min(1),
  search: z.string().max(10_000),
  columns: z
    .array(z.object({ key: z.string().min(1), label: z.string() }))
    .min(1)
    .max(500)
});

/**
 * POST `{ listKey, search, columns: [{ key, label }] }` — starts the background
 * CSV export of a registered list (the Table's Download button, past 1,000
 * rows). Answers `{ success: true }`, or `{ error }` with 400 (bad request,
 * unknown list), 409 (an export of the company is already running; the text
 * says how long its lock can still hold) or 500. The file is served by
 * `api+/table.export.$exportId.ts`, to the requester only.
 */
export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);

  const body = exportRequestValidator.safeParse(
    await request.json().catch(() => null)
  );
  if (!body.success) {
    return data(
      {
        error: "The export request is not valid",
        refusal: { code: "not-started" } satisfies TableJobRefusal
      },
      { status: 400 }
    );
  }
  const { listKey, search, columns } = body.data;

  const definition = getListDefinition(listKey);
  if (!definition) {
    logger.error("Export requested for an unknown list", { listKey });
    return data(
      {
        error: "This list cannot be exported",
        refusal: { code: "not-supported" } satisfies TableJobRefusal
      },
      { status: 400 }
    );
  }

  const { companyId, userId } = await requirePermissions(request, {
    ...definition.permission,
    role: "employee"
  });

  const exportId = newTableExportId(listKey);
  const lock = await takeTableJobLock("export", companyId, exportId);
  if (lock.status === "busy") {
    return data(
      {
        error: tableJobBusyMessage("export", lock.retryAfterSeconds),
        refusal: tableJobBusyRefusal("export", lock.retryAfterSeconds)
      },
      { status: 409 }
    );
  }
  if (lock.status === "full") {
    logger.warn("Refused a table export: every table-job slot is taken", {
      companyId,
      listKey
    });
    return data(
      {
        error: TABLE_JOBS_FULL_MESSAGE,
        refusal: { code: "full" } satisfies TableJobRefusal
      },
      { status: 503 }
    );
  }
  if (lock.status === "unavailable") {
    // Fail-open: Inngest's per-company concurrency still runs one at a time.
    logger.warn("Starting a table export without the Redis lock", {
      companyId,
      listKey
    });
  }

  try {
    await trigger("table-export", {
      companyId,
      userId,
      exportId,
      listKey,
      search,
      columns
    });
  } catch (error) {
    logger.error("Failed to start a table export", {
      companyId,
      listKey,
      error
    });
    await releaseTableJobLock("export", companyId, exportId);
    return data(
      {
        error: "The export could not start",
        refusal: { code: "not-started" } satisfies TableJobRefusal
      },
      { status: 500 }
    );
  }

  return data({ success: true });
}
