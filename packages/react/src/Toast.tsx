"use client";

import { Toaster as Sonner, toast } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      className="toaster group"
      closeButton
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg selection:bg-slate-900 selection:text-white",
          description: "group-[.toast]:text-muted-foreground",
          actionButton:
            "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton:
            "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
          closeButton:
            "group-[.toast]:!bg-transparent group-[.toast]:!text-current group-[.toast]:!border-transparent group-[.toast]:!size-5 group-[.toast]:!left-auto group-[.toast]:!right-2 group-[.toast]:!top-1/2 group-[.toast]:!-translate-y-1/2 group-[.toast]:!translate-x-0 group-[.toast]:!opacity-60 group-[.toast]:hover:!opacity-100 group-[.toast]:!transition-opacity group-[.toast]:!shadow-none",
          success:
            "group-[.toaster]:bg-blue-700 group-[.toaster]:text-white group-[.toaster]:border-blue-700 ",
          error:
            "group-[.toaster]:bg-red-600 group-[.toaster]:text-white group-[.toaster]:border-red-600 "
        }
      }}
      {...props}
    />
  );
};

export { toast, Toaster };
