// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { LoaderFunctionArgs } from "react-router";
import {
  isUserBackupName,
  packBackupArchive,
  requireBackupAccess
} from "~/modules/settings/settings.service";

/** Download a backup as a self-contained `.carbon.tar.gz`. */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { companyId } = await requireBackupAccess(request);

  const name = params.file ?? "";
  if (!isUserBackupName(name)) {
    throw new Response("Invalid backup", { status: 400 });
  }
  // Backup objects are service-role only; the gate above guards this route.
  const stream = await packBackupArchive(
    getCarbonServiceRole(),
    companyId,
    name
  );
  if (!stream) throw new Response("Backup not found", { status: 404 });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "application/gzip",
      "Content-Disposition": `attachment; filename="${name}.carbon.tar.gz"`
    }
  });
}
