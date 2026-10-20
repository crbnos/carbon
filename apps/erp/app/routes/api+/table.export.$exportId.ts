// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import {
  fileResponseHeaders,
  isStorageNotFound,
  storageErrorStatus,
  TEMP_STAGING_BUCKET
} from "@carbon/files";
import { CSV_CONTENT_TYPE } from "@carbon/files/csv";
import { tableExportStorageKey } from "@carbon/jobs/inngest";
import { getLogger } from "@carbon/logger";
import type { LoaderFunctionArgs } from "react-router";
import { getListDefinition } from "~/utils/list-registry/index.server";
import { parseTableExportId } from "~/utils/table-jobs";

const logger = getLogger("erp", "table-export-download");

export const config = {
  runtime: "nodejs"
};

/**
 * GET — downloads a background export (`table.export.ts`). The file lives at
 * `{companyId}/exports/{userId}/{exportId}.csv`, and the key is built from the
 * session, so a user only ever reaches their own exports of the active
 * company. The list's permission is checked again: a user who lost access to
 * the list since the export no longer gets its rows.
 */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const exportId = params.exportId ?? "";
  const parsed = parseTableExportId(exportId);
  const definition = parsed ? getListDefinition(parsed.listKey) : undefined;
  if (!parsed || !definition) {
    logger.error("Refused a table export download for an unknown export", {
      exportId
    });
    throw new Response("This export could not be found.", { status: 404 });
  }

  const { companyId, userId } = await requirePermissions(request, {
    ...definition.permission,
    role: "employee"
  });

  const key = tableExportStorageKey(companyId, userId, exportId);
  const file = await getCarbonServiceRole()
    .storage.from(TEMP_STAGING_BUCKET)
    .download(key);
  if (file.error) {
    const notFound = await isStorageNotFound(file.error);
    logger.error("Failed to download a table export", {
      companyId,
      key,
      status: storageErrorStatus(file.error),
      error: file.error
    });
    if (notFound) {
      // The nightly cleanup deletes exports after 7 days.
      throw new Response(
        "This export could not be found. Exports are kept for 7 days.",
        { status: 404 }
      );
    }
    throw new Response(null, { status: 500 });
  }

  const headers = fileResponseHeaders(CSV_CONTENT_TYPE, "private, no-store");
  headers.set(
    "Content-Disposition",
    `attachment; filename="${parsed.listKey}.csv"`
  );
  return new Response(file.data, { status: 200, headers });
}
