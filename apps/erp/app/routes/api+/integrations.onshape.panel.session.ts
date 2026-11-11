// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  deletePanelSession,
  panelSessionTokenFromRequest,
  requireOnshapePanelPermissions,
  switchPanelSessionCompany
} from "@carbon/ee/onshape/panel-session.server";
import { getLogger } from "@carbon/logger";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { z } from "zod";
import {
  getOnshapePanelAccountGate,
  getOnshapePanelCompanies
} from "~/modules/settings/settings.service";

export const config = {
  runtime: "nodejs"
};

const logger = getLogger("erp", "onshape", "panel-session");

const switchSchema = z.object({ companyId: z.string().min(1) });

export async function action({ request }: ActionFunctionArgs) {
  if (request.method === "POST") {
    return switchCompany(request);
  }
  if (request.method !== "DELETE") {
    return data({ error: "Method not allowed" }, { status: 405 });
  }

  const token = panelSessionTokenFromRequest(request);
  if (token) {
    await deletePanelSession(token);
  }

  return data({ ok: true });
}

/** Moves the panel to another company and answers the new token. */
async function switchCompany(request: Request) {
  const { client, companyId, userId, email, ssoProviderId } =
    await requireOnshapePanelPermissions(request, {});
  const token = panelSessionTokenFromRequest(request);

  const parsed = switchSchema.safeParse(await request.json().catch(() => null));
  if (!token || !parsed.success) {
    return data({ error: "Invalid company" }, { status: 400 });
  }

  const choices = await getOnshapePanelCompanies(client, userId, companyId);
  if (choices.error) {
    logger.error("Could not list the panel's companies", {
      companyId,
      userId,
      error: choices.error
    });
    return data(
      { error: "Carbon couldn't read your companies. Try again." },
      { status: 503 }
    );
  }

  const target = choices.data.find(({ id }) => id === parsed.data.companyId);
  if (!target) {
    logger.warn("Refused an Onshape panel company switch", {
      companyId,
      userId,
      targetCompanyId: parsed.data.companyId
    });
    // 409, not 403: `panelFetch` rewrites every 403 to its permission wording.
    return data(
      { error: "The Onshape panel isn't available in that company." },
      { status: 409 }
    );
  }

  const gate = await getOnshapePanelAccountGate(client, {
    companyId: target.id,
    userId,
    email,
    ssoProviderId
  });
  if (gate !== "open") {
    logger.warn("An account gate held back an Onshape panel company switch", {
      companyId,
      userId,
      targetCompanyId: target.id,
      gate
    });
    return gate === "setup-required"
      ? data(
          {
            error: `Finish setting up your Carbon account in ${target.name}, then try again.`
          },
          { status: 409 }
        )
      : data(
          { error: "Carbon couldn't switch company. Try again." },
          { status: 503 }
        );
  }

  const next = await switchPanelSessionCompany(token, {
    companyId: target.id,
    companyGroupId: target.companyGroupId
  });
  if (!next) {
    logger.error("Could not store an Onshape panel session", {
      companyId,
      userId,
      targetCompanyId: target.id
    });
    return data(
      { error: "Carbon couldn't switch company. Try again." },
      { status: 503 }
    );
  }

  return data({ token: next }, { headers: { "Cache-Control": "no-store" } });
}
