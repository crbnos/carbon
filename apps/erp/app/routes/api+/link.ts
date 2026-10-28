// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { getCompanyId, setCompanyId } from "@carbon/auth/company.server";
import { updateCompanySession } from "@carbon/auth/session.server";
import type { NotificationEvent } from "@carbon/notifications";
import { redirect } from "@carbon/utils";
import type { LoaderFunctionArgs } from "react-router";
import { getCompanies } from "~/modules/settings/settings.service";
import {
  type NotificationDocumentType,
  notificationTarget
} from "~/utils/notification-target";
import { path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  const {
    client,
    companyId: sessionCompanyId,
    userId
  } = await requirePermissions(request, {
    // Notification links switch to the linked company, which must work from a
    // portal company session too.
    allowPortalAccounts: true
  });

  const url = new URL(request.url);
  const event = url.searchParams.get("event") as NotificationEvent | null;
  const documentId = url.searchParams.get("documentId");
  const documentType = url.searchParams.get(
    "documentType"
  ) as NotificationDocumentType | null;
  const page = url.searchParams.get("page");

  const companyId = url.searchParams.get("companyId");

  let redirectTo: string;
  if (page === "notification-settings") {
    // Email footer link — no document, but the company-switch below still applies.
    redirectTo = path.to.accountSettings("notifications");
  } else if (event && documentId) {
    // The same target as the topbar row (`notificationTarget`).
    redirectTo =
      notificationTarget(event, documentId, documentType)?.path ??
      path.to.authenticatedRoot;
  } else if (companyId) {
    redirectTo = path.to.authenticatedRoot;
  } else {
    throw redirect(path.to.authenticatedRoot);
  }

  // The notification points at a document in a specific company, but the
  // recipient may currently be viewing a different one. If the linked company
  // is one the user belongs to, switch them into it before redirecting — the
  // same flow the company switcher uses — so the document actually resolves.
  if (
    companyId &&
    (companyId !== sessionCompanyId || companyId !== getCompanyId(request))
  ) {
    const companies = await getCompanies(client, userId);
    const matchedCompany = companies.data?.find(
      (company) => company.id === companyId
    );
    if (matchedCompany) {
      const sessionCookie = await updateCompanySession(
        request,
        companyId,
        matchedCompany.companyGroupId ?? ""
      );
      const companyIdCookie = setCompanyId(companyId);
      throw redirect(redirectTo, {
        headers: [
          ["Set-Cookie", sessionCookie],
          ["Set-Cookie", companyIdCookie]
        ]
      });
    }
  }

  throw redirect(redirectTo);
}
