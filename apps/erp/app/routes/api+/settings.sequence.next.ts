import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { rejectCrossSiteNavigation } from "@carbon/auth/middleware/security.server";
import { flash } from "@carbon/auth/session.server";
import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { getNextSequence } from "~/modules/settings";

export async function loader({ request }: LoaderFunctionArgs) {
  // Writes on GET: a link on another site must not trigger it.
  rejectCrossSiteNavigation(request);
  const { client, companyId } = await requirePermissions(request, {});

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const table = searchParams.get("table") as string;

  if (!table || table === "undefined")
    return data(
      { data: null },
      await flash(request, error(request, "Bad request for next sequence"))
    );

  const nextSequence = await getNextSequence(client, table, companyId);
  if (nextSequence.error) {
    return data(
      nextSequence,
      await flash(
        request,
        error(nextSequence.error, `Failed to get next sequence for ${table}`)
      )
    );
  }

  return nextSequence;
}
