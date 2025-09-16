import type { HTMLAttributes } from "react";
import { createContext, forwardRef, useContext, useState } from "react";
import { LuChevronDown, LuChevronUp } from "react-icons/lu";
import { IconButton } from "./IconButton";
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

    const toggle = () => {
      if (onCollapsedChange) {
        onCollapsedChange(!isCollapsed);
      } else {
        setUncontrolledIsCollapsed(!isCollapsed);
      }
    };

    return (
      <CardContext.Provider value={{ isCollapsed, toggle }}>
        <div
          ref={ref}
          className={cn(
            "relative flex flex-col rounded-lg border border-border dark:border-none dark:shadow-[inset_0_0.5px_0_rgb(255_255_255_/_0.08),_inset_0_0_1px_rgb(255_255_255_/_0.24),_0_0_0_0.5px_rgb(0,0,0,1),0px_0px_4px_rgba(0,_0,_0,_0.08)] bg-card dark:bg-gradient-to-bl dark:from-card dark:from-50% dark:via-card dark:to-background text-card-foreground p-4  w-full",
            className
          )}
          {...props}
        >
          {isCollapsible && (
            <IconButton
              aria-label={isCollapsed ? "Expand" : "Collapse"}
              variant="ghost"
              onClick={toggle}
              className="absolute right-8 top-8"
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
      className={cn("flex flex-col py-4 px-6", className)}
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
      "flex flex-row md:flex-col items-start justify-start gap-2",
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
    className={cn("flex flex-col md:flex-row gap-8", className)}
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
          "flex flex-col space-y-1.5 p-6",
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
      "text-xl font-semibold leading-none tracking-tight text-foreground line-clamp-2",
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
    className={cn("text-sm text-muted-foreground tracking-tight", className)}
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
    return (
      <div
        ref={ref}
        className={cn("flex flex-col flex-1 p-6 pt-0", className)}
        {...props}
      />
    );
  }
);
CardContent.displayName = "CardContent";

const CardFooter = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => {
    const context = useContext(CardContext);
    if (context?.isCollapsed) {
      return null;
    }
    return (
      <div
        ref={ref}
        className={cn("flex items-center p-6 pt-0 gap-2", className)}
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
  CardTitle,
};
