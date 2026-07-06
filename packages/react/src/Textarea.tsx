import type { VariantProps } from "class-variance-authority";
import { cva } from "class-variance-authority";
import type { TextareaHTMLAttributes } from "react";
import { forwardRef } from "react";
import { cn } from "./utils/cn";

const textareaVariants = cva(
  "flex min-h-[2lh] max-h-[10lh] w-full border border-input bg-transparent shadow-xs transition-[color,box-shadow] placeholder:text-muted-foreground outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 read-only:bg-muted read-only:cursor-not-allowed dark:aria-invalid:ring-destructive/40",
  {
    variants: {
      size: {
        sm: "rounded-md px-3 py-1 text-sm",
        md: "rounded-md px-3 py-2 text-sm",
        lg: "rounded-lg px-4 py-3 text-base"
      }
    },
    defaultVariants: {
      size: "md"
    }
  }
);

export interface TextareaProps
  extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "size">,
    VariantProps<typeof textareaVariants> {}

const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, size, ...props }, ref) => {
    return (
      <textarea
        className={cn(textareaVariants({ size }), className)}
        ref={ref}
        {...props}
      />
    );
  }
);
Textarea.displayName = "Textarea";

export { Textarea };
