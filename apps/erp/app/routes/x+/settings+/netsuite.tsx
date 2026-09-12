// Settings → Migrate from NetSuite (preview or run a one-click migration,
// then keep it or revert).
import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { Heading, VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, redirect, useLoaderData, useRevalidator } from "react-router";
import type { NetSuiteMigrationRun } from "~/modules/settings";
import { getIntegration, getNetSuiteMigrationRun } from "~/modules/settings";
import {
  finalizeNetSuiteMigration,
  revertNetSuiteMigration,
  startNetSuiteMigration
} from "~/modules/settings/netsuiteMigration.server";
import {
  MigrationReport,
  MigrationRunRow,
  MigrationStartCard
} from "~/modules/settings/ui/NetSuiteMigration";
import { canAccessBackups } from "~/utils/backups";
import { path } from "~/utils/path";

export const handle = {
  breadcrumb: msg`Migrate from NetSuite`,
  to: path.to.netsuiteMigration
};

function requireMigrationAccess(email: string | null) {
  // Same gate as Backups and Demo Data: a migration writes across a company's
  // whole dataset and snapshots it first, so it carries the same unhardened
  // multi-tenant caveats and stays internal-only in real deployments.
  if (!canAccessBackups(email)) {
    throw redirect(path.to.settings);
  }
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId, email } = await requirePermissions(request, {
    update: "settings"
  });
  requireMigrationAccess(email);

  const [run, integration] = await Promise.all([
    getNetSuiteMigrationRun(client, companyId),
    getIntegration(client, "netsuite", companyId)
  ]);

  return { run: run.data, connected: integration.data?.active === true };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId, email } = await requirePermissions(
    request,
    { update: "settings" }
  );
  requireMigrationAccess(email);

  const formData = await request.formData();
  const intent = formData.get("intent");
  const migrationRunId = String(formData.get("migrationRunId") ?? "");

  switch (intent) {
    case "preview":
    case "migrate": {
      const integration = await getIntegration(client, "netsuite", companyId);
      if (integration.data?.active !== true) {
        return {
          success: false,
          message: "Connect NetSuite in Settings → Integrations first"
        };
      }

      // One change at a time. A second migration while one is still pending
      // review would overwrite the only snapshot of the company's real data.
      // The job refuses too — that one is authoritative; this is the nice error.
      const inFlight = await getNetSuiteMigrationRun(client, companyId);
      if (inFlight.data && inFlight.data.status !== "failed") {
        return {
          success: false,
          message:
            "Finish your current NetSuite migration — keep or revert it — first."
        };
      }

      const subsidiaryId = String(formData.get("subsidiaryId") ?? "").trim();
      try {
        const startedRunId = await startNetSuiteMigration({
          companyId,
          userId,
          subsidiaryId: subsidiaryId || null,
          dryRun: intent === "preview"
        });
        return {
          success: true,
          message:
            intent === "preview"
              ? "Previewing your NetSuite data"
              : "Migrating from NetSuite",
          migrationRunId: startedRunId
        };
      } catch (err) {
        return {
          success: false,
          message:
            err instanceof Error ? err.message : "Failed to start the migration"
        };
      }
    }

    case "keep":
    case "dismiss": {
      if (!migrationRunId) {
        return { success: false, message: "Nothing to resolve" };
      }
      try {
        await finalizeNetSuiteMigration({ companyId, migrationRunId });
        return {
          success: true,
          message: intent === "keep" ? "Migration kept" : "Dismissed"
        };
      } catch (err) {
        return data(
          { success: false },
          await flash(request, error(err, "Failed to resolve the migration"))
        );
      }
    }

    case "revert": {
      if (!migrationRunId) {
        return { success: false, message: "Nothing to revert" };
      }
      try {
        await revertNetSuiteMigration({ companyId, userId, migrationRunId });
        return { success: true, message: "Reverting the migration" };
      } catch (err) {
        return data(
          { success: false },
          await flash(request, error(err, "Failed to revert the migration"))
        );
      }
    }

    default:
      return { success: false, message: "Unknown action" };
  }
}

export default function NetSuiteMigrationRoute() {
  const { run, connected } = useLoaderData<typeof loader>();
  const revalidator = useRevalidator();

  // Keep/Dismiss clear the marker through a job, so the row is hidden the moment
  // the user acts rather than a poll later. A REVERT is not resolved here — it
  // keeps running, and the row is the only thing reporting that it is.
  const [resolvedRunIds, setResolvedRunIds] = useState<string[]>([]);

  // Starting only ENQUEUES the job, so the fetcher goes idle a moment later with
  // no marker written yet. This stand-in holds the row until the loader sees a
  // real run, so the page never looks like the click did nothing.
  const [starting, setStarting] = useState(false);
  const hasRun = run !== null;
  useEffect(() => {
    if (hasRun) setStarting(false);
  }, [hasRun]);

  const optimisticRun: NetSuiteMigrationRun | null =
    !hasRun && starting
      ? {
          migrationRunId: "",
          status: "running",
          startedAt: null,
          error: null,
          progress: null,
          dryRun: false,
          hasSnapshot: false,
          report: null,
          subsidiaryChoices: null
        }
      : null;

  const active = (run !== null && run.status !== "failed") || starting;
  const pending =
    (run !== null && !resolvedRunIds.includes(run.migrationRunId)
      ? run
      : null) ?? optimisticRun;

  // The loader is the only source of run state — this revalidate is what moves
  // the row from "reading your NetSuite account" to Keep/Revert. The job
  // throttles its own marker writes, so a faster poll would only re-read the
  // same row.
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => revalidator.revalidate(), 2500);
    return () => clearInterval(id);
  }, [active, revalidator]);

  return (
    <VStack spacing={4} className="p-8 w-full max-w-4xl mx-auto">
      <VStack spacing={1}>
        <Heading size="h3">
          <Trans>Migrate from NetSuite</Trans>
        </Heading>
        <p className="text-muted-foreground text-sm">
          <Trans>
            Move your NetSuite account into Carbon in one click. Preview it
            first, see exactly what comes across and what does not, and put
            everything back if it isn't what you expected.
          </Trans>
        </p>
      </VStack>

      {pending && (
        <MigrationRunRow
          run={pending}
          onResolve={(id) => setResolvedRunIds((prev) => [...prev, id])}
        />
      )}

      <MigrationStartCard
        connected={connected}
        disabled={active}
        subsidiaryChoices={run?.subsidiaryChoices ?? null}
        onStart={setStarting}
      />

      {pending?.report && (
        <MigrationReport report={pending.report} dryRun={pending.dryRun} />
      )}
    </VStack>
  );
}
