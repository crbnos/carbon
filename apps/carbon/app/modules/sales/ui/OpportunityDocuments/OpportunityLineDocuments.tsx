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
import type { FileObject } from "@supabase/storage-js";
import { LuAxis3D, LuUpload } from "react-icons/lu";
import { MdMoreVert } from "react-icons/md";
import { DocumentPreview, Hyperlink } from "~/components";
import { DocumentIcon, getDocumentType } from "~/modules/documents";
import type { ItemFile, ModelUpload } from "~/modules/items";

import { useNavigate, useRevalidator, useSubmit } from "@remix-run/react";
import type { ChangeEvent } from "react";
import { usePermissions, useUser } from "~/hooks";
import { useSupabase } from "~/lib/supabase";
import { path } from "~/utils/path";

import { useCallback } from "react";

const useOpportunityLineDocuments = ({ lineId }: { lineId: string }) => {
  const navigate = useNavigate();
  const permissions = usePermissions();
  const revalidator = useRevalidator();
  const { supabase } = useSupabase();
  const { company } = useUser();

  const canDelete = permissions.can("delete", "sales");
  const canUpdate = permissions.can("update", "sales");
  const getPath = useCallback(
    (file: ItemFile) => {
      return `${company.id}/opportunity-line/${lineId}/${file.name}`;
    },
    [company.id, lineId]
  );

  const deleteFile = useCallback(
    async (file: ItemFile) => {
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

  const deleteModel = useCallback(
    async (lineId: string) => {
      if (!lineId || !supabase) return;

      const { error } = await supabase
        .from("quoteLine")
        .update({ modelUploadId: null })
        .eq("id", lineId);
      if (error) {
        toast.error("Error removing model from line");
        return;
      }
      toast.success("Model removed from line");
      revalidator.revalidate();
    },
    [supabase, revalidator]
  );

  const download = useCallback(
    async (file: ItemFile) => {
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

  return {
    canDelete,
    canUpdate,
    deleteFile,
    deleteModel,
    download,
    getPath,
    viewModel,
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
  const { canDelete, download, deleteFile, deleteModel, getPath, viewModel } =
    useOpportunityLineDocuments({
      lineId,
    });

  return (
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
                        <DropdownMenuItem
                          onClick={() => viewModel(modelUpload)}
                        >
                          View
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
      </CardContent>
    </Card>
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
  const submit = useSubmit();
  const { company } = useUser();
  const { supabase } = useSupabase();
  const permissions = usePermissions();

  const uploadFile = async (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && supabase && company) {
      const file = e.target.files[0];
      const fileName = `${company.id}/opportunity-line/${lineId}/${file.name}`;

      const fileUpload = await supabase.storage
        .from("private")
        .upload(fileName, file, {
          cacheControl: `${12 * 60 * 60}`,
        });

      if (fileUpload.error) {
        toast.error("Failed to upload file");
      }

      if (fileUpload.data?.path) {
        toast.success("File uploaded");
        submitFileData({
          path: fileUpload.data.path,
          name: file.name,
          size: file.size,
        });
      }
    }
  };

  const submitFileData = ({
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
    });
  };

  return (
    <File
      isDisabled={!permissions.can("update", "sales")}
      leftIcon={<LuUpload />}
      onChange={uploadFile}
    >
      New
    </File>
  );
};
