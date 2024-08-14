import { toast } from "@carbon/react";
import { useRevalidator } from "@remix-run/react";
import type { FileObject } from "@supabase/storage-js";
import { useCallback } from "react";
import { usePermissions, useUser } from "~/hooks";
import { useSupabase } from "~/lib/supabase";

type Props = {
  id: string;
};

export const useSalesRFQDocuments = ({ id }: Props) => {
  const permissions = usePermissions();
  const { company } = useUser();
  const { supabase } = useSupabase();
  const revalidator = useRevalidator();

  const canDelete = permissions.can("delete", "sales"); // TODO: or is document owner

  const getPath = useCallback(
    (attachment: FileObject) => {
      return `${company.id}/sales-rfq/${id}/${attachment.name}`;
    },
    [company.id, id]
  );

  const deleteAttachment = useCallback(
    async (attachment: FileObject) => {
      const result = await supabase?.storage
        .from("private")
        .remove([getPath(attachment)]);

      if (!result || result.error) {
        toast.error(result?.error?.message || "Error deleting file");
        return;
      }

      toast.success("File deleted successfully");
      revalidator.revalidate();
    },
    [supabase?.storage, getPath, revalidator]
  );

  const download = useCallback(
    async (attachment: FileObject) => {
      const result = await supabase?.storage
        .from("private")
        .download(getPath(attachment));

      if (!result || result.error) {
        toast.error(result?.error?.message || "Error downloading file");
        return;
      }

      const a = document.createElement("a");
      document.body.appendChild(a);
      const url = window.URL.createObjectURL(result.data);
      a.href = url;
      a.download = attachment.name;
      a.click();

      setTimeout(() => {
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      }, 0);
    },
    [supabase?.storage, getPath]
  );

  return {
    canDelete,
    deleteAttachment,
    download,
    getPath,
  };
};
