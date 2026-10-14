// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { HTMLAttributes } from "react";
import {
  createContext,
  forwardRef,
  useContext,
  useMemo,
  useState
} from "react";
import { LuChevronDown, LuChevronUp } from "react-icons/lu";
import { IconButton } from "./IconButton";
import { compactFooterClassName } from "./Modal";
import { cn } from "./utils/cn";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  isCollapsible?: boolean;
  defaultCollapsed?: boolean;
  isCollapsed?: boolean;
  onCollapsedChange?: (isCollapsed: boolean) => void;
}

const CardContext = createContext<
  { isCollapsed: boolean; toggle: () => void } | undefined
>(undefined);

const Card = forwardRef<HTMLDivElement, CardProps>(
  (
    {
      className,
      isCollapsible = false,
      defaultCollapsed = false,
      isCollapsed: controlledIsCollapsed,
      onCollapsedChange,
      children,
      ...props
    },
    ref
  ) => {
    const [uncontrolledIsCollapsed, setUncontrolledIsCollapsed] =
      useState(defaultCollapsed);

    const isCollapsed = controlledIsCollapsed ?? uncontrolledIsCollapsed;

    // A stable value: an inline object re-rendered every consumer whenever the
    // card's parent rendered.
    const context = useMemo(
      () => ({
        isCollapsed,
        toggle: () => {
          if (onCollapsedChange) {
            onCollapsedChange(!isCollapsed);
          } else {
            setUncontrolledIsCollapsed(!isCollapsed);
          }
        }
      }),
      [isCollapsed, onCollapsedChange]
    );

    return (
      <CardContext.Provider value={context}>
        <div
          ref={ref}
          className={cn(
            "relative flex flex-col rounded-xl border border-border bg-accent dark:bg-card text-card-foreground p-0 w-full",
            className
          )}
          {...props}
        >
          {isCollapsible && (
            <IconButton
              aria-label={isCollapsed ? "Expand" : "Collapse"}
              variant="ghost"
              onClick={context.toggle}
              className="absolute right-2 top-2"
              icon={
                isCollapsed ? (
                  <LuChevronDown className="size-6" />
                ) : (
                  <LuChevronUp className="size-6" />
                )
              }
            />
          )}
          {children}
        </div>
      </CardContext.Provider>
    );
  }
);
Card.displayName = "Card";

const CardAction = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("flex flex-col py-2 px-4 pr-6", className)}
      {...props}
    />
  )
);
CardAction.displayName = "CardAction";

const CardAttribute = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "flex flex-row md:flex-col items-start justify-start gap-2 max-md:min-h-12 max-md:items-center max-md:justify-between",
      className
    )}
    {...props}
  />
));
CardAttribute.displayName = "CardAttribute";

const CardAttributes = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex flex-col md:flex-row gap-8 max-md:gap-0", className)}
    {...props}
  />
));
CardAttributes.displayName = "CardAttributes";

const CardAttributeLabel = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("font-medium text-xs text-muted-foreground", className)}
    {...props}
  />
));
CardAttributeLabel.displayName = "CardAttributeLabel";

const CardAttributeValue = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("font-medium text-sm text-foreground", className)}
    {...props}
  />
));
CardAttributeValue.displayName = "CardAttributeValue";

const CardHeader = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => {
    const context = useContext(CardContext);
    const handleClick = () => {
      if (context?.isCollapsed) {
        context.toggle();
      }
    };

    return (
      <div
        ref={ref}
        className={cn(
          "flex flex-col gap-1 px-6 py-4 text-muted-foreground max-md:px-4 max-md:py-3",
          context?.isCollapsed && "cursor-pointer",
          className
        )}
        onClick={handleClick}
        {...props}
      />
    );
  }
);
CardHeader.displayName = "CardHeader";

const CardTitle = forwardRef<
  HTMLParagraphElement,
  HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h3
    ref={ref}
    className={cn(
      "text-base font-medium leading-none tracking-tight text-foreground/90 text-pretty line-clamp-2",
      className
    )}
    {...props}
  />
));
CardTitle.displayName = "CardTitle";

const CardDescription = forwardRef<
  HTMLParagraphElement,
  HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p
    ref={ref}
    className={cn("text-xs text-muted-foreground tracking-tight", className)}
    {...props}
  />
));
CardDescription.displayName = "CardDescription";

const CardContent = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => {
    const context = useContext(CardContext);
    if (context?.isCollapsed) {
      return null;
    }
    // Phones square off the panel's top under its header. When the header
    // before it is hidden on phones, the panel is the card's top edge, so it
    // stays rounded.
    return (
      <div
        ref={ref}
        className={cn(
          "flex flex-col flex-1 p-6 m-[-1px] rounded-xl border border-border bg-card dark:bg-muted/40 max-md:p-4 max-md:rounded-t-none max-md:[&:is([class~='max-md:hidden']+*)]:rounded-t-xl",
          className
        )}
        {...props}
      />
    );
  }
);
CardContent.displayName = "CardContent";

type CardFooterProps = HTMLAttributes<HTMLDivElement> & {
  /** Phones: pin the footer's actions to the bottom of the screen. */
  sticky?: boolean;
};

const CardFooter = forwardRef<HTMLDivElement, CardFooterProps>(
  ({ className, sticky = false, ...props }, ref) => {
    const context = useContext(CardContext);
    if (context?.isCollapsed) {
      return null;
    }
    return (
      <div
        ref={ref}
        className={cn(
          "flex items-center py-4 px-6 gap-2 max-md:px-4",
          // Phones: the same full-width 44pt actions as a sheet footer.
          sticky && compactFooterClassName,
          sticky &&
            "max-md:z-10 max-md:border-t max-md:border-border max-md:bg-card max-md:pb-safe-4",
          className
        )}
        {...props}
      />
    );
  }
);
CardFooter.displayName = "CardFooter";

export {
  Card,
  CardAction,
  CardAttribute,
  CardAttributeLabel,
  CardAttributes,
  CardAttributeValue,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle
};
