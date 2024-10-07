import type { VariantProps } from "class-variance-authority";
import { cva } from "class-variance-authority";
import type { ComponentProps, ElementType } from "react";
import { forwardRef } from "react";

import { cn } from "./utils/cn";

const headingVariants = cva(
  "font-semibold leading-none tracking-tight text-foreground",
  {
    variants: {
      size: {
        display: "md:text-[44px] text-[36px]",
        h1: "md:text-3xl text-2xl",
        h2: "md:text-2xl text-xl",
        h3: "md:text-xl text-base",
        h4: "md:text-base text-sm",
      },
      noOfLines: {
        1: "line-clamp-1",
        2: "line-clamp-2",
        3: "line-clamp-3",
        4: "line-clamp-4",
        5: "line-clamp-5",
        6: "line-clamp-6",
        7: "line-clamp-7",
        8: "line-clamp-8",
        9: "line-clamp-9",
        10: "line-clamp-10",
      },
    },
    defaultVariants: {
      size: "h2",
    },
  }
);

export interface HeadingProps
  extends ComponentProps<"h2">,
    VariantProps<typeof headingVariants> {
  as?: ElementType;
}

const Heading = forwardRef<HTMLHeadingElement, HeadingProps>(
  ({ as = "h2", className, noOfLines, size, children, ...props }, ref) => {
    const Component = as;
    return (
      <Component
        className={cn(
          headingVariants({
            size,
            noOfLines,
            className,
          })
        )}
        ref={ref}
        {...props}
      >
        {children}
      </Component>
    );
  }
);
Heading.displayName = "Heading";

export { Heading };
