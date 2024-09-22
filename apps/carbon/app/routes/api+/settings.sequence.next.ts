import type { LoaderFunctionArgs } from "@vercel/remix";
import { json } from "@vercel/remix";
import { getNextSequence } from "~/modules/settings";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { error } from "~/utils/result";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {});

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const table = searchParams.get("table") as string;

  if (!table || table === "undefined")
    return json(
      { data: null },
      await flash(request, error(request, "Bad request for next sequence"))
    );

  const nextSequence = await getNextSequence(client, table, companyId);
  if (nextSequence.error) {
    return json(
      nextSequence,
      await flash(
        request,
        error(nextSequence.error, `Failed to get next sequence for ${table}`)
      )
    );
  }

  return json(nextSequence);
}
