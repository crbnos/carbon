import { SUPABASE_URL, useCarbon } from "@carbon/auth";
import { Button, File as FileUpload, HStack, toast } from "@carbon/react";
import { nanoid } from "nanoid";
import type { ChangeEvent } from "react";
import { useCallback, useEffect, useState } from "react";
import { useUser } from "~/hooks";
import { getPrivateUrl } from "~/utils/path";
export function ItemThumbnailUpload({
  path,
  itemId,
  modelId,
}: {
  path?: string | null;
  itemId: string;
  modelId?: string | null;
}) {
  const { company } = useUser();
  const { carbon } = useCarbon();

  const [thumbnailPath, setThumbnailPath] = useState<string | null>(() => {
    if (path) {
      return getPrivateUrl(path);
    }
    return null;
  });

  useEffect(() => {
    setThumbnailPath(path ? getPrivateUrl(path) : null);
  }, [path]);

  const onFileRemove = useCallback(async () => {
    if (!carbon) {
      toast.error("Carbon client not found");
      return;
    }

    setThumbnailPath(null);

    const itemResult = await carbon
      .from("item")
      .update({
        thumbnailPath: null,
      })
      .eq("id", itemId);

    if (itemResult.error) {
      toast.error("Failed to remove thumbnail");
      return;
    }

    if (modelId) {
      const modelResult = await carbon
        .from("modelUpload")
        .update({
          thumbnailPath: null,
        })
        .eq("id", modelId);

      if (modelResult.error) {
        toast.error("Failed to remove model thumbnail");
        return;
      }
    }

    toast.success("Thumbnail removed");
  }, [carbon, itemId, modelId]);

  const onFileChange = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      if (!carbon) {
        toast.error("Carbon client not found");
        return;
      }
      const file = e.target.files?.[0];
      if (file) {
        toast.info(`Uploading ${file.name}`);
        const formData = new FormData();
        formData.append("file", file);
        formData.append("contained", "true");

        try {
          const response = await fetch(
            `${SUPABASE_URL}/functions/v1/image-resizer`,
            {
              method: "POST",
              body: formData,
            }
          );
          const blob = new Blob([await response.arrayBuffer()], {
            type: "image/png",
          });

          const reader = new FileReader();
          reader.onload = (event) => {
            if (event.target?.result) {
              const base64String = event.target.result as string;
              setThumbnailPath(base64String);
            }
          };
          reader.readAsDataURL(blob);

          const fileName = `${nanoid()}.png`;
          const thumbnailFile = new File([blob], fileName, {
            type: "image/png",
          });

          const { data, error } = await carbon.storage
            .from("private")
            .upload(
              `${company.id}/thumbnails/${itemId}/${fileName}`,
              thumbnailFile,
              {
                upsert: true,
              }
            );

          if (error) {
            toast.error("Failed to upload thumbnail");
            return;
          }

          const result = await carbon
            .from("item")
            .update({
              thumbnailPath: data?.path,
            })
            .eq("id", itemId);

          if (result.error) {
            toast.error("Failed to update thumbnail path");
            return;
          }

          if (data) {
            setThumbnailPath(getPrivateUrl(data.path));
            toast.success("Thumbnail uploaded");
          }
        } catch {
          toast.error("Failed to resize image");
        }
      }
    },
    [carbon, company.id, itemId]
  );

  return (
    <div className="relative w-full aspect-square">
      {thumbnailPath ? (
        <img
          alt="thumbnail"
          src={thumbnailPath}
          className="w-full h-full object-cover bg-gradient-to-bl from-muted to-muted/40 rounded-lg border border-border"
        />
      ) : (
        <div className="w-full h-full bg-gradient-to-bl from-muted to-muted/40 rounded-lg border border-border flex items-center justify-center">
          <span className="text-muted-foreground">No image</span>
        </div>
      )}
      <HStack className="absolute bottom-2 right-2">
        {thumbnailPath && (
          <Button variant="secondary" size="sm" onClick={onFileRemove}>
            Remove
          </Button>
        )}
        <FileUpload
          accept="image/*"
          variant="secondary"
          size="sm"
          onChange={onFileChange}
        >
          Upload
        </FileUpload>
      </HStack>
    </div>
  );
}
