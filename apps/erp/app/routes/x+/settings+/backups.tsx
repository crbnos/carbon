// Settings → Backups (company export/import). Renamed from data-management.
import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { Database } from "@carbon/database";
import { ValidatedForm, validationError, validator } from "@carbon/form";
import { batchTrigger } from "@carbon/jobs";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Heading,
  HStack,
  ScrollArea,
  VStack
} from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, Form, redirect, useLoaderData } from "react-router";
import { z } from "zod";
import { Hidden, Input, Select, Submit } from "~/components/Form";
import {
  ArtifactUpload,
  deleteCompanyTemplateExport,
  exportCompanyTemplate,
  finalizeCompanyTemplateImport,
  getCompanyTemplateImportedModels,
  getCompanyTemplateImportRuns,
  getCompanyTemplateSignedUrl,
  importCompanyTemplate,
  listCompanyTemplateExports,
  revertCompanyTemplateImport
} from "~/modules/settings";
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

const importValidator = z.object({
  intent: z.literal("import"),
  filePath: z.string().min(1, { message: "Select an export to import" }),
  mode: z.enum(["reseed", "preserve"])
});

async function requireOwner(
  request: Request,
  client: SupabaseClient<Database>,
  companyGroupId: string | null,
  userId: string
) {
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

async function flashError(request: Request, message: string) {
  return data({}, await flash(request, error(null, message)));
}

/** Flash the edge function's real error message on failure, or a success. */
async function flashResult(
  request: Request,
  result: { error: unknown },
  successMessage: string,
  failureMessage: string
) {
  if (result.error) {
    return flashError(
      request,
      await getEdgeFunctionErrorMessage(result.error, failureMessage)
    );
  }
  return data({}, await flash(request, success(successMessage)));
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId, companyGroupId, userId } =
    await requirePermissions(request, {
      update: "settings"
    });
  await requireOwner(request, client, companyGroupId, userId);

  const [exportsList, importRuns] = await Promise.all([
    listCompanyTemplateExports(client, companyId),
    getCompanyTemplateImportRuns(client, companyId)
  ]);

  const files = await Promise.all(
    (exportsList.data ?? [])
      .filter((f) => f.id !== null)
      .map(async (f) => {
        const filePath = `exports/${f.name}`;
        const signed = await getCompanyTemplateSignedUrl(
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
    importRuns: importRuns.data ?? []
  };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, companyGroupId, userId } =
    await requirePermissions(request, {
      update: "settings"
    });
  await requireOwner(request, client, companyGroupId, userId);

  const formData = await request.formData();
  const intent = formData.get("intent");

  switch (intent) {
    case "export": {
      const validation = await validator(exportValidator).validate(formData);
      if (validation.error) return validationError(validation.error);

      const { label, includeStorage } = validation.data;
      return flashResult(
        request,
        await exportCompanyTemplate(client, {
          companyId,
          userId,
          label: label || undefined,
          includeStorage
        }),
        "Export started — it will appear below shortly",
        "Failed to start export"
      );
    }

    case "import": {
      const validation = await validator(importValidator).validate(formData);
      if (validation.error) return validationError(validation.error);

      const { filePath, mode } = validation.data;
      return flashResult(
        request,
        await importCompanyTemplate(client, {
          companyId,
          userId,
          filePath,
          mode
        }),
        "Import started — review the pending run below once it completes",
        "Failed to start import"
      );
    }

    case "finalize": {
      const importRunId = String(formData.get("importRunId") ?? "");
      if (!importRunId) return flashError(request, "Missing import run");

      // Fan out thumbnail rendering for imported models before the ledger
      // (which we use to find them) is deleted by finalize.
      const models = await getCompanyTemplateImportedModels(client, {
        companyId,
        importRunId
      });
      if (models.data && models.data.length > 0) {
        await batchTrigger(
          "model-thumbnail",
          models.data.map((m) => ({ payload: { modelId: m.id, companyId } }))
        );
      }

      return flashResult(
        request,
        await finalizeCompanyTemplateImport(client, {
          companyId,
          importRunId,
          userId
        }),
        "Import finalized",
        "Failed to finalize import"
      );
    }

    case "revert": {
      const importRunId = String(formData.get("importRunId") ?? "");
      if (!importRunId) return flashError(request, "Missing import run");

      return flashResult(
        request,
        await revertCompanyTemplateImport(client, {
          companyId,
          importRunId,
          userId
        }),
        "Revert started — the pending run will clear shortly",
        "Failed to revert import"
      );
    }

    case "delete": {
      const filePath = String(formData.get("filePath") ?? "");
      if (!filePath.startsWith("exports/")) {
        return flashError(request, "Invalid file path");
      }

      return flashResult(
        request,
        await deleteCompanyTemplateExport(client, companyId, filePath),
        "Export deleted",
        "Failed to delete export"
      );
    }

    default:
      return flashError(request, "Unknown action");
  }
}

function formatSize(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

export default function BackupsRoute() {
  const { companyId, files, importRuns } = useLoaderData<typeof loader>();

  return (
    <ScrollArea className="w-full h-[calc(100dvh-49px)]">
      <VStack
        spacing={4}
        className="py-12 px-4 max-w-[60rem] h-full mx-auto gap-4"
      >
        <Heading size="h3">Backups</Heading>
        <Card>
          <CardHeader>
            <CardTitle>Create a backup</CardTitle>
            <CardDescription>
              Snapshot all of this company's data into a downloadable backup.
              Credentials, integration tokens and webhooks are never included.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ValidatedForm
              method="post"
              validator={exportValidator}
              defaultValues={{ label: "", includeStorage: "none" }}
              className="w-full"
            >
              <Hidden name="intent" value="export" />
              <VStack spacing={4} className="max-w-md">
                <Input name="label" label="Label (optional)" />
                <Select
                  name="includeStorage"
                  label="Files"
                  options={[
                    { value: "none", label: "Data only" },
                    { value: "all", label: "Data + uploaded files" }
                  ]}
                />
                <Submit>Create backup</Submit>
              </VStack>
            </ValidatedForm>
          </CardContent>
        </Card>

        {importRuns.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Pending restore</CardTitle>
              <CardDescription>
                Review the restored data, then finalize to keep it or revert to
                delete everything the restore created.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <VStack spacing={2}>
                {importRuns.map((run) => (
                  <HStack
                    key={run.importRunId}
                    className="w-full justify-between border rounded-lg p-3"
                  >
                    <VStack spacing={0}>
                      <span className="text-sm font-medium">
                        Run {run.importRunId.slice(0, 8)}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {new Date(run.startedAt).toLocaleString()} ·{" "}
                        {run.rows.toLocaleString()} rows
                      </span>
                    </VStack>
                    <HStack spacing={2}>
                      <Form method="post">
                        <input type="hidden" name="intent" value="finalize" />
                        <input
                          type="hidden"
                          name="importRunId"
                          value={run.importRunId}
                        />
                        <Button type="submit">Finalize</Button>
                      </Form>
                      <Form method="post">
                        <input type="hidden" name="intent" value="revert" />
                        <input
                          type="hidden"
                          name="importRunId"
                          value={run.importRunId}
                        />
                        <Button type="submit" variant="destructive">
                          Revert
                        </Button>
                      </Form>
                    </HStack>
                  </HStack>
                ))}
              </VStack>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Restore from a backup</CardTitle>
            <CardDescription>
              Upload a .carbon.json.gz backup — created here or downloaded from
              another company — then restore it. Reseed assigns new ids and
              scrubs emails; preserve restores an exact copy into the company it
              was backed up from.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <VStack spacing={4} className="max-w-md">
              <ArtifactUpload companyId={companyId} />
              {files.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No backups yet — upload one above to restore.
                </p>
              ) : (
                <ValidatedForm
                  method="post"
                  validator={importValidator}
                  defaultValues={{ filePath: "", mode: "reseed" }}
                  className="w-full"
                >
                  <Hidden name="intent" value="import" />
                  <VStack spacing={4}>
                    <Select
                      name="filePath"
                      label="Backup"
                      options={files.map((f) => ({
                        value: f.path,
                        label: f.name
                      }))}
                    />
                    <Select
                      name="mode"
                      label="Mode"
                      options={[
                        {
                          value: "reseed",
                          label: "Reseed — new ids, scrubbed"
                        },
                        { value: "preserve", label: "Preserve — exact restore" }
                      ]}
                    />
                    <Submit>Restore</Submit>
                  </VStack>
                </ValidatedForm>
              )}
            </VStack>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Backups</CardTitle>
            <CardDescription>
              Past backups stored in this company's bucket under exports/.
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
                      <span className="text-sm font-medium">{file.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {file.createdAt
                          ? new Date(file.createdAt).toLocaleString()
                          : ""}
                        {file.size ? <> · {formatSize(file.size)}</> : null}
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
      </VStack>
    </ScrollArea>
  );
}
