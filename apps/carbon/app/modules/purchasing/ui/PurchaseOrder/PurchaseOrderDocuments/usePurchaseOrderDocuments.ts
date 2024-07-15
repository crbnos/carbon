import { toast } from "@carbon/react";
import { useFetcher } from "@remix-run/react";
import { useCallback } from "react";
import { usePermissions, useUser } from "~/hooks";
import { useSupabase } from "~/lib/supabase";
import type { PurchaseOrderAttachment } from "~/modules/purchasing/types";

type Props = {
  isExternal: boolean;
  orderId: string;
};

export const usePurchaseOrderDocuments = ({ isExternal, orderId }: Props) => {
  const fetcher = useFetcher<{}>();
  const permissions = usePermissions();
  const { supabase } = useSupabase();
  const { company } = useUser();

  const canDelete = permissions.can("delete", "purchasing"); // TODO: or is document owner

  const refresh = useCallback(
    () => fetcher.submit(null, { method: "post" }),
    [fetcher]
  );

  const getPath = useCallback(
    (attachment: PurchaseOrderAttachment) => {
      return `${company.id}/purchasing/${
        isExternal ? "external" : "internal"
      }/${orderId}/${attachment.name}`;
    },
    [company.id, isExternal, orderId]
  );

  const deleteAttachment = useCallback(
    async (attachment: PurchaseOrderAttachment) => {
      const fileDelete = await supabase?.storage
        .from("private")
        .remove([getPath(attachment)]);

      if (!fileDelete || fileDelete.error) {
        toast.error(fileDelete?.error?.message || "Error deleting file");
        return;
      }

      toast.success("File deleted successfully");
      refresh();
    },
    [supabase, getPath, refresh]
  );

  const download = useCallback(
    async (attachment: PurchaseOrderAttachment) => {
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
