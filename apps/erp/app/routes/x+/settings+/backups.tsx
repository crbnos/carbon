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
import { useEffect, useRef, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, Form, redirect, useFetcher, useLoaderData } from "react-router";
import { z } from "zod";
import {
  deleteCompanyBackup,
  exportCompanyBackup,
  getCompanyRestoreRuns,
  listCompanyBackups
} from "~/modules/settings";
import {
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

  const [backupsList, restoreRuns] = await Promise.all([
    listCompanyBackups(client, companyId),
    getCompanyRestoreRuns(client, companyId)
  ]);

  return {
    companyId,
    files: backupsList.data ?? [],
    restoreRuns: restoreRuns.data ?? []
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
  const { files, restoreRuns } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<{
    success?: boolean;
    message?: string;
    restoreRunId?: string;
    started?: "export";
  }>();
  const [active, setActive] = useState<{
    runId?: string;
    mode: "export" | "restore" | "revert";
    /** Export only: the backup paths present when the export started. The run is
     *  done once a path outside this set appears in the (revalidated) list. */
    exportBaseline?: Set<string>;
  } | null>(null);
  // Latest list, read without re-triggering the fetcher effect when it changes.
  const filesRef = useRef(files);
  filesRef.current = files;
  const exportCompleted =
    active?.mode === "export" &&
    !!active.exportBaseline &&
    files.some(
      (f) => f.status === "ready" && !active.exportBaseline!.has(f.name)
    );

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
    // Export and restore open a progress modal — let it own the feedback instead
    // of also firing a toast. Everything else (keep/revert/dismiss/errors) toasts.
    if (result.success && result.started === "export") {
      setActive({
        mode: "export",
        exportBaseline: new Set(filesRef.current.map((f) => f.name))
      });
      return;
    }
    if (result.success && result.restoreRunId) {
      setActive({ runId: result.restoreRunId, mode: "restore" });
      return;
    }
    if (result.success) toast.success(result.message);
    else toast.error(result.message);
  }, [fetcher.data]);

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
            {files.length === 0 ? (
              <p className="text-sm text-muted-foreground">No backups yet.</p>
            ) : (
              <VStack spacing={2}>
                {files.map((file) => (
                  <HStack
                    key={file.name}
                    className={`w-full justify-between border rounded-lg p-3 ${
                      file.status === "pending" ? "opacity-70" : ""
                    }`}
                  >
                    <VStack spacing={0}>
                      <span className="text-sm font-medium">
                        {file.label || formatBackupName(file.name)}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {file.status === "pending" ? (
                          <span className="animate-pulse">Preparing…</span>
                        ) : (
                          <>
                            {formatBackupDate(file.exportedAt)}
                            {file.sizeBytes ? (
                              <>
                                {" · "}
                                {convertKbToString(
                                  Math.round(file.sizeBytes / 1024)
                                )}
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
                      <Form method="post">
                        <input type="hidden" name="intent" value="delete" />
                        <input type="hidden" name="name" value={file.name} />
                        <Button type="submit" variant="destructive">
                          Delete
                        </Button>
                      </Form>
                    </HStack>
                  </HStack>
                ))}
              </VStack>
            )}
          </CardContent>
        </Card>
      </div>
    </ScrollArea>
  );
}
