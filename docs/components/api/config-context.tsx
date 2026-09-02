"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { parseBaseUrl } from "./base-url-parse";

export const DEFAULT_API_BASE = "https://rest.carbon.ms";
const BASE_STORAGE_KEY = "carbon-api-base";
const KEY_STORAGE_KEY = "carbon-api-key";
const API_KEY_PLACEHOLDER = "<api-key>";

/** Stand-in for the origin when we don't know which instance the reader is on.
 *  Mirrors the `<api-key>` convention: obviously a placeholder when copy-pasted. */
export const HOST_PLACEHOLDER = "<your-host>";

/** Query param the ERP adds to its "API Documentation" link, carrying that
 *  deployment's REST origin (`CARBON_API_URL`) so docs can show the real host. */
const HOST_PARAM = "host";

type Ctx = {
  /** null = the reader's instance is unknown; render HOST_PLACEHOLDER instead. */
  base: string | null;
  setBase: (v: string | null) => void;
  isDefault: boolean;
  isUnknown: boolean;
  apiKey: string;
  setApiKey: (v: string) => void;
  /** Ask the nearest in-provider Configurator to open (from a placeholder click). */
  openConfigurator: () => void;
  /** Bumped by openConfigurator. Each Configurator keeps its OWN open state and
   *  watches this instead of sharing one — the mobile drawer and the sidebar both
   *  mount a Configurator at once, and a shared boolean would open both dialogs. */
  openRequest: number;
};
const ApiConfigCtx = createContext<Ctx>({
  base: null,
  setBase: () => {},
  isDefault: false,
  isUnknown: true,
  apiKey: "",
  setApiKey: () => {},
  openConfigurator: () => {},
  openRequest: 0,
});

export function ApiConfigProvider({ children }: { children: React.ReactNode }) {
  // Unknown until proven otherwise — showing rest.carbon.ms to a self-hosted
  // reader is the bug this state exists to fix.
  const [base, setBaseState] = useState<string | null>(null);
  const [apiKey, setApiKeyState] = useState("");
  const [openRequest, setOpenRequest] = useState(0);

  useEffect(() => {
    try {
      // Precedence: a choice the reader saved themselves outranks the `?host=`
      // hint from a referring app, which outranks "unknown".
      const savedBase = localStorage.getItem(BASE_STORAGE_KEY);
      if (savedBase) {
        setBaseState(savedBase);
      } else {
        const fromParam = new URLSearchParams(window.location.search).get(HOST_PARAM);
        if (fromParam) {
          const result = parseBaseUrl(fromParam);
          if ("url" in result) {
            setBaseState(result.url);
            localStorage.setItem(BASE_STORAGE_KEY, result.url);
          }
        }
      }
      const savedKey = localStorage.getItem(KEY_STORAGE_KEY);
      if (savedKey) setApiKeyState(savedKey);
    } catch {}
  }, []);

  const setBase = (v: string | null) => {
    if (v === null) {
      setBaseState(null);
      try {
        localStorage.removeItem(BASE_STORAGE_KEY);
      } catch {}
      return;
    }
    const val = (v || "").trim().replace(/\/+$/, "");
    if (!val) return;
    setBaseState(val);
    try {
      localStorage.setItem(BASE_STORAGE_KEY, val);
    } catch {}
  };

  const setApiKey = (v: string) => {
    const val = (v || "").trim();
    setApiKeyState(val);
    try {
      if (val) localStorage.setItem(KEY_STORAGE_KEY, val);
      else localStorage.removeItem(KEY_STORAGE_KEY);
    } catch {}
  };

  return (
    <ApiConfigCtx.Provider
      value={{
        base,
        setBase,
        isDefault: base === DEFAULT_API_BASE,
        isUnknown: base === null,
        apiKey,
        setApiKey,
        openConfigurator: () => setOpenRequest((n) => n + 1),
        openRequest,
      }}
    >
      {children}
    </ApiConfigCtx.Provider>
  );
}

export const useApiConfig = () => useContext(ApiConfigCtx);

/** Rewrite the default base URL in a sample to the configured instance, or to the
 *  `<your-host>` placeholder when the instance is unknown. */
export function applyBase(text: string, base: string | null): string {
  if (!text) return text;
  const replacement = base ?? HOST_PLACEHOLDER;
  if (replacement === DEFAULT_API_BASE) return text;
  return text.split(DEFAULT_API_BASE).join(replacement);
}

// The MCP server lives on the app host (app.carbon.ms), a sibling of the REST API
// host (rest.carbon.ms) the configurator controls. Derive the instance's MCP
// endpoint from the configured base by swapping the `rest.` subdomain for `app.`.
export const DEFAULT_MCP_ENDPOINT = "https://app.carbon.ms/api/mcp";

/** App base for the configured instance (where Settings and the MCP server live).
 *  The configurator controls the REST base (rest.*); the app base swaps that subdomain.
 *  Returns null when the instance is unknown, so callers render the placeholder.
 *
 *  Keeps any path prefix, because `parseBaseUrl` deliberately preserves one: an
 *  instance served under `https://acme.com/api/v1` must not have that segment
 *  dropped from its MCP endpoint and Settings links while the REST samples keep it. */
export function appOrigin(base: string | null): string | null {
  if (base === null) return null;
  if (base === DEFAULT_API_BASE) return "https://app.carbon.ms";
  try {
    const u = new URL(base);
    u.hostname = u.hostname.replace(/^rest\./, "app.");
    return (u.origin + u.pathname).replace(/\/+$/, "");
  } catch {
    return "https://app.carbon.ms";
  }
}

function mcpEndpointFor(base: string | null): string {
  const origin = appOrigin(base);
  return origin === null ? `${HOST_PLACEHOLDER}/api/mcp` : `${origin}/api/mcp`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Apply the configured base URL and API key to a sample. Pass `html: true` when `text`
 * is shiki-highlighted HTML — there the `<api-key>` placeholder is entity-escaped to
 * `&lt;api-key&gt;`, and the substituted key must be escaped too. The same applies to
 * `<your-host>`: injected raw into highlighted HTML the browser would eat it as a tag,
 * so it goes in entity-encoded and only the copy path (html: false) gets the literal.
 */
export function applyConfig(
  text: string,
  base: string | null,
  apiKey: string,
  html = false
): string {
  // A configured base is reader-supplied and can hold `&` or `'` (new URL() leaves
  // both intact), so it needs the same escaping the api key gets — otherwise those
  // decode inside the highlighted markup and render a host nobody typed.
  const host = base ?? HOST_PLACEHOLDER;
  const hostReplacement = html ? escapeHtml(host) : host;
  let out = text;
  if (hostReplacement !== DEFAULT_API_BASE) {
    out = out.split(DEFAULT_API_BASE).join(hostReplacement);
  }
  const mcp = mcpEndpointFor(base);
  out = out.split(DEFAULT_MCP_ENDPOINT).join(html ? escapeHtml(mcp) : mcp);
  if (apiKey) {
    if (html) {
      const keyEsc = escapeHtml(apiKey);
      // Shiki encodes the placeholder's angle brackets as hex entities (&#x3C;);
      // also cover decimal (&#60;) and named (&lt;) so substitution is encoding-proof.
      for (const needle of ["&#x3C;api-key&#x3E;", "&#60;api-key&#62;", "&lt;api-key&gt;"]) {
        out = out.split(needle).join(keyEsc);
      }
    } else {
      out = out.split(API_KEY_PLACEHOLDER).join(apiKey);
    }
  }
  return out;
}
