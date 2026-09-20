import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { updateSessionConsole } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { clearConsolePinIn } from "~/services/console.server";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId } = await requirePermissions(request, {});

  const formData = await request.formData();
  const enabled = formData.get("consoleMode") === "true";

  // Only allow enabling if company has console mode turned on
  if (enabled) {
    const settings = await client
      .from("companySettings")
      .select("consoleEnabled")
      .eq("id", companyId)
      .single();

    if (!settings.data?.consoleEnabled) {
      throw new Response("Console mode is not enabled", { status: 403 });
    }
  }

  const headers = new Headers();
  headers.append(
    "Set-Cookie",
    await updateSessionConsole(request, enabled ? companyId : undefined)
  );

  // When disabling console mode, also clear any active pin-in
  if (!enabled) {
    headers.append("Set-Cookie", clearConsolePinIn(companyId));
  }

  // Return data (not a redirect) so the caller's fetcher auto-revalidates the
  // layout loader and `consoleMode` flips — mirroring the dark-mode toggle in
  // root.tsx. A fetcher redirect to the current route did not reliably refresh
  // the loader, so toggling console mode appeared to do nothing.
  return data({ success: true }, { headers });
}
