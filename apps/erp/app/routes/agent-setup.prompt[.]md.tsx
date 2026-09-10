import { getAppUrl } from "@carbon/env";
import type { LoaderFunctionArgs } from "react-router";
import { buildAgentSetupPrompt } from "./api+/mcp+/lib/agent-setup-prompt";

/**
 * The agent-setup prompt, at `/agent-setup/prompt.md` — a markdown document you
 * point an AI agent at to have it connect its own MCP client to this instance.
 *
 * Public and unauthenticated by design: it carries no company data, only how to
 * reach `/api/mcp` and how to authenticate against it. The MCP URL is derived
 * from this deployment's own origin, so a self-hosted or ITAR instance serves a
 * prompt that points at itself rather than at app.carbon.ms. CORS is open
 * because a browser-based agent fetches it cross-origin, and a CORS error there
 * reads to the agent as "no document exists".
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const origin = getAppUrl() || url.origin;

  return new Response(buildAgentSetupPrompt(origin), {
    status: 200,
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Cache-Control": "public, max-age=3600"
    }
  });
}
