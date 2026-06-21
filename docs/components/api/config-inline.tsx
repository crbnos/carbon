"use client";

import type { ReactNode } from "react";
import { appOrigin, useApiConfig } from "./config-context";
import { Code, DocLink } from "./doc";

/* Reactive inline references for prose — they read the Configurator (api key + base
 * URL) so the MCP endpoint, auth header, and Settings link match the instance the
 * reader configured, everywhere they appear (not just in the code blocks). */

/** Inline MCP endpoint for the configured instance. */
export function McpEndpoint() {
  const { base } = useApiConfig();
  return <Code>{`${appOrigin(base)}/api/mcp`}</Code>;
}

/** Inline bearer-auth header carrying the configured API key (placeholder if unset). */
export function AuthHeader() {
  const { apiKey } = useApiConfig();
  return <Code>Authorization: Bearer {apiKey || "<api-key>"}</Code>;
}

/** Settings → API Keys link on the configured instance's app host. */
export function ApiKeysLink({ children }: { children: ReactNode }) {
  const { base } = useApiConfig();
  return <DocLink href={`${appOrigin(base)}/x/settings/api-keys`}>{children}</DocLink>;
}
