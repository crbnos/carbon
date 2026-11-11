// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Settings → Backups (company export / in-place restore).

import { assertIsPost, error, success } from "@carbon/auth";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { convertKbToString } from "@carbon/files";
import {
  Hidden,
  Input,
  Submit,
  useControlField,
  ValidatedForm,
  validationError,
  validator
} from "@carbon/form";
import { trigger } from "@carbon/jobs";
import { useRevalidator } from "@carbon/query";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  HStack,
  ScrollArea,
  toast,
  useDisclosure,
  VStack
} from "@carbon/react";
import { datetime, getErrorMessage } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import { useCallback, useEffect, useRef, useState } from "react";
import { LuLoaderCircle } from "react-icons/lu";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, useFetcher, useFetchers, useLoaderData } from "react-router";
import { z } from "zod";
import { DateTime } from "~/components";
import { Confirm } from "~/components/Modals";
import { SettingsPageHeading } from "~/components/SettingsPage";
import { DEFAULT_INCLUDE_STORAGE } from "~/modules/settings/settings.models";
import {
  deleteCompanyBackup,
  dismissCompanyExportFailure,
  exportCompanyBackup,
  getBackupInUse,
  getCompanyBackups,
  getCompanyExportRun,
  getCompanyRestoreRuns,
  getPendingChange,
  isUserBackupName,
  purgeAndRetry,
  requireBackupAccess,
  startCompanyRestore
} from "~/modules/settings/settings.service";
import type { CompanyBackupSummary } from "~/modules/settings/types";
import {
  IncludeStorageChoice,
  RestoreIncludeChoice
} from "~/modules/settings/ui/Backups/BackupChoices";
import { BackupContentsInfo } from "~/modules/settings/ui/Backups/BackupContentsInfo";
import { JobProgressModal } from "~/modules/settings/ui/Backups/BackupProgressModal";
import { BackupSourcePicker } from "~/modules/settings/ui/Backups/BackupSourcePicker";
import { ExcludedRowsInfo } from "~/modules/settings/ui/Backups/ExcludedRowsInfo";
import type { BackupStatus } from "~/modules/settings/ui/Backups/format";
import {
  backupStatusLabel,
  backupStatusVariant,
  formatBackupDate,
  formatBackupName,
  JOB_POLL,
  totalScopeRows
} from "~/modules/settings/ui/Backups/format";
import { PurgeCorruptedRowsModal } from "~/modules/settings/ui/Backups/PurgeCorruptedRowsModal";
import { RestoreDisclosure } from "~/modules/settings/ui/Backups/RestoreDisclosure";
import { RestoreReviewRow } from "~/modules/settings/ui/Backups/RestoreReviewRow";
import { getDatabaseClient } from "~/services/database.server";
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
  return {
    label: label ?? "",
    includeStorage: includeStorage ?? DEFAULT_INCLUDE_STORAGE.export
  };
}

// The skip retry posts the Create form's CURRENT values (label + include) so the
// person gets the backup they just described, falling back to what the failed
// run asked for when the form is untouched.
const exportSkipValidator = z.object({
  intent: z.literal("exportSkipCorrupted"),
  label: z.string().optional(),
  includeStorage: z.enum(["none", "all"]).optional()
});

