import { Spinner, cn } from "@carbon/react";
import { cva } from "class-variance-authority";
import { LuSquareStack } from "react-icons/lu";
import type { MethodItemType } from "~/modules/shared";
import { MethodItemTypeIcon } from "./Icons";

interface ItemThumbnailProps {
  thumbnailPath?: string | null;
  modelId?: string | null;
  type?: MethodItemType;
  size?: "sm" | "md" | "lg";
}

const itemVariants = cva(
  "bg-gradient-to-bl from-muted to-muted/40 rounded-lg border-2 border-transparent",
  {
    variants: {
      size: {
        sm: "w-7 h-7 p-1",
        md: "w-9 h-9 p-1.5",
        lg: "w-11 h-11 p-2",
      },
    },
    defaultVariants: {
      size: "md",
    },
  }
);

const iconVariants = cva("text-muted-foreground", {
  variants: {
    size: {
      sm: "w-4 h-4",
      md: "w-5 h-5",
      lg: "w-6 h-6",
    },
  },
  defaultVariants: {
    size: "md",
  },
});

const ItemThumbnail = ({
  thumbnailPath,
  modelId,
  type,
  size = "md",
}: ItemThumbnailProps) => {
  return thumbnailPath ? (
    <img
      alt="thumbnail"
      className={itemVariants({ size })}
      src={`/file/preview/private/${thumbnailPath}`}
    />
  ) : !!modelId && !thumbnailPath ? (
    <div className={cn(itemVariants({ size }))}>
      <Spinner className={iconVariants({ size })} />
    </div>
  ) : (
    <div className={cn(itemVariants({ size }))}>
      {type ? (
        <MethodItemTypeIcon className={iconVariants({ size })} type={type} />
      ) : (
        <LuSquareStack className={iconVariants({ size })} />
      )}
    </div>
  );
};

export default ItemThumbnail;
