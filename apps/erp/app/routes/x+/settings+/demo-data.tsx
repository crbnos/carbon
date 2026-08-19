// Settings → Demo Data (apply an industry demo dataset, keep it or revert).
import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { DATASETS, datasetKeys } from "@carbon/database/datasets";
import { Heading, VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useEffect, useMemo, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, redirect, useLoaderData, useRevalidator } from "react-router";
import type { CompanyTemplateRun } from "~/modules/settings";
import { getCompanyTemplateRun } from "~/modules/settings";
import {
  finalizeCompanyTemplate,
  revertCompanyTemplate,
  startCompanyTemplate
} from "~/modules/settings/demoData.server";
import {
  TemplateCards,
  TemplateReviewRow
} from "~/modules/settings/ui/DemoData";
import { canAccessBackups } from "~/utils/backups";
import { path } from "~/utils/path";

export const handle = {
  breadcrumb: msg`Demo Data`,
  to: path.to.demoData
};

function requireDemoDataAccess(email: string | null) {
  // Same gate as Backups: this replaces a company's data wholesale and carries
  // the same unhardened multi-tenant caveats, so it stays internal-only in real
  // deployments and open to everyone on a local dev stack.
  if (!canAccessBackups(email)) {
    throw redirect(path.to.settings);
  }
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId, email } = await requirePermissions(request, {
    update: "settings"
  });
  requireDemoDataAccess(email);

  const run = await getCompanyTemplateRun(client, companyId);

  // Read from DATASETS rather than a hardcoded list, so a new dataset shows up
  // here without a second edit. The loader is server-only, so this import never
  // reaches the browser bundle.
  const datasets = datasetKeys().map((key) => ({
    key,
    label: DATASETS[key].label
  }));

  return { run: run.data, datasets };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId, email } = await requirePermissions(
    request,
    {
      update: "settings"
    }
  );
  requireDemoDataAccess(email);

  const formData = await request.formData();
  const intent = formData.get("intent");
  const templateRunId = String(formData.get("templateRunId") ?? "");

  switch (intent) {
    // Replaces this company's data with a demo dataset. The job snapshots first
    // so it can be reverted; the snapshot is also what makes the wipe safe.
    case "apply": {
      const datasetKey = String(formData.get("datasetKey") ?? "");
      if (!datasetKey || !datasetKeys().includes(datasetKey as never)) {
        return { success: false, message: "Choose a demo dataset" };
      }

      // One change at a time. A second apply while one is still pending review
      // would overwrite the only snapshot of the user's real data.
      const inFlight = await getCompanyTemplateRun(client, companyId);
      if (inFlight.data && inFlight.data.status !== "failed") {
        return {
          success: false,
          message:
            "Finish your current demo data change — keep or revert it — first."
        };
      }

      try {
        const startedRunId = await startCompanyTemplate({
          companyId,
          userId,
          datasetKey
        });
        return {
          success: true,
          message: "Applying demo data",
          templateRunId: startedRunId
        };
      } catch (err) {
        return {
          success: false,
          message:
            err instanceof Error
              ? err.message
              : "Failed to start the demo data change"
        };
      }
    }

    // Keep (a ready run) and Dismiss (a failed one) are the same operation —
    // drop the snapshot, then the marker — and differ only in what the user is
    // told. The job refuses anything that isn't settled.
    case "keep":
    case "dismiss": {
      if (!templateRunId) {
        return { success: false, message: "Nothing to resolve" };
      }
      try {
        await finalizeCompanyTemplate({ companyId, templateRunId });
        return {
          success: true,
          message: intent === "keep" ? "Demo data kept" : "Dismissed"
        };
      } catch (err) {
        return data(
          { success: false },
          await flash(request, error(err, "Failed to resolve the demo data"))
        );
      }
    }

    case "revert": {
      if (!templateRunId) {
        return { success: false, message: "Nothing to revert" };
      }
      try {
        await revertCompanyTemplate({ companyId, userId, templateRunId });
        return { success: true, message: "Reverting demo data" };
      } catch (err) {
        return data(
          { success: false },
          await flash(request, error(err, "Failed to revert the demo data"))
        );
      }
    }

    default:
      return { success: false, message: "Unknown action" };
  }
}

export default function DemoDataRoute() {
  const { run, datasets } = useLoaderData<typeof loader>();
  const revalidator = useRevalidator();

  // Keep/Dismiss clear the marker through a job, so the row is hidden the moment
  // the user acts rather than a poll later. A REVERT is not resolved here — it
  // keeps running, and the row is the only thing reporting that it is.
  const [resolvedRunIds, setResolvedRunIds] = useState<string[]>([]);

  // Apply only ENQUEUES the job, so its fetcher goes idle a moment later with no
  // marker written yet — without this the button's spinner vanishes and the page
  // looks like nothing happened. Stands in until the loader sees a real run.
  const [pendingApplyKey, setPendingApplyKey] = useState<string | null>(null);
  const hasRun = run !== null;
  useEffect(() => {
    if (hasRun) setPendingApplyKey(null);
  }, [hasRun]);

  const optimisticRun: CompanyTemplateRun | null =
    !hasRun && pendingApplyKey !== null
      ? {
          templateRunId: "",
          status: "running",
          datasetKey: pendingApplyKey,
          startedAt: null,
          error: null,
          progress: null,
          hasSnapshot: false
        }
      : null;

  const active =
    (run !== null && run.status !== "failed") || pendingApplyKey !== null;
  const pending =
    (run !== null && !resolvedRunIds.includes(run.templateRunId)
      ? run
      : null) ?? optimisticRun;

  // The loader is the only source of run state — this revalidate is what moves
  // the row from "applying…" to Keep/Revert. The job throttles its own marker
  // writes, so a faster poll would only re-read the same row.
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => revalidator.revalidate(), 2500);
    return () => clearInterval(id);
  }, [active, revalidator]);

  const datasetLabel = useMemo(
    () => datasets.find((d) => d.key === pending?.datasetKey)?.label ?? null,
    [datasets, pending]
  );

  return (
    <VStack spacing={4} className="p-8 w-full max-w-4xl mx-auto">
      <VStack spacing={1}>
        <Heading size="h3">
          <Trans>Demo Data</Trans>
        </Heading>
        <p className="text-muted-foreground text-sm">
          <Trans>
            Fill this company with a realistic industry story so every screen
            has something in it. You can put back what was here before.
          </Trans>
        </p>
      </VStack>

      {pending && (
        <TemplateReviewRow
          run={pending}
          datasetLabel={datasetLabel}
          onResolve={(id) => setResolvedRunIds((prev) => [...prev, id])}
        />
      )}

      <TemplateCards
        datasets={datasets}
        disabled={active}
        onApply={setPendingApplyKey}
      />
    </VStack>
  );
}
