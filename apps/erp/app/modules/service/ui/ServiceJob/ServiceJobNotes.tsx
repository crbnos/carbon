// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useCarbon } from "@carbon/auth";
import {
  convertKbToString,
  downloadUrl,
  getDocumentType,
  isPreviewableDocumentType,
  storage
} from "@carbon/files";
import { getLogger } from "@carbon/logger";
import { useAction, useRevalidator } from "@carbon/query";
import type { JSONContent } from "@carbon/react";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  File,
  HStack,
  IconButton,
  Label,
  MENU_ITEM_SHORTCUTS,
  RadioGroup,
  RadioGroupButton,
  RichTextView,
  Skeleton,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  toast,
  useDebounce,
  useViewport
} from "@carbon/react";
import { Editor } from "@carbon/react/Editor";
import { RoundingMode, round } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import type { FileObject } from "@supabase/storage-js";
import type { ChangeEvent, ReactNode } from "react";
import { Suspense, useCallback, useState } from "react";
import { LuEllipsisVertical, LuUpload } from "react-icons/lu";
import { Await } from "react-router";
import { DocumentPreview, FileDropzone } from "~/components";
import DocumentIcon from "~/components/DocumentIcon";
import {
  useFileUpload,
  useImageUpload,
  usePermissions,
  useUser
} from "~/hooks";
import type { action as updateAction } from "~/routes/x+/service-job+/update";
import type { StorageItem } from "~/types";
import { path } from "~/utils/path";
import { stripSpecialCharacters } from "~/utils/string";

const logger = getLogger("erp", "servicejobnotes");

/** Saves one header field of the job through `update.tsx`. */
function useUpdateServiceJobField(id: string) {
  const fetcher = useAction<typeof updateAction>({});
  // biome-ignore lint/correctness/useExhaustiveDependencies: fetcher identity is stable
  return useCallback(
    (field: string, value: string | null) => {
      const formData = new FormData();
      formData.append("ids", id);
      formData.append("field", field);
      formData.append("value", value ?? "");
      fetcher.submit(formData, {
        method: "post",
        action: path.to.serviceJobUpdate
      });
    },
    [id]
  );
}

/**
 * What the customer reported, and whether the technician found the unit
 * worth repairing. Repairable stays unset until someone decides.
 */
export function ServiceJobProblem({
  id,
  problem,
  repairable: initialRepairable,
  isDisabled
}: {
  id: string;
  problem: JSONContent;
  repairable: boolean | null;
  isDisabled: boolean;
}) {
  const { t } = useLingui();
  const permissions = usePermissions();
  const onUpdate = useUpdateServiceJobField(id);
  const isReadOnly = isDisabled || !permissions.can("update", "service");
  const [repairable, setRepairable] = useState(initialRepairable);

  return (
    <ServiceJobNotes
      id={id}
      field="problem"
      content={problem}
      isDisabled={isDisabled}
      footer={
        <CardFooter className="gap-3">
          <Label>
            <Trans>Repairable</Trans>
          </Label>
          <RadioGroup
            aria-label={t`Repairable`}
            className="flex gap-2"
            value={repairable === null ? "" : String(repairable)}
            disabled={isReadOnly}
            onValueChange={(value) => {
              setRepairable(value === "true");
              onUpdate("repairable", value);
            }}
          >
            {[
              { value: "true", label: t`Yes` },
              { value: "false", label: t`No` }
            ].map((option) => (
              <RadioGroupButton
                key={option.value}
                value={option.value}
                className={cn(
                  "data-[state=checked]:bg-accent data-[state=checked]:text-foreground data-[state=checked]:border-primary"
                )}
              >
                {option.label}
              </RadioGroupButton>
            ))}
          </RadioGroup>
        </CardFooter>
      }
    />
  );
}

/**
 * The customer's problem, the technician's findings or the resolution: rich
 * text, autosaved. `footer` renders below the text (the problem's
 * Repairable).
 */
export function ServiceJobNotes({
  id,
  field,
  content: initialContent,
  isDisabled,
  footer
}: {
  id: string;
  field: "problem" | "findings" | "resolution";
  content: JSONContent;
  isDisabled: boolean;
  footer?: ReactNode;
}) {
  const permissions = usePermissions();
  const onUpdate = useUpdateServiceJobField(id);
  const [content, setContent] = useState(initialContent ?? {});
  const onUploadImage = useImageUpload("service-job");

  const onUpdateContent = useDebounce(
    (next: JSONContent) => {
      onUpdate(field, JSON.stringify(next));
    },
    2500,
    true
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {field === "problem" ? (
            <Trans>Problem</Trans>
          ) : field === "findings" ? (
            <Trans>Findings</Trans>
          ) : (
            <Trans>Resolution</Trans>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {permissions.can("update", "service") && !isDisabled ? (
          <Editor
            initialValue={(content ?? {}) as JSONContent}
            onUpload={onUploadImage}
            onChange={(value) => {
              setContent(value);
              onUpdateContent(value);
            }}
          />
        ) : (
          <RichTextView
            content={content as JSONContent}
            empty={
              field === "problem" ? (
                <Trans>No problem described</Trans>
              ) : field === "findings" ? (
                <Trans>No findings</Trans>
              ) : (
                <Trans>No resolution</Trans>
              )
            }
          />
        )}
      </CardContent>
      {footer}
    </Card>
  );
}

export function ServiceJobFilesSkeleton() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans>Files</Trans>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-3/4" />
        </div>
      </CardContent>
    </Card>
  );
}

