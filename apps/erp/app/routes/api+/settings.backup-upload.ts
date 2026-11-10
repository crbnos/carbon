// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { getLogger } from "@carbon/logger";
import type { ActionFunctionArgs } from "react-router";
import {
  isStagedBackupPath,
  requireBackupAccess,
  signBackupStaging,
  unpackStagedBackupArchive
} from "~/modules/settings/settings.service";

const logger = getLogger("erp", "settings-backup-upload");

/**
 * Two-step upload of a `.carbon.tar.gz` (a whole backup folder):
 *
 * 1. `intent=sign` — mint a presigned upload URL; the browser PUTs the archive
 *    straight to storage, so the bytes never pass through this function (a
 *    Vercel-hosted target caps the request body).
 * 2. `intent=unpack` — stream the staged archive back and unpack it into a fresh
 *    backup folder so the normal restore/import finds it, then drop the staged
 *    object. Returns the folder name.
 */
export async function action({ request }: ActionFunctionArgs) {
  const { companyId } = await requireBackupAccess(request);
  if (request.method !== "POST") {
    throw new Response("Method not allowed", { status: 405 });
  }

  const formData = await request.formData();
  const intent = formData.get("intent");
  const serviceRole = getCarbonServiceRole();
  const prefix = `${companyId}/backups`;

  if (intent === "sign") {
    try {
      return await signBackupStaging(serviceRole, prefix);
    } catch (err) {
      logger.error("Failed to create backup upload URL", {
        companyId,
        error: err
      });
      throw new Response((err as Error).message, { status: 500 });
    }
  }

  if (intent === "unpack") {
    const path = formData.get("path");
    if (!isStagedBackupPath(path, prefix)) {
      logger.error("Rejected backup archive path", { companyId, path });
      throw new Response("Invalid path", { status: 400 });
    }
    try {
      return await unpackStagedBackupArchive(serviceRole, companyId, path);
    } catch (err) {
      logger.error("Failed to unpack uploaded backup", {
        companyId,
        path,
        error: err
      });
      throw new Response((err as Error).message, { status: 400 });
    }
  }

  throw new Response("Unknown intent", { status: 400 });
}
