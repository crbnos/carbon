import type { HTMLAttributes } from "react";
import { createContext, forwardRef, useContext, useState } from "react";
import { LuChevronDown, LuChevronUp } from "react-icons/lu";
import { cn } from "./utils/cn";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  isCollapsible?: boolean;
  defaultCollapsed?: boolean;
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
      children,
      ...props
    },
    ref
  ) => {
    const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);
    const toggle = () => setIsCollapsed(!isCollapsed);

    return (
      <CardContext.Provider value={{ isCollapsed, toggle }}>
        <div
          ref={ref}
          className={cn(
            "relative flex flex-col rounded-lg border border-border shadow-md dark:border-0 dark:shadow-[0px_1px_0px_0px_hsla(0,0%,100%,.03)_inset,0px_0px_0px_1px_hsla(0,0%,100%,.03)_inset,0px_0px_0px_1px_rgba(0,0,0,.1),0px_2px_2px_0px_rgba(0,0,0,.1),0px_4px_4px_0px_rgba(0,0,0,.1),0px_8px_8px_0px_rgba(0,0,0,.1)] bg-gradient-to-bl from-card via-card to-background text-card-foreground  w-full",
            className
          )}
          {...props}
        >
          {isCollapsible && (
            <button
              type="button"
              onClick={toggle}
              className="absolute right-3 top-4 p-2 text-muted-foreground hover:text-foreground"
            >
              {isCollapsed ? (
                <LuChevronDown className="w-6 h-6" />
              ) : (
                <LuChevronUp className="w-6 h-6" />
              )}
            </button>
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
      className={cn("flex flex-col space-y-1.5 p-4", className)}
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
      "flex flex-row md:flex-col items-start justify-between gap-1",
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
    className={cn("text-xs text-muted-foreground", className)}
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
    className={cn("font-bold text-foreground", className)}
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
      "text-2xl font-semibold leading-none tracking-tight text-foreground",
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
    className={cn("text-sm text-muted-foreground", className)}
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
        className={cn("flex items-center p-6 pt-0", className)}
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
