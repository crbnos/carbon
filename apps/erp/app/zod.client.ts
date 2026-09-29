import { z } from "zod";

// Imported first by root.tsx — React Router's hydration script loads the route
// modules before entry.client, so this is the earliest code on the page:
// zod probes `new Function` once for its JIT, and the CSP refuses eval, so every
// page load would raise a violation report. Client only — the server keeps the JIT.
z.config({ jitless: true });
