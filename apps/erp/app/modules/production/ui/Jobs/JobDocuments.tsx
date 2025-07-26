import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
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
  VStack,
  toast,
} from "@carbon/react";
import { convertKbToString } from "@carbon/utils";
import { Link, useFetchers, useRevalidator, useSubmit } from "@remix-run/react";
import type { FileObject } from "@supabase/storage-js";
import type { ChangeEvent } from "react";
import { LuEllipsisVertical, LuUpload } from "react-icons/lu";
import { DocumentPreview, FileDropzone, Hyperlink } from "~/components";
import DocumentIcon from "~/components/DocumentIcon";
import { usePermissions, useUser } from "~/hooks";
import { getDocumentType } from "~/modules/shared";
import { path } from "~/utils/path";

import { useCarbon } from "@carbon/auth";
import { useCallback } from "react";
import { Enumerable } from "~/components/Enumerable";
import type { OptimisticFileObject } from "~/modules/shared";
import type { ModelUpload } from "~/types";
import { stripSpecialCharacters } from "~/utils/string";

const useJobDocuments = ({
  jobId,
  itemId,
}: {
  jobId: string;
  itemId?: string | null;
}) => {
  const permissions = usePermissions();
  const revalidator = useRevalidator();
  const { carbon } = useCarbon();
  const { company } = useUser();
  const submit = useSubmit();

  const canDelete = permissions.can("delete", "production");
  const canUpdate = permissions.can("update", "production");

  const getPath = useCallback(
    (file: { name: string }, bucket: "job" | "parts" = "job") => {
      if (bucket === "parts" && itemId) {
        return `${company.id}/parts/${itemId}/${stripSpecialCharacters(
          file.name
        )}`;
      }
      return `${company.id}/job/${jobId}/${stripSpecialCharacters(file.name)}`;
    },
    [company.id, jobId, itemId]
  );

  const deleteFile = useCallback(
    async (file: FileObject & { bucket?: string }) => {
      const bucket = file.bucket === "parts" ? "parts" : "job";
      const fileDelete = await carbon?.storage
        .from("private")
        .remove([getPath(file, bucket as "job" | "parts")]);

      if (!fileDelete || fileDelete.error) {
        toast.error(fileDelete?.error?.message || "Error deleting file");
        return;
      }

      toast.success(`${file.name} deleted successfully`);
      revalidator.revalidate();
    },
    [getPath, carbon?.storage, revalidator]
  );

  const deleteModel = useCallback(async () => {
    if (!carbon) return;

    const { error } = await carbon
      .from("job")
      .update({ modelUploadId: null })
      .eq("id", jobId);
    if (error) {
      toast.error("Error removing model from job");
      return;
    }
    toast.success("Model removed from job");
    revalidator.revalidate();
  }, [carbon, jobId, revalidator]);

  const downloadModel = useCallback(
    async (model: ModelUpload) => {
      if (!model.modelPath || !model.modelName) {
        toast.error("Model data is missing");
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
        toast.error("Error downloading file");
        console.error(error);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const download = useCallback(
    async (file: FileObject & { bucket?: string }) => {
      const bucket = file.bucket === "parts" ? "parts" : "job";
      const url = path.to.file.previewFile(
        `private/${getPath(file, bucket as "job" | "parts")}`
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
        toast.error("Error downloading file");
        console.error(error);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      bucket = "job",
    }: {
      path: string;
      name: string;
      size: number;
      bucket?: "job" | "parts";
    }) => {
      const formData = new FormData();
      formData.append("path", filePath);
      formData.append("name", name);
      formData.append("size", Math.round(size / 1024).toString());
      formData.append("sourceDocument", "Job");
      formData.append("sourceDocumentId", jobId);

      submit(formData, {
        method: "post",
        action: path.to.newDocument,
        navigate: false,
        fetcherKey: `job:${name}`,
      });
    },
    [jobId, submit]
  );

  const upload = useCallback(
    async (files: File[], bucket: "job" | "parts" = "job") => {
      if (!carbon) {
        toast.error("Carbon client not available");
        return;
      }

      if (bucket === "parts" && !itemId) {
        toast.error("Cannot upload to parts bucket without item ID");
        return;
      }

      for (const file of files) {
        const fileName = getPath(file, bucket);

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
            bucket,
          });
        }
      }
      revalidator.revalidate();
    },
    [getPath, createDocumentRecord, carbon, revalidator, itemId]
  );

  const moveFile = useCallback(
    async (
      file: FileObject & { bucket?: string },
      targetBucket: "job" | "parts"
    ) => {
      if (!carbon) {
        toast.error("Carbon client not available");
        return;
      }

      if (targetBucket === "parts" && !itemId) {
        toast.error("Cannot move to parts bucket without item ID");
        return;
      }

      const currentBucket = file.bucket === "parts" ? "parts" : "job";

      if (currentBucket === targetBucket) {
        toast.error("File is already in the selected bucket");
        return;
      }

      try {
        // Download the file first
        const sourcePath = getPath(file, currentBucket);
        const { data: downloadData } = await carbon.storage
          .from("private")
          .download(sourcePath);

        if (!downloadData) {
          toast.error("Failed to download file for moving");
          return;
        }

        // Upload to new location
        const targetPath = getPath(file, targetBucket);
        const { error: uploadError } = await carbon.storage
          .from("private")
          .upload(targetPath, downloadData, {
            cacheControl: `${12 * 60 * 60}`,
            upsert: true,
          });

        if (uploadError) {
          toast.error("Failed to upload file to new location");
          return;
        }

        // Delete from old location
        const { error: deleteError } = await carbon.storage
          .from("private")
          .remove([sourcePath]);

        if (deleteError) {
          toast.error("Failed to delete file from old location");
          return;
        }

        toast.success(
          `Moved ${file.name} to ${
            targetBucket === "parts" ? "Item Master" : "Job"
          } bucket`
        );
        revalidator.revalidate();
      } catch (error) {
        toast.error("Error moving file");
        console.error(error);
      }
    },
    [carbon, itemId, getPath, revalidator]
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
    upload,
  };
};

