import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { clearConsolePinIn } from "@carbon/auth/console-pin.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId } = await requirePermissions(request, {});

  // Return data (not a redirect) so the caller's fetcher revalidates the shell
  // loader — the `_layout` shouldRevalidate has an explicit case for this
  // action, and a redirect would drop the form context it matches on.
  return data(
    { success: true },
    {
      headers: {
        "Set-Cookie": await clearConsolePinIn(companyId)
      }
    }
  );
}
