"use client";

import type { ReactNode } from "react";
import { appOrigin, useApiConfig } from "./config-context";
import { Code, DocLink } from "./doc";
import { HostPlaceholder } from "./host-placeholder";

/* Reactive inline references for prose — they read the Configurator (api key + base
 * URL) so the MCP endpoint, auth header, and Settings link match the instance the
 * reader configured, everywhere they appear (not just in the code blocks). When no
 * instance is known they degrade to the `<your-host>` placeholder rather than
 * asserting a host the reader may not be on. */

/** Inline MCP endpoint for the configured instance. */
export function McpEndpoint() {
  const { base, appBase } = useApiConfig();
  const origin = appOrigin(base, appBase);
  if (origin === null) {
    return (
      <Code>
        <HostPlaceholder />
        /api/mcp
      </Code>
    );
  }
  return <Code>{`${origin}/api/mcp`}</Code>;
}

/** Inline bearer-auth header carrying the configured API key (placeholder if unset). */
export function AuthHeader() {
  const { apiKey } = useApiConfig();
  return <Code>Authorization: Bearer {apiKey || "<api-key>"}</Code>;
}

/** Settings → API Keys link on the configured instance's app host. With no known
 *  instance there is no host to link to, so the label becomes the configurator
 *  affordance instead of a dead link. */
export function ApiKeysLink({ children }: { children: ReactNode }) {
  const { base, appBase, openConfigurator } = useApiConfig();
  const origin = appOrigin(base, appBase);
  if (origin === null) {
    return (
      <button
        type="button"
        onClick={openConfigurator}
        title="Set your Carbon instance"
        className="text-ed-brand-ink underline decoration-dotted underline-offset-2 hover:decoration-solid"
      >
        {children}
      </button>
    );
  }
  return <DocLink href={`${origin}/x/settings/api-keys`}>{children}</DocLink>;
}
