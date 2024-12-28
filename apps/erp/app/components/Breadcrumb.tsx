import { Button, cn, getValidChildren } from "@carbon/react";
import type { LinkProps } from "@remix-run/react";
import { Link } from "@remix-run/react";
import type { ComponentProps } from "react";
import { cloneElement, forwardRef } from "react";

const Breadcrumbs = forwardRef<
  HTMLElement,
  ComponentProps<"nav"> & {
    useReactRouter?: boolean;
  }
>(({ className, children, useReactRouter = true, ...props }, ref) => {
  const validChildren = getValidChildren(children);
  const count = validChildren.length;
  const clones = validChildren.map((child, index) =>
    cloneElement(child, {
      isFirstChild: index === 0,
      isLastChild: index === count - 1,
    })
  );
  return (
    <nav
      aria-label="Breadcrumb"
      ref={ref}
      className={cn("reset flex", className)}
      {...props}
    >
      <ol className="inline-flex items-center space-x-1">{clones}</ol>
    </nav>
  );
});
Breadcrumbs.displayName = "Breadcrumbs";

const BreadcrumbItem = forwardRef<
  HTMLLIElement,
  ComponentProps<"li"> & {
    isFirstChild?: boolean;
    isLastChild?: boolean;
  }
>(({ className, children, isFirstChild, isLastChild, ...props }, ref) => (
  <li
    ref={ref}
    className={cn("inline-flex items-center", className)}
    {...props}
  >
    {!isFirstChild && <span className="text-muted-foreground">/</span>}
    {children}
  </li>
));
BreadcrumbItem.displayName = "BreadcrumbItem";

const BreadcrumbLink = forwardRef<
  HTMLAnchorElement,
  LinkProps & {
    isCurrentPage?: boolean;
  }
>(({ className, children, isCurrentPage, ...props }, ref) => {
  return (
    <Button
      variant="ghost"
      className={cn(
        "px-2 outline-none focus-visible:ring-transparent",
        className
      )}
      asChild
    >
      {isCurrentPage ? (
        <span aria-current="page" ref={ref} {...props}>
          {children}
        </span>
      ) : (
        <Link ref={ref} {...props} prefetch="intent">
          {children}
        </Link>
      )}
    </Button>
  );
});
BreadcrumbLink.displayName = "BreadcrumbLink";

export { BreadcrumbItem, BreadcrumbLink, Breadcrumbs };
