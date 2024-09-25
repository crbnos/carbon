import { useCarbon } from "@carbon/auth";
import { toast } from "@carbon/react";
import { useNavigate } from "@remix-run/react";
import { useCallback } from "react";
import { usePermissions, useUrlParams, useUser } from "~/hooks";
import type {
  DocumentTransactionType,
  Document as DocumentType,
} from "~/modules/documents";
import { path } from "~/utils/path";

export const useDocument = () => {
  const navigate = useNavigate();
  const permissions = usePermissions();
  const { carbon } = useCarbon();
  const [params, setParams] = useUrlParams();
  const user = useUser();

  const canDelete = useCallback(
    (doc: DocumentType) => {
      return (
        !permissions.can("delete", "documents") ||
        // @ts-ignore
        !doc.writeGroups?.some((group) => user?.groups.includes(group))
      );
    },
    [permissions, user]
  );

  const canUpdate = useCallback(
    (document: DocumentType) => {
      return (
        !permissions.can("update", "documents") ||
        // @ts-ignore
        !document.writeGroups?.some((group) => user?.groups.includes(group))
      );
    },
    [permissions, user]
  );

  const insertTransaction = useCallback(
    (document: DocumentType, type: DocumentTransactionType) => {
      if (user?.id === undefined) throw new Error("User is undefined");
      if (!document.id) throw new Error("Document id is undefined");

      return carbon?.from("documentTransaction").insert({
        documentId: document.id,
        type,
        userId: user.id,
      });
    },
    [carbon, user?.id]
  );

  const deleteLabel = useCallback(
    async (document: DocumentType, label: string) => {
      if (!document.id) throw new Error("Document id is undefined");
      if (user?.id === undefined) throw new Error("User is undefined");

      return carbon
        ?.from("documentLabel")
        .delete()
        .eq("documentId", document.id)
        .eq("userId", user.id)
        .eq("label", label);
    },
    [carbon, user?.id]
  );

  const download = useCallback(
    async (doc: DocumentType) => {
      if (!doc.path) throw new Error("Document path is undefined");

      const result = await carbon?.storage.from("private").download(doc.path);

      if (!result || result.error) {
        toast.error(result?.error?.message || "Error downloading file");
        return;
      }

      const a = document.createElement("a");
      document.body.appendChild(a);
      const url = window.URL.createObjectURL(result.data);
      a.href = url;
      a.download = doc.name ?? "File";
      a.click();

      setTimeout(() => {
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      }, 0);

      await insertTransaction(doc, "Download");
    },
    [carbon, insertTransaction]
  );

  const view = useCallback(
    (document: DocumentType) => {
      navigate(`${path.to.documentView(document.id!)}/?${params}`);
    },
    [navigate, params]
  );

  const edit = useCallback(
    (document: DocumentType) =>
      navigate(`${path.to.document(document.id!)}?${params}`),
    [navigate, params]
  );

  const favorite = useCallback(
    async (document: DocumentType) => {
      if (document.favorite) {
        await carbon
          ?.from("documentFavorite")
          .delete()
          .eq("documentId", document.id!)
          .eq("userId", user?.id);
        return insertTransaction(document, "Unfavorite");
      } else {
        await carbon
          ?.from("documentFavorite")
          .insert({ documentId: document.id!, userId: user?.id });
        return insertTransaction(document, "Favorite");
      }
    },
    [insertTransaction, carbon, user?.id]
  );

  const isImage = useCallback((fileType: string) => {
    return ["png", "jpg", "jpeg", "gif", "svg", "avif", "webp"].includes(
      fileType
    );
  }, []);

  const isPdf = useCallback((fileType: string) => {
    return fileType === "pdf";
  }, []);

  const label = useCallback(
    async (document: DocumentType, labels: string[]) => {
      if (user?.id === undefined) throw new Error("User is undefined");
      await carbon
        ?.from("documentLabel")
        .delete()
        .eq("documentId", document.id!)
        .eq("userId", user.id)
        .then(() => {
          return carbon?.from("documentLabel").insert(
            labels.map((label) => ({
              documentId: document.id!,
              label,
              userId: user.id,
            }))
          );
        });

      return insertTransaction(document, "Label");
    },
    [insertTransaction, carbon, user.id]
  );

  const makePreview = useCallback(
    async (doc: DocumentType) => {
      if (!doc.path) throw new Error("Document path is undefined");
      const result = await carbon?.storage.from("private").download(doc.path);

      if (!result || result.error) {
        toast.error(result?.error?.message || "Error previewing file");
        return null;
      }

      return window.URL.createObjectURL(result.data);
    },
    [carbon]
  );

  const removeLabel = useCallback(
    (document: DocumentType, label: string) => {
      return carbon
        ?.from("documentLabel")
        .delete()
        .eq("documentId", document.id!)
        .eq("userId", user?.id)
        .eq("label", label);
    },
    [carbon, user?.id]
  );

  const setLabel = useCallback(
    (label: string) => {
      setParams({ label });
    },
    [setParams]
  );

  return {
    canDelete,
    canUpdate,
    download,
    deleteLabel,
    edit,
    favorite,
    isImage,
    isPdf,
    label,
    view,
    makePreview,
    removeLabel,
    setLabel,
  };
};
