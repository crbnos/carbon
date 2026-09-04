"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { parseBaseUrl } from "./base-url-parse";
import {
  APP_PARAM,
  DEFAULT_API_BASE,
  DEFAULT_APP_ORIGIN,
  DEFAULT_MCP_ENDPOINT,
  HOST_PARAM,
  HOST_PLACEHOLDER,
} from "./config-constants";

export { DEFAULT_API_BASE, DEFAULT_MCP_ENDPOINT, HOST_PLACEHOLDER };

const BASE_STORAGE_KEY = "carbon-api-base";
const APP_STORAGE_KEY = "carbon-app-origin";
const KEY_STORAGE_KEY = "carbon-api-key";
const API_KEY_PLACEHOLDER = "<api-key>";

/** A host that arrived in the URL rather than from the reader is only trusted to
 *  DISPLAY. Pasting the reader's stored key into samples aimed at it would hand a
 *  crafted link their credential, so the key is withheld until they confirm the
 *  instance in the dialog. Cleartext http is refused outright (except loopback,
 *  which never leaves the machine) — a key in a copy-pasted http:// sample is a
 *  key on the wire. */
function isTrustedForCredentials(base: string | null): boolean {
  if (base === null) return false;
  try {
    const u = new URL(base);
    if (u.protocol === "https:") return true;
    return u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "[::1]";
  } catch {
    return false;
  }
}

type Ctx = {
  /** null = the reader's instance is unknown; render HOST_PLACEHOLDER instead. */
  base: string | null;
  setBase: (v: string | null, app?: string | null) => void;
  /** App host (Settings, MCP). Configured separately from the REST host upstream,
   *  so it is carried explicitly rather than guessed from `base`. */
  appBase: string | null;
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
  appBase: null,
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
  const [appBase, setAppBaseState] = useState<string | null>(null);
  const [apiKey, setApiKeyState] = useState("");
  // Where `base` came from. Trust is derived from this + the scheme below, rather
  // than stored, so no writer can forget to keep a parallel flag in sync.
  const [baseFromLink, setBaseFromLink] = useState(false);
  const [openRequest, setOpenRequest] = useState(0);

  useEffect(() => {
    try {
      // Precedence: a choice the reader saved themselves outranks the `?host=`
      // hint from a referring app, which outranks "unknown".
      const savedBase = localStorage.getItem(BASE_STORAGE_KEY);
      const savedKey = localStorage.getItem(KEY_STORAGE_KEY);
      if (savedKey) setApiKeyState(savedKey);

      if (savedBase) {
        // Saved by the reader in the dialog, so the key may be shown against it.
        setBaseState(savedBase);
        setAppBaseState(localStorage.getItem(APP_STORAGE_KEY));
        return;
      }

      // Both params are read independently: the ERP emits each only when its own
      // env var is set, and `CARBON_API_URL` is optional while the app origin
      // always resolves — so an `?app=`-only link is the ordinary shape for a
      // deployment that never configured a REST origin.
      const params = new URLSearchParams(window.location.search);

      // Display-only: NOT persisted and never credential-trusted. Persisting would
      // make one crafted link permanently redirect this reader's samples, and the
      // dialog is where a host becomes the reader's own choice.
      const hostParam = params.get(HOST_PARAM);
      if (hostParam) {
        const result = parseBaseUrl(hostParam);
        if ("url" in result) {
          setBaseState(result.url);
          setBaseFromLink(true);
        }
      }

      const appParam = params.get(APP_PARAM);
      if (appParam) {
        const appResult = parseBaseUrl(appParam);
        if ("url" in appResult) setAppBaseState(appResult.url);
      }
    } catch {}
  }, []);

  /** Saving through the dialog is what makes a host the reader's OWN choice, so this
   *  is the only path that persists one or lets the key be shown against it.
   *  `app` is the instance's app host when known (the ERP passes it; the two are
   *  configured independently upstream), else null to fall back to the rest.->app. guess. */
  const setBase = (v: string | null, app: string | null = null) => {
    if (v === null) {
      setBaseState(null);
      setAppBaseState(null);
      setBaseFromLink(false);
      try {
        localStorage.removeItem(BASE_STORAGE_KEY);
        localStorage.removeItem(APP_STORAGE_KEY);
      } catch {}
      return;
    }
    const val = (v || "").trim().replace(/\/+$/, "");
    if (!val) return;
    setBaseState(val);
    setAppBaseState(app);
    setBaseFromLink(false);
    try {
      localStorage.setItem(BASE_STORAGE_KEY, val);
      if (app) localStorage.setItem(APP_STORAGE_KEY, app);
      else localStorage.removeItem(APP_STORAGE_KEY);
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
        appBase,
        isDefault: base === DEFAULT_API_BASE,
        isUnknown: base === null,
        // Withheld while the host came from a link rather than the reader, and for
        // any cleartext destination — samples would otherwise carry a real key there.
        apiKey: baseFromLink || !isTrustedForCredentials(base) ? "" : apiKey,
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

/** App base for the configured instance (where Settings and the MCP server live).
 *  Returns null when the instance is unknown, so callers render the placeholder.
 *
 *  `appBase` wins whenever it is known: upstream the app host and the REST host are
 *  separate settings (`ERP_URL` vs `CARBON_API_URL`) and need not share a domain, so
 *  the `rest.` -> `app.` rewrite below is only a fallback for a host the reader typed
 *  themselves. Either way any path prefix survives, because `parseBaseUrl` preserves
 *  one: an instance under `https://acme.com/api/v1` must not lose that segment here
 *  while the REST samples keep it. */
export function appOrigin(base: string | null, appBase: string | null = null): string | null {
  if (appBase) return appBase.replace(/\/+$/, "");
  if (base === null) return null;
  if (base === DEFAULT_API_BASE) return DEFAULT_APP_ORIGIN;
  try {
    const u = new URL(base);
    u.hostname = u.hostname.replace(/^rest\./, "app.");
    return (u.origin + u.pathname).replace(/\/+$/, "");
  } catch {
    return DEFAULT_APP_ORIGIN;
  }
}

function mcpEndpointFor(base: string | null, appBase: string | null = null): string {
  const origin = appOrigin(base, appBase);
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
  html = false,
  appBase: string | null = null
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
  const mcp = mcpEndpointFor(base, appBase);
  out = out.split(DEFAULT_MCP_ENDPOINT).join(html ? escapeHtml(mcp) : mcp);
  if (apiKey) {
    if (html) {
      const keyEsc = escapeHtml(apiKey);
      // Shiki escapes only what HTML strictly requires, so the brackets around the
      // placeholder come back INDEPENDENTLY encoded — in practice `&#x3C;api-key>`,
      // with the `<` a hex entity and the `>` left raw. Matching a fixed pair of
      // fully-encoded needles silently missed that and shipped a sample that still
      // said `<api-key>` after the reader had set one. Match either bracket in any
      // of its forms instead.
      const LT = "(?:<|&#x3C;|&#60;|&lt;)";
      const GT = "(?:>|&#x3E;|&#62;|&gt;)";
      out = out.replace(new RegExp(`${LT}api-key${GT}`, "gi"), keyEsc);
    } else {
      out = out.split(API_KEY_PLACEHOLDER).join(apiKey);
    }
  }
  return out;
}
