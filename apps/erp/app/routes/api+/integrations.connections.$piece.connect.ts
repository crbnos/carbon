import { requirePermissions } from "@carbon/auth/auth.server";
import {
  getPieceOAuth2Auth,
  PIECE_ALLOWLIST,
  resolveOAuthApp
} from "@carbon/jobs/integrations";
import type { LoaderFunctionArgs } from "react-router";
import { signConnectionState } from "~/modules/settings/connection-state.server";

export const config = {
  runtime: "nodejs"
};

/**
 * Builds the vendor's consent URL: the piece supplies `authUrl` and `scope`, the
 * allowlist row supplies which env vars hold our OAuth app. Returns `{ url }` like
 * the Slack install route, so the client opens it in a popup.
 */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { companyId, userId } = await requirePermissions(request, {
    update: "settings"
  });

  const pieceName = params.piece;
  const entry = pieceName ? PIECE_ALLOWLIST[pieceName] : undefined;
  if (!pieceName || entry === undefined) {
    return { error: "That integration is not available." };
  }

  let app: ReturnType<typeof resolveOAuthApp>;
  try {
    app = resolveOAuthApp(pieceName);
  } catch {
    // Names the vendor rather than the missing variable: this reaches a customer.
    return {
      error: `This Carbon instance has no ${entry.label} OAuth app configured.`
    };
  }

  const requested = new URL(request.url).searchParams.get("name")?.trim();
  const name = requested || entry.label;

  const auth = await getPieceOAuth2Auth(pieceName);

  const url = new URL(auth.authUrl);
  url.searchParams.set("client_id", app.clientId);
  url.searchParams.set("redirect_uri", app.redirectUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", auth.scope.join(" "));
  // Without both of these Google returns no refresh token on a re-authorization.
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set(
    "state",
    signConnectionState({ companyId, pieceName, name, userId })
  );

  return { url: url.toString() };
}
