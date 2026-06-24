// Settings → Backups (company export / in-place restore).
import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { Database } from "@carbon/database";
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
import type { SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, Form, redirect, useFetcher, useLoaderData } from "react-router";
import { z } from "zod";
import {
  deleteCompanyBackupExport,
  exportCompanyBackup,
  getCompanyBackupSignedUrl,
  getCompanyRestoreRuns,
  listCompanyBackupExports
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

// Hidden pre-restore snapshots are named `_pre-restore-<runId>` — never shown
// in the backups list or offered as a restore source.
const SNAPSHOT_PREFIX = "_pre-restore-";

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

async function requireOwner(
  request: Request,
  client: SupabaseClient<Database>,
  companyGroupId: string | null,
  userId: string,
  email: string | null
) {
  // Internal-only while multi-tenant hardening is pending.
  if (!isInternalEmail(email)) {
    throw redirect(path.to.settings);
  }

  const group = companyGroupId
    ? await client
        .from("companyGroup")
        .select("ownerId")
        .eq("id", companyGroupId)
        .single()
    : null;

  if (group?.data?.ownerId !== userId) {
    throw redirect(
      path.to.settings,
      await flash(
        request,
        error(null, "Only the company owner can access backups")
      )
    );
  }
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId, companyGroupId, userId, email } =
    await requirePermissions(request, {
      update: "settings"
    });
  await requireOwner(request, client, companyGroupId, userId, email);

  const [exportsList, restoreRuns] = await Promise.all([
    listCompanyBackupExports(client, companyId),
    getCompanyRestoreRuns(client, companyId)
  ]);

  const files = await Promise.all(
    (exportsList.data ?? [])
      // Drop folders and the hidden pre-restore snapshots.
      .filter((f) => f.id !== null && !f.name.startsWith(SNAPSHOT_PREFIX))
      .map(async (f) => {
        const filePath = `exports/${f.name}`;
        const signed = await getCompanyBackupSignedUrl(
          client,
          companyId,
          filePath
        );
        return {
          name: f.name,
          path: filePath,
          createdAt: f.created_at,
          size: (f.metadata as { size?: number } | null)?.size ?? 0,
          url: signed.data?.signedUrl ?? null
        };
      })
  );

  return {
    companyId,
    files,
    restoreRuns: restoreRuns.data ?? []
  };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, companyGroupId, userId, email } =
    await requirePermissions(request, {
      update: "settings"
    });
  await requireOwner(request, client, companyGroupId, userId, email);

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

      const filePath = validation.data.source.replace(/^backup:/, "");
      if (!filePath.startsWith("exports/")) {
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
          filePath,
          includeStorage: validation.data.includeStorage,
          label: filePath.split("/").pop()
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
      const filePath = String(formData.get("filePath") ?? "");
      if (!filePath.startsWith("exports/"))
        return data({}, await flash(request, error(null, "Invalid file path")));

      const result = await deleteCompanyBackupExport(
        client,
        companyId,
        filePath
      );
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
  const { companyId, files, restoreRuns } = useLoaderData<typeof loader>();
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
  const startRevert = (runId: string) => {
    fetcher.submit(
      { intent: "revert", restoreRunId: runId },
      { method: "post" }
    );
    setActive({ runId, mode: "revert" });
  };

  useEffect(() => {
    const result = fetcher.data;
    if (result?.message === undefined) return;
    // Export and restore open a progress modal — let it own the feedback instead
    // of also firing a toast. Everything else (keep/revert/dismiss/errors) toasts.
    if (result.success && result.started === "export") {
      setActive({ mode: "export" });
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
                    <BackupSourcePicker backups={files} companyId={companyId} />
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

        {restoreRuns.length > 0 && (
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
                {restoreRuns.map((run) => (
                  <RestoreReviewRow
                    key={run.restoreRunId}
                    run={run}
                    onKeep={() =>
                      fetcher.submit(
                        { intent: "keep", restoreRunId: run.restoreRunId },
                        { method: "post" }
                      )
                    }
                    onRevert={() => startRevert(run.restoreRunId)}
                    onDismiss={() =>
                      fetcher.submit(
                        { intent: "dismiss", restoreRunId: run.restoreRunId },
                        { method: "post" }
                      )
                    }
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
                    key={file.path}
                    className="w-full justify-between border rounded-lg p-3"
                  >
                    <VStack spacing={0}>
                      <span className="text-sm font-medium">
                        {formatBackupName(file.name)}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {formatBackupDate(file.createdAt)}
                        {file.size ? (
                          <>
                            {" · "}
                            {convertKbToString(Math.round(file.size / 1024))}
                          </>
                        ) : null}
                      </span>
                    </VStack>
                    <HStack spacing={2}>
                      {file.url && (
                        <Button asChild variant="secondary">
                          <a href={file.url} download>
                            Download
                          </a>
                        </Button>
                      )}
                      <Form method="post">
                        <input type="hidden" name="intent" value="delete" />
                        <input
                          type="hidden"
                          name="filePath"
                          value={file.path}
                        />
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
