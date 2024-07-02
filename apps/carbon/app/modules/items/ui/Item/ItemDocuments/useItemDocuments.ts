import { toast } from "@carbon/react";
import { useNavigate, useRevalidator } from "@remix-run/react";
import { useCallback } from "react";
import { usePermissions, useUser } from "~/hooks";
import { useSupabase } from "~/lib/supabase";
import type { ItemFile, ModelUpload } from "~/modules/items";
import { path } from "~/utils/path";

type Props = {
  itemId: string;
};

export const useItemDocuments = ({ itemId }: Props) => {
  const navigate = useNavigate();
  const permissions = usePermissions();
  const revalidator = useRevalidator();
  const { supabase } = useSupabase();
  const { company } = useUser();

  const canDelete = permissions.can("delete", "parts");
  const getPath = useCallback(
    (file: ItemFile) => {
      return `${company.id}/parts/${itemId}/${file.name}`;
    },
    [company.id, itemId]
  );

  const deleteFile = useCallback(
    async (file: ItemFile) => {
      console.log(`deleting file ${file.name}: ${getPath(file)}`);
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
