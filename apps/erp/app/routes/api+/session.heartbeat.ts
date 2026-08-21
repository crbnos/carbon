import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { touchAuthSession } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";

// Activity heartbeat for the NIST 3.1.10 idle lock. The client posts here (throttled)
// only while the user is genuinely active; each call re-commits the session cookie with
// lastActiveAt = now. requirePermissions runs requireAuthSession, so once the session is
// already idle-locked this redirects to /unlock instead of resuming it — only a real
// re-auth clears the lock. Its job is to keep an ACTIVE session from ever locking.
export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  await requirePermissions(request, {});
  const cookie = await touchAuthSession(request);
  return data(
    { ok: Boolean(cookie) },
    cookie ? { headers: { "Set-Cookie": cookie } } : undefined
  );
}
