import {
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

const useSalesRFQLineDocuments = ({
  rfqId,
  salesRfqLineId,
}: {
  rfqId: string;
  salesRfqLineId: string;
}) => {
  const navigate = useNavigate();
  const permissions = usePermissions();
  const revalidator = useRevalidator();
  const { supabase } = useSupabase();
  const { company } = useUser();

  const canDelete = permissions.can("delete", "sales");
  const getPath = useCallback(
    (file: ItemFile) => {
      return `${company.id}/sales-rfq/${rfqId}/${salesRfqLineId}/${file.name}`;
    },
    [company.id, rfqId, salesRfqLineId]
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
    async (model: ModelUpload) => {
      if (!model || !supabase) return;

      // TODO: delete from Autodesk server

      if (model.modelPath) {
        const fileDelete = await supabase?.storage
          .from("private")
          .remove([model?.modelPath]);

        if (!fileDelete || fileDelete.error) {
          toast.error(fileDelete?.error?.message || "Error deleting file");
          return;
        }
      }

      const modelDelete = await supabase
        ?.from("modelUpload")
        .delete()
        .eq("id", model.id);
      if (modelDelete.error) {
        toast.error(modelDelete.error.message);
        return;
      }

      toast.success("File deleted successfully");
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
    deleteFile,
    deleteModel,
    download,
    getPath,
    viewModel,
  };
};

type SalesRFQLineDocumentsProps = {
  files: (FileObject & { salesRfqLineId: string | null })[];
  rfqId: string;
  salesRfqLineId: string;
  modelUpload?: ModelUpload;
};

const SalesRFQLineDocuments = ({
  files,
  rfqId,
  salesRfqLineId,
  modelUpload,
}: SalesRFQLineDocumentsProps) => {
  const { canDelete, download, deleteFile, deleteModel, getPath, viewModel } =
    useSalesRFQLineDocuments({
      rfqId,
      salesRfqLineId,
    });

  return (
    <div className="min-h-[300px]">
      <Table>
        <Thead>
          <Tr>
            <Th>Name</Th>
            <Th>Size</Th>

            <Th className="flex items-center justify-end">
              <SalesRFQLineDocumentForm
                rfqId={rfqId}
                salesRfqLineId={salesRfqLineId}
              />
            </Th>
          </Tr>
        </Thead>
        <Tbody>
          {modelUpload && (
            <Tr>
              <Td>
                <HStack>
                  <LuAxis3D className="text-green-500 w-6 h-6" />
                  <Hyperlink
                    target="_blank"
                    onClick={() => viewModel(modelUpload)}
                  >
                    {modelUpload?.autodeskUrn
                      ? modelUpload.name
                      : "Uploading..."}
                  </Hyperlink>
                </HStack>
              </Td>
              <Td>
                {modelUpload.size
                  ? convertKbToString(
                      Math.floor((modelUpload.size ?? 0) / 1024)
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
                      <DropdownMenuItem onClick={() => viewModel(modelUpload)}>
                        View
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        disabled={!canDelete}
                        onClick={() => deleteModel(modelUpload)}
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
    </div>
  );
};

export default SalesRFQLineDocuments;

type SalesRFQLineDocumentFormProps = {
  rfqId: string;
  salesRfqLineId: string;
};

const SalesRFQLineDocumentForm = ({
  rfqId,
  salesRfqLineId,
}: SalesRFQLineDocumentFormProps) => {
  const submit = useSubmit();
  const { company } = useUser();
  const { supabase } = useSupabase();

  const uploadFile = async (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && supabase && company) {
      const file = e.target.files[0];
      const fileName = `${company.id}/sales-rfq/${rfqId}/${salesRfqLineId}/${file.name}`;

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
    formData.append("sourceDocument", "Request for Quote");
    formData.append("sourceDocumentId", rfqId);

    submit(formData, {
      method: "post",
      action: path.to.newDocument,
    });
  };

  return (
    <File leftIcon={<LuUpload />} onChange={uploadFile}>
      New
    </File>
  );
};
