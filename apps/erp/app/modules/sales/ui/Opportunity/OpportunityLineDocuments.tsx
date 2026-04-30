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
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
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
  toast,
  VStack
} from "@carbon/react";
import { convertKbToString } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import type { FileObject } from "@supabase/storage-js";
import type { ChangeEvent } from "react";
import { useCallback } from "react";
import { LuEllipsisVertical, LuUpload } from "react-icons/lu";
import { Link, useFetchers, useRevalidator, useSubmit } from "react-router";
import { DocumentPreview, FileDropzone, Hyperlink } from "~/components";
import DocumentIcon from "~/components/DocumentIcon";
import { Enumerable } from "~/components/Enumerable";
import { useDateFormatter, usePermissions, useUser } from "~/hooks";
import type { OptimisticFileObject } from "~/modules/shared";
import { getDocumentType } from "~/modules/shared";
import type { ModelUpload } from "~/types";
import { path } from "~/utils/path";
import { stripSpecialCharacters } from "~/utils/string";

const useOpportunityLineDocuments = ({
  id,
  lineId,
  itemId,
  type
}: {
  id: string;
  lineId: string;
  itemId?: string | null;
  type: "Request for Quote" | "Sales Order" | "Quote" | "Sales Invoice";
}) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const revalidator = useRevalidator();
  const { carbon } = useCarbon();
  const { company } = useUser();
  const submit = useSubmit();

  const canDelete = permissions.can("delete", "sales");
  const canUpdate = permissions.can("update", "sales");

  const getPath = useCallback(
    (
      file: { name: string },
      bucket: "opportunity-line" | "parts" = "opportunity-line"
    ) => {
      if (bucket === "parts" && itemId) {
        return `${company.id}/parts/${itemId}/${stripSpecialCharacters(
          file.name
        )}`;
      }
      return `${company.id}/opportunity-line/${lineId}/${stripSpecialCharacters(
        file.name
      )}`;
    },
    [company.id, lineId, itemId]
  );

  const deleteFile = useCallback(
    async (file: FileObject & { bucket?: string }) => {
      const bucket = file.bucket === "parts" ? "parts" : "opportunity-line";
      const fileDelete = await carbon?.storage
        .from("private")
        .remove([getPath(file, bucket as "opportunity-line" | "parts")]);

      if (!fileDelete || fileDelete.error) {
        toast.error(fileDelete?.error?.message || "Error deleting file");
        return;
      }

      toast.success(t`${file.name} deleted successfully`);
      revalidator.revalidate();
    },
    [getPath, carbon?.storage, revalidator, t]
  );

  const deleteModel = useCallback(
    async (lineId: string) => {
      if (!lineId || !carbon) return;

      const [
        salesRfqLineResult,
        quoteLineResult,
        salesOrderLineResult,
        salesInvoiceLineResult
      ] = await Promise.all([
        carbon
          .from("salesRfqLine")
          .update({ modelUploadId: null })
          .eq("id", lineId),
        carbon
          .from("quoteLine")
          .update({ modelUploadId: null })
          .eq("id", lineId),
        carbon
          .from("salesOrderLine")
          .update({ modelUploadId: null })
          .eq("id", lineId),
        carbon
          .from("salesInvoiceLine")
          .update({ modelUploadId: null })
          .eq("id", lineId)
      ]);

      if (salesRfqLineResult.error) {
        toast.error(t`Error removing model from RFQ line`);
        return;
      }

      if (quoteLineResult.error) {
        toast.error(t`Error removing model from quote line`);
        return;
      }

      if (salesOrderLineResult.error) {
        toast.error(t`Error removing model from sales order line`);
        return;
      }

      if (salesInvoiceLineResult.error) {
        toast.error(t`Error removing model from sales invoice line`);
        return;
      }

      toast.success(t`Model removed from line`);
      revalidator.revalidate();
    },
    [carbon, revalidator, t]
  );

  const downloadModel = useCallback(
    async (model: ModelUpload) => {
      if (!model.modelPath || !model.modelName) {
        toast.error(t`Model data is missing`);
        return;
      }

      const url = path.to.file.previewFile(`private/${model.modelPath}`);
      try {
        const response = await fetch(url);
        const blob = await response.blob();
        const blobUrl = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        document.body.appendChild(a);
        a.href = blobUrl;
        a.download = model.modelName;
        a.click();
        window.URL.revokeObjectURL(blobUrl);
        document.body.removeChild(a);
      } catch (error) {
        toast.error(t`Error downloading file`);
        console.error(error);
      }
    },

    [t]
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  const download = useCallback(
    async (file: FileObject & { bucket?: string }) => {
      const bucket = file.bucket === "parts" ? "parts" : "opportunity-line";
      const url = path.to.file.previewFile(
        `private/${getPath(file, bucket as "opportunity-line" | "parts")}`
      );
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

    []
  );

  const getModelPath = useCallback((model: ModelUpload) => {
    if (!model?.modelId) {
      return "";
    }
    return path.to.file.cadModel(model.modelId);
  }, []);

  const createDocumentRecord = useCallback(
    ({
      path: filePath,
      name,
      size,
      bucket = "opportunity-line"
    }: {
      path: string;
      name: string;
      size: number;
      bucket?: "opportunity-line" | "parts";
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
        fetcherKey: `opportunity-line:${name}`
      });
    },
    [id, submit, type]
  );

  const upload = useCallback(
    async (
      files: File[],
      bucket: "opportunity-line" | "parts" = "opportunity-line"
    ) => {
      if (!carbon) {
        toast.error(t`Carbon client not available`);
        return;
      }

      if (bucket === "parts" && !itemId) {
        toast.error(t`Cannot upload to parts bucket without item ID`);
        return;
      }

      for (const file of files) {
        const fileName = getPath(file, bucket);

        const fileUpload = await carbon.storage
          .from("private")
          .upload(fileName, file, {
            cacheControl: `${12 * 60 * 60}`,
            upsert: true
          });

        if (fileUpload.error) {
          toast.error(t`Failed to upload file: ${file.name}`);
        } else if (fileUpload.data?.path) {
          createDocumentRecord({
            path: fileUpload.data.path,
            name: file.name,
            size: file.size,
            bucket
          });
        }
      }
      revalidator.revalidate();
    },
    [getPath, createDocumentRecord, carbon, revalidator, itemId, t]
  );

  const moveFile = useCallback(
    async (
      file: FileObject & { bucket?: string },
      targetBucket: "opportunity-line" | "parts"
    ) => {
      if (!carbon) {
        toast.error(t`Carbon client not available`);
        return;
      }

      if (targetBucket === "parts" && !itemId) {
        toast.error(t`Cannot move to parts bucket without item ID`);
        return;
      }

      const currentBucket =
        file.bucket === "parts" ? "parts" : "opportunity-line";

      if (currentBucket === targetBucket) {
        toast.error(t`File is already in the selected bucket`);
        return;
      }

      try {
        // Download the file first
        const sourcePath = getPath(file, currentBucket);
        const { data: downloadData } = await carbon.storage
          .from("private")
          .download(sourcePath);

        if (!downloadData) {
          toast.error(t`Failed to download file for moving`);
          return;
        }

        // Upload to new location
        const targetPath = getPath(file, targetBucket);
        const { error: uploadError } = await carbon.storage
          .from("private")
          .upload(targetPath, downloadData, {
            cacheControl: `${12 * 60 * 60}`,
            upsert: true
          });

        if (uploadError) {
          toast.error(t`Failed to upload file to new location`);
          return;
        }

        // Delete from old location
        const { error: deleteError } = await carbon.storage
          .from("private")
          .remove([sourcePath]);

        if (deleteError) {
          toast.error(t`Failed to delete file from old location`);
          return;
        }

        toast.success(
          t`Moved ${file.name} to ${
            targetBucket === "parts" ? "Parts" : "Opportunity"
          } bucket`
        );
        revalidator.revalidate();
      } catch (error) {
        toast.error(t`Error moving file`);
        console.error(error);
      }
    },
    [carbon, itemId, getPath, revalidator, t]
  );

  return {
    canDelete,
    canUpdate,
    deleteFile,
    deleteModel,
    download,
    downloadModel,
    getPath,
    getModelPath,
    moveFile,
    upload
  };
};

