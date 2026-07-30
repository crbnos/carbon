import { intro, log, outro, spinner } from "@clack/prompts";
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
