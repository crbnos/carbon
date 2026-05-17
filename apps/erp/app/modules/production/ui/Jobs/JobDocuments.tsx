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
import { convertKbToString, getCompanyPrivateBucket } from "@carbon/utils";
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

const useJobDocuments = ({
  jobId,
  itemId
}: {
  jobId: string;
  itemId?: string | null;
}) => {
  const permissions = usePermissions();
  const { t } = useLingui();
  const revalidator = useRevalidator();
  const { carbon } = useCarbon();
  const { company } = useUser();
  const submit = useSubmit();
  const companyPrivateBucket = getCompanyPrivateBucket(company.id);

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
      let deleted = false;
      let lastError: string | undefined;

      for (const physicalBucket of [companyPrivateBucket]) {
        const fileDelete = await carbon?.storage
          .from(physicalBucket)
          .remove([getPath(file, bucket as "job" | "parts")]);

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

      toast.success(t`${file.name} deleted successfully`);
      revalidator.revalidate();
    },
    [company.id, companyPrivateBucket, getPath, carbon?.storage, revalidator, t]
  );

  const deleteModel = useCallback(async () => {
    if (!carbon) return;

    const { error } = await carbon
      .from("job")
      .update({ modelUploadId: null })
      .eq("id", jobId);
    if (error) {
      toast.error(t`Error removing model from job`);
      return;
    }
    toast.success(t`Model removed from job`);
    revalidator.revalidate();
  }, [carbon, jobId, revalidator, t]);

  const downloadModel = useCallback(
    async (model: ModelUpload) => {
      if (!model.modelPath || !model.modelName) {
        toast.error(t`Model data is missing`);
        return;
      }

      const url = path.to.file.preview(companyPrivateBucket, model.modelPath);
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

    [companyPrivateBucket, t]
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  const download = useCallback(
    async (file: FileObject & { bucket?: string }) => {
      const bucket = file.bucket === "parts" ? "parts" : "job";
      const url = path.to.file.preview(
        companyPrivateBucket,
        getPath(file, bucket as "job" | "parts")
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

    [companyPrivateBucket, getPath]
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
      bucket = "job"
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
        fetcherKey: `job:${name}`
      });
    },
    [jobId, submit]
  );

  const upload = useCallback(
    async (files: File[], bucket: "job" | "parts" = "job") => {
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
          .from(companyPrivateBucket)
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
    [
      companyPrivateBucket,
      getPath,
      createDocumentRecord,
      carbon,
      revalidator,
      itemId,
      t
    ]
  );

  const moveFile = useCallback(
    async (
      file: FileObject & { bucket?: string },
      targetBucket: "job" | "parts"
    ) => {
      if (!carbon) {
        toast.error(t`Carbon client not available`);
        return;
      }

      if (targetBucket === "parts" && !itemId) {
        toast.error(t`Cannot move to parts bucket without item ID`);
        return;
      }

      const currentBucket = file.bucket === "parts" ? "parts" : "job";

      if (currentBucket === targetBucket) {
        toast.error(t`File is already in the selected bucket`);
        return;
      }

      try {
        const sourcePath = getPath(file, currentBucket);
        let downloadData: Blob | null = null;
        let sourcePhysicalBucket = companyPrivateBucket;

        for (const physicalBucket of [companyPrivateBucket]) {
          const result = await carbon.storage
            .from(physicalBucket)
            .download(sourcePath);

          if (!result.error && result.data) {
            downloadData = result.data;
            sourcePhysicalBucket = physicalBucket;
            break;
          }
        }

        if (!downloadData) {
          toast.error(t`Failed to download file for moving`);
          return;
        }

        const targetPath = getPath(file, targetBucket);
        const { error: uploadError } = await carbon.storage
          .from(companyPrivateBucket)
          .upload(targetPath, downloadData, {
            cacheControl: `${12 * 60 * 60}`,
            upsert: true
          });

        if (uploadError) {
          toast.error(t`Failed to upload file to new location`);
          return;
        }

        const { error: deleteError } = await carbon.storage
          .from(sourcePhysicalBucket)
          .remove([sourcePath]);

        if (deleteError) {
          toast.error(t`Failed to delete file from old location`);
          return;
        }

        toast.success(
          `Moved ${file.name} to ${
            targetBucket === "parts" ? "Item Master" : "Job"
          } bucket`
        );
        revalidator.revalidate();
      } catch (error) {
        toast.error(t`Error moving file`);
        console.error(error);
      }
    },
    [carbon, company.id, companyPrivateBucket, itemId, getPath, revalidator, t]
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

type JobDocumentsProps = {
  files: FileObject[];
  jobId: string;
  itemId?: string | null;
  bucket?: "job" | "parts";
  modelUpload?: ModelUpload;
  isReadOnly?: boolean;
};

const JobDocuments = ({
  files,
  jobId,
  itemId,
  modelUpload,
  bucket = "job",
  isReadOnly
}: JobDocumentsProps) => {
  const {
    company: { id: companyId }
  } = useUser();
  const companyPrivateBucket = getCompanyPrivateBucket(companyId);
  const { t } = useLingui();
  const { formatDate } = useDateFormatter();
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
    upload
  } = useJobDocuments({
    jobId,
    itemId
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
              <JobDocumentForm jobId={jobId} itemId={itemId} bucket={bucket} />
            )}
          </CardAction>
        </HStack>
        <CardContent>
          <Table>
            <Thead>
              <Tr>
                <Th>Name</Th>
                <Th>Size</Th>
                <Th>Bucket</Th>
                <Th>Created</Th>
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
                    <Enumerable value="Job" />
                  </Td>
                  <Td className="text-xs font-mono">--</Td>
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
                          <DropdownMenuItem asChild>
                            <Link to={getModelPath(modelUpload)}>
                              <Trans>View</Trans>
                            </Link>
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => downloadModel(modelUpload)}
                          >
                            Download
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            destructive
                            disabled={!canDelete || isReadOnly}
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
                                path.to.file.preview(
                                  companyPrivateBucket,
                                  getPath(file, bucket as "job" | "parts")
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
                              Download
                            </DropdownMenuItem>
                            {itemId &&
                              (file as any).bucket !== "opportunity-line" && (
                                <DropdownMenuSub>
                                  <DropdownMenuSubTrigger
                                    disabled={!canUpdate || isReadOnly}
                                  >
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
                              disabled={!canDelete || isReadOnly}
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
                    colSpan={5}
                    className="py-8 text-muted-foreground text-center"
                  >
                    No files
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

export default JobDocuments;

type JobDocumentFormProps = {
  jobId: string;
  itemId?: string | null;
  bucket?: "job" | "parts";
};

const JobDocumentForm = ({
  jobId,
  itemId,
  bucket = "job"
}: JobDocumentFormProps) => {
  const permissions = usePermissions();
  const { upload } = useJobDocuments({ jobId, itemId });

  const uploadFiles = async (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      upload(Array.from(e.target.files), bucket);
    }
  };

  return (
    <File
      isDisabled={!permissions.can("update", "production")}
      leftIcon={<LuUpload />}
      onChange={(e) => uploadFiles(e)}
      multiple
    >
      New
    </File>
  );
};

const usePendingItems = () => {
  const {
    company: { id: companyId }
  } = useUser();
  const companyPrivateBucket = getCompanyPrivateBucket(companyId);

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
          bucket_id: companyPrivateBucket,
          bucket: "job",
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
