// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Wires the ERP into `carbon()` (`@carbon/api/carbon.server`): its router, and
// the context a caller's operations run with; and the postings jobs and ee
// call (`@carbon/api/postings.server`). Imported once, by entry.server.

import { registerCarbon } from "@carbon/api/carbon.server";
import { registerPostings } from "@carbon/api/postings.server";
import type { Router } from "./router.server";
import { serviceContext } from "./service-context.server";

declare module "@carbon/api/carbon.server" {
  interface Register {
    router: Router;
  }
}

// Loaded on first use, not at start: the router and the postings reach most of
// the ERP's modules, and a dev server would compile all of them for its first page.
registerCarbon({
  loadRouter: () => import("./router.server").then((m) => m.router),
  context: serviceContext
});
registerPostings(() => import("./postings.server").then((m) => m.postings));
