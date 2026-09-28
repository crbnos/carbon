import { POSTHOG_API_HOST, SUPABASE_URL } from "@carbon/auth";
import {
  getNonce,
  setStrictContentSecurityPolicy
} from "@carbon/auth/middleware/security.server";
import { ensureLoggingConfigured } from "@carbon/logger/config.server";
import { handleRequest as vercelHandleRequest } from "@vercel/react-router/entry.server";
import type { EntryContext, RouterContextProvider } from "react-router";

ensureLoggingConfigured();

export const streamTimeout = 5_000;

export default function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext,
  _loadContext: RouterContextProvider // RouterContextProvider when v8_middleware is turned on
) {
  const nonce = getNonce(_loadContext);
  setStrictContentSecurityPolicy(responseHeaders, nonce, {
    supabaseUrl: SUPABASE_URL,
    posthogHost: POSTHOG_API_HOST,
    // tailwind.css imports Google Fonts.
    extra: {
      "style-src": ["https://fonts.googleapis.com"],
      "font-src": ["https://fonts.gstatic.com"]
    }
  });
  return vercelHandleRequest(
    request,
    responseStatusCode,
    responseHeaders,
    routerContext,
    // @ts-expect-error
    _loadContext, // Vercel's handler still expecting AppLoadContext type
    { nonce }
  );
}
