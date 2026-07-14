// Settings → Backups (company export / in-place restore).
import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import {
  Hidden,
  Input,
  Submit,
  ValidatedForm,
  validationError,
  validator
} from "@carbon/form";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Heading,
  HStack,
  ScrollArea,
  toast,
  VStack
} from "@carbon/react";
import { convertKbToString, isInternalEmail } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import { useCallback, useEffect, useRef, useState } from "react";
import { LuLoaderCircle } from "react-icons/lu";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  data,
  redirect,
  useFetcher,
  useLoaderData,
  useRevalidator
} from "react-router";
import { z } from "zod";
import type { CompanyBackupSummary } from "~/modules/settings";
import {
  deleteCompanyBackup,
  exportCompanyBackup,
  getCompanyExportRun,
  getCompanyRestoreRuns,
  listCompanyBackups
} from "~/modules/settings";
import {
  dismissCompanyExportFailure,
  finalizeCompanyRestore,
  revertCompanyRestore,
  startCompanyRestore
} from "~/modules/settings/backups.server";
import {
  BackupContentsInfo,
  BackupSourcePicker,
  formatBackupDate,
  formatBackupName,
  IncludeStorageChoice,
  JobProgressModal,
  RestoreIncludeChoice,
  RestoreReviewRow,
  RestoreSubmit
} from "~/modules/settings/ui/Backups";
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

// `source` is `backup:<path>` — one of this company's own exports (or an
// uploaded copy of one). Restore is always in-place into the current company.
// `includeStorage` picks whether uploaded files (3D models, docs) come along.
const restoreValidator = z.object({
  intent: z.literal("restore"),
  source: z.string().min(1, { message: "Choose a backup to restore" }),
  includeStorage: z.enum(["none", "all"])
});

function requireInternal(email: string | null) {
  // Internal-only while multi-tenant hardening is pending.
  if (!isInternalEmail(email)) {
    throw redirect(path.to.settings);
  }
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId, email } = await requirePermissions(request, {
    update: "settings"
  });
  requireInternal(email);

  const [backupsList, restoreRuns, exportRun] = await Promise.all([
    listCompanyBackups(client, companyId),
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
  requireInternal(email);

  const formData = await request.formData();
  const intent = formData.get("intent");

  switch (intent) {
    case "export": {
      const validation = await validator(exportValidator).validate(formData);
      if (validation.error) return validationError(validation.error);

      const { label, includeStorage } = validation.data;
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
  const fetcher = useFetcher<{
    success?: boolean;
    message?: string;
    restoreRunId?: string;
    started?: "export";
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

  // The in-progress export we're tracking this session. Set the instant the user
  // clicks "Create backup" (optimistic — before the job writes its first marker,
  // so the row shows immediately, Supabase-style) or adopted from the marker for
  // a run started elsewhere (reload / another tab). `baseline` = the READY backups
  // when tracking began; the run is complete once a ready backup outside it
  // appears in the (revalidated) list.
  const [runningExport, setRunningExport] = useState<{
    startedAt: string | null;
    baseline: Set<string>;
  } | null>(null);

  const readyBackupNames = useCallback(
    () =>
      new Set(
        filesRef.current.filter((f) => f.status === "ready").map((f) => f.name)
      ),
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
      setRunningExport({
        startedAt: exportRun?.startedAt ?? null,
        baseline: readyBackupNames()
      });
    }
  }, [exportRunning, runningExport, exportRun, readyBackupNames]);

  // Stop tracking once the run fails, or completes and isn't being shown in the
  // detail modal (the modal keeps `completed` true until the user closes it).
  useEffect(() => {
    const exportModalOpen = active?.mode === "export";
    if (
      runningExport &&
      (exportFailed || (exportCompleted && !exportModalOpen))
    ) {
      setRunningExport(null);
    }
  }, [runningExport, exportCompleted, exportFailed, active]);

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
        baseline: readyBackupNames()
      });
      return;
    }
    if (result.success && result.restoreRunId) {
      setActive({ runId: result.restoreRunId, mode: "restore" });
      return;
    }
    if (result.success) toast.success(result.message);
    else toast.error(result.message);
  }, [fetcher.data, readyBackupNames]);

  return (
    <ScrollArea className="w-full h-[calc(100dvh-49px)]">
      <div className="py-12 px-4 max-w-[72rem] mx-auto flex flex-col gap-4">
        <Heading size="h3">Backups</Heading>

        {/* Create + Restore — equal-height cards, footers aligned. */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-stretch">
          <Card className="flex flex-col">
            <ValidatedForm
              method="post"
              validator={exportValidator}
              defaultValues={{ label: "", includeStorage: "none" }}
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
                    <BackupSourcePicker
                      backups={files.filter((f) => f.status === "ready")}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <span className="text-sm">Include</span>
                    <RestoreIncludeChoice />
                  </div>
                </div>
              </CardContent>
              <CardFooter>
                <RestoreSubmit />
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
                  />
                ))}
              </VStack>
            </CardContent>
          </Card>
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
                {exportFailed && (
                  <HStack className="w-full justify-between rounded-lg border border-destructive/50 bg-destructive/5 p-3">
                    <VStack spacing={0} className="min-w-0">
                      <span className="text-sm font-medium">Backup failed</span>
                      <span className="break-words text-xs text-muted-foreground">
                        The system created an invalid backup — please contact
                        Carbon support.
                        {exportRun?.error ? ` (${exportRun.error})` : null}
                      </span>
                    </VStack>
                    <Button
                      variant="secondary"
                      onClick={() =>
                        fetcher.submit(
                          { intent: "dismissExportFailure" },
                          { method: "post" }
                        )
                      }
                    >
                      Dismiss
                    </Button>
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

// One backup row. Its own fetcher so Delete shows a spinner and dims the row
// while the (async, storage-recursing) delete runs; the row drops out of the
// list on the revalidation that follows.
function BackupRow({ file }: { file: CompanyBackupSummary }) {
  const deleteFetcher = useFetcher();
  const isDeleting = deleteFetcher.state !== "idle";

  return (
    <HStack
      className={`w-full justify-between border rounded-lg p-3 ${
        file.status === "pending" || isDeleting ? "opacity-70" : ""
      }`}
    >
      <VStack spacing={0}>
        <span className="text-sm font-medium">
          {file.label || formatBackupName(file.name)}
        </span>
        <span className="text-xs text-muted-foreground">
          {file.status === "pending" ? (
            // A pending folder with no running export is a dead partial — never
            // lie with "Preparing…".
            <>Incomplete backup — not restorable</>
          ) : (
            <>
              {formatBackupDate(file.exportedAt)}
              {file.sizeBytes ? (
                <>
                  {" · "}
                  {convertKbToString(Math.round(file.sizeBytes / 1024))}
                </>
              ) : null}
            </>
          )}
        </span>
      </VStack>
      <HStack spacing={2}>
        {file.status === "ready" ? (
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
        <deleteFetcher.Form method="post">
          <input type="hidden" name="intent" value="delete" />
          <input type="hidden" name="name" value={file.name} />
          <Button
            type="submit"
            variant="destructive"
            isLoading={isDeleting}
            isDisabled={isDeleting}
          >
            Delete
          </Button>
        </deleteFetcher.Form>
      </HStack>
    </HStack>
  );
}
