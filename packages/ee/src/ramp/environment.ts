/**
 * TEMPORARY hard switch between the Ramp sandbox (demo) and production
 * environments, for testing the integration with a customer. There is NO env
 * var by design — flip this one constant and redeploy, then set it back to
 * "production" when testing is done.
 *
 * While set to "sandbox", point the RAMP_CLIENT_ID / RAMP_CLIENT_SECRET env
 * vars at your Ramp *demo* OAuth app's credentials — the sandbox is a separate
 * Ramp OAuth app, so the production app's id/secret will NOT authorize against
 * it. The stored `credentials.environment` (stamped by `exchangeRampOAuthCode`)
 * carries this choice through to every subsequent Ramp API call and token
 * refresh, so `RampClient` talks to demo-api.ramp.com automatically.
 *
 * This module is browser-safe (no node imports) so both the client-bundled
 * `config.tsx` and the server `connection.ts` share the one switch.
 */
export type RampEnvironment = "production" | "sandbox";

export const RAMP_ENVIRONMENT: RampEnvironment = "sandbox";

const IS_SANDBOX = RAMP_ENVIRONMENT === "sandbox";

/**
 * User-consent (authorize) endpoint. Lives on the APP host, NOT the API host —
 * hitting the api host's /v1/authorize returns "Not Authorized" before any
 * consent screen. Production: app.ramp.com. Sandbox/demo: demo.ramp.com. (If
 * the sandbox consent screen 404s, this demo host is the value to adjust.)
 */
export const RAMP_AUTHORIZE_URL = IS_SANDBOX
  ? "https://demo.ramp.com/v1/authorize"
  : "https://app.ramp.com/v1/authorize";

/** Token-exchange endpoint — on the API host. */
export const RAMP_TOKEN_URL = IS_SANDBOX
  ? "https://demo-api.ramp.com/developer/v1/token"
  : "https://api.ramp.com/developer/v1/token";
