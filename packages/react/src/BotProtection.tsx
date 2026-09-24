import { Turnstile } from "@marsidev/react-turnstile";
import { initBotId } from "botid/client/core";
import { type ReactNode, useEffect, useState } from "react";
import { useMode } from "./hooks/useMode";

// Mirrors BotProtection in @carbon/auth/auth.server — the login loader passes
// the server's value straight through, so client and server always agree.
export type BotProtectionConfig =
  | { provider: "botid" }
  | { provider: "turnstile"; siteKey: string }
  | null;

let botIdInitialized = false;

/**
 * The client half of the login bot check. Render `challenge` inside the form,
 * post `token` as `botToken`, and hold submit until `ready`.
 *
 * - BotID patches window.fetch so POSTs to `path` (and `${path}.data`, where
 *   React Router submits an action) carry an invisible challenge. Nothing to
 *   render, nothing to wait for.
 * - Turnstile renders a widget; its token is single-use, so the form stays
 *   disabled until one arrives and again after it expires.
 */
export function useBotProtection(
  path: string,
  config: BotProtectionConfig
): { token: string; ready: boolean; challenge: ReactNode } {
  const mode = useMode();
  const [token, setToken] = useState("");

  const provider = config?.provider;
  useEffect(() => {
    if (provider !== "botid" || botIdInitialized) return;
    botIdInitialized = true;
    initBotId({
      protect: [
        { path, method: "POST" },
        { path: `${path}.data`, method: "POST" }
      ]
    });
  }, [path, provider]);

  if (config?.provider !== "turnstile") {
    return { token: "", ready: true, challenge: null };
  }

  return {
    token,
    ready: Boolean(token),
    challenge: (
      <div className="w-full flex justify-center">
        <Turnstile
          siteKey={config.siteKey}
          onSuccess={setToken}
          onError={() => setToken("")}
          onExpire={() => setToken("")}
          options={{ theme: mode === "dark" ? "dark" : "light" }}
        />
      </div>
    )
  };
}
