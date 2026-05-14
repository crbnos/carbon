import { intro, log, outro } from "@clack/prompts";
import pc from "picocolors";
import { listContainers } from "../services/compose.js";
import { portsTable, servicesTable } from "../ui.js";
import {
  getSlot,
  getWorktreeRoot,
  projectName,
  resolveSlug
} from "../worktree.js";

export async function status() {
  intro("Carbon · dev status");
  const root = await getWorktreeRoot();
  const slug = resolveSlug(root);
  const slot = getSlot(slug);
  log.info(
    `worktree: ${pc.cyan(slug)}  project: ${pc.cyan(projectName(slug))}`
  );
  if (!slot) {
    log.warn("no port assignment yet — run `crbn up`");
    outro("");
    return;
  }

  log.message("\n" + portsTable(slot.ports, slot.redisDb), {
    symbol: pc.bold(pc.yellow("Portless"))
  });

  const containers = await listContainers(root, slug);
  if (containers.length === 0) {
    log.warn("no containers running");
    outro("");
    return;
  }

  log.message("\n" + servicesTable(containers), {
    symbol: pc.bold(pc.yellow("Docker"))
  });
  outro("");
}