// `source` is a backup folder name — one of this company's own exports (or an
// uploaded copy of one). Restore is always in-place into the current company.
// `includeStorage` picks whether uploaded files (3D models, docs) come along.
const restoreValidator = z.object({
  intent: z.literal("restore"),
  source: z.string().min(1, { message: "Choose a backup to restore" }),
  includeStorage: z.enum(["none", "all"]),
  /** The company the confirm dialog named. Set by the dialog, not a field. */
  companyId: z.string().optional()
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
  if ((await getCompanyExportRun(client, companyId))?.status === "failed") {
    await dismissCompanyExportFailure(companyId);
  }
}

const PENDING_MESSAGE = {
  restore: "Finish your current restore — keep or revert it — first.",
  template: "Finish your current demo data change — keep or revert it — first."
} as const;

const IN_USE_MESSAGE = {
  restore:
    "A restore is using this backup. Keep, revert or dismiss it, then delete the backup.",
  export: "This backup is still being created."
} as const;

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requireBackupAccess(request);

  const [files, restoreRuns, exportRun] = await Promise.all([
    // Backup objects are service-role only; the gate above guards this route.
    getCompanyBackups(getCarbonServiceRole(), getDatabaseClient(), companyId),
    getCompanyRestoreRuns(client, companyId),
    getCompanyExportRun(client, companyId)
  ]);

  return { files, restoreRuns, exportRun };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requireBackupAccess(request);

  const formData = await request.formData();
  const intent = formData.get("intent");
  const restoreRunId = String(formData.get("restoreRunId") ?? "");
  const failure = (err: unknown, fallback: string) => ({
    success: false as const,
    message: getErrorMessage(err, fallback)
  });

  switch (intent) {
    case "export": {
      const validation = await validator(exportValidator).validate(formData);
      if (validation.error) return validationError(validation.error);
      try {
        await clearStaleExportFailure(client, companyId);
        await exportCompanyBackup({
          companyId,
          userId,
          label: validation.data.label || undefined,
          includeStorage: validation.data.includeStorage
        });
      } catch (err) {
        return failure(err, "Failed to start backup");
      }
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

      const { source } = validation.data;
      if (!isUserBackupName(source)) {
        return { success: false, message: "Choose one of your backups" };
      }
      // The dialog named the company this tab shows. Another tab may have
      // switched the session to a different one since: never restore into a
      // company the person wasn't shown.
      if (validation.data.companyId !== companyId) {
        return {
          success: false,
          message:
            "You switched company in another tab. Reload this page, check the company, and restore again."
        };
      }

      try {
        // One restore at a time. A second restore while one is still pending
        // review would snapshot the already-restored state and tangle the
        // revert chain.
        const pending = await getPendingChange(client, companyId);
        if (pending) {
          return { success: false, message: PENDING_MESSAGE[pending] };
        }
        const restoreRunId = await startCompanyRestore({
          companyId,
          userId,
          filePath: source,
          includeStorage: validation.data.includeStorage
        });
        return { success: true, message: "Restore started", restoreRunId };
      } catch (err) {
        return failure(err, "Failed to start restore");
      }
    }

    // keep / dismiss / revert / delete are fetcher buttons (modal + review card
    // use them) and return JSON so the UI can react in place. Dismiss is keep
    // for a FAILED run: nothing was changed, so it's a dismissal, not a "keep".
    case "keep":
    case "dismiss": {
      if (!restoreRunId)
        return { success: false, message: "Missing restore run" };
      try {
        await trigger("company-restore-finalize", { companyId, restoreRunId });
      } catch (err) {
        return failure(err, "Failed to resolve the restore");
      }
      return {
        success: true,
        message: intent === "keep" ? "Restore kept" : "Dismissed"
      };
    }

    case "revert": {
      if (!restoreRunId)
        return { success: false, message: "Missing restore run" };
      try {
        await trigger("company-restore-revert", { companyId, restoreRunId });
      } catch (err) {
        return failure(err, "Failed to revert the restore");
      }
      return {
        success: true,
        message: "Reverting — your previous data is being restored"
      };
    }

    // Acknowledge a failed export — clears the failure marker. Any partial
    // backup folder stays in the list (as "Incomplete") until deleted.
    case "dismissExportFailure": {
      try {
        await dismissCompanyExportFailure(companyId);
      } catch (err) {
        return failure(err, "Failed to dismiss");
      }
      return { success: true, message: "Dismissed" };
    }

    // The ONE sanctioned bypass of the export's closure guard: re-run the
    // failed backup leaving out the rows whose links escape this company. Only
    // offered for that failure class — the marker's `reason` is what the job
    // wrote, not something the client sends.
    case "exportSkipCorrupted": {
      const validation =
        await validator(exportSkipValidator).validate(formData);
      if (validation.error) return validationError(validation.error);
      try {
        const run = await getCompanyExportRun(client, companyId);
        if (run?.status !== "failed" || run.reason !== "scope-violations") {
          return {
            success: false,
            message: "There is no failed backup to retry"
          };
        }
        await dismissCompanyExportFailure(companyId);
        // The banner posts the Create form's current values, and that form is
        // seeded from this same failed run — so these fallbacks only matter if
        // the fields are missing entirely.
        await exportCompanyBackup({
          companyId,
          userId,
          label: validation.data.label || run.label || undefined,
          includeStorage:
            validation.data.includeStorage ??
            run.includeStorage ??
            DEFAULT_INCLUDE_STORAGE.export,
          skipCorrupted: true
        });
      } catch (err) {
        return failure(err, "Failed to start backup");
      }
      return {
        success: true,
        message: "Backup started",
        started: "export" as const
      };
    }

    // A restore that died at its snapshot because the LIVE data has rows
    // escaping company scope: permanently delete those rows (user-confirmed in
    // the UI), drop the failed run, and start the same restore again.
    case "purgeAndRestore": {
      let retry: { filePath: string; includeStorage: "none" | "all" };
      try {
        const runs = await getCompanyRestoreRuns(client, companyId);
        const run = runs.find((r) => r.restoreRunId === restoreRunId);
        if (
          !run ||
          run.status !== "failed" ||
          run.reason !== "scope-violations" ||
          !run.filePath
        ) {
          return {
            success: false,
            message: "This restore can't be retried this way"
          };
        }
        const pending = await getPendingChange(client, companyId);
        if (pending) {
          return { success: false, message: PENDING_MESSAGE[pending] };
        }
        retry = {
          filePath: run.filePath,
          includeStorage: run.includeStorage ?? DEFAULT_INCLUDE_STORAGE.restore
        };
      } catch (err) {
        return failure(err, "Failed to read the restore");
      }

      const result = await purgeAndRetry(getDatabaseClient(), companyId, {
        doing: "restoring",
        name: "the restore",
        start: async () => {
          await trigger("company-restore-finalize", {
            companyId,
            restoreRunId
          });
          return startCompanyRestore({ companyId, userId, ...retry });
        }
      });
      return result.success
        ? {
            success: true,
            message: result.message,
            restoreRunId: result.runId,
            deleted: result.deleted
          }
        : result;
    }

    case "delete": {
      const name = String(formData.get("name") ?? "");
      if (!isUserBackupName(name))
        return data({}, await flash(request, error(null, "Invalid backup")));
      try {
        const serviceRole = getCarbonServiceRole();
        const inUse = await getBackupInUse(serviceRole, companyId, name);
        if (inUse) {
          return data(
            {},
            await flash(request, error(null, IN_USE_MESSAGE[inUse]))
          );
        }
        await deleteCompanyBackup(serviceRole, companyId, name);
      } catch (err) {
        return data(
          {},
          await flash(request, error(err, "Failed to delete backup"))
        );
      }
      return data({}, await flash(request, success("Backup deleted")));
    }

    default:
      return data({}, await flash(request, error(null, "Unknown action")));
  }
}

