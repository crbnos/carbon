import { intro, log, outro } from "@clack/prompts";
import pc from "picocolors";
import { readEnvPorts } from "../env.js";
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

  // Prefer the ports the stack was actually booted with over the registry's
  // allocation — they differ in localhost mode, where `up` pins API/ERP/MES.
  const booted = readEnvPorts(root);
  const ports =
    booted && Object.keys(booted).length > 0
      ? { ...slot.ports, ...booted }
      : slot.ports;
  log.message("\n" + portsTable(ports, slot.redisDb), {
    symbol: pc.bold(pc.yellow(booted ? "Ports (.env.local)" : "Ports"))
  });
  if (!booted) {
    log.info(
      "ports are the registry's allocation — this worktree hasn't booted"
    );
  }

  const listing = await listContainers(root, slug);
  if (!listing.ok) {
    // Never report this as an empty stack: the containers may all be up and
    // healthy, and only the read failed.
    log.error(`could not read container state — ${listing.error}`);
    outro("");
    return;
  }
  if (listing.containers.length === 0) {
    log.warn("no containers running");
    outro("");
    return;
  }

  log.message("\n" + servicesTable(listing.containers), {
    symbol: pc.bold(pc.yellow("Docker"))
  });
  outro("");
}
