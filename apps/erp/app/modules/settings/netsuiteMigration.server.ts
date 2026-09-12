import { trigger } from "@carbon/jobs";
import { nanoid } from "nanoid";

/**
 * Thin triggers for the NetSuite migration job, kept out of the route module so
 * `@carbon/jobs` — which pulls Node's `Buffer` in through the Inngest client —
 * never lands in the browser bundle.
 *
 * The run id is minted here and returned so the page can show the run before the
 * job has written its first marker: enqueuing an event is instant, and without a
 * run id the button's spinner would vanish and the page would look like nothing
 * happened.
 */

export async function startNetSuiteMigration(args: {
  companyId: string;
  userId: string;
  subsidiaryId?: string | null;
  dryRun?: boolean;
}): Promise<string> {
  const migrationRunId = nanoid();
  await trigger("netsuite-migration", {
    companyId: args.companyId,
    userId: args.userId,
    migrationRunId,
    subsidiaryId: args.subsidiaryId ?? null,
    dryRun: args.dryRun ?? false
  });
  return migrationRunId;
}

export async function finalizeNetSuiteMigration(args: {
  companyId: string;
  migrationRunId: string;
}): Promise<void> {
  await trigger("netsuite-migration-finalize", args);
}

export async function revertNetSuiteMigration(args: {
  companyId: string;
  userId: string;
  migrationRunId: string;
}): Promise<void> {
  await trigger("netsuite-migration-revert", args);
}
