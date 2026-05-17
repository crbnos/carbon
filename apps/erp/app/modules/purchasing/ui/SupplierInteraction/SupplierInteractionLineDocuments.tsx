import { useCarbon } from "@carbon/auth";
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
import { convertKbToString, getCompanyPrivateBucket } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import type { FileObject } from "@supabase/storage-js";
import type { ChangeEvent } from "react";
import { useCallback } from "react";
import { LuEllipsisVertical, LuUpload } from "react-icons/lu";
import { useFetchers, useRevalidator, useSubmit } from "react-router";
import { DocumentPreview, FileDropzone } from "~/components";
import DocumentIcon from "~/components/DocumentIcon";
import { useDateFormatter, usePermissions, useUser } from "~/hooks";
import type { ItemFile } from "~/modules/items";
import type { OptimisticFileObject } from "~/modules/shared";
import { getDocumentType } from "~/modules/shared";
import { path } from "~/utils/path";
import { stripSpecialCharacters } from "~/utils/string";

type SupportedDocument =
  | "Purchasing Request for Quote"
  | "Supplier Quote"
  | "Purchase Order"
  | "Purchase Invoice";

const useSupplierInteractionLineDocuments = ({
  id,
  lineId,
  type
}: {
  id: string;
  lineId: string;
  type: SupportedDocument;
}) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const revalidator = useRevalidator();
  const { carbon } = useCarbon();
  const { company } = useUser();
  const submit = useSubmit();
  const companyPrivateBucket = getCompanyPrivateBucket(company.id);

  const canDelete = permissions.can("delete", "sales");
  const canUpdate = permissions.can("update", "sales");

  const getPath = useCallback(
    (file: { name: string }) => {
      return `${
        company.id
      }/supplier-interaction-line/${lineId}/${stripSpecialCharacters(
        file.name
      )}`;
    },
    [company.id, lineId]
  );

  const deleteFile = useCallback(
    async (file: ItemFile) => {
      let deleted = false;
      let lastError: string | undefined;

      for (const physicalBucket of [companyPrivateBucket]) {
        const fileDelete = await carbon?.storage
          .from(physicalBucket)
          .remove([getPath(file)]);

        if (fileDelete && !fileDelete.error) {
          deleted = true;
        } else if (fileDelete?.error) {
          lastError = fileDelete.error.message;
        }
      }

      if (!deleted) {
        toast.error(lastError || "Error deleting file");
        return;
      }

      toast.success(`${file.name} deleted successfully`);
      revalidator.revalidate();
    },
    [company.id, companyPrivateBucket, getPath, carbon?.storage, revalidator]
  );

  const download = useCallback(
    async (file: ItemFile) => {
      const url = path.to.file.preview(companyPrivateBucket, getPath(file));
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
    [companyPrivateBucket, getPath, t]
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
      formData.append("sourceDocument", type);
      formData.append("sourceDocumentId", id);

      submit(formData, {
        method: "post",
        action: path.to.newDocument,
        navigate: false,
        fetcherKey: `supplier-interaction-line:${name}`
      });
    },
    [id, submit, type]
  );

  const upload = useCallback(
    async (files: File[]) => {
      if (!carbon) {
        toast.error(t`Carbon client not available`);
        return;
      }

      for (const file of files) {
        const fileName = getPath(file);

        const fileUpload = await carbon.storage
          .from(companyPrivateBucket)
          .upload(fileName, file, {
            cacheControl: `${12 * 60 * 60}`,
            upsert: true
          });

        if (fileUpload.error) {
          toast.error(`Failed to upload file: ${file.name}`);
        } else if (fileUpload.data?.path) {
          createDocumentRecord({
            path: fileUpload.data.path,
            name: file.name,
            size: file.size
          });
        }
      }
      revalidator.revalidate();
    },
    [
      companyPrivateBucket,
      getPath,
      createDocumentRecord,
      carbon,
      revalidator,
      t
    ]
  );

  return {
    canDelete,
    canUpdate,
    deleteFile,
    download,
    getPath,

    upload
  };
};

type SupplierInteractionLineDocumentsProps = {
  files: FileObject[];
  id: string;
  isReadOnly?: boolean;
  lineId: string;
  type: SupportedDocument;
};

