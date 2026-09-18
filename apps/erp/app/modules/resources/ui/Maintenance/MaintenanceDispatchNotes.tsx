import { useCarbon } from "@carbon/auth";
import {
  convertKbToString,
  downloadBlob,
  isPreviewableDocumentType
} from "@carbon/files";
import { getLogger } from "@carbon/logger";
import type { JSONContent } from "@carbon/react";
import {
  Card,
  CardContent,
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
import { Trans, useLingui } from "@lingui/react/macro";
import type { FileObject } from "@supabase/storage-js";
import type { ChangeEvent } from "react";
import { Suspense, useCallback, useState } from "react";
import { LuEllipsisVertical, LuUpload } from "react-icons/lu";
import { Await, useRevalidator } from "react-router";
import { DocumentPreview, FileDropzone } from "~/components";
import DocumentIcon from "~/components/DocumentIcon";
import {
  useFileUpload,
  useImageUpload,
  usePermissions,
  useUser
} from "~/hooks";
import { getDocumentType } from "~/modules/shared";
import type { StorageItem } from "~/types";
import { path } from "~/utils/path";
import { stripSpecialCharacters } from "~/utils/string";

const logger = getLogger("erp", "maintenancedispatchnotes");

export function MaintenanceDispatchNotes({
  id,
  content: initialContent,
  isDisabled
}: {
  id: string;
  content: JSONContent;
  isDisabled: boolean;
}) {
  const { id: userId } = useUser();
  const { carbon } = useCarbon();
  const permissions = usePermissions();

  const [content, setContent] = useState(initialContent ?? {});

  const onUploadImage = useImageUpload("maintenance");

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

  const getFilePath = useCallback(
    (fileName: string) => {
      return `${company.id}/maintenance/${dispatchId}/${stripSpecialCharacters(fileName)}`;
    },
    [company.id, dispatchId]
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
        const response = await fetch(url);
        downloadBlob(await response.blob(), file.name);
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
      const result = await carbon.storage.from("private").remove([filePath]);

      if (result.error) {
        toast.error(result.error.message || "Error deleting file");
        return;
      }

      toast.success(t`${file.name} deleted successfully`);
      revalidator.revalidate();
    },
    [carbon, getFilePath, revalidator, t]
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
