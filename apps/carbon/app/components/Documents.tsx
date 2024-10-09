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
  toast,
} from "@carbon/react";
import { convertKbToString } from "@carbon/utils";
import { useNavigate, useRevalidator, useSubmit } from "@remix-run/react";
import type { ChangeEvent } from "react";
import { useCallback } from "react";
import { LuAxis3D, LuUpload } from "react-icons/lu";
import { MdMoreVert } from "react-icons/md";
import { DocumentPreview, FileDropzone, Hyperlink } from "~/components";
import { usePermissions, useUser } from "~/hooks";
import { DocumentIcon, getDocumentType } from "~/modules/documents";
import type { ModelUpload, StorageItem } from "~/types";
import { path } from "~/utils/path";
import { stripSpecialCharacters } from "~/utils/string";

type DocumentsProps = {
  files: StorageItem[];
  modelUpload?: ModelUpload;
  sourceDocument: "Job";
  sourceDocumentId: string;
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
  writeBucketPermission,
}: DocumentsProps) => {
  const permissions = usePermissions();
  const revalidator = useRevalidator();
  const { carbon } = useCarbon();
  const { company } = useUser();
  const submit = useSubmit();
  const navigate = useNavigate();

  const canDelete = permissions.can("delete", writeBucketPermission);
  const canUpdate = permissions.can("update", writeBucketPermission);

  const getReadPath = useCallback(
    (file: StorageItem) => {
      const id = sourceDocumentLineId || sourceDocumentId;
      return `${company.id}/${file.bucket}/${id}/${file.name}`;
    },
    [company.id, sourceDocumentId, sourceDocumentLineId]
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
        toast.error(fileDelete?.error?.message || "Error deleting file");
        return;
      }

      toast.success(`${file.name} deleted successfully`);
      revalidator.revalidate();
    },
    [getReadPath, carbon?.storage, revalidator]
  );

  const deleteModel = useCallback(async () => {
    if (!carbon) return;

    if (sourceDocument === "Job") {
      const result = await carbon
        .from("job")
        .update({ modelUploadId: null })
        .eq("id", sourceDocumentId);

      if (result.error) {
        toast.error(`Error removing model from ${sourceDocument}`);
        return;
      }
    } else if (sourceDocument === "Purchase Order") {
      // TODO
    } else {
      toast.error(`Unsupported source document type: ${sourceDocument}`);
      return;
    }

    toast.success(`Model removed from ${sourceDocument}`);
    revalidator.revalidate();
  }, [carbon, sourceDocument, sourceDocumentId, revalidator]);

  const download = useCallback(
    async (file: StorageItem) => {
      const result = await carbon?.storage
        .from("private")
        .download(getReadPath(file));

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
    [carbon?.storage, getReadPath]
  );

  const viewModel = useCallback(
    (model: ModelUpload) => {
      if (!model?.autodeskUrn) {
        toast.error("Autodesk URN not found");
        return;
      }
      navigate(path.to.file.cadModel(model?.autodeskUrn));
    },
    [navigate]
  );

  const upload = useCallback(
    async (files: File[]) => {
      if (!carbon) {
        toast.error("Carbon client not available");
        return;
      }

      for (const file of files) {
        const fileName = getWritePath({ name: file.name });

        const fileUpload = await carbon.storage
          .from("private")
          .upload(fileName, file, {
            cacheControl: `${12 * 60 * 60}`,
            upsert: true,
          });

        if (fileUpload.error) {
          toast.error(`Failed to upload file: ${file.name}`);
        } else if (fileUpload.data?.path) {
          toast.success(`Uploaded: ${file.name}`);
          const formData = new FormData();
          formData.append("path", fileUpload.data.path);
          formData.append("name", file.name);
          formData.append("size", Math.round(file.size / 1024).toString());
          formData.append("sourceDocument", sourceDocument);
          formData.append("sourceDocumentId", sourceDocumentId);

          submit(formData, {
            method: "post",
            action: path.to.newDocument,
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
          <CardTitle>Files</CardTitle>
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
            New
          </File>
        </CardAction>
      </HStack>
      <CardContent>
        <Table>
          <Thead>
            <Tr>
              <Th>Name</Th>
              <Th>Size</Th>
              <Th></Th>
            </Tr>
          </Thead>
          <Tbody>
            {modelUpload?.autodeskUrn && (
              <Tr>
                <Td>
                  <HStack>
                    <LuAxis3D className="text-green-500 w-6 h-6" />
                    <Hyperlink
                      target="_blank"
                      onClick={() => viewModel(modelUpload)}
                    >
                      {modelUpload?.autodeskUrn
                        ? modelUpload.modelName
                        : "Uploading..."}
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
                        <DropdownMenuItem
                          onClick={() => viewModel(modelUpload)}
                        >
                          View
                        </DropdownMenuItem>
                        <DropdownMenuItem
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
            {files.map((file) => {
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
                            disabled={!canDelete || file.bucket !== writeBucket}
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
            {files.length === 0 && !modelUpload && (
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
  );
};

export default Documents;
