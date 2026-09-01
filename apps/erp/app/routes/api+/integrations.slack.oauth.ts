import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";

export const config = {
  runtime: "nodejs"
};

/**
 * Legacy Slack redirect URL, kept as a forwarder. Deployed environments (and the
 * Slack app's registered Redirect URLs) still name `/api/integrations/slack/oauth`
 * in `SLACK_OAUTH_REDIRECT_URL`; the consent itself now completes in the shared
 * connections callback. Slack sends the browser here with `code` and `state`, so
 * pass the query through untouched — the state is ours, signed for that callback,
 * and the token exchange reuses the same redirect URL it was authorized with.
 *
 * Once every environment points `SLACK_OAUTH_REDIRECT_URL` at the callback
 * directly, this file can go.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  return redirect(`/api/integrations/connections/callback${url.search}`, 302);
}
