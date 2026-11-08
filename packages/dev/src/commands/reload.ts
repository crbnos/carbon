// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { intro, log, outro } from "@clack/prompts";
import pc from "picocolors";
import { loadEnvFiles } from "../env.js";
import { recreateServices } from "../services/compose.js";
import { currentStack } from "../stack.js";
import { spinner } from "../ui.js";

// `crbn reload <service...>` — recreate specific compose services so an edit to
// docker-compose.dev.yml / .env.local (memory limit, env var, image, port) takes
// effect, WITHOUT `crbn up` restarting the app dev servers.
export async function reload(services: string[]) {
  intro("Carbon · dev reload");

  const names = services;
  if (names.length === 0) {
    log.error(
      "Usage: crbn reload <service...>  (e.g. crbn reload storage api-gw)"
    );
    outro("");
    process.exitCode = 1;
    return;
  }

  const stack = await currentStack();
  // Compose interpolates from process.env: without the .env values the
  // compose file references (the GOTRUE_SAML_* bindings), a reload would
  // reset them to their defaults.
  loadEnvFiles(stack.root, { shellWins: true });
  log.info(
    `worktree: ${pc.cyan(stack.slug)}  project: ${pc.cyan(stack.project)}`
  );

  const s = spinner();
  s.start(`Recreating ${names.map((n) => pc.cyan(n)).join(", ")}`);
  try {
    await recreateServices(stack, names);
    s.stop(`Recreated ${names.map((n) => pc.cyan(n)).join(", ")}`);
    outro(pc.green("Done"));
  } catch (err) {
    s.stop("Reload failed");
    log.error(err instanceof Error ? err.message : String(err));
    outro("");
    process.exitCode = 1;
  }
}
