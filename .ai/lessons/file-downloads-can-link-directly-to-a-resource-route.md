---
paths: ["apps/erp/app/routes/x+/reports+/*aging*"]
triggers: ["withCsvExport", "csvExportHref", "serverExport"]
promoted: null
---
# File downloads can link directly to a resource route

**Context:** The AR/AP aging table needs a complete server-generated CSV rather than its currently expanded browser rows.

**Problem:** Adding a separate Export button required turning off the Table's own CSV control with `withCsvExport={false}`, leaving two download mechanisms to coordinate.

**Rule:** For one format, give the Table the download URL and render its Download control as a plain anchor. For multiple formats on a report, use one Export menu whose links each make one browser GET to a server resource route; hide the Table's single-format control there. Keep the client-side Table export for lists without a download URL.

**Applies to:** Table downloads backed by resource routes and AR/AP aging exports.