type JobDocumentsProps = {
  files: FileObject[];
  jobId: string;
  itemId?: string | null;
  modelUpload?: ModelUpload;
};

const JobDocuments = ({
  files,
  jobId,
  itemId,
  modelUpload,
}: JobDocumentsProps) => {
  const {
    canDelete,
    canUpdate,
    download,
    downloadModel,
    deleteFile,
    deleteModel,
    getPath,
    getModelPath,
    moveFile,
    upload,
  } = useJobDocuments({
    jobId,
    itemId,
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
            <CardDescription>Job documents</CardDescription>
          </CardHeader>
          <CardAction>
            <JobDocumentForm jobId={jobId} itemId={itemId} />
          </CardAction>
        </HStack>
        <CardContent>
          <Table>
            <Thead>
              <Tr>
                <Th>Name</Th>
                <Th>Size</Th>
                <Th>Bucket</Th>
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
                  <Td>Job</Td>
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
                            <Link to={getModelPath(modelUpload)}>View</Link>
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => downloadModel(modelUpload)}
                          >
                            Download
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            destructive
                            disabled={!canDelete}
                            onClick={() => deleteModel()}
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
                          className="font-medium cursor-pointer"
                          onClick={() => {
                            if (["PDF", "Image"].includes(type)) {
                              const bucket =
                                (file as any).bucket === "parts"
                                  ? "parts"
                                  : "job";
                              window.open(
                                path.to.file.previewFile(
                                  `${"private"}/${getPath(
                                    file,
                                    bucket as "job" | "parts"
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
                                  : "job"
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
                            : (file as any).bucket === "opportunity-line"
                            ? "Opportunity"
                            : "Job"
                        }
                      />
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
                              Download
                            </DropdownMenuItem>
                            {itemId &&
                              (file as any).bucket !== "opportunity-line" && (
                                <DropdownMenuSub>
                                  <DropdownMenuSubTrigger disabled={!canUpdate}>
                                    Move to
                                  </DropdownMenuSubTrigger>
                                  <DropdownMenuSubContent>
                                    <DropdownMenuRadioGroup
                                      value={
                                        (file as any).bucket === "parts"
                                          ? "parts"
                                          : "job"
                                      }
                                      onValueChange={(value) =>
                                        moveFile(file, value as "job" | "parts")
                                      }
                                    >
                                      <DropdownMenuRadioItem value="job">
                                        Job
                                      </DropdownMenuRadioItem>
                                      <DropdownMenuRadioItem value="parts">
                                        Item
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
                    colSpan={4}
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

export default JobDocuments;

type JobDocumentFormProps = {
  jobId: string;
  itemId?: string | null;
};

const JobDocumentForm = ({ jobId, itemId }: JobDocumentFormProps) => {
  const permissions = usePermissions();
  const { upload } = useJobDocuments({ jobId, itemId });

  const uploadFiles = async (
    e: ChangeEvent<HTMLInputElement>,
    bucket: "job" | "parts" = "job"
  ) => {
    if (e.target.files) {
      upload(Array.from(e.target.files), bucket);
    }
  };

  return (
    <File
      isDisabled={!permissions.can("update", "production")}
      leftIcon={<LuUpload />}
      onChange={(e) => uploadFiles(e, "job")}
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
