import type { VariantProps } from "class-variance-authority";
import { cva } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { forwardRef } from "react";

import { cn } from "./utils/cn";

const alertVariants = cva(
  "relative w-full rounded-lg border p-4 transition-colors [&>svg~*]:pl-7 [&>svg+div]:translate-y-[-3px] [&>svg]:absolute [&>svg]:left-4 [&>svg]:top-[19px] [&>svg]:text-foreground dark:inset-ring dark:inset-ring-white/5",
  {
    variants: {
      variant: {
        default: "bg-background text-foreground",
        success:
          "bg-linear-to-tr via-card to-card hover:to-muted/30 hover:via-muted/30 border-emerald-600/40 from-emerald-600/15 text-emerald-700 [&>svg]:text-emerald-600 dark:text-emerald-100 dark:from-emerald-600/15 dark:border-emerald-500/30 dark:[&>svg]:text-emerald-400",
        warning:
          "bg-linear-to-tr via-card to-card hover:to-muted/30 hover:via-muted/30 border-amber-500/40 from-amber-500/20 text-amber-800 [&>svg]:text-amber-600 dark:text-amber-100 dark:from-amber-500/15 dark:border-amber-500/30 dark:[&>svg]:text-amber-400",
        destructive:
          "bg-linear-to-tr via-card to-card hover:to-muted/30 hover:via-muted/30 border-red-500/40 from-red-500/15 text-destructive [&>svg]:text-destructive dark:text-red-100 dark:from-red-500/15 dark:border-red-500/30 dark:[&>svg]:text-red-400"
      }
    },
    defaultVariants: {
      variant: "default"
    }
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
    className={cn("mb-1 font-medium leading-none text-sm", className)}
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
    className={cn("text-xs [&_p]:leading-relaxed", className)}
    {...props}
  />
));
AlertDescription.displayName = "AlertDescription";

export { Alert, AlertDescription, AlertTitle };
