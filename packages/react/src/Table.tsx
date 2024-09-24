import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from "react";
import { forwardRef } from "react";

import { cn } from "./utils/cn";

const Table = forwardRef<
  HTMLTableElement,
  HTMLAttributes<HTMLTableElement> & { full?: boolean }
>(({ className, full = false, ...props }, ref) =>
  full ? (
    <div className="w-full">
      <table
        ref={ref}
        className={cn(
          "w-full border-b border-border caption-bottom text-sm",
          className
        )}
        {...props}
      />
    </div>
  ) : (
    <div className="rounded-md border overflow-hidden">
      <div className="relative w-full overflow-auto">
        <table
          ref={ref}
          className={cn("w-full caption-bottom text-sm", className)}
          {...props}
        />
      </div>
    </div>
  )
);
Table.displayName = "Table";

const Thead = forwardRef<
  HTMLTableSectionElement,
  HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <thead
    ref={ref}
    className={cn("bg-card [&_tr]:border-b border-border", className)}
    {...props}
  />
));
Thead.displayName = "Thead";

const Tbody = forwardRef<
  HTMLTableSectionElement,
  HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tbody ref={ref} className={cn("", className)} {...props} />
));
Tbody.displayName = "Tbody";

const Tfoot = forwardRef<
  HTMLTableSectionElement,
  HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tfoot
    ref={ref}
    className={cn("font-medium text-foreground", className)}
    {...props}
  />
));
Tfoot.displayName = "Tfoot";

const Tr = forwardRef<HTMLTableRowElement, HTMLAttributes<HTMLTableRowElement>>(
  ({ className, ...props }, ref) => (
    <tr
      ref={ref}
      className={cn(
        "group transition-colors data-[state=selected]:bg-muted",
        className
      )}
      {...props}
    />
  )
);
Tr.displayName = "Tr";

const Th = forwardRef<
  HTMLTableCellElement,
  ThHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <th
    ref={ref}
    className={cn(
      "group-hover:bg-primary/5 h-11 px-6 text-left align-middle uppercase bg-card font-semibold tracking-tight text-xs text-foreground [&:has([role=checkbox])]:pr-0",
      className
    )}
    {...props}
  />
));
Th.displayName = "Th";

const Td = forwardRef<
  HTMLTableCellElement,
  TdHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <td
    ref={ref}
    className={cn(
      "group-hover:bg-primary/5 text-foreground/80 px-6 bg-card align-middle [&:has([role=checkbox])]:pr-0 h-11",
      className
    )}
    {...props}
  />
));
Td.displayName = "Td";

const TableCaption = forwardRef<
  HTMLTableCaptionElement,
  HTMLAttributes<HTMLTableCaptionElement>
>(({ className, ...props }, ref) => (
  <caption
    ref={ref}
    className={cn("mt-4 text-sm text-muted-foreground", className)}
    {...props}
  />
));
TableCaption.displayName = "TableCaption";

export { Table, TableCaption, Tbody, Td, Tfoot, Th, Thead, Tr };
