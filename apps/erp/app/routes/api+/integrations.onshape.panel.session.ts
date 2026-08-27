import {
  deletePanelSession,
  panelSessionTokenFromRequest
} from "@carbon/auth/panel-session.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";

export const config = {
  runtime: "nodejs"
};

/** DELETE revokes the panel session named by the bearer token. */
export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "DELETE") {
    return data({ error: "Method not allowed" }, { status: 405 });
  }

  const token = panelSessionTokenFromRequest(request);
  if (token) {
    await deletePanelSession(token);
  }

  return data({ ok: true });
}
