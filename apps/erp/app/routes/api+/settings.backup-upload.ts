import { Readable } from "node:stream";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { TEMP_STAGING_BUCKET } from "@carbon/files";
import { nanoid } from "nanoid";
import type { ActionFunctionArgs } from "react-router";
import { canManageBackups } from "~/modules/settings/backups.server";
import { unpackBackupArchive } from "~/modules/settings/backups-archive.server";

/**
 * Two-step upload of a `.carbon.tar.gz` (a whole backup folder):
 *
 * 1. `intent=sign` — mint a presigned upload URL; the browser PUTs the archive
 *    straight to storage, so the bytes never pass through this function (a
 *    Vercel-hosted target caps the request body).
 * 2. `intent=unpack` — stream the staged archive back and unpack it into a fresh
 *    `exports/<name>/` so the normal restore/import finds it, then drop the
 *    staged object. Returns the folder name.
 */
export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId, email } = await requirePermissions(request, {
    update: "settings"
  });
  if (!(await canManageBackups(client, companyId, email)))
    throw new Response("Not found", { status: 404 });
  if (request.method !== "POST") {
    throw new Response("Method not allowed", { status: 405 });
  }

  const formData = await request.formData();
  const intent = formData.get("intent");
  // Service role: `temp-staging` RLS only admits `${companyId}/models/...`; the
  // permission checks above gate this route.
  const staging = (await getCarbonServiceRole()).storage.from(
    TEMP_STAGING_BUCKET
  );

  if (intent === "sign") {
    const path = `${companyId}/backups/${nanoid()}.tar.gz`;
    const signed = await staging.createSignedUploadUrl(path);
    if (signed.error) {
      throw new Response(signed.error.message, { status: 500 });
    }
    return { path: signed.data.path, token: signed.data.token };
  }

  if (intent === "unpack") {
    const path = formData.get("path");
    // Caller-supplied — only ever read back an archive staged for this company.
    if (typeof path !== "string" || !path.startsWith(`${companyId}/backups/`)) {
      throw new Response("Invalid path", { status: 400 });
    }
    try {
      // Stream through a signed download URL; `download()` would buffer the
      // whole archive in memory.
      const signed = await staging.createSignedUrl(path, 60 * 60);
      if (signed.error) throw new Error(signed.error.message);
      const res = await fetch(signed.data.signedUrl);
      if (!res.ok || !res.body) {
        throw new Error(`Failed to read the uploaded archive (${res.status})`);
      }
      const source = Readable.fromWeb(
        res.body as Parameters<typeof Readable.fromWeb>[0]
      );
      return await unpackBackupArchive(client, companyId, source);
    } catch (err) {
      throw new Response((err as Error).message, { status: 400 });
    } finally {
      await staging.remove([path]);
    }
  }

  throw new Response("Unknown intent", { status: 400 });
}
