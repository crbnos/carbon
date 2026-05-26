import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { getNextSequence } from "~/modules/settings/settings.service.server";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {});

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const table = searchParams.get("table") as string;

  if (!table || table === "undefined")
    return data(
      { data: null },
      await flash(request, error(request, "Bad request for next sequence"))
    );

  const nextSequence = await getNextSequence(table);
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
