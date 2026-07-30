import { useEffect } from "react";
import { isRouteErrorResponse, useNavigate } from "react-router";
import { ErrorScreen, type ErrorScreenProps } from "./ErrorScreen";

/**
 * VOID//SYS — drop-in root ErrorBoundary for React Router v7 (framework mode).
 *
 * Usage in app/root.tsx:
 *
 *   import { RootErrorBoundary } from "@carbon/react/ErrorBoundary";
 *   import type { Route } from "./+types/root";
 *
 *   export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
 *     return <RootErrorBoundary error={error} />;
 *   }
 *
 * It handles three cases:
 *   1. Route error responses (thrown `Response` / `data()` — includes 404s and
 *      any other HTTP status like 401 / 403 / 500).
 *   2. Real `Error` instances thrown during render / loaders / actions.
 *   3. Anything else that got thrown (strings, unknown values).
 */
export function RootErrorBoundary({ error }: { error: unknown }) {
  const navigate = useNavigate();

  // Route errors (e.g. an unmatched fetcher.load) are otherwise invisible —
  // React Router hands them to the boundary without logging anywhere.
  useEffect(() => {
    const summary = isRouteErrorResponse(error)
      ? `${error.status} ${error.statusText || "route error response"}`
      : error instanceof Error
        ? error.message
        : String(error);
    // biome-ignore lint/suspicious/noConsole: surfacing the swallowed error is the point
    console.error(`[ErrorBoundary] ${summary}`, error);
  }, [error]);

  const config = resolveConfig(error, () => navigate(0));
  return <ErrorScreen {...config} />;
}

function resolveConfig(error: unknown, retry: () => void): ErrorScreenProps {
  // 1. Route error responses (thrown Response / data() results)
  if (isRouteErrorResponse(error)) {
    if (error.status === 404) {
      return {
        code: "404",
        eyebrow: "— coordinates unresolved",
        title: "This page slipped through the cracks.",
        message:
          "The resource you requested has drifted out of range, been renamed, or never existed in this dimension to begin with.",
        highlightIndex: 3,
        logLines: [
          "> initiating trace_route.exe",
          "> pinging requested resource ...",
          "> resource returned: NULL",
          "> status_code: 404 / NOT_FOUND",
          "> signal strength: 0.0%",
          "> location: /dev/void",
          "> recommendation: return to known coordinates"
        ],
        actions: [{ label: "return home", to: "/" }]
      };
    }

    // Any other HTTP status thrown as a route response
    const detail =
      typeof error.data === "string"
        ? error.data
        : (error.data?.message ?? error.statusText);

    return {
      code: String(error.status),
      eyebrow: "— request refused",
      title: "The server turned this request away.",
      message:
        "This route responded with an error status. You may not have access, or the request was malformed in transit.",
      highlightIndex: 3,
      logLines: [
        "> opening channel to server ...",
        "> transmitting request payload",
        "> awaiting acknowledgement",
        `> status_code: ${error.status} / ${error.statusText || "ERROR"}`,
        `> detail: ${detail || "no additional detail"}`,
        "> channel closed by remote host",
        "> recommendation: verify access or retry"
      ],
      actions: [
        { label: "retry", onClick: retry },
        { label: "return home", to: "/", variant: "ghost" }
      ]
    };
  }

  // 2. Real Error instances thrown during render / loaders / actions
  const message = error instanceof Error ? error.message : "unknown error";
  const stack =
    error instanceof Error && error.stack
      ? error.stack.split("\n")[1]?.trim()
      : undefined;

  return {
    code: "500",
    eyebrow: "— unhandled exception",
    title: "Something broke on our end.",
    message:
      "The application hit an unexpected fault while rendering this route. You can retry the operation or head back to safe ground.",
    highlightIndex: 3,
    logLines: [
      "> executing render pipeline ...",
      "> exception thrown mid-stream",
      `> message: ${message}`,
      "> status_code: 500 / INTERNAL_ERROR",
      stack ? `> at: ${stack}` : "> stack: unavailable",
      "> stack unwound to nearest boundary",
      "> recommendation: retry or return home"
    ],
    actions: [
      { label: "retry", onClick: retry },
      { label: "return home", to: "/", variant: "ghost" }
    ]
  };
}
