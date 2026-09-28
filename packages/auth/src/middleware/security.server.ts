import { getLogger } from "@carbon/logger";
import {
  createContext,
  type MiddlewareFunction,
  type RouterContextProvider
} from "react-router";
import {
  buildContentSecurityPolicy,
  type ContentSecurityPolicyOptions,
  createNonce,
  isCrossOriginRequestAllowed,
  isCrossSiteNavigation
} from "../lib/security";

/** Where every app receives CSP violation reports (`api+/csp-report.ts`). */
export const CSP_REPORT_PATH = "/api/csp-report";

/**
 * The strict policy on a document response. Report-only until production
 * reports are clean; enforcing it is renaming the header here.
 */
export function setStrictContentSecurityPolicy(
  headers: Headers,
  nonce: string,
  options: Omit<ContentSecurityPolicyOptions, "nonce" | "reportUri">
): void {
  if (!nonce) return;
  headers.set(
    "Content-Security-Policy-Report-Only",
    buildContentSecurityPolicy({
      ...options,
      nonce,
      reportUri: CSP_REPORT_PATH
    })
  );
}

const log = getLogger("auth", "security");

/** This request's CSP nonce; `entry.server` hands it to React Router. */
const nonceContext = createContext<string>("");

export const getNonce = (context: Readonly<RouterContextProvider>) =>
  context.get(nonceContext);

// On every response, resource and `.data` routes included: `entry.server` only
// runs for documents.
const RESPONSE_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "SAMEORIGIN",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains"
};

function withSecurityHeaders(response: Response): Response {
  const missing = Object.entries(RESPONSE_HEADERS).filter(
    ([name]) => !response.headers.has(name)
  );
  if (missing.length === 0) return response;
  try {
    for (const [name, value] of missing) response.headers.set(name, value);
    return response;
  } catch {
    // Immutable headers (a proxied `fetch` response): copy, then set.
    const copy = new Response(response.body, response);
    for (const [name, value] of missing) copy.headers.set(name, value);
    return copy;
  }
}

/**
 * Root middleware for every app: refuses cross-origin state-changing requests
 * (CSRF), issues the CSP nonce, and adds the baseline security headers.
 */
export const securityMiddleware: MiddlewareFunction<Response> = async (
  { request, context },
  next
) => {
  const { pathname } = new URL(request.url);
  if (!isCrossOriginRequestAllowed(request.method, pathname, request.headers)) {
    log.warn("Refused a cross-origin {method} {pathname}", {
      method: request.method,
      pathname,
      origin: request.headers.get("origin"),
      secFetchSite: request.headers.get("sec-fetch-site")
    });
    return withSecurityHeaders(
      new Response("Cross-origin request refused", { status: 403 })
    );
  }
  context.set(nonceContext, createNonce());
  return withSecurityHeaders(await next());
};

/**
 * For loaders that write on GET (QR scan flows): a link on another site must not
 * be able to trigger them through the SameSite=Lax session cookie.
 */
export function rejectCrossSiteNavigation(request: Request): void {
  if (!isCrossSiteNavigation(request.headers)) return;
  const { pathname } = new URL(request.url);
  log.warn("Refused a cross-site navigation to {pathname}", { pathname });
  throw new Response("Cross-site request refused", { status: 403 });
}

/**
 * `report-uri` target for the report-only CSP. Logs a trimmed violation and
 * never fails: the reporter is the browser and nothing reads the reply.
 */
export async function cspReportAction(request: Request): Promise<Response> {
  const body = (await request.text()).slice(0, 16_384);
  try {
    const report = JSON.parse(body)["csp-report"];
    if (!report || typeof report !== "object") throw new Error("not a report");
    log.warn("CSP violation: {directive} {blocked}", {
      directive: report["effective-directive"] ?? report["violated-directive"],
      blocked: report["blocked-uri"],
      document: report["document-uri"],
      source: report["source-file"],
      line: report["line-number"]
    });
  } catch {
    log.warn("Unreadable CSP report", { body: body.slice(0, 512) });
  }
  return new Response(null, { status: 204 });
}
