import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { forwardRef } from "react";

import { cn } from "./utils/cn";

const alertVariants = cva(
  "relative w-full rounded-lg border p-4 [&>svg~*]:pl-7 [&>svg+div]:translate-y-[-3px] [&>svg]:absolute [&>svg]:left-4 [&>svg]:top-4 [&>svg]:text-foreground",
  {
    variants: {
      variant: {
        default: "bg-background text-foreground",
        success:
          "bg-gradient-to-r dark:from-emerald-600/30 dark:via-card dark:to-card from-emerald-100 to-emerald-100 border-emerald-600 text-emerald-600 [&>svg]:text-emerald-600 dark:text-foreground dark:[&>svg]:text-foreground",
        warning:
          "bg-gradient-to-r dark:from-yellow-700/30 dark:via-card dark:to-card from-yellow-100/10 to-yellow-100/10 border-yellow-700 text-yellow-800 [&>svg]:text-yellow-800 dark:text-foreground  dark:[&>svg]:text-foreground",
        destructive:
          "bg-gradient-to-r dark:from-destructive/30 dark:via-card dark:to-card from-destructive/10 to-destructive/10 border-destructive text-destructive [&>svg]:text-destructive dark:text-foreground  dark:[&>svg]:text-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

const Alert = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants>
>(({ className, variant, ...props }, ref) => (
  <div
    ref={ref}
    role="alert"
    className={cn(alertVariants({ variant }), className)}
    {...props}
  />
));
Alert.displayName = "Alert";

const AlertTitle = forwardRef<
  HTMLParagraphElement,
  HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h5
    ref={ref}
    className={cn("mb-1 font-medium leading-none tracking-tight", className)}
    {...props}
  />
));
AlertTitle.displayName = "AlertTitle";

const AlertDescription = forwardRef<
  HTMLParagraphElement,
  HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("text-sm [&_p]:leading-relaxed", className)}
    {...props}
  />
));
AlertDescription.displayName = "AlertDescription";

export { Alert, AlertDescription, AlertTitle };
