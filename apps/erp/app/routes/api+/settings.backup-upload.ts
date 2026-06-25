import { Readable } from "node:stream";
import { requirePermissions } from "@carbon/auth/auth.server";
import { isInternalEmail } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { unpackBackupArchive } from "~/modules/settings/backups-archive.server";

/**
 * Unpack an uploaded `.carbon.tar.gz` (a whole backup folder) into a fresh
 * `exports/<name>/` so the normal restore/import then finds it. The raw archive
 * is the request body (never stored whole); a large archive unpacks at flat
 * memory.
 *
 * NOTE: this receives the upload server-side, so a Vercel-hosted target caps the
 * body size. It's for local / self-hosted import targets (the prod -> local case).
 */
export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId, email } = await requirePermissions(request, {
    update: "settings"
  });
  if (!isInternalEmail(email)) throw new Response("Not found", { status: 404 });
  if (request.method !== "POST" || !request.body) {
    throw new Response("Expected a tar.gz body", { status: 400 });
  }

  const source = Readable.fromWeb(
    request.body as Parameters<typeof Readable.fromWeb>[0]
  );
  try {
    return await unpackBackupArchive(client, companyId, source);
  } catch (err) {
    throw new Response((err as Error).message, { status: 400 });
  }
}