const SupplierInteractionLineDocuments = ({
  files,
  id,
  isReadOnly,
  lineId,
  type
}: SupplierInteractionLineDocumentsProps) => {
  const {
    company: { id: companyId }
  } = useUser();
  const companyPrivateBucket = getCompanyPrivateBucket(companyId);
  const { t } = useLingui();
  const { formatDate } = useDateFormatter();
  const { canDelete, download, deleteFile, getPath, upload } =
    useSupplierInteractionLineDocuments({
      id,
      lineId,
      type
    });

  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      upload(acceptedFiles);
    },
    [upload]
  );

  const attachmentsByName = new Map<string, FileObject | OptimisticFileObject>(
    files.map((file) => [file.name, file])
  );
  const pendingItems = usePendingItems();
  for (let pendingItem of pendingItems) {
    let item = attachmentsByName.get(pendingItem.name);
    let merged = item ? { ...item, ...pendingItem } : pendingItem;
    attachmentsByName.set(pendingItem.name, merged);
  }

  const allFiles = Array.from(attachmentsByName.values()).sort((a, b) =>
    a.name.localeCompare(b.name)
  ) as FileObject[];

  return (
    <>
      <Card className="flex-grow">
        <HStack className="justify-between items-start">
          <CardHeader>
            <CardTitle>
              <Trans>Files</Trans>
            </CardTitle>
          </CardHeader>
          <CardAction>
            {!isReadOnly && (
              <SupplierInteractionLineDocumentForm
                id={id}
                type={type}
                lineId={lineId}
              />
            )}
          </CardAction>
        </HStack>
        <CardContent>
          <Table>
            <Thead>
              <Tr>
                <Th>Name</Th>
                <Th>Size</Th>
                <Th>Created</Th>
                <Th />
              </Tr>
            </Thead>
            <Tbody>
              {allFiles.map((file) => {
                const type = getDocumentType(file.name);
                return (
                  <Tr key={file.id}>
                    <Td>
                      <HStack>
                        <DocumentIcon type={type} />
                        <span
                          className="font-medium"
                          onClick={() => {
                            if (["PDF", "Image"].includes(type)) {
                              window.open(
                                path.to.file.previewFile(
                                  `${"private"}/${getPath(file)}`
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
                              pathToFile={getPath(file)}
                              // @ts-ignore
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
                    <Td className="text-xs font-mono">
                      {file.created_at ? formatDate(file.created_at) : "--"}
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
                            <DropdownMenuItem
                              destructive
                              disabled={!canDelete || isReadOnly}
                              onClick={() => deleteFile(file)}
                            >
                              <Trans>Delete</Trans>
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </Td>
                  </Tr>
                );
              })}
              {allFiles.length === 0 && (
                <Tr>
                  <Td
                    colSpan={24}
                    className="py-8 text-muted-foreground text-center"
                  >
                    <Trans>No files</Trans>
                  </Td>
                </Tr>
              )}
            </Tbody>
          </Table>
          {!isReadOnly && <FileDropzone onDrop={onDrop} />}
        </CardContent>
      </Card>
    </>
  );
};

export default SupplierInteractionLineDocuments;

type SupplierInteractionLineDocumentFormProps = {
  id: string;
  lineId: string;
  type: SupportedDocument;
};

const SupplierInteractionLineDocumentForm = ({
  id,
  lineId,
  type
}: SupplierInteractionLineDocumentFormProps) => {
  const permissions = usePermissions();
  const { upload } = useSupplierInteractionLineDocuments({ id, lineId, type });

  const uploadFiles = async (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      upload(Array.from(e.target.files));
    }
  };

  return (
    <File
      isDisabled={!permissions.can("update", "sales")}
      leftIcon={<LuUpload />}
      onChange={uploadFiles}
      multiple
    >
      <Trans>New</Trans>
    </File>
  );
};

const usePendingItems = () => {
  type PendingItem = ReturnType<typeof useFetchers>[number] & {
    formData: FormData;
  };

  return useFetchers()
    .filter((fetcher): fetcher is PendingItem => {
      return fetcher.formAction === path.to.newDocument;
    })
    .reduce<OptimisticFileObject[]>((acc, fetcher) => {
      const path = fetcher.formData.get("path") as string;
      const name = fetcher.formData.get("name") as string;
      const size = parseInt(fetcher.formData.get("size") as string, 10) * 1024;

      if (path && name && size) {
        const newItem: OptimisticFileObject = {
          id: path,
          name: name,
          bucket_id: "private",
          bucket: "private",
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
