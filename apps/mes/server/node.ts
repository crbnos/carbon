// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// What `pnpm start` runs in the self-hosted image. Vercel does not come
// through here; it calls `server/app.ts`.

import path from "node:path";
import { serve } from "@carbon/serve";
import type { ServerBuild } from "react-router";

// By URL, not as a literal path: the build is not there when this file is
// typechecked, and a literal one TypeScript would go looking for.
const build: ServerBuild = await import(
  new URL("../build/server/index.js", import.meta.url).href
);

await serve({
  build,
  clientDirectory: path.resolve(import.meta.dirname, "../build/client"),
  // The app's own address, as the deployment sets it.
  siteUrl: process.env.MES_URL
});