export default function BackupsRoute() {
  const { files, restoreRuns, exportRun } = useLoaderData<typeof loader>();
  const { locale } = useLocale();
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
  // a run started elsewhere (reload / another tab). `baseline` = the backups
  // listed when tracking began; the run is complete once a ready backup outside
  // it appears in the (revalidated) list.
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
    const id = setInterval(() => revalidator.revalidate(), JOB_POLL.listMs);
    return () => clearInterval(id);
  }, [runningExport, active, revalidator]);

  // keep / dismiss / revert finalize the run via an async Inngest job, so the
  // marker is still present on the next revalidation. Hide the row optimistically
  // the moment the user acts so it doesn't linger until the job lands.
  // A refused keep/dismiss/revert puts the row back: hidden, it could never be
  // finished, and every new restore would be refused as "pending".
  const [resolvedRunIds, setResolvedRunIds] = useState<Set<string>>(new Set());
  const resolvingRunId = useRef<string | null>(null);
  const resolveRun = (runId: string) => {
    resolvingRunId.current = runId;
    setResolvedRunIds((prev) => new Set(prev).add(runId));
  };
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
  const [purgeOpen, setPurgeOpen] = useState(false);
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
    includeStorage:
      (exportFailed ? exportRun?.includeStorage : null) ??
      DEFAULT_INCLUDE_STORAGE.export
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
        startedAt: datetime.timestamp(),
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
    const resolving = resolvingRunId.current;
    resolvingRunId.current = null;
    if (result.success) {
      toast.success(result.message);
      return;
    }
    toast.error(result.message);
    if (resolving) {
      setResolvedRunIds((prev) => {
        const next = new Set(prev);
        next.delete(resolving);
        return next;
      });
      setActive((current) => (current?.mode === "revert" ? null : current));
    }
  }, [fetcher.data, knownBackupNames]);

  return (
    <ScrollArea className="w-full h-[calc(100dvh-var(--topbar-height)-var(--content-inset))]">
      <div className="py-12 px-4 max-w-[72rem] mx-auto flex flex-col gap-4 max-md:py-3">
        <SettingsPageHeading>
          <Trans>Backups</Trans>
        </SettingsPageHeading>

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
                  onConfirm={({ source, includeStorage, companyId }) =>
                    fetcher.submit(
                      { intent: "restore", source, includeStorage, companyId },
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
                    onPurgeAndRestore={() => {
                      setPurgeRun(run);
                      setPurgeOpen(true);
                    }}
                  />
                ))}
              </VStack>
            </CardContent>
          </Card>
        )}

        {purgeRun && (
          <PurgeCorruptedRowsModal
            open={purgeOpen}
            rowsByTable={purgeRun.violationRowsByTable}
            description={
              <Trans>
                These rows link to data outside this company, so a safety copy
                of your current data can't be made. Deleting them cannot be
                undone. If they turn out to be shared with other companies in
                this group, nothing is deleted and the restore doesn't start.
              </Trans>
            }
            confirmLabel={<Trans>Delete and restore</Trans>}
            onCancel={() => setPurgeOpen(false)}
            onConfirm={() => {
              fetcher.submit(
                {
                  intent: "purgeAndRestore",
                  restoreRunId: purgeRun.restoreRunId
                },
                { method: "post" }
              );
              resolveRun(purgeRun.restoreRunId);
              setPurgeOpen(false);
            }}
          />
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
                    className="flex w-full items-center justify-between rounded-lg border p-3 text-left transition-colors hover:bg-muted/50 max-md:border-0 max-md:p-0 max-md:rounded-none"
                  >
                    <VStack spacing={0}>
                      <span className="text-sm font-medium">
                        Creating backup…
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {runningExportStartedAt
                          ? `Started ${formatBackupDate(runningExportStartedAt, locale)}`
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
  // An older backup has the per-edge list but no row count: say rows were left
  // out without a number, rather than hide it as zero.
  const excluded = file.excludedRowsByTable
    ? totalScopeRows(file.excludedRowsByTable)
    : file.excludedRows.length > 0
      ? null
      : 0;
  // A half-written folder has no verdict — the incompleteness is the whole story.
  // A null verdict means the schema could not be read: show no badge rather than
  // a green one nothing actually checked.
  const status: BackupStatus | null =
    file.status === "pending"
      ? "incomplete"
      : (file.compatibility?.status ?? null);

  return (
    <HStack
      className={`w-full justify-between border rounded-lg p-3 max-md:border-0 max-md:p-0 max-md:rounded-none ${
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
              {excluded !== 0 ? (
                <>
                  {" · "}
                  {excluded === null ? (
                    <Trans>Some rows excluded</Trans>
                  ) : (
                    <Plural
                      value={excluded}
                      one="# row excluded"
                      other="# rows excluded"
                    />
                  )}{" "}
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
            <a href={path.to.api.backupArchive(file.name)} download>
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
