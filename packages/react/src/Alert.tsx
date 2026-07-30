import type { VariantProps } from "class-variance-authority";
import { cva } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { forwardRef } from "react";

import { cn } from "./utils/cn";

const alertVariants = cva(
  "relative grid w-full grid-cols-[0_1fr] items-start gap-y-1.5 rounded-lg border p-3 transition-colors has-[>svg]:grid-cols-[1rem_1fr] has-[>svg]:gap-x-3 [&>svg]:size-4 [&>svg]:text-foreground dark:inset-ring dark:inset-ring-white/5",
  {
    variants: {
      variant: {
        default: "bg-background text-foreground",
        success:
          "bg-gradient-fade border-emerald-600/70 from-emerald-600/20 text-emerald-700 [&>svg]:text-emerald-600 dark:text-emerald-100 dark:from-emerald-600/20 dark:border-emerald-500/30 dark:[&>svg]:text-emerald-400",
        info: "bg-gradient-fade border-blue-500/70 from-blue-500/20 text-blue-800 [&>svg]:text-blue-600 dark:text-blue-100 dark:from-blue-500/20 dark:border-blue-500/30 dark:[&>svg]:text-blue-400",
        warning:
          "bg-gradient-fade border-amber-500/70 from-amber-500/20 text-amber-800 [&>svg]:text-amber-600 dark:text-amber-100 dark:from-amber-500/20 dark:border-amber-500/30 dark:[&>svg]:text-amber-400",
        destructive:
          "bg-gradient-fade border-red-500/70 from-red-500/20 text-destructive [&>svg]:text-destructive dark:text-red-100 dark:from-red-500/20 dark:border-red-500/30 dark:[&>svg]:text-red-400"
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
    className={cn("col-start-2 font-medium leading-none text-sm", className)}
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
    className={cn("col-start-2 text-xs [&_p]:leading-relaxed", className)}
    {...props}
  />
));
AlertDescription.displayName = "AlertDescription";

export { Alert, AlertDescription, AlertTitle };
