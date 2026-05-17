import { useCarbon } from "@carbon/auth";
import type { JSONContent } from "@carbon/react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  File,
  generateHTML,
  HStack,
  IconButton,
  Skeleton,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  toast,
  useDebounce
} from "@carbon/react";
import { Editor } from "@carbon/react/Editor";
import {
  buildCompanyPrivateStorageTarget,
  convertKbToString,
  getCompanyPrivateBucket
} from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import type { FileObject } from "@supabase/storage-js";
import { nanoid } from "nanoid";
import type { ChangeEvent } from "react";
import { Suspense, useCallback, useState } from "react";
import { LuEllipsisVertical, LuUpload } from "react-icons/lu";
import { Await, useRevalidator } from "react-router";
import { DocumentPreview, FileDropzone } from "~/components";
import DocumentIcon from "~/components/DocumentIcon";
import { usePermissions, useUser } from "~/hooks";
import { getDocumentType } from "~/modules/shared";
import type { StorageItem } from "~/types";
import { getPrivateUrl, path } from "~/utils/path";
import { stripSpecialCharacters } from "~/utils/string";

export function MaintenanceDispatchNotes({
  id,
  content: initialContent,
  isDisabled
}: {
  id: string;
  content: JSONContent;
  isDisabled: boolean;
}) {
  const {
    id: userId,
    company: { id: companyId }
  } = useUser();
  const { carbon } = useCarbon();
  const permissions = usePermissions();
  const companyPrivateBucket = getCompanyPrivateBucket(companyId);

  const [content, setContent] = useState(initialContent ?? {});

  const onUploadImage = async (file: File) => {
    const target = buildCompanyPrivateStorageTarget({
      companyId,
      logicalFolder: "maintenance",
      fileName: `${nanoid()}.${file.name.split(".").pop()}`
    });

    const result = await carbon?.storage
      .from(target.physicalBucket)
      .upload(target.objectPath, file);

    if (result?.error) {
      toast.error("Failed to upload image");
      throw new Error(result.error.message);
    }

    if (!result?.data) {
      throw new Error("Failed to upload image");
    }

    return getPrivateUrl(companyPrivateBucket, result.data.path);
  };

  const onUpdateContent = useDebounce(
    async (content: JSONContent) => {
      await carbon
        ?.from("maintenanceDispatch")
        .update({
          content: content,
          updatedBy: userId
        })
        .eq("id", id!);
    },
    2500,
    true
  );

  if (!id) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans>Notes</Trans>
        </CardTitle>
        <CardDescription>
          <Trans>
            Add notes and documentation for this maintenance dispatch
          </Trans>
        </CardDescription>
      </CardHeader>

      <CardContent>
        {permissions.can("update", "resources") && !isDisabled ? (
          <Editor
            initialValue={(content ?? {}) as JSONContent}
            onUpload={onUploadImage}
            onChange={(value) => {
              setContent(value);
              onUpdateContent(value);
            }}
          />
        ) : (
          <div
            className="prose dark:prose-invert"
            dangerouslySetInnerHTML={{
              __html: generateHTML(content as JSONContent)
            }}
          />
        )}
      </CardContent>
    </Card>
  );
}

export function MaintenanceDispatchFilesSkeleton() {
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

export function MaintenanceDispatchFiles({
  dispatchId,
  files,
  isDisabled
}: {
  dispatchId: string;
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
        <Suspense fallback={<MaintenanceDispatchFilesSkeleton />}>
          <Await resolve={files}>
            {(resolvedFiles) => (
              <MaintenanceFilesContent
                dispatchId={dispatchId}
                files={resolvedFiles ?? []}
                isReadOnly={
                  !permissions.can("update", "resources") || isDisabled
                }
              />
            )}
          </Await>
        </Suspense>
      </CardContent>
    </Card>
  );
}

function MaintenanceFilesContent({
  dispatchId,
  files,
  isReadOnly
}: {
  dispatchId: string;
  files: StorageItem[];
  isReadOnly: boolean;
}) {
  const { t } = useLingui();
  const { carbon } = useCarbon();
  const { company } = useUser();
  const revalidator = useRevalidator();
  const companyPrivateBucket = getCompanyPrivateBucket(company.id);

  const getFilePath = useCallback(
    (fileName: string) =>
      buildCompanyPrivateStorageTarget({
        companyId: company.id,
        logicalFolder: "maintenance",
        entityId: dispatchId,
        fileName: stripSpecialCharacters(fileName)
      }).objectPath,
    [company.id, dispatchId]
  );

  const upload = useCallback(
    async (filesToUpload: File[]) => {
      if (!carbon) {
        toast.error(t`Carbon client not available`);
        return;
      }

      for (const file of filesToUpload) {
        const filePath = getFilePath(file.name);

        const result = await carbon.storage
          .from(companyPrivateBucket)
          .upload(filePath, file, {
            cacheControl: `${12 * 60 * 60}`,
            upsert: true
          });

        if (result.error) {
          toast.error(t`Failed to upload file: ${file.name}`);
        } else {
          toast.success(t`${file.name} uploaded successfully`);
        }
      }
      revalidator.revalidate();
    },
    [carbon, companyPrivateBucket, getFilePath, revalidator, t]
  );

  const download = useCallback(
    async (file: FileObject) => {
      const filePath = getFilePath(file.name);
      const url = path.to.file.preview(companyPrivateBucket, filePath);
      try {
        const response = await fetch(url);
        const blob = await response.blob();
        const blobUrl = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        document.body.appendChild(a);
        a.href = blobUrl;
        a.download = file.name;
        a.click();
        window.URL.revokeObjectURL(blobUrl);
        document.body.removeChild(a);
      } catch (error) {
        toast.error(t`Error downloading file`);
        console.error(error);
      }
    },
    [companyPrivateBucket, getFilePath, t]
  );

  const deleteFile = useCallback(
    async (file: FileObject) => {
      if (!carbon) {
        toast.error(t`Carbon client not available`);
        return;
      }

      const filePath = getFilePath(file.name);

      let deleted = false;
      let lastError: string | undefined;

      for (const physicalBucket of [companyPrivateBucket]) {
        const result = await carbon.storage
          .from(physicalBucket)
          .remove([filePath]);

        if (!result.error) {
          deleted = true;
        } else {
          lastError = result.error.message;
        }
      }

      if (!deleted) {
        toast.error(lastError || "Error deleting file");
        return;
      }

      toast.success(t`${file.name} deleted successfully`);
      revalidator.revalidate();
    },
    [carbon, company.id, companyPrivateBucket, getFilePath, revalidator, t]
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
                        if (["PDF", "Image"].includes(type)) {
                          window.open(
                            path.to.file.preview(
                              companyPrivateBucket,
                              getFilePath(file.name)
                            ),
                            "_blank"
                          );
                        } else {
                          download(file);
                        }
                      }}
                    >
                      {["PDF", "Image"].includes(type) ? (
                        <DocumentPreview
                          bucket={companyPrivateBucket}
                          pathToFile={getFilePath(file.name)}
                          // @ts-expect-error
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
                    Math.floor((file.metadata?.size ?? 0) / 1024)
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
                        <DropdownMenuItem onClick={() => download(file)}>
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
      {!isReadOnly && <FileDropzone onDrop={onDrop} />}
    </>
  );
}

export default MaintenanceDispatchNotes;
