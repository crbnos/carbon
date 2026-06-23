"use client";

import { createContext, useContext, useEffect, useState } from "react";

export const DEFAULT_API_BASE = "https://rest.carbon.ms";
const BASE_STORAGE_KEY = "carbon-api-base";
const KEY_STORAGE_KEY = "carbon-api-key";
const API_KEY_PLACEHOLDER = "<api-key>";

type Ctx = {
  base: string;
  setBase: (v: string) => void;
  isDefault: boolean;
  apiKey: string;
  setApiKey: (v: string) => void;
};
const ApiConfigCtx = createContext<Ctx>({
  base: DEFAULT_API_BASE,
  setBase: () => {},
  isDefault: true,
  apiKey: "",
  setApiKey: () => {},
});

export function ApiConfigProvider({ children }: { children: React.ReactNode }) {
  const [base, setBaseState] = useState(DEFAULT_API_BASE);
  const [apiKey, setApiKeyState] = useState("");

  useEffect(() => {
    try {
      const savedBase = localStorage.getItem(BASE_STORAGE_KEY);
      if (savedBase) setBaseState(savedBase);
      const savedKey = localStorage.getItem(KEY_STORAGE_KEY);
      if (savedKey) setApiKeyState(savedKey);
    } catch {}
  }, []);

  const setBase = (v: string) => {
    const val = (v || "").trim().replace(/\/+$/, "") || DEFAULT_API_BASE;
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
      value={{ base, setBase, isDefault: base === DEFAULT_API_BASE, apiKey, setApiKey }}
    >
      {children}
    </ApiConfigCtx.Provider>
  );
}

export const useApiConfig = () => useContext(ApiConfigCtx);

/** Rewrite the default base URL in a sample to the configured instance. */
export function applyBase(text: string, base: string): string {
  if (!text || base === DEFAULT_API_BASE) return text;
  return text.split(DEFAULT_API_BASE).join(base);
}

// The MCP server lives on the app host (app.carbon.ms), a sibling of the REST API
// host (rest.carbon.ms) the configurator controls. Derive the instance's MCP
// endpoint from the configured base by swapping the `rest.` subdomain for `app.`.
export const DEFAULT_MCP_ENDPOINT = "https://app.carbon.ms/api/mcp";

/** App host for the configured instance (where Settings and the MCP server live).
 *  The configurator controls the REST host (rest.*); the app host swaps that subdomain. */
export function appOrigin(base: string): string {
  if (base === DEFAULT_API_BASE) return "https://app.carbon.ms";
  try {
    const u = new URL(base);
    u.hostname = u.hostname.replace(/^rest\./, "app.");
    return u.origin;
  } catch {
    return "https://app.carbon.ms";
  }
}

function mcpEndpointFor(base: string): string {
  return `${appOrigin(base)}/api/mcp`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Apply the configured base URL and API key to a sample. Pass `html: true` when `text`
 * is shiki-highlighted HTML — there the `<api-key>` placeholder is entity-escaped to
 * `&lt;api-key&gt;`, and the substituted key must be escaped too.
 */
export function applyConfig(text: string, base: string, apiKey: string, html = false): string {
  let out = applyBase(text, base);
  out = out.split(DEFAULT_MCP_ENDPOINT).join(mcpEndpointFor(base));
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
