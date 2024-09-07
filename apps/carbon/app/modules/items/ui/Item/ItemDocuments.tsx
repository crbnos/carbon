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
  toast,
  Tr,
} from "@carbon/react";
import { convertKbToString } from "@carbon/utils";
import { LuAxis3D, LuUpload } from "react-icons/lu";
import { MdMoreVert } from "react-icons/md";
import { DocumentPreview, FileDropzone, Hyperlink } from "~/components";
import { DocumentIcon, getDocumentType } from "~/modules/documents";
import type { ItemFile, ModelUpload } from "~/modules/items";
import type { MethodItemType } from "~/modules/shared";

import { useNavigate, useRevalidator, useSubmit } from "@remix-run/react";
import type { FileObject } from "@supabase/storage-js";
import type { ChangeEvent } from "react";
import { useCallback } from "react";
import { usePermissions, useUser } from "~/hooks";
import { useSupabase } from "~/lib/supabase";
import { path } from "~/utils/path";

type ItemDocumentsProps = {
  files: ItemFile[];
  itemId: string;
  modelUpload?: ModelUpload;
  type: MethodItemType;
};

const ItemDocuments = ({
  files,
  itemId,
  modelUpload,
  type,
}: ItemDocumentsProps) => {
  const {
    canDelete,
    download,
    deleteFile,
    deleteModel,
    getPath,
    viewModel,
    upload,
  } = useItemDocuments({
    itemId,
    type,
  });

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
          <ItemDocumentForm type={type} itemId={itemId} />
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
                      <Hyperlink onClick={() => download(file)}>
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
                      </Hyperlink>
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

export default ItemDocuments;

type ItemDocumentFormProps = {
  itemId: string;
  type: MethodItemType;
};

const ItemDocumentForm = ({ itemId, type }: ItemDocumentFormProps) => {
  const permissions = usePermissions();
  const { upload } = useItemDocuments({ itemId, type });

  const uploadFiles = async (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      upload(Array.from(e.target.files));
    }
  };

  return (
    <File
      isDisabled={!permissions.can("update", "parts")}
      leftIcon={<LuUpload />}
      onChange={uploadFiles}
      multiple
    >
      New
    </File>
  );
};

type Props = {
  itemId: string;
  type: MethodItemType;
};

export const useItemDocuments = ({ itemId, type }: Props) => {
  const navigate = useNavigate();
  const permissions = usePermissions();
  const revalidator = useRevalidator();
  const { supabase } = useSupabase();
  const { company } = useUser();
  const submit = useSubmit();

  const canDelete = permissions.can("delete", "parts");
  const getPath = useCallback(
    (file: { name: string }) => {
      return `${company.id}/parts/${itemId}/${file.name}`;
    },
    [company.id, itemId]
  );

  const deleteFile = useCallback(
    async (file: FileObject) => {
      const fileDelete = await supabase?.storage
        .from("private")
        .remove([getPath(file)]);

      if (!fileDelete || fileDelete.error) {
        toast.error(fileDelete?.error?.message || "Error deleting file");
        return;
      }

      toast.success("File deleted successfully");
      revalidator.revalidate();
    },
    [getPath, supabase?.storage, revalidator]
  );

  const deleteModel = useCallback(async () => {
    if (!supabase) return;

    const { error } = await supabase
      .from("item")
      .update({ modelUploadId: null })
      .eq("id", itemId);
    if (error) {
      toast.error("Error removing model from item");
      return;
    }
    toast.success("Model removed from item");
    revalidator.revalidate();
  }, [supabase, itemId, revalidator]);

  const download = useCallback(
    async (file: FileObject) => {
      const result = await supabase?.storage
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
    [supabase?.storage, getPath]
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
      if (!supabase) {
        toast.error("Supabase client not available");
        return;
      }

      for (const file of files) {
        const fileName = getPath(file);

        const fileUpload = await supabase.storage
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
          formData.append("sourceDocument", type);
          formData.append("sourceDocumentId", itemId);

          submit(formData, {
            method: "post",
            action: path.to.newDocument,
          });
        }
      }
      revalidator.revalidate();
    },
    [getPath, supabase, revalidator, submit, type, itemId]
  );

  return {
    canDelete,
    deleteFile,
    deleteModel,
    download,
    getPath,
    viewModel,
    upload,
  };
};
