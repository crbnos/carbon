import { Spinner } from "@carbon/react";
import { LuImage } from "react-icons/lu";

interface ItemThumbnailProps {
  thumbnailPath?: string | null;
  modelId?: string | null;
}

const ItemThumbnail = ({ thumbnailPath, modelId }: ItemThumbnailProps) => {
  return thumbnailPath ? (
    <img
      alt="P2392303"
      className="w-10 h-10 bg-gradient-to-bl from-muted to-muted/40 rounded-lg border-2 border-transparent"
      src={`/file/preview/private/${thumbnailPath}`}
    />
  ) : !!modelId && !thumbnailPath ? (
    <div className="w-10 h-10 bg-gradient-to-bl from-muted to-muted/40 rounded-lg border-2 border-transparent p-2">
      <Spinner className="w-6 h-6 text-muted-foreground" />
    </div>
  ) : (
    <div className="w-10 h-10 bg-gradient-to-bl from-muted to-muted/40 rounded-lg border-2 border-transparent p-2">
      <LuImage className="w-6 h-6 text-muted-foreground" />
    </div>
  );
};

export default ItemThumbnail;
