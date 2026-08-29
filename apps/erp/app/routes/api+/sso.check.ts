import { assertIsPost } from "@carbon/auth";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { getSsoConnectionByDomain, isSsoEnabled } from "@carbon/ee/sso.server";
import { Ratelimit, redis } from "@carbon/kv";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";

// Public endpoint: given an email, answers only whether SSO is configured for
// its domain and whether that connection enforces SSO-only sign-in.
// Deliberately returns two booleans — no other connection details.
export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);

  if (!isSsoEnabled()) {
    return data({ enabled: false, required: false });
  }

  const ip = request.headers.get("x-forwarded-for") ?? "127.0.0.1";
  const ratelimit = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(20, "1 h"),
    analytics: true
  });
  const { success } = await ratelimit.limit(`sso-check:${ip}`);

  if (!success) {
    return data({ enabled: false, required: false }, { status: 429 });
  }

  const formData = await request.formData();
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const domain = email.split("@")[1];

  if (!domain) {
    return data({ enabled: false, required: false });
  }

  const connection = await getSsoConnectionByDomain(
    getCarbonServiceRole(),
    domain
  );

  return data({
    enabled: Boolean(connection.data),
    required: connection.data?.requireSso === true
  });
}
