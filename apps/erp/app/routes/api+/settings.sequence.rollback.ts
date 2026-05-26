import { assertIsDelete, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { getCurrentSequence } from "~/modules/settings/settings.service.server";

export async function action({ request }: ActionFunctionArgs) {
  assertIsDelete(request);
  await requirePermissions(request, {});

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const table = searchParams.get("table") as string;
  const currentSequence = searchParams.get("currentSequence") as string;

  if (
    !table ||
    table === "undefined" ||
    !currentSequence ||
    currentSequence === "undefined"
  )
    return data(
      { data: null },
      await flash(
        request,
        error(request, "Bad request for rolling back sequence")
      )
    );

  const verifyCurrent = await getCurrentSequence(table);
  if (verifyCurrent.error) {
    return data(
      verifyCurrent,
      await flash(
        request,
        error(
          verifyCurrent.error,
          `Failed to get current sequence for ${table}`
        )
      )
    );
  }

  if (verifyCurrent.data !== currentSequence) {
    return {
      data: null,
      error: "Sequence has changed since last request"
    };
  }

  return {
    data: currentSequence,
    error: null
  };
}
