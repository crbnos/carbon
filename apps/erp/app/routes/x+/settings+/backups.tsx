// Settings → Backups (company export / in-place restore).
import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import {
  Hidden,
  Input,
  Submit,
  useControlField,
  ValidatedForm,
  validationError,
  validator
} from "@carbon/form";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Heading,
  HStack,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  ModalTitle,
  ScrollArea,
  toast,
  useDisclosure,
  VStack
} from "@carbon/react";
import { convertKbToString } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { useCallback, useEffect, useRef, useState } from "react";
import { LuLoaderCircle } from "react-icons/lu";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  data,
  redirect,
  useFetcher,
  useFetchers,
  useLoaderData,
  useRevalidator
} from "react-router";
import { z } from "zod";
import { DateTime } from "~/components";
import { Confirm } from "~/components/Modals";
import type { CompanyBackupSummary } from "~/modules/settings";
import {
  deleteCompanyBackup,
  exportCompanyBackup,
  getCompanyExportRun,
  getCompanyRestoreRuns,
  totalScopeRows
} from "~/modules/settings";
import {
  dismissCompanyExportFailure,
  finalizeCompanyRestore,
  getCompanyBackups,
  purgeCorruptedRows,
  revertCompanyRestore,
  startCompanyRestore
} from "~/modules/settings/backups.server";
import type { BackupStatus } from "~/modules/settings/ui/Backups";
import {
  BackupContentsInfo,
  BackupSourcePicker,
  backupStatusLabel,
  backupStatusVariant,
  ExcludedRowsInfo,
  formatBackupDate,
  formatBackupName,
  IncludeStorageChoice,
  JobProgressModal,
  RestoreDisclosure,
  RestoreIncludeChoice,
  RestoreReviewRow
} from "~/modules/settings/ui/Backups";
import { canAccessBackups } from "~/utils/backups";
import { getEdgeFunctionErrorMessage } from "~/utils/error";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Backups`,
  to: path.to.backups
};

const exportValidator = z.object({
  intent: z.literal("export"),
  label: z.string().optional(),
  includeStorage: z.enum(["none", "all"])
});

const EXPORT_FORM_ID = "export-backup-form";

/**
 * The Create-backup form's live values, read through the form store rather than
 * off the DOM. The skip-and-retry button lives outside that form (it is in the
 * failure banner) but must submit what the person currently has typed.
 */
function useExportChoices(): { label: string; includeStorage: "none" | "all" } {
  const [label] = useControlField<string>("label", EXPORT_FORM_ID);
  const [includeStorage] = useControlField<"none" | "all">(
    "includeStorage",
    EXPORT_FORM_ID
  );
  return { label: label ?? "", includeStorage: includeStorage ?? "none" };
}

// The skip retry posts the Create form's CURRENT values (label + include) so the
// person gets the backup they just described, falling back to what the failed
// run asked for when the form is untouched.
const exportSkipValidator = z.object({
  intent: z.literal("exportSkipCorrupted"),
  label: z.string().optional(),
  includeStorage: z.enum(["none", "all"]).optional()
});

// `source` is `backup:<path>` — one of this company's own exports (or an
// uploaded copy of one). Restore is always in-place into the current company.
// `includeStorage` picks whether uploaded files (3D models, docs) come along.
const restoreValidator = z.object({
  intent: z.literal("restore"),
  source: z.string().min(1, { message: "Choose a backup to restore" }),
  includeStorage: z.enum(["none", "all"])
});

/**
 * Drop a leftover "failed" export marker before starting a new run. The loader
 * revalidates the instant the action returns, and a still-failed marker makes
 * the page stop tracking the run it just began. A RUNNING marker is never
 * touched — that would orphan a live job's progress.
 */
async function clearStaleExportFailure(
  client: Parameters<typeof getCompanyExportRun>[0],
  companyId: string
) {
  const previous = await getCompanyExportRun(client, companyId);
  if (previous.data?.status === "failed") {
    await dismissCompanyExportFailure(companyId);
  }
}

function requireBackupAccess(email: string | null) {
  // Internal-only in real deployments while multi-tenant hardening is pending;
  // open to everyone on a local dev stack.
  if (!canAccessBackups(email)) {
    throw redirect(path.to.settings);
  }
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId, email } = await requirePermissions(request, {
    update: "settings"
  });
  requireBackupAccess(email);

  const [backupsList, restoreRuns, exportRun] = await Promise.all([
    getCompanyBackups(client, companyId),
    getCompanyRestoreRuns(client, companyId),
    getCompanyExportRun(client, companyId)
  ]);

  return {
    companyId,
    files: backupsList.data ?? [],
    restoreRuns: restoreRuns.data ?? [],
    exportRun: exportRun.data
  };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId, email } = await requirePermissions(
    request,
    {
      update: "settings"
    }
  );
  requireBackupAccess(email);

  const formData = await request.formData();
  const intent = formData.get("intent");

  switch (intent) {
    case "export": {
      const validation = await validator(exportValidator).validate(formData);
      if (validation.error) return validationError(validation.error);

      const { label, includeStorage } = validation.data;
      await clearStaleExportFailure(client, companyId);
      const result = await exportCompanyBackup(client, {
        companyId,
        userId,
        label: label || undefined,
        includeStorage
      });
      if (result.error)
        return {
          success: false,
          message: await getEdgeFunctionErrorMessage(
            result.error,
            "Failed to start backup"
          )
        };
      return {
        success: true,
        message: "Backup started",
        started: "export" as const
      };
    }

    // Restore replaces the current company's data with a backup, in place. The
    // job snapshots first so it can be reverted. We return the run id so the
    // client can open the progress modal and poll for completion.
    case "restore": {
      const validation = await validator(restoreValidator).validate(formData);
      if (validation.error) return validationError(validation.error);

      // The source is the backup folder name. Reject anything with a path
      // separator (traversal / legacy gz paths).
      const source = validation.data.source.replace(/^backup:/, "");
      if (!source || source.includes("/")) {
        return { success: false, message: "Choose one of your backups" };
      }

      // One restore at a time. A second restore while one is still pending review
      // would snapshot the already-restored state and tangle the revert chain.
      const inFlight = await getCompanyRestoreRuns(client, companyId);
      if (inFlight.data?.some((r) => r.status !== "failed")) {
        return {
          success: false,
          message: "Finish your current restore — keep or revert it — first."
        };
      }

      try {
        const restoreRunId = await startCompanyRestore({
          companyId,
          userId,
          filePath: source,
          includeStorage: validation.data.includeStorage,
          label: source
        });
        return { success: true, message: "Restore started", restoreRunId };
      } catch (err) {
        return {
          success: false,
          message:
            err instanceof Error ? err.message : "Failed to start restore"
        };
      }
    }

    // keep / dismiss / revert / delete are fetcher buttons (modal + review card
    // use them) and return JSON so the UI can react in place.
    case "keep": {
      const restoreRunId = String(formData.get("restoreRunId") ?? "");
      if (!restoreRunId)
        return { success: false, message: "Missing restore run" };
      await finalizeCompanyRestore({ companyId, restoreRunId });
      return { success: true, message: "Restore kept" };
    }

    // Same cleanup as keep (drop the snapshot + marker), but for a FAILED run —
    // nothing was changed, so it's a dismissal, not a "keep".
    case "dismiss": {
      const restoreRunId = String(formData.get("restoreRunId") ?? "");
      if (!restoreRunId)
        return { success: false, message: "Missing restore run" };
      await finalizeCompanyRestore({ companyId, restoreRunId });
      return { success: true, message: "Dismissed" };
    }

    case "revert": {
      const restoreRunId = String(formData.get("restoreRunId") ?? "");
      if (!restoreRunId)
        return { success: false, message: "Missing restore run" };
      await revertCompanyRestore({ companyId, restoreRunId });
      return {
        success: true,
        message: "Reverting — your previous data is being restored"
      };
    }

    // Acknowledge a failed export — clears the failure marker. Any partial
    // backup folder stays in the list (as "Incomplete") until deleted.
    case "dismissExportFailure": {
      await dismissCompanyExportFailure(companyId);
      return { success: true, message: "Dismissed" };
    }

    // The ONE sanctioned bypass of the export's closure guard: re-run the
    // failed backup (same label + include setting) leaving out the rows whose
    // links escape this company. Only offered for that failure class — the
    // marker's `reason` is what the job wrote, not something the client sends.
    case "exportSkipCorrupted": {
      const run = await getCompanyExportRun(client, companyId);
      if (
        run.data?.status !== "failed" ||
        run.data.reason !== "scope-violations"
      ) {
        return {
          success: false,
          message: "There is no failed backup to retry"
        };
      }
      const validation =
        await validator(exportSkipValidator).validate(formData);
      if (validation.error) return validationError(validation.error);
      // The banner posts the Create form's current values, and that form is
      // seeded from this same failed run — so these fallbacks only matter if the
      // fields are missing entirely.
      const label = validation.data.label || run.data.label || undefined;
      const includeStorage =
        validation.data.includeStorage ?? run.data.includeStorage ?? "none";
      await clearStaleExportFailure(client, companyId);
      const result = await exportCompanyBackup(client, {
        companyId,
        userId,
        label,
        includeStorage,
        skipCorrupted: true
      });
      if (result.error)
        return {
          success: false,
          message: await getEdgeFunctionErrorMessage(
            result.error,
            "Failed to start backup"
          )
        };
      return {
        success: true,
        message: "Backup started",
        started: "export" as const
      };
    }

    // A restore that died at its pre-restore snapshot because the LIVE data has
    // rows escaping company scope: permanently delete those rows (user-confirmed
    // in the UI), drop the failed run, and start the same restore again.
    case "purgeAndRestore": {
      const restoreRunId = String(formData.get("restoreRunId") ?? "");
      const runs = await getCompanyRestoreRuns(client, companyId);
      const failed = runs.data?.find((r) => r.restoreRunId === restoreRunId);
      if (
        !failed ||
        failed.status !== "failed" ||
        failed.reason !== "scope-violations" ||
        !failed.filePath
      ) {
        return {
          success: false,
          message: "This restore can't be retried this way"
        };
      }
      if (runs.data?.some((r) => r.status !== "failed")) {
        return {
          success: false,
          message: "Finish your current restore — keep or revert it — first."
        };
      }
      // The delete commits on its own; the restore is enqueued after. Those are
      // two steps and cannot be one transaction (the second is a job trigger),
      // so the failure messages must tell the user WHICH half happened —
      // "couldn't remove the rows" and "removed the rows but the restore didn't
      // start" call for opposite next actions, and only the second is lossy.
      let deleted: Array<{ table: string; rows: number }>;
      try {
        ({ deleted } = await purgeCorruptedRows(companyId));
      } catch (err) {
        return {
          success: false,
          message:
            err instanceof Error
              ? err.message
              : "Failed to remove corrupted data — nothing was deleted"
        };
      }

      const rows = deleted.reduce((sum, d) => sum + d.rows, 0);
      try {
        await finalizeCompanyRestore({ companyId, restoreRunId });
        const newRunId = await startCompanyRestore({
          companyId,
          userId,
          filePath: failed.filePath,
          includeStorage: failed.includeStorage ?? "all",
          label: failed.label ?? failed.filePath
        });
        return {
          success: true,
          message: `Removed ${rows} row${rows === 1 ? "" : "s"} — restoring`,
          restoreRunId: newRunId,
          deleted
        };
      } catch (err) {
        return {
          success: false,
          message:
            `Removed ${rows} row${rows === 1 ? "" : "s"}, but the restore did not start` +
            ` — start it again from the list. (${
              err instanceof Error ? err.message : "unknown error"
            })`
        };
      }
    }

    case "delete": {
      const name = String(formData.get("name") ?? "");
      if (!name || name.includes("/"))
        return data({}, await flash(request, error(null, "Invalid backup")));

      const result = await deleteCompanyBackup(client, companyId, name);
      if (result.error)
        return data(
          {},
          await flash(request, error(result.error, "Failed to delete backup"))
        );
      return data({}, await flash(request, success("Backup deleted")));
    }

    default:
      return data({}, await flash(request, error(null, "Unknown action")));
  }
}

export default function BackupsRoute() {
  const { files, restoreRuns, exportRun } = useLoaderData<typeof loader>();
  const readyBackups = files.filter((f) => f.status === "ready");
  const fetcher = useFetcher<{
    success?: boolean;
    message?: string;
    restoreRunId?: string;
    started?: "export";
    deleted?: Array<{ table: string; rows: number }>;
  }>();
  const [active, setActive] = useState<{
    runId?: string;
    mode: "export" | "restore" | "revert";
  } | null>(null);
  // Latest list, read without re-triggering effects when it changes.
  const filesRef = useRef(files);
  filesRef.current = files;

  const exportRunning = exportRun?.status === "running";
  const exportFailed = exportRun?.status === "failed";
  // The failed marker visible right now — the one a Create/Skip click replaces.
  const supersededFailureRef = useRef<string | null>(null);
  supersededFailureRef.current = exportFailed
    ? (exportRun?.startedAt ?? null)
    : null;

  // The in-progress export we're tracking this session. Set the instant the user
  // clicks "Create backup" (optimistic — before the job writes its first marker,
  // so the row shows immediately, Supabase-style) or adopted from the marker for
  // a run started elsewhere (reload / another tab). `baseline` = the READY backups
  // when tracking began; the run is complete once a ready backup outside it
  // appears in the (revalidated) list.
  const [runningExport, setRunningExport] = useState<{
    startedAt: string | null;
    baseline: Set<string>;
    /**
     * The `startedAt` of the failed marker this run REPLACED, if any. The action
     * clears that marker before starting, but a revalidation already in flight
     * can still deliver it — and it is stale precisely because it is that exact
     * row, which is a comparison of identity rather than of two clocks (the
     * marker's is the server's, ours is the browser's; skew must not decide it).
     */
    supersedes: string | null;
  } | null>(null);

  // Baseline = EVERY folder already listed, ready or pending. A failed export
  // leaves a pending folder behind; if the baseline held only ready names, that
  // same folder later reading "ready" would look like the new run finishing and
  // the spinner row would vanish seconds after the retry started.
  const knownBackupNames = useCallback(
    () => new Set(filesRef.current.map((f) => f.name)),
    []
  );

  const exportCompleted =
    runningExport != null &&
    files.some(
      (f) => f.status === "ready" && !runningExport.baseline.has(f.name)
    );
  const runningExportStartedAt =
    exportRun?.startedAt ?? runningExport?.startedAt ?? null;

  // Adopt a run this session didn't start (page reload, another tab).
  useEffect(() => {
    if (exportRunning && !runningExport) {
      // Adopted, not started here — there is no superseded marker to ignore.
      setRunningExport({
        startedAt: exportRun?.startedAt ?? null,
        baseline: knownBackupNames(),
        supersedes: null
      });
    }
  }, [exportRunning, runningExport, exportRun, knownBackupNames]);

  // Stop tracking once the run fails, or completes and isn't being shown in the
  // detail modal (the modal keeps `completed` true until the user closes it).
  //
  // A "failed" marker only ends tracking when it belongs to THIS run — see
  // `supersedes` above for how the superseded one is recognised.
  const failedIsStale =
    exportFailed &&
    runningExport?.supersedes != null &&
    exportRun?.startedAt === runningExport.supersedes;
  useEffect(() => {
    const exportModalOpen = active?.mode === "export";
    if (
      runningExport &&
      ((exportFailed && !failedIsStale) ||
        (exportCompleted && !exportModalOpen))
    ) {
      setRunningExport(null);
    }
  }, [runningExport, exportCompleted, exportFailed, failedIsStale, active]);

  const openExportProgress = useCallback(() => {
    setActive({ mode: "export" });
  }, []);

  // The export runs fully server-side — poll the list to catch completion while
  // the detail modal is closed (the modal runs its own faster poll when open).
  const revalidator = useRevalidator();
  useEffect(() => {
    if (!runningExport || active) return;
    const id = setInterval(() => revalidator.revalidate(), 2500);
    return () => clearInterval(id);
  }, [runningExport, active, revalidator]);

  // keep / dismiss / revert finalize the run via an async Inngest job, so the
  // marker is still present on the next revalidation. Hide the row optimistically
  // the moment the user acts so it doesn't linger until the job lands.
  const [resolvedRunIds, setResolvedRunIds] = useState<Set<string>>(new Set());
  const resolveRun = (runId: string) =>
    setResolvedRunIds((prev) => new Set(prev).add(runId));
  const visibleRestoreRuns = restoreRuns.filter(
    (r) => !resolvedRunIds.has(r.restoreRunId)
  );

  // The failed restore whose "Remove corrupted data and restore" is being
  // confirmed. The modal lives here (not in the row) so the purge submits through
  // the route fetcher and the existing `restoreRunId` effect opens the progress
  // modal for the NEW run.
  const [purgeRun, setPurgeRun] = useState<
    (typeof visibleRestoreRuns)[number] | null
  >(null);
  // Distinct ROWS, not per-edge violations — a row escaping scope through three
  // of its FKs is one row, and this number sits on an irreversible-delete button.
  const purgeRowCount = totalScopeRows(purgeRun?.violationRowsByTable ?? []);
  const exportChoices = useExportChoices();
  // A failed run's label and include setting seed the form, so "Skip corrupted
  // rows and retry" reuses what that run asked for and the person can see it.
  // `defaultValues` is only read on mount, hence the key.
  const exportDefaults = {
    key:
      exportFailed && exportRun?.startedAt
        ? `failed-${exportRun.startedAt}`
        : "new",
    label: (exportFailed ? exportRun?.label : null) ?? "",
    includeStorage: ((exportFailed ? exportRun?.includeStorage : null) ??
      "none") as "none" | "all"
  };

  const startRevert = (runId: string) => {
    fetcher.submit(
      { intent: "revert", restoreRunId: runId },
      { method: "post" }
    );
    resolveRun(runId);
    setActive({ runId, mode: "revert" });
  };

  useEffect(() => {
    const result = fetcher.data;
    if (result?.message === undefined) return;
    // Export is non-blocking: drop an in-progress row immediately (the user opens
    // the detail modal by clicking it) — no toast, no forced modal. Restore opens
    // its modal directly. Everything else (keep/revert/dismiss/errors) toasts.
    if (result.success && result.started === "export") {
      setRunningExport({
        startedAt: new Date().toISOString(),
        baseline: knownBackupNames(),
        supersedes: supersededFailureRef.current
      });
      return;
    }
    if (result.success && result.restoreRunId) {
      // A purge-and-restore also reports how many rows it removed.
      if (result.deleted) toast.success(result.message);
      setActive({ runId: result.restoreRunId, mode: "restore" });
      return;
    }
    if (result.success) toast.success(result.message);
    else toast.error(result.message);
  }, [fetcher.data, knownBackupNames]);

  return (
    <ScrollArea className="w-full h-[calc(100dvh-var(--topbar-height))]">
      <div className="py-12 px-4 max-w-[72rem] mx-auto flex flex-col gap-4">
        <Heading size="h3">Backups</Heading>

        {/* Create + Restore — equal-height cards, footers aligned. */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-stretch">
          <Card className="flex flex-col">
            <ValidatedForm
              id={EXPORT_FORM_ID}
              key={exportDefaults.key}
              method="post"
              validator={exportValidator}
              defaultValues={{
                label: exportDefaults.label,
                includeStorage: exportDefaults.includeStorage
              }}
              fetcher={fetcher}
              className="flex flex-1 flex-col"
            >
              <CardHeader>
                <CardTitle className="flex items-center gap-1.5">
                  Create a backup
                  <BackupContentsInfo />
                </CardTitle>
                <CardDescription>
                  Snapshot all of this company's non-sensitive data into a
                  downloadable file.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex-1">
                <Hidden name="intent" value="export" />
                <div className="flex flex-col gap-6">
                  <Input name="label" label="Label" />
                  <div className="flex flex-col gap-1.5">
                    <span className="text-sm">Include</span>
                    <IncludeStorageChoice />
                  </div>
                </div>
              </CardContent>
              <CardFooter>
                <Submit>Create backup</Submit>
              </CardFooter>
            </ValidatedForm>
          </Card>

          <Card className="flex flex-col">
            <ValidatedForm
              method="post"
              validator={restoreValidator}
              defaultValues={{ source: "", includeStorage: "all" }}
              fetcher={fetcher}
              className="flex flex-1 flex-col"
            >
              <CardHeader>
                <CardTitle>Restore from a backup</CardTitle>
                <CardDescription>
                  Replace this company's data with any backup — snapshotted
                  first, so you can revert.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex-1">
                <Hidden name="intent" value="restore" />
                <div className="flex flex-col gap-6">
                  <div className="flex flex-col gap-1.5">
                    <span className="text-sm">Source</span>
                    <BackupSourcePicker backups={readyBackups} />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <span className="text-sm">Include</span>
                    <RestoreIncludeChoice />
                  </div>
                </div>
              </CardContent>
              <CardFooter>
                {/* The disclosure screen is the only way this form submits — it
                    submits through the fetcher rather than the form's own submit
                    button, because the modal is portaled outside the <form>. */}
                <RestoreDisclosure
                  backups={readyBackups}
                  onConfirm={({ source, includeStorage }) =>
                    fetcher.submit(
                      { intent: "restore", source, includeStorage },
                      { method: "post" }
                    )
                  }
                />
              </CardFooter>
            </ValidatedForm>
          </Card>
        </div>

        {visibleRestoreRuns.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Restored — review</CardTitle>
              <CardDescription>
                A restore replaced this company's data. Keep it, or revert to
                put back exactly what was here before.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <VStack spacing={2}>
                {visibleRestoreRuns.map((run) => (
                  <RestoreReviewRow
                    key={run.restoreRunId}
                    run={run}
                    onKeep={() => {
                      fetcher.submit(
                        { intent: "keep", restoreRunId: run.restoreRunId },
                        { method: "post" }
                      );
                      resolveRun(run.restoreRunId);
                    }}
                    onRevert={() => startRevert(run.restoreRunId)}
                    onDismiss={() => {
                      fetcher.submit(
                        { intent: "dismiss", restoreRunId: run.restoreRunId },
                        { method: "post" }
                      );
                      resolveRun(run.restoreRunId);
                    }}
                    onPurgeAndRestore={() => setPurgeRun(run)}
                  />
                ))}
              </VStack>
            </CardContent>
          </Card>
        )}

        {purgeRun && (
          <Modal
            open
            onOpenChange={(open) => {
              if (!open) setPurgeRun(null);
            }}
          >
            <ModalOverlay />
            <ModalContent>
              <ModalHeader>
                <ModalTitle>
                  <Plural
                    value={purgeRowCount}
                    one="Permanently delete # row?"
                    other="Permanently delete # rows?"
                  />
                </ModalTitle>
              </ModalHeader>
              <ModalBody>
                <p className="text-sm text-muted-foreground">
                  <Trans>
                    These rows link to data outside this company, so a safety
                    copy of your current data can't be made. Deleting them
                    cannot be undone. If they turn out to be shared with other
                    companies in this group, nothing is deleted and the restore
                    doesn't start.
                  </Trans>
                </p>
                {/* Per TABLE, not per FK edge: the title counts distinct rows,
                    and a per-edge list beside it would show larger numbers for
                    the same delete. */}
                <ul className="mt-3 flex flex-col gap-1 text-xs font-mono">
                  {purgeRun.violationRowsByTable.map((t) => (
                    <li key={t.table} className="flex justify-between gap-3">
                      <span className="break-all">{t.table}</span>
                      <span className="tabular-nums shrink-0">
                        {t.rows.toLocaleString()}
                      </span>
                    </li>
                  ))}
                </ul>
              </ModalBody>
              <ModalFooter>
                <Button variant="secondary" onClick={() => setPurgeRun(null)}>
                  <Trans>Cancel</Trans>
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => {
                    fetcher.submit(
                      {
                        intent: "purgeAndRestore",
                        restoreRunId: purgeRun.restoreRunId
                      },
                      { method: "post" }
                    );
                    resolveRun(purgeRun.restoreRunId);
                    setPurgeRun(null);
                  }}
                >
                  <Trans>Delete and restore</Trans>
                </Button>
              </ModalFooter>
            </ModalContent>
          </Modal>
        )}

        {active && (
          <JobProgressModal
            mode={active.mode}
            runId={active.runId}
            completed={exportCompleted}
            onClose={() => setActive(null)}
          />
        )}

        <Card>
          <CardHeader>
            <CardTitle>Backups</CardTitle>
            <CardDescription>
              Past backups stored in this company's bucket.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {files.length === 0 && !runningExport && !exportFailed ? (
              <p className="text-sm text-muted-foreground">No backups yet.</p>
            ) : (
              <VStack spacing={2}>
                {exportFailed && !runningExport && (
                  <HStack className="w-full justify-between rounded-lg border border-destructive/50 bg-destructive/5 p-3">
                    <VStack spacing={0} className="min-w-0">
                      <span className="text-sm font-medium">
                        <Trans>Backup failed</Trans>
                      </span>
                      {/* Never "the system", and never "contact support" for
                          something the reason already explains. The one-line
                          copy names the cause in product words; the exact
                          tables and the raw error live in the "i" popover. */}
                      <span className="break-words text-xs text-muted-foreground">
                        {exportRun?.reason === "scope-violations" ? (
                          <Plural
                            value={totalScopeRows(
                              exportRun.violationRowsByTable
                            )}
                            one="# row links to data outside this company, so it can't be backed up. Skipping it backs up everything else."
                            other="# rows link to data outside this company, so they can't be backed up. Skipping them backs up everything else."
                          />
                        ) : (
                          <Trans>This backup could not be completed.</Trans>
                        )}{" "}
                        <ExcludedRowsInfo
                          excludedRows={exportRun?.violations ?? []}
                          title={<Trans>Why this backup failed</Trans>}
                          description={
                            exportRun?.reason === "scope-violations" ? (
                              <Trans>
                                Each line is a link from this company's data to
                                a row it doesn't own. A backup with these rows
                                could never be restored.
                              </Trans>
                            ) : (
                              <Trans>The backup job reported this error.</Trans>
                            )
                          }
                          technical={exportRun?.error}
                        />
                      </span>
                    </VStack>
                    <HStack spacing={2} className="shrink-0">
                      {exportRun?.reason === "scope-violations" && (
                        <Button
                          isLoading={
                            fetcher.state !== "idle" &&
                            fetcher.formData?.get("intent") ===
                              "exportSkipCorrupted"
                          }
                          onClick={() =>
                            // Post the Create form's CURRENT values so the retry
                            // is the backup the person just described.
                            fetcher.submit(
                              {
                                intent: "exportSkipCorrupted",
                                label: exportChoices.label,
                                includeStorage: exportChoices.includeStorage
                              },
                              { method: "post" }
                            )
                          }
                        >
                          <Trans>Skip corrupted rows and retry</Trans>
                        </Button>
                      )}
                      <Button
                        variant="secondary"
                        onClick={() =>
                          fetcher.submit(
                            { intent: "dismissExportFailure" },
                            { method: "post" }
                          )
                        }
                      >
                        <Trans>Dismiss</Trans>
                      </Button>
                    </HStack>
                  </HStack>
                )}

                {/* The in-flight export — fully server-side; appears the instant
                    "Create backup" is clicked. Click it to open the progress
                    dialog. Its partially-written folder (if any) is hidden below
                    to avoid a duplicate row. */}
                {runningExport && !exportCompleted && (
                  <button
                    type="button"
                    onClick={openExportProgress}
                    className="flex w-full items-center justify-between rounded-lg border p-3 text-left transition-colors hover:bg-muted/50"
                  >
                    <VStack spacing={0}>
                      <span className="text-sm font-medium">
                        Creating backup…
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {runningExportStartedAt
                          ? `Started ${formatBackupDate(runningExportStartedAt)}`
                          : "Starting…"}
                      </span>
                    </VStack>
                    <LuLoaderCircle className="h-4 w-4 shrink-0 animate-spin text-primary motion-reduce:animate-none" />
                  </button>
                )}

                {files
                  .filter((f) => !(runningExport && f.status === "pending"))
                  .map((file) => (
                    <BackupRow key={file.name} file={file} />
                  ))}
              </VStack>
            )}
          </CardContent>
        </Card>
      </div>
    </ScrollArea>
  );
}

function BackupRow({ file }: { file: CompanyBackupSummary }) {
  const { t } = useLingui();
  const deleteDisclosure = useDisclosure();
  const isDeleting = useFetchers().some((fetcher) => {
    const intent = fetcher.formData?.get("intent");
    const backupName = fetcher.formData?.get("name");
    return (
      fetcher.state !== "idle" &&
      fetcher.formAction === path.to.backups &&
      intent === "delete" &&
      backupName === file.name
    );
  });
  const name = file.label || formatBackupName(file.name);
  const excluded = totalScopeRows(file.excludedRowsByTable);
  // A half-written folder has no verdict — the incompleteness is the whole story.
  // A null verdict means the schema could not be read: show no badge rather than
  // a green one nothing actually checked.
  const status: BackupStatus | null =
    file.status === "pending"
      ? "incomplete"
      : (file.compatibility?.status ?? null);

  return (
    <HStack
      className={`w-full justify-between border rounded-lg p-3 ${
        file.status === "pending" || isDeleting ? "opacity-70" : ""
      }`}
    >
      <VStack spacing={0} className="min-w-0">
        <span className="text-sm font-medium truncate">{name}</span>
        <span className="text-xs text-muted-foreground">
          {file.status === "pending" ? (
            // A pending folder with no running export is a dead partial — never
            // lie with "Preparing…".
            <Trans>Incomplete backup — not restorable</Trans>
          ) : (
            <>
              <DateTime value={file.exportedAt} variant="absolute" />
              {file.sizeBytes ? (
                <>
                  {" · "}
                  {convertKbToString(Math.round(file.sizeBytes / 1024))}
                </>
              ) : null}
              {excluded > 0 ? (
                <>
                  {" · "}
                  <Plural
                    value={excluded}
                    one="# row excluded"
                    other="# rows excluded"
                  />{" "}
                  <ExcludedRowsInfo excludedRows={file.excludedRows} />
                </>
              ) : null}
            </>
          )}
        </span>
      </VStack>
      <HStack spacing={2} className="shrink-0">
        {/* Status sits with the actions, not against the name — it describes
            what you can DO with the row (restore it or not), and a loud chip
            beside a quiet text-sm title read as part of the name. */}
        {status ? (
          <Badge variant={backupStatusVariant(status)}>
            {t(backupStatusLabel(status))}
          </Badge>
        ) : null}
        {file.status === "ready" && !isDeleting ? (
          <Button asChild variant="secondary">
            <a
              href={`/api/settings/backup-archive/${encodeURIComponent(
                file.name
              )}`}
              download
            >
              Download
            </a>
          </Button>
        ) : (
          <Button variant="secondary" isDisabled>
            Download
          </Button>
        )}
        <Button
          type="button"
          variant="destructive"
          isLoading={isDeleting}
          isDisabled={isDeleting}
          onClick={deleteDisclosure.onOpen}
        >
          <Trans>Delete</Trans>
        </Button>
        <Confirm
          action={path.to.backups}
          isOpen={deleteDisclosure.isOpen}
          title={t`Delete ${name}`}
          text={t`Are you sure you want to delete ${
            name
          }? This cannot be undone.`}
          confirmText={t`Delete`}
          cancelText={isDeleting ? t`Close` : t`Cancel`}
          confirmVariant="destructive"
          onCancel={deleteDisclosure.onClose}
          onSubmit={deleteDisclosure.onClose}
        >
          <input type="hidden" name="intent" value="delete" />
          <input type="hidden" name="name" value={file.name} />
        </Confirm>
      </HStack>
    </HStack>
  );
}