type OpportunityLineDocumentsProps = {
  files: FileObject[];
  id: string;
  lineId: string;
  itemId?: string | null;
  type: "Request for Quote" | "Sales Order" | "Quote" | "Sales Invoice";
  modelUpload?: ModelUpload;
  isReadOnly?: boolean;
};

const OpportunityLineDocuments = ({
  files,
  id,
  lineId,
  itemId,
  modelUpload,
  type,
  isReadOnly: isReadOnlyProp
}: OpportunityLineDocumentsProps) => {
  const { formatDate } = useDateFormatter();
  const {
    canDelete: canDeleteBase,
    canUpdate: canUpdateBase,
    download,
    downloadModel,
    deleteFile,
    deleteModel,
    getPath,
    getModelPath,
    moveFile,
    upload
  } = useOpportunityLineDocuments({
    id,
    lineId,
    itemId,
    type
  });
  const canDelete = isReadOnlyProp ? false : canDeleteBase;
  const canUpdate = isReadOnlyProp ? false : canUpdateBase;

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
            {!isReadOnlyProp && (
              <OpportunityLineDocumentForm
                id={id}
                type={type}
                lineId={lineId}
                itemId={itemId}
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
                  <Trans>Bucket</Trans>
                </Th>
                <Th>
                  <Trans>Created</Trans>
                </Th>
                <Th />
              </Tr>
            </Thead>
            <Tbody>
              {modelUpload?.modelName && (
                <Tr>
                  <Td>
                    <HStack>
                      <DocumentIcon type="Model" />
                      <VStack>
                        <Hyperlink
                          target="_blank"
                          to={getModelPath(modelUpload)}
                        >
                          {modelUpload.modelName}
                        </Hyperlink>
                      </VStack>
                    </HStack>
                  </Td>
                  <Td>
                    {modelUpload.modelSize
                      ? convertKbToString(
                          Math.floor((modelUpload.modelSize ?? 0) / 1024)
                        )
                      : "--"}
                  </Td>
                  <Td>
                    <Enumerable value="Model" />
                  </Td>
                  <Td className="text-xs font-mono">--</Td>
                  <Td>
                    <div className="flex justify-end w-full">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <IconButton
                            aria-label="More"
                            icon={<LuEllipsisVertical />}
                            variant="secondary"
                          />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent>
                          <DropdownMenuItem asChild>
                            <Link to={getModelPath(modelUpload)}>
                              <Trans>View</Trans>
                            </Link>
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => downloadModel(modelUpload)}
                          >
                            <Trans>Download</Trans>
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            destructive
                            disabled={!canDelete}
                            onClick={() => deleteModel(lineId)}
                          >
                            <Trans>Delete</Trans>
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </Td>
                </Tr>
              )}
              {allFiles.map((file) => {
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
                              const bucket =
                                (file as any).bucket === "parts"
                                  ? "parts"
                                  : "opportunity-line";
                              window.open(
                                path.to.file.previewFile(
                                  `${"private"}/${getPath(
                                    file,
                                    bucket as "opportunity-line" | "parts"
                                  )}`
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
                              bucket="private"
                              pathToFile={getPath(
                                file,
                                (file as any).bucket === "parts"
                                  ? "parts"
                                  : "opportunity-line"
                              )}
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
                    <Td>
                      <Enumerable
                        value={
                          (file as any).bucket === "parts"
                            ? "Item"
                            : "Opportunity"
                        }
                      />
                    </Td>
                    <Td className="text-xs font-mono">
                      {file.created_at ? formatDate(file.created_at) : "--"}
                    </Td>
                    <Td>
                      <div className="flex justify-end w-full">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <IconButton
                              aria-label="More"
                              icon={<LuEllipsisVertical />}
                              variant="secondary"
                            />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent>
                            <DropdownMenuItem onClick={() => download(file)}>
                              <Trans>Download</Trans>
                            </DropdownMenuItem>
                            {itemId && (
                              <DropdownMenuSub>
                                <DropdownMenuSubTrigger disabled={!canUpdate}>
                                  <Trans>Move to</Trans>
                                </DropdownMenuSubTrigger>
                                <DropdownMenuSubContent>
                                  <DropdownMenuRadioGroup
                                    value={
                                      (file as any).bucket === "parts"
                                        ? "parts"
                                        : "opportunity-line"
                                    }
                                    onValueChange={(value) =>
                                      moveFile(
                                        file,
                                        value as "opportunity-line" | "parts"
                                      )
                                    }
                                  >
                                    <DropdownMenuRadioItem value="opportunity-line">
                                      <Trans>Opportunity</Trans>
                                    </DropdownMenuRadioItem>
                                    <DropdownMenuRadioItem value="parts">
                                      <Trans>Item</Trans>
                                    </DropdownMenuRadioItem>
                                  </DropdownMenuRadioGroup>
                                </DropdownMenuSubContent>
                              </DropdownMenuSub>
                            )}
                            <DropdownMenuItem
                              destructive
                              disabled={!canDelete}
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
              {allFiles.length === 0 && !modelUpload && (
                <Tr>
                  <Td
                    colSpan={5}
                    className="py-8 text-muted-foreground text-center"
                  >
                    <Trans>No files</Trans>
                  </Td>
                </Tr>
              )}
            </Tbody>
          </Table>
          {!isReadOnlyProp && <FileDropzone onDrop={onDrop} />}
        </CardContent>
      </Card>
    </>
  );
};

export default OpportunityLineDocuments;

type OpportunityLineDocumentFormProps = {
  id: string;
  lineId: string;
  itemId?: string | null;
  type: "Request for Quote" | "Sales Order" | "Quote" | "Sales Invoice";
};

const OpportunityLineDocumentForm = ({
  id,
  lineId,
  itemId,
  type
}: OpportunityLineDocumentFormProps) => {
  const permissions = usePermissions();
  const { upload } = useOpportunityLineDocuments({ id, lineId, itemId, type });

  const uploadFiles = async (
    e: ChangeEvent<HTMLInputElement>,
    bucket: "opportunity-line" | "parts" = "opportunity-line"
  ) => {
    if (e.target.files) {
      upload(Array.from(e.target.files), bucket);
    }
  };

  return (
    <File
      isDisabled={!permissions.can("update", "sales")}
      leftIcon={<LuUpload />}
      onChange={(e) => uploadFiles(e, "opportunity-line")}
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
