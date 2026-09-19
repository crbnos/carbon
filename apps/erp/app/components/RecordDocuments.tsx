import { useCarbon } from "@carbon/auth";
import { convertKbToString } from "@carbon/files";
import { getLogger } from "@carbon/logger";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  File,
  HStack,
  IconButton,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  toast
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { FileObject } from "@supabase/storage-js";
import type { ChangeEvent } from "react";
import { useCallback } from "react";
import { LuEllipsisVertical, LuExternalLink, LuUpload } from "react-icons/lu";
import { useFetchers, useRevalidator, useSubmit } from "react-router";
import { DateTime, DocumentPreview, FileDropzone } from "~/components";
import DocumentIcon from "~/components/DocumentIcon";
import { useFileUpload, usePermissions, useUser } from "~/hooks";
import type { OptimisticFileObject } from "~/modules/shared";
import { getDocumentType } from "~/modules/shared";
import { path } from "~/utils/path";
import { stripSpecialCharacters } from "~/utils/string";

const logger = getLogger("erp", "recorddocuments");

/**
 * Documents filed against a master record (a supplier or a customer as a
 * company), as opposed to a transaction. Files land in the `private` bucket
 * under `${companyId}/${bucketPrefix}/${id}`, and each upload also writes a
 * `document` row so the file is searchable in the global Documents module.
 */
/** PDFs and images are the only types a browser reliably renders inline; for
 *  anything else a new tab would just trigger a download, so the action is hidden. */
function isViewableInBrowser(fileName: string): boolean {
  const type = getDocumentType(fileName);
  return type === "PDF" || type === "Image";
}

type RecordDocumentsProps = {
  files: FileObject[];
  /** The record's id — becomes document.sourceDocumentId */
  id: string;
  /** Storage prefix segment under ${companyId}/, e.g. "supplier" */
  bucketPrefix: string;
  /** documentSourceType value */
  sourceDocument: "Supplier" | "Customer";
  /** Permission module gating upload/delete */
  module: "purchasing" | "sales";
  isReadOnly?: boolean;
};

