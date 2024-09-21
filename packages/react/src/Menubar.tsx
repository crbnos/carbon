import type { ComponentProps } from "react";
import { forwardRef } from "react";
import type { ButtonProps } from "./Button";
import { Button } from "./Button";
import { cn } from "./utils/cn";

const Menubar = forwardRef<HTMLDivElement, ComponentProps<"div">>(
  ({ children, className, ...props }, ref) => {
    return (
      <div
        {...props}
        className={cn(
          "min-h-[2.5rem] flex items-center bg-card border border-border shadow-sm dark:border-0 dark:shadow-[0px_1px_0px_0px_hsla(0,0%,100%,.03)_inset,0px_0px_0px_1px_hsla(0,0%,100%,.03)_inset,0px_0px_0px_1px_rgba(0,0,0,.1),0px_2px_2px_0px_rgba(0,0,0,.1),0px_4px_4px_0px_rgba(0,0,0,.1),0px_8px_8px_0px_rgba(0,0,0,.1)] rounded-lg justify-start p-1 w-full space-x-1 overflow-x-scroll scrollbar-hide",
          className
        )}
      >
        {children}
      </div>
    );
  }
);
Menubar.displayName = "Menubar";

const MenubarItem = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ children, ...props }, ref) => {
    return (
      <Button className="rounded-sm" ref={ref} variant="ghost" {...props}>
        {children}
      </Button>
    );
  }
);
MenubarItem.displayName = "MenubarItem";

export { Menubar, MenubarItem };
