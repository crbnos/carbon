import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { clearConsolePinIn } from "@carbon/auth/console-pin.server";
import { updateSessionConsole } from "@carbon/auth/session.server";
import { isConsoleModeEnabledForCompany } from "@carbon/ee/console.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const formData = await request.formData();
  const enabled = formData.get("consoleMode") === "true";

  // Entering console mode turns this terminal into one every pinned operator
  // acts through, so it takes `settings_update` (checked against the SESSION
  // user, never a pinned operator). Leaving it only drops back to the session
  // user's own identity and stays open to anyone, so a terminal is never stuck
  // in console mode.
  const { client, companyId } = await requirePermissions(
    request,
    enabled ? { update: "settings" } : {}
  );

  // Only allow enabling if the company has console mode turned on AND is
  // entitled to it — the flag outlives a lapsed entitlement. An unreadable
  // setting (`null`) refuses too.
  if (enabled && !(await isConsoleModeEnabledForCompany(client, companyId))) {
    throw new Response("Console mode is not enabled", { status: 403 });
  }

  const headers = new Headers();
  headers.append(
    "Set-Cookie",
    await updateSessionConsole(request, enabled ? companyId : undefined)
  );

  // When disabling console mode, also clear any active pin-in
  if (!enabled) {
    headers.append("Set-Cookie", await clearConsolePinIn(companyId));
  }

  // Return data (not a redirect) so the caller's fetcher auto-revalidates the
  // layout loader and `consoleMode` flips — mirroring the dark-mode toggle in
  // root.tsx. A fetcher redirect to the current route did not reliably refresh
  // the loader, so toggling console mode appeared to do nothing.
  return data({ success: true }, { headers });
}
