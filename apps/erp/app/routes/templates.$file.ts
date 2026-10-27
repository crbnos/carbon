// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { authEmails } from "@carbon/documents/email";
import { createElement } from "react";
import { render } from "react-email";
import type { LoaderFunctionArgs } from "react-router";

/**
 * Auth's email templates, rendered from Carbon's React Email components
 * with Auth's placeholders left for Auth to fill in. Self-hosted Auth
 * downloads these when it sends mail (GOTRUE_MAILER_TEMPLATES_*, pointed
 * at the ERP inside the cluster), so every deployment's emails match its
 * own release. Public: a template is the same for everyone and carries no
 * data.
 */
export async function loader({ params }: LoaderFunctionArgs) {
  const file = params.file ?? "";
  // Own keys only: "constructor" would otherwise find Object's.
  if (!Object.hasOwn(authEmails, file)) {
    return new Response("Not found", { status: 404 });
  }
  const Email = authEmails[file as keyof typeof authEmails];
  const html = await render(createElement(Email));
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // Auth keeps its own copy for minutes; this only spares re-renders.
      "Cache-Control": "public, max-age=300"
    }
  });
}
