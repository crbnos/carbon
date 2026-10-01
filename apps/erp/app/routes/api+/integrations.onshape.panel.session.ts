// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  deletePanelSession,
  panelSessionTokenFromRequest
} from "@carbon/ee/onshape/panel-session.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";

export const config = {
  runtime: "nodejs"
};

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
