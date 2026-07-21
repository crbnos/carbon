import { Ratelimit, redis } from "@carbon/kv";
import { data, type LoaderFunctionArgs } from "react-router";
import { openApiDocument } from "~/modules/accounting/openapi";

// Public, unauthenticated OpenAPI 3.1 document for the v1 integration surface.
// Rate limited per IP (20/h) via the same Redis sliding-window pattern as
// api+/docs.ts.
export async function loader({ request }: LoaderFunctionArgs) {
  const ip = request.headers.get("x-forwarded-for") ?? "127.0.0.1";
  const ratelimit = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(20, "1 h"),
    analytics: true
  });
  const { success } = await ratelimit.limit(`openapi:${ip}`);

  if (!success) {
    throw data({ error: "Rate limit exceeded" }, { status: 429 });
  }

  return openApiDocument;
}
