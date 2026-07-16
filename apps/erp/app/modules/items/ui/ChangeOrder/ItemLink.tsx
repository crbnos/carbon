import { cn } from "@carbon/react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { getItemDetailPath } from "~/utils/path";

// Renders an item reference (id/name) as a link to the item's detail page.
// Classic link behavior: a plain click navigates in the same tab; a Cmd/Ctrl
// (or middle) click opens a new tab — React Router's Link handles the modifier
// keys natively. `type` picks the right detail route (defaults to Part for
// assemblies/unknown types).
export default function ItemLink({
  itemId,
  type,
  children,
  className
}: {
  itemId: string;
  type: string | null | undefined;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Link
      to={getItemDetailPath(type, itemId)}
      prefetch="intent"
      className={cn("hover:underline", className)}
    >
      {children}
    </Link>
  );
}
