// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Wires the ERP into `carbon()` (`@carbon/api/carbon.server`): its router, and
// the context a caller's operations run with; and the postings jobs and ee
// call (`@carbon/api/postings.server`). Imported once, by entry.server.

import { registerCarbon } from "@carbon/api/carbon.server";
import { registerPostings } from "@carbon/api/postings.server";
import { postings } from "./postings.server";
import { type Router, router } from "./router.server";
import { serviceContext } from "./service-context.server";

declare module "@carbon/api/carbon.server" {
  interface Register {
    router: Router;
  }
}

registerCarbon({ router, context: serviceContext });
registerPostings(postings);
