import { cn } from "@carbon/react";
import { cva } from "class-variance-authority";
import { LuSquareStack } from "react-icons/lu";
import type { MethodItemType } from "~/modules/shared";
import { getPrivateUrl } from "~/utils/path";
import { MethodItemTypeIcon } from "./Icons";

interface ItemThumbnailProps {
  thumbnailPath?: string | null;
  type?: MethodItemType;
  size?: "sm" | "md" | "lg";
}

const itemVariants = cva("bg-muted rounded-lg border-2 border-transparent", {
  variants: {
    size: {
      sm: "w-7 h-7",
      md: "w-9 h-9",
      lg: "w-11 h-11 bg-gradient-to-bl from-muted to-muted/40 ",
    },
    withPadding: {
      true: "",
      false: "p-0",
    },
  },
  compoundVariants: [
    {
      withPadding: true,
      size: "sm",
      class: "p-1",
    },
    {
      withPadding: true,
      size: "md",
      class: "p-1.5",
    },
    {
      withPadding: true,
      size: "lg",
      class: "p-2",
    },
  ],
  defaultVariants: {
    size: "md",
    withPadding: true,
  },
});

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
  type,
  size = "md",
}: ItemThumbnailProps) => {
  return thumbnailPath ? (
    <img
      alt="thumbnail"
      className={itemVariants({ size, withPadding: false })}
      src={getPrivateUrl(thumbnailPath)}
    />
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