export function ServiceJobFiles({
  jobId,
  files,
  isDisabled
}: {
  jobId: string;
  files: Promise<StorageItem[]>;
  isDisabled: boolean;
}) {
  const permissions = usePermissions();

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans>Files</Trans>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Suspense fallback={<ServiceJobFilesSkeleton />}>
          <Await resolve={files}>
            {(resolvedFiles) => (
              <ServiceJobFilesContent
                jobId={jobId}
                files={resolvedFiles ?? []}
                isReadOnly={!permissions.can("update", "service") || isDisabled}
              />
            )}
          </Await>
        </Suspense>
      </CardContent>
    </Card>
  );
}

function ServiceJobFilesContent({
  jobId,
  files,
  isReadOnly
}: {
  jobId: string;
  files: StorageItem[];
  isReadOnly: boolean;
}) {
  const { t } = useLingui();
  const { isPhone } = useViewport();
  const { carbon } = useCarbon();
  const { company } = useUser();
  const revalidator = useRevalidator();

  const getFilePath = useCallback(
    (fileName: string) => {
      return `${company.id}/service-job/${jobId}/${stripSpecialCharacters(fileName)}`;
    },
    [company.id, jobId]
  );

  const { upload: uploadToStorage } = useFileUpload();
  const upload = useCallback(
    async (filesToUpload: File[]) => {
      await uploadToStorage(filesToUpload, {
        getPath: (file) => getFilePath(file.name),
        onSuccess: (file) => {
          toast.success(t`${file.name} uploaded successfully`);
        }
      });
      revalidator.revalidate();
    },
    [uploadToStorage, getFilePath, revalidator, t]
  );

  const download = useCallback(
    async (file: FileObject) => {
      const filePath = getFilePath(file.name);
      const url = path.to.file.previewFile(`private/${filePath}`);
      try {
        await downloadUrl(url, file.name);
      } catch (error) {
        toast.error(t`Error downloading file`);
        logger.error("Error", { error: error });
      }
    },
    [getFilePath, t]
  );

  const deleteFile = useCallback(
    async (file: FileObject) => {
      if (!carbon) {
        toast.error(t`Carbon client not available`);
        return;
      }

      const filePath = getFilePath(file.name);
      const { error } = await storage(carbon)
        .company(company.id)
        .remove([filePath]);

      if (error) {
        toast.error(error.message || t`Error deleting file`);
        return;
      }

      toast.success(t`${file.name} deleted successfully`);
      revalidator.revalidate();
    },
    [carbon, company.id, getFilePath, revalidator, t]
  );

  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      upload(acceptedFiles);
    },
    [upload]
  );

  const uploadFiles = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      upload(Array.from(e.target.files));
    }
  };

  return (
    <>
      {!isReadOnly && (
        <div className="flex justify-end mb-4">
          {/* @ts-expect-error TS2322 */}
          <File leftIcon={<LuUpload />} onChange={uploadFiles} multiple>
            <Trans>Upload</Trans>
          </File>
        </div>
      )}
      <Table>
        <Thead>
          <Tr>
            <Th>
              <Trans>Name</Trans>
            </Th>
            <Th>
              <Trans>Size</Trans>
            </Th>
            <Th />
          </Tr>
        </Thead>
        <Tbody>
          {files.map((file) => {
            const type = getDocumentType(file.name);
            return (
              <Tr key={file.id}>
                <Td>
                  <HStack>
                    <DocumentIcon type={type} />
                    <span
                      className="font-medium cursor-pointer"
                      onClick={() => {
                        if (isPreviewableDocumentType(type)) {
                          window.open(
                            path.to.file.previewFile(
                              `private/${getFilePath(file.name)}`
                            ),
                            "_blank"
                          );
                        } else {
                          download(file);
                        }
                      }}
                    >
                      {isPreviewableDocumentType(type) ? (
                        <DocumentPreview
                          bucket="private"
                          pathToFile={getFilePath(file.name)}
                          type={type}
                        >
                          {file.name}
                        </DocumentPreview>
                      ) : (
                        file.name
                      )}
                    </span>
                  </HStack>
                </Td>
                <Td>
                  {convertKbToString(
                    round(
                      (file.metadata?.size ?? 0) / 1024,
                      0,
                      RoundingMode.Down
                    )
                  )}
                </Td>
                <Td>
                  <div className="flex justify-end w-full">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <IconButton
                          aria-label={t`More`}
                          icon={<LuEllipsisVertical />}
                          variant="secondary"
                        />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent>
                        <DropdownMenuItem
                          shortcut={MENU_ITEM_SHORTCUTS.download}
                          onClick={() => download(file)}
                        >
                          <Trans>Download</Trans>
                        </DropdownMenuItem>
                        {!isReadOnly && (
                          <DropdownMenuItem
                            destructive
                            onClick={() => deleteFile(file)}
                          >
                            <Trans>Delete</Trans>
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </Td>
              </Tr>
            );
          })}
          {files.length === 0 && (
            <Tr>
              <Td
                colSpan={3}
                className="py-8 text-muted-foreground text-center"
              >
                <Trans>No files uploaded</Trans>
              </Td>
            </Tr>
          )}
        </Tbody>
      </Table>
      {/* Phones: the header Upload already opens the same picker. */}
      {!isReadOnly && !isPhone && <FileDropzone onDrop={onDrop} />}
    </>
  );
}
