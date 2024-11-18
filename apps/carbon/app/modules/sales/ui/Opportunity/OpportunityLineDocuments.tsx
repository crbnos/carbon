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
  VStack,
  toast,
} from "@carbon/react";
import { convertKbToString } from "@carbon/utils";
import type { FileObject } from "@supabase/storage-js";
import { LuUpload } from "react-icons/lu";
import { MdMoreVert } from "react-icons/md";
import { DocumentPreview, FileDropzone, Hyperlink } from "~/components";
import { DocumentIcon, getDocumentType } from "~/modules/documents";
import type { ItemFile } from "~/modules/items";

import { Link, useFetchers, useRevalidator, useSubmit } from "@remix-run/react";
import type { ChangeEvent } from "react";
import { usePermissions, useUser } from "~/hooks";
import { path } from "~/utils/path";

import { useCarbon } from "@carbon/auth";
import { useCallback } from "react";
import type { OptimisticFileObject } from "~/modules/shared";
import type { ModelUpload } from "~/types";
import { stripSpecialCharacters } from "~/utils/string";

const useOpportunityLineDocuments = ({
  id,
  lineId,
  type,
}: {
  id: string;
  lineId: string;
  type: "Request for Quote" | "Sales Order" | "Quote";
}) => {
  const permissions = usePermissions();
  const revalidator = useRevalidator();
  const { carbon } = useCarbon();
  const { company } = useUser();
  const submit = useSubmit();

  const canDelete = permissions.can("delete", "sales");
  const canUpdate = permissions.can("update", "sales");

  const getPath = useCallback(
    (file: { name: string }) => {
      return `${company.id}/opportunity-line/${lineId}/${stripSpecialCharacters(
        file.name
      )}`;
    },
    [company.id, lineId]
  );

  const deleteFile = useCallback(
    async (file: ItemFile) => {
      const fileDelete = await carbon?.storage
        .from("private")
        .remove([getPath(file)]);

      if (!fileDelete || fileDelete.error) {
        toast.error(fileDelete?.error?.message || "Error deleting file");
        return;
      }

      toast.success(`${file.name} deleted successfully`);
      revalidator.revalidate();
    },
    [getPath, carbon?.storage, revalidator]
  );

  const deleteModel = useCallback(
    async (lineId: string) => {
      if (!lineId || !carbon) return;

      const [salesRfqLineResult, quoteLineResult, salesOrderLineResult] =
        await Promise.all([
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
        ]);

      if (salesRfqLineResult.error) {
        toast.error("Error removing model from RFQ line");
        return;
      }

      if (quoteLineResult.error) {
        toast.error("Error removing model from quote line");
        return;
      }

      if (salesOrderLineResult.error) {
        toast.error("Error removing model from sales order line");
        return;
      }
      toast.success("Model removed from line");
      revalidator.revalidate();
    },
    [carbon, revalidator]
  );

  const download = useCallback(
    async (file: ItemFile) => {
      const result = await carbon?.storage
        .from("private")
        .download(getPath(file));

      if (!result || result.error) {
        toast.error(result?.error?.message || "Error downloading file");
        return;
      }

      const a = document.createElement("a");
      document.body.appendChild(a);
      const url = window.URL.createObjectURL(result.data);
      a.href = url;
      a.download = file.name;
      a.click();

      setTimeout(() => {
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      }, 0);
    },
    [carbon?.storage, getPath]
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
        fetcherKey: `opportunity-line:${name}`,
      });
    },
    [id, submit, type]
  );

  const upload = useCallback(
    async (files: File[]) => {
      if (!carbon) {
        toast.error("Carbon client not available");
        return;
      }

      for (const file of files) {
        const fileName = getPath(file);

        const fileUpload = await carbon.storage
          .from("private")
          .upload(fileName, file, {
            cacheControl: `${12 * 60 * 60}`,
            upsert: true,
          });

        if (fileUpload.error) {
          toast.error(`Failed to upload file: ${file.name}`);
        } else if (fileUpload.data?.path) {
          createDocumentRecord({
            path: fileUpload.data.path,
            name: file.name,
            size: file.size,
          });
        }
      }
      revalidator.revalidate();
    },
    [getPath, createDocumentRecord, carbon, revalidator]
  );

  return {
    canDelete,
    canUpdate,
    deleteFile,
    deleteModel,
    download,
    getPath,
    getModelPath,
    upload,
  };
};

type OpportunityLineDocumentsProps = {
  files: FileObject[];
  id: string;
  lineId: string;
  type: "Request for Quote" | "Sales Order" | "Quote";
  modelUpload?: ModelUpload;
};

const OpportunityLineDocuments = ({
  files,
  id,
  lineId,
  modelUpload,
  type,
}: OpportunityLineDocumentsProps) => {
  const {
    canDelete,
    download,
    deleteFile,
    deleteModel,
    getPath,
    getModelPath,
    upload,
  } = useOpportunityLineDocuments({
    id,
    lineId,
    type,
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
            <CardTitle>Files</CardTitle>
          </CardHeader>
          <CardAction>
            <OpportunityLineDocumentForm id={id} type={type} lineId={lineId} />
          </CardAction>
        </HStack>
        <CardContent>
          <Table>
            <Thead>
              <Tr>
                <Th>Name</Th>
                <Th>Size</Th>
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
                    <div className="flex justify-end w-full">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <IconButton
                            aria-label="More"
                            icon={<MdMoreVert />}
                            variant="secondary"
                          />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent>
                          <DropdownMenuItem asChild>
                            <Link to={getModelPath(modelUpload)}>View</Link>
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            disabled={!canDelete}
                            onClick={() => deleteModel(lineId)}
                          >
                            Delete
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
                          className="font-medium"
                          onClick={() => download(file)}
                        >
                          {["PDF", "Image"].includes(type) ? (
                            <DocumentPreview
                              bucket="private"
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
                    <Td>
                      <div className="flex justify-end w-full">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <IconButton
                              aria-label="More"
                              icon={<MdMoreVert />}
                              variant="secondary"
                            />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent>
                            <DropdownMenuItem onClick={() => download(file)}>
                              Download
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              disabled={!canDelete}
                              onClick={() => deleteFile(file)}
                            >
                              Delete
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
                    colSpan={24}
                    className="py-8 text-muted-foreground text-center"
                  >
                    No files
                  </Td>
                </Tr>
              )}
            </Tbody>
          </Table>
          <FileDropzone onDrop={onDrop} />
        </CardContent>
      </Card>
    </>
  );
};

export default OpportunityLineDocuments;

type OpportunityLineDocumentFormProps = {
  id: string;
  lineId: string;
  type: "Request for Quote" | "Sales Order" | "Quote";
};

const OpportunityLineDocumentForm = ({
  id,
  lineId,
  type,
}: OpportunityLineDocumentFormProps) => {
  const permissions = usePermissions();
  const { upload } = useOpportunityLineDocuments({ id, lineId, type });

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
      New
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
            mimetype: getDocumentType(name),
          },
        };
        return [...acc, newItem];
      }
      return acc;
    }, []);
};
