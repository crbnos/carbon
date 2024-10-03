import { Spinner } from "@carbon/react";
import { LuSquareStack } from "react-icons/lu";
import type { MethodItemType } from "~/modules/shared";
import { MethodItemTypeIcon } from "./Icons";

interface ItemThumbnailProps {
  thumbnailPath?: string | null;
  modelId?: string | null;
  type?: MethodItemType;
}

const ItemThumbnail = ({
  thumbnailPath,
  modelId,
  type,
}: ItemThumbnailProps) => {
  return thumbnailPath ? (
    <img
      alt="thumbnail"
      className="w-10 h-10 bg-gradient-to-bl from-muted to-muted/40 rounded-lg border-2 border-transparent"
      src={`/file/preview/private/${thumbnailPath}`}
    />
  ) : !!modelId && !thumbnailPath ? (
    <div className="w-10 h-10 bg-gradient-to-bl from-muted to-muted/40 rounded-lg border-2 border-transparent p-2">
      <Spinner className="w-6 h-6 text-muted-foreground" />
    </div>
  ) : (
    <div className="w-10 h-10 bg-gradient-to-bl from-muted to-muted/40 rounded-lg border-2 border-transparent p-2">
      {type ? (
        <MethodItemTypeIcon
          className="w-5 h-5 text-muted-foreground"
          type={type}
        />
      ) : (
        <LuSquareStack className="w-5 h-5 text-muted-foreground" />
      )}
    </div>
  );
};

export default ItemThumbnail;
