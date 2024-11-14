"use client";

import { Toaster as Sonner, toast } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton:
            "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton:
            "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
          success:
            "group-[.toaster]:bg-emerald-600 group-[.toaster]:text-emerald-100 dark:group-[.toaster]:bg-emerald-900 group-[.toaster]:border-emerald-600 dark:group-[.toaster]:text-emerald-400 group-[.toaster]:text-white",
          error:
            "group-[.toaster]:bg-red-600 group-[.toaster]:text-red-100 dark:group-[.toaster]:bg-red-900 group-[.toaster]:border-red-600 dark:group-[.toaster]:text-red-400 group-[.toaster]:text-white",
        },
      }}
      {...props}
    />
  );
};

export { toast, Toaster };
