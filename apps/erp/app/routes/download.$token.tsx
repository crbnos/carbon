import {
  getCarbonServiceRole,
  getUserScopedClient
} from "@carbon/auth/client.server";
import { verifyDownloadToken } from "@carbon/auth/download-token.server";
import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { path } from "~/utils/path";

// Documents live in the "private" storage bucket, keyed directly by `document.path`
// (mirrors useDocument.ts).
const DOCUMENTS_BUCKET = "private";

// Pure resource route (loader only, no default export): it always returns a
// Response — the file bytes on success, or a redirect to the friendly error page
// on any failure. The token is the credential; the clicker needs no Carbon login.
export async function loader({ params }: LoaderFunctionArgs) {
  const { token } = params;

  const fail = (reason: "invalid" | "unavailable") =>
    redirect(path.to.downloadError(reason));

  if (!token) return fail("invalid");

  let payload;
  try {
    payload = await verifyDownloadToken(token);
  } catch {
    // Forged / corrupt signature or unexpected claim shape.
    return fail("invalid");
  }

  const { userId, companyId, documentId } = payload;

  try {
    // Permission + availability in one shot: read the document AS the encoded
    // user via RLS. No row => the user lacks documents_view / readGroups access,
    // or the document was deleted. companyId is enforced to prevent any
    // cross-tenant access even if document ids were to collide.
    const userClient = await getUserScopedClient(userId);
    const doc = await userClient
      .from("document")
      .select("id, name, path")
      .eq("id", documentId)
      .eq("companyId", companyId)
      .maybeSingle();

    if (doc.error || !doc.data?.path) return fail("unavailable");

    // Access already proven above; fetch the bytes with the service role.
    const file = await getCarbonServiceRole()
      .storage.from(DOCUMENTS_BUCKET)
      .download(doc.data.path);

    if (file.error || !file.data) return fail("unavailable");

    // Best-effort audit log mirroring useDocument's "Download" transaction, so
    // history stays consistent. Never block the download on a logging failure.
    try {
      await userClient
        .from("documentTransaction")
        .insert({ documentId, type: "Download", companyId, userId });
    } catch {
      // ignore
    }

    const filename = (doc.data.name ?? "download").replace(/["\r\n]/g, "");
    return new Response(file.data, {
      status: 200,
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(
          doc.data.name ?? "download"
        )}`
      }
    });
  } catch {
    return fail("unavailable");
  }
}
