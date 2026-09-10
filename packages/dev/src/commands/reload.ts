import { join } from "node:path";
import { intro, log, outro, spinner } from "@clack/prompts";
import { config as loadDotenv } from "dotenv";
import pc from "picocolors";
import { recreateServices } from "../services/compose.js";
import { getWorktreeRoot, projectName, resolveSlug } from "../worktree.js";

// `crbn reload <service...>` — recreate specific compose services so an edit to
// docker-compose.dev.yml / .env.local (memory limit, env var, image, port) takes
// effect, WITHOUT `crbn up` restarting the app dev servers. Wraps
// `docker compose up -d --force-recreate <services>`.
export async function reload(services: string[]) {
  intro("Carbon · dev reload");

  const names = services.filter((s) => s && !s.startsWith("-"));
  if (names.length === 0) {
    log.error(
      "Usage: crbn reload <service...>  (e.g. crbn reload storage kong)"
    );
    outro("");
    process.exitCode = 1;
    return;
  }

  const root = await getWorktreeRoot();
  // Mirror `crbn up`: compose interpolation reads process.env first, so root
  // .env values referenced by docker-compose.dev.yml (e.g. the GOTRUE_SAML_*
  // bindings on ${SAML_ENABLED}/${SAML_PRIVATE_KEY}) survive a reload instead
  // of silently resetting to their defaults. .env.local takes precedence.
  loadDotenv({ path: join(root, ".env.local"), override: false });
  loadDotenv({ path: join(root, ".env"), override: false });
  const slug = resolveSlug(root);
  log.info(
    `worktree: ${pc.cyan(slug)}  project: ${pc.cyan(projectName(slug))}`
  );

  const s = spinner();
  s.start(`Recreating ${names.map((n) => pc.cyan(n)).join(", ")}`);
  try {
    await recreateServices(root, slug, names);
    s.stop(`Recreated ${names.map((n) => pc.cyan(n)).join(", ")}`);
    outro(pc.green("Done"));
  } catch (err) {
    s.stop("Reload failed");
    log.error(err instanceof Error ? err.message : String(err));
    outro("");
    process.exitCode = 1;
  }
}