const RecordDocuments = ({
  files,
  id,
  bucketPrefix,
  sourceDocument,
  module,
  isReadOnly
}: RecordDocumentsProps) => {
  const { t } = useLingui();
  const { canDelete, download, view, deleteAttachment, getPath, upload } =
    useRecordDocuments({ id, bucketPrefix, sourceDocument, module });

  const effectiveCanDelete = isReadOnly ? false : canDelete;

  const onDrop = useCallback(
    (acceptedFiles: globalThis.File[]) => {
      upload(acceptedFiles);
    },
    [upload]
  );

  const filesByName = new Map<string, FileObject | OptimisticFileObject>(
    files.map((file) => [file.name, file])
  );
  const pendingItems = usePendingItems();
  for (const pendingItem of pendingItems) {
    const item = filesByName.get(pendingItem.name);
    const merged = item ? { ...item, ...pendingItem } : pendingItem;
    filesByName.set(pendingItem.name, merged);
  }

  const filesToRender = Array.from(filesByName.values()).sort((a, b) =>
    a.name.localeCompare(b.name)
  ) as FileObject[];

  return (
    <Card>
      <HStack className="justify-between items-start">
        <CardHeader>
          <CardTitle>
            <Trans>Documents</Trans>
          </CardTitle>
        </CardHeader>
        <CardAction>
          {!isReadOnly && (
            <RecordDocumentUpload
              id={id}
              bucketPrefix={bucketPrefix}
              sourceDocument={sourceDocument}
              module={module}
            />
          )}
        </CardAction>
      </HStack>
      <CardContent>
        <Table>
          <Thead>
            <Tr>
              <Th>
                <Trans>Name</Trans>
              </Th>
              <Th>
                <Trans>Size</Trans>
              </Th>
              <Th>
                <Trans>Created</Trans>
              </Th>
              <Th />
            </Tr>
          </Thead>
          <Tbody>
            {filesToRender.length ? (
              filesToRender.map((file) => (
                <Tr key={file.id}>
                  <Td>
                    <HStack>
                      <DocumentIcon type={getDocumentType(file.name)} />
                      <span
                        className="font-medium cursor-pointer"
                        onClick={() => download(file)}
                      >
                        <DocumentPreview
                          bucket="private"
                          pathToFile={getPath(file)}
                          // @ts-ignore
                          type={getDocumentType(file.name)}
                        >
                          {file.name}
                        </DocumentPreview>
                      </span>
                    </HStack>
                  </Td>
                  <Td className="text-xs font-mono">
                    {convertKbToString(
                      Math.floor((file.metadata?.size ?? 0) / 1024)
                    )}
                  </Td>
                  <Td className="text-xs font-mono">
                    {file.created_at ? (
                      <DateTime value={file.created_at} variant="date" />
                    ) : (
                      "--"
                    )}
                  </Td>
                  <Td>
                    <div className="flex justify-end gap-2">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <IconButton
                            aria-label={t`More`}
                            icon={<LuEllipsisVertical />}
                            variant="secondary"
                          />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent>
                          {isViewableInBrowser(file.name) && (
                            <DropdownMenuItem onClick={() => view(file)}>
                              <LuExternalLink className="mr-2" />
                              <Trans>View in new tab</Trans>
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem onClick={() => download(file)}>
                            <Trans>Download</Trans>
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            destructive
                            disabled={!effectiveCanDelete}
                            onClick={() => deleteAttachment(file)}
                          >
                            <Trans>Delete</Trans>
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </Td>
                </Tr>
              ))
            ) : (
              <Tr>
                <Td
                  colSpan={24}
                  className="py-8 text-muted-foreground text-center"
                >
                  <Trans>No documents</Trans>
                </Td>
              </Tr>
            )}
          </Tbody>
        </Table>
        {!isReadOnly && <FileDropzone onDrop={onDrop} />}
      </CardContent>
    </Card>
  );
};

type RecordDocumentUploadProps = {
  id: string;
  bucketPrefix: string;
  sourceDocument: "Supplier" | "Customer";
  module: "purchasing" | "sales";
};

const RecordDocumentUpload = (props: RecordDocumentUploadProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const { upload } = useRecordDocuments(props);

  const uploadFiles = async (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      await upload(Array.from(e.target.files));
    }
  };

  return (
    <File
      isDisabled={!permissions.can("update", props.module)}
      leftIcon={<LuUpload />}
      onChange={uploadFiles}
      multiple
    >
      {t`New`}
    </File>
  );
};

export const useRecordDocuments = ({
  id,
  bucketPrefix,
  sourceDocument,
  module
}: RecordDocumentUploadProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const { company } = useUser();
  const { carbon } = useCarbon();
  const revalidator = useRevalidator();
  const submit = useSubmit();

  const canDelete = permissions.can("delete", module);

  const getPath = useCallback(
    (file: { name: string }) =>
      `${company.id}/${bucketPrefix}/${id}/${stripSpecialCharacters(
        file.name
      )}`,
    [company.id, bucketPrefix, id]
  );

  const deleteAttachment = useCallback(
    async (file: FileObject) => {
      const result = await carbon?.storage
        .from("private")
        .remove([getPath(file)]);

      if (!result || result.error) {
        toast.error(result?.error?.message || t`Error deleting file`);
        return;
      }

      toast.success(t`${file.name} deleted successfully`);
      revalidator.revalidate();
    },
    [carbon?.storage, getPath, revalidator, t]
  );

  const view = useCallback(
    (file: FileObject) => {
      // The preview route streams the file inline, so the browser renders it
      // rather than downloading. noopener because this is a user-content URL.
      window.open(
        path.to.file.previewFile(`private/${getPath(file)}`),
        "_blank",
        "noopener,noreferrer"
      );
    },
    [getPath]
  );

  const download = useCallback(
    async (file: FileObject) => {
      const url = path.to.file.previewFile(`private/${getPath(file)}`);
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
        logger.error("Error", { error });
      }
    },
    [getPath, t]
  );

  const createDocumentRecord = useCallback(
    ({
      path: filePath,
      name,
      size
    }: {
      path: string;
      name: string;
      size: number;
    }) => {
      const formData = new FormData();
      formData.append("path", filePath);
      formData.append("name", name);
      formData.append("size", Math.round(size / 1024).toString());
      formData.append("sourceDocument", sourceDocument);
      formData.append("sourceDocumentId", id);

      submit(formData, {
        method: "post",
        action: path.to.newDocument,
        navigate: false,
        fetcherKey: `${bucketPrefix}:${name}`
      });
    },
    [id, bucketPrefix, sourceDocument, submit]
  );

  const { upload: uploadFiles } = useFileUpload();
  const upload = useCallback(
    async (files: globalThis.File[]) => {
      await uploadFiles(files, {
        getPath,
        onSuccess: (file, uploadedPath) => {
          toast.success(t`Uploaded: ${file.name}`);
          createDocumentRecord({
            path: uploadedPath,
            name: file.name,
            size: file.size
          });
        }
      });
      revalidator.revalidate();
    },
    [uploadFiles, getPath, createDocumentRecord, revalidator, t]
  );

  return {
    canDelete,
    deleteAttachment,
    download,
    view,
    upload,
    getPath
  };
};

export const usePendingItems = () => {
  type PendingItem = ReturnType<typeof useFetchers>[number] & {
    formData: FormData;
  };

  return useFetchers()
    .filter((fetcher): fetcher is PendingItem => {
      return fetcher.formAction === path.to.newDocument;
    })
    .reduce<OptimisticFileObject[]>((acc, fetcher) => {
      const filePath = fetcher.formData.get("path") as string;
      const name = fetcher.formData.get("name") as string;
      const size = parseInt(fetcher.formData.get("size") as string, 10) * 1024;

      if (filePath && name && size) {
        const newItem: OptimisticFileObject = {
          id: filePath,
          name: name,
          bucket_id: "private",
          metadata: {
            size,
            mimetype: getDocumentType(name)
          }
        };
        return [...acc, newItem];
      }
      return acc;
    }, []);
};

export default RecordDocuments;
