import { cva } from "class-variance-authority";
import { getPrivateUrl } from "~/utils/path";

interface ItemThumbnailProps {
  thumbnailPath?: string | null;
  size?: "sm" | "md" | "lg" | "xl";
}

const itemVariants = cva(
  "bg-gradient-to-bl from-muted to-muted/40 rounded-lg",
  {
    variants: {
      size: {
        sm: "w-7 h-7",
        md: "w-9 h-9",
        lg: "w-11 h-11",
        xl: "w-16 h-16",
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
      {
        withPadding: true,
        size: "xl",
        class: "p-2.5",
      },
    ],
    defaultVariants: {
      size: "md",
      withPadding: true,
    },
  }
);

const ItemThumbnail = ({ thumbnailPath, size = "md" }: ItemThumbnailProps) => {
  return thumbnailPath ? (
    <img
      alt="thumbnail"
      className={itemVariants({ size, withPadding: false })}
      src={getPrivateUrl(thumbnailPath)}
    />
  ) : null;
};

export default ItemThumbnail;
