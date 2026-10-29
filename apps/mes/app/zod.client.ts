// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { z } from "zod";

// Imported first by root.tsx — React Router's hydration script loads the route
// modules before entry.client, so this is the earliest code on the page:
// zod probes `new Function` once for its JIT, and the CSP refuses eval, so every
// page load would raise a violation report. Client only — the server keeps the JIT.
z.config({ jitless: true });
