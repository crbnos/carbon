import { cn } from "@carbon/react";
import { cva } from "class-variance-authority";
import { LuBlocks } from "react-icons/lu";
import { getPrivateUrl } from "~/utils/path";
import { MethodItemTypeIcon } from "./Icons";

interface ItemThumbnailProps {
  thumbnailPath?: string | null;
  size?: "sm" | "md" | "lg" | "xl";
  type?: "Part" | "Material" | "Tool" | "Service" | "Consumable" | "Fixture";
  onClick?: () => void;
}

const itemVariants = cva(
  "bg-gradient-to-bl from-muted to-muted/40 rounded-lg",
  {
    variants: {
      size: {
        sm: "w-7 h-7",
        md: "w-9 h-9",
        lg: "w-11 h-11",
        xl: "w-16 h-16"
      },
      withPadding: {
        true: "",
        false: "p-0"
      }
    },
    compoundVariants: [
      {
        withPadding: true,
        size: "sm",
        class: "p-1"
      },
      {
        withPadding: true,
        size: "md",
        class: "p-1.5"
      },
      {
        withPadding: true,
        size: "lg",
        class: "p-2"
      },
      {
        withPadding: true,
        size: "xl",
        class: "p-2.5"
      }
    ],
    defaultVariants: {
      size: "md",
      withPadding: true
    }
  }
);

const iconVariants = cva("text-[#AAAAAA] dark:text-[#444]", {
  variants: {
    size: {
      sm: "w-5 h-5",
      md: "w-6 h-6",
      lg: "w-7 h-7",
      xl: "w-11 h-11"
    }
  },
  defaultVariants: {
    size: "md"
  }
});

const ItemThumbnail = ({
  thumbnailPath,
  type,
  size = "md",
  onClick
}: ItemThumbnailProps) => {
  return thumbnailPath ? (
    <img
      alt="thumbnail"
      className={cn(
        itemVariants({ size, withPadding: false }),
        thumbnailPath && "cursor-pointer"
      )}
      src={getPrivateUrl(thumbnailPath)}
      onClick={onClick}
    />
  ) : (
    <div className={cn(itemVariants({ size }))}>
      {type ? (
        <MethodItemTypeIcon className={iconVariants({ size })} type={type} />
      ) : (
        <LuBlocks className={iconVariants({ size })} />
      )}
    </div>
  );
};

export default ItemThumbnail;
