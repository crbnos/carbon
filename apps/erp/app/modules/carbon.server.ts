// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Wires the ERP into `authorize` (`@carbon/auth/auth.server`): its router, and
// the context a caller's operations run with; and the postings jobs and ee
// call (`@carbon/api/postings.server`). Imported once, by entry.server.

import { type Api, registerCarbon } from "@carbon/api/carbon.server";
import { registerPostings } from "@carbon/api/postings.server";
import { postings } from "./postings.server";
import { type Router, router } from "./router.server";
import { serviceContext } from "./service-context.server";

declare module "@carbon/auth/auth.server" {
  interface Register {
    api: Api<Router>;
  }
}

registerCarbon({ router, context: serviceContext });
registerPostings(postings);
