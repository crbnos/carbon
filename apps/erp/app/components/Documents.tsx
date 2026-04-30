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
import { convertKbToString } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ChangeEvent } from "react";
import { useCallback } from "react";
import { LuAxis3D, LuEllipsisVertical, LuUpload } from "react-icons/lu";
import { Link, useFetchers, useRevalidator, useSubmit } from "react-router";
import { DocumentPreview, FileDropzone, Hyperlink } from "~/components";
import DocumentIcon from "~/components/DocumentIcon";
import { useDateFormatter, usePermissions, useUser } from "~/hooks";
import type { OptimisticFileObject } from "~/modules/shared";
import { getDocumentType } from "~/modules/shared";
import type { ModelUpload, StorageItem } from "~/types";
import { path } from "~/utils/path";
import { stripSpecialCharacters } from "~/utils/string";

type DocumentsProps = {
  files: StorageItem[];
  modelUpload?: ModelUpload;
  sourceDocument?: "Job" | "Issue" | "Gauge Calibration Record";
  sourceDocumentId?: string;
  sourceDocumentLineId?: string;
  writeBucket: string;
  writeBucketPermission: string;
};

const Documents = ({
  files,
  modelUpload,
  sourceDocument,
  sourceDocumentId,
  sourceDocumentLineId,
  writeBucket,
  writeBucketPermission
}: DocumentsProps) => {
  const { t } = useLingui();
  const { formatDate } = useDateFormatter();
  const permissions = usePermissions();
  const revalidator = useRevalidator();
  const { carbon } = useCarbon();
  const { company } = useUser();
  const submit = useSubmit();

  const canDelete = permissions.can("delete", writeBucketPermission);
  const canUpdate = permissions.can("update", writeBucketPermission);

  const attachmentsByName = new Map<string, StorageItem | OptimisticFileObject>(
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
  ) as StorageItem[];

  const getReadPath = useCallback(
    (file: StorageItem) => {
      const id = sourceDocumentLineId || sourceDocumentId;
      return `${company.id}/${file.bucket ?? writeBucket}/${id}/${file.name}`;
    },
    [company.id, sourceDocumentId, sourceDocumentLineId, writeBucket]
  );

  const getWritePath = useCallback(
    (file: { name: string }) => {
      const id = sourceDocumentLineId || sourceDocumentId;
      return `${company.id}/${writeBucket}/${id}/${stripSpecialCharacters(
        file.name
      )}`;
    },
    [company.id, sourceDocumentId, sourceDocumentLineId, writeBucket]
  );

  const deleteFile = useCallback(
    async (file: StorageItem) => {
      const fileDelete = await carbon?.storage
        .from("private")
        .remove([getReadPath(file)]);

      if (!fileDelete || fileDelete.error) {
        toast.error(fileDelete?.error?.message || t`Error deleting file`);
        return;
      }

      toast.success(t`${file.name} deleted successfully`);
      revalidator.revalidate();
    },
    [carbon?.storage, getReadPath, revalidator, t]
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

  const deleteModel = useCallback(async () => {
    if (!carbon || !sourceDocumentId) return;

    if (sourceDocument === "Job") {
      const result = await carbon
        .from("job")
        .update({ modelUploadId: null })
        .eq("id", sourceDocumentId);

      if (result.error) {
        toast.error(t`Error removing model from ${sourceDocument}`);
        return;
      }
    } else if (sourceDocument === "Issue") {
      // no action required
    } else {
      toast.error(t`Unsupported source document type: ${sourceDocument}`);
      return;
    }

    toast.success(t`Model removed from ${sourceDocument}`);
    revalidator.revalidate();
  }, [carbon, sourceDocument, sourceDocumentId, revalidator, t]);

  const download = useCallback(
    async (file: StorageItem) => {
      const url = path.to.file.previewFile(`private/${getReadPath(file)}`);
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
    [getReadPath, t]
  );

  const upload = useCallback(
    async (files: File[]) => {
      if (!carbon) {
        toast.error(t`Carbon client not available`);
        return;
      }

      for (const file of files) {
        const fileName = getWritePath({ name: file.name });
        toast.info(t`Uploading ${file.name}`);
        const fileUpload = await carbon.storage
          .from("private")
          .upload(fileName, file, {
            cacheControl: `${12 * 60 * 60}`,
            upsert: true
          });

        if (fileUpload.error) {
          toast.error(t`Failed to upload file: ${file.name}`);
        } else if (
          fileUpload.data?.path &&
          sourceDocument &&
          sourceDocumentId
        ) {
          toast.success(t`Uploaded: ${file.name}`);
          const formData = new FormData();
          formData.append("path", fileUpload.data.path);
          formData.append("name", file.name);
          formData.append("size", Math.round(file.size / 1024).toString());
          formData.append("sourceDocument", sourceDocument);
          formData.append("sourceDocumentId", sourceDocumentId);

          submit(formData, {
            method: "post",
            action: path.to.newDocument,
            navigate: false,
            fetcherKey: `${sourceDocument}:${file.name}`
          });
        }
      }
      revalidator.revalidate();
    },
    [
      getWritePath,
      carbon,
      revalidator,
      submit,
      sourceDocument,
      sourceDocumentId,
      t
    ]
  );

  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      upload(acceptedFiles);
    },
    [upload]
  );

  return (
    <Card className="flex-grow">
      <HStack className="justify-between items-start">
        <CardHeader>
          <CardTitle>
            <Trans>Files</Trans>
          </CardTitle>
        </CardHeader>
        <CardAction>
          <File
            isDisabled={!canUpdate}
            leftIcon={<LuUpload />}
            onChange={async (e: ChangeEvent<HTMLInputElement>) => {
              if (e.target.files && carbon && company) {
                upload(Array.from(e.target.files));
              }
            }}
            multiple
          >
            <Trans>New</Trans>
          </File>
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
              <Th></Th>
            </Tr>
          </Thead>
          <Tbody>
            {modelUpload?.modelName && (
              <Tr>
                <Td>
                  <HStack>
                    <LuAxis3D className="text-emerald-500 w-6 h-6" />
                    <Hyperlink
                      target="_blank"
                      to={
                        modelUpload.modelId
                          ? path.to.file.cadModel(modelUpload.modelId)
                          : ""
                      }
                    >
                      {modelUpload.modelName}
                    </Hyperlink>
                  </HStack>
                </Td>
                <Td className="text-xs font-mono">
                  {modelUpload.modelSize
                    ? convertKbToString(
                        Math.floor((modelUpload.modelSize ?? 0) / 1024)
                      )
                    : "--"}
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
                        <DropdownMenuItem
                          onClick={() => downloadModel(modelUpload)}
                        >
                          <Trans>Download</Trans>
                        </DropdownMenuItem>
                        <DropdownMenuItem asChild>
                          <Link
                            to={
                              modelUpload.modelId
                                ? path.to.file.cadModel(modelUpload.modelId)
                                : ""
                            }
                          >
                            <Trans>View</Trans>
                          </Link>
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          disabled={!canDelete}
                          destructive
                          onClick={() => deleteModel()}
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
              const isPreviewable = ["PDF", "Image"].includes(type);
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
                                `${"private"}/${getReadPath(file)}`
                              ),
                              "_blank"
                            );
                          } else {
                            download(file);
                          }
                        }}
                      >
                        {isPreviewable ? (
                          <DocumentPreview
                            bucket="private"
                            pathToFile={getReadPath(file)}
                            // @ts-ignore
                            type={getDocumentType(file.name)}
                          >
                            {file.name}
                          </DocumentPreview>
                        ) : (
                          file.name
                        )}
                      </span>
                    </HStack>
                  </Td>
                  <Td className="text-xs font-mono">
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
                            disabled={!canDelete}
                            onClick={() => deleteFile(file)}
                            destructive
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
                  colSpan={24}
                  className="py-8 text-muted-foreground text-center"
                >
                  <Trans>No files</Trans>
                </Td>
              </Tr>
            )}
          </Tbody>
        </Table>
        <FileDropzone onDrop={onDrop} />
      </CardContent>
    </Card>
  );
};

export default Documents;

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
