import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { Json } from "@carbon/database";
import {
  decodePunchoutFormPost,
  parsePunchOutOrderMessage
} from "@carbon/ee/punchout";
import { now, parseAbsolute } from "@internationalized/date";
import type { ActionFunctionArgs } from "react-router";
import {
  getPunchoutSessionById,
  updatePunchoutSession
} from "~/modules/purchasing";

// Public, cookie-less endpoint McMaster browser-POSTs the cart to. Auth is the
// unguessable session id in the path + the echoed BuyerCookie, never a cookie.

const HTML_HEADERS = { "Content-Type": "text/html" };

function closeWindow(
  status: "returned" | "cancelled" | "error",
  sessionId: string,
  httpStatus: number
) {
  const body = `<!doctype html><html><body><script>if (window.opener) window.opener.postMessage("punchout:${status}:${sessionId}", "*"); window.close();</script><p>You can close this window.</p></body></html>`;
  return new Response(body, { headers: HTML_HEADERS, status: httpStatus });
}

export async function loader() {
  return new Response("<p>Punchout return endpoint.</p>", {
    headers: HTML_HEADERS,
    status: 200
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const sessionId = params.sessionId;
  if (!sessionId) return closeWindow("error", "", 400);

  const serviceRole = getCarbonServiceRole();
  const sessionResult = await getPunchoutSessionById(serviceRole, sessionId);
  if (sessionResult.error || !sessionResult.data) {
    return closeWindow("error", sessionId, 404);
  }
  const session = sessionResult.data;
  const companyId = session.companyId;

  // Idempotent: a duplicate post to an already-settled session changes nothing.
  if (session.status === "Returned" || session.status === "Consumed") {
    return closeWindow("returned", sessionId, 200);
  }
  if (session.status !== "Pending") {
    return closeWindow("cancelled", sessionId, 200);
  }
  if (parseAbsolute(session.expiresAt, "UTC").compare(now("UTC")) <= 0) {
    await updatePunchoutSession(serviceRole, {
      id: sessionId,
      companyId,
      status: "Expired"
    });
    return closeWindow("error", sessionId, 410);
  }

  const formData = await request.formData();
  const search = new URLSearchParams();
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string") search.append(key, value);
  }

  const rawCxml = decodePunchoutFormPost(search);
  if (!rawCxml) return closeWindow("error", sessionId, 400);

  const cartResult = parsePunchOutOrderMessage(rawCxml);
  if (!cartResult.data) return closeWindow("error", sessionId, 400);
  const cart = cartResult.data;

  if (cart.buyerCookie !== session.buyerCookie) {
    return closeWindow("error", sessionId, 401);
  }

  // An empty cart is the supplier's cancel signal.
  if (cart.lines.length === 0) {
    await updatePunchoutSession(serviceRole, {
      id: sessionId,
      companyId,
      status: "Cancelled"
    });
    return closeWindow("cancelled", sessionId, 200);
  }

  const updated = await updatePunchoutSession(serviceRole, {
    id: sessionId,
    companyId,
    status: "Returned",
    cart: cart as unknown as Json
  });
  if (updated.error) return closeWindow("error", sessionId, 500);

  return closeWindow("returned", sessionId, 200);
}
