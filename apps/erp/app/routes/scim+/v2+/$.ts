// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// SCIM 2.0 provisioning (RFC 7643 / 7644) — the endpoint a customer's identity
// provider (Okta, Microsoft Entra ID) calls to create, update, deactivate and
// regroup the company's employees.
//
//   /scim/v2/{Users,Groups,ServiceProviderConfig,ResourceTypes,Schemas}[/{id}]
//
// The bearer token names the company. Everything else — the entitlement lock,
// the rate limit, the request shapes — is the commercial engine's
// (`@carbon/ee/scim.server`). No CORS: the IdP calls server to server.

import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { handleScimRequest } from "@carbon/ee/scim.server";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { getDatabaseClient } from "~/services/database.server";

function serve(request: Request) {
  return handleScimRequest(request, {
    db: getDatabaseClient(),
    serviceRole: getCarbonServiceRole()
  });
}

export async function loader({ request }: LoaderFunctionArgs) {
  return serve(request);
}

export async function action({ request }: ActionFunctionArgs) {
  return serve(request);
}
