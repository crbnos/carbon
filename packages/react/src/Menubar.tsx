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
          "min-h-[2.5rem] flex items-center bg-card border border-border rounded-lg justify-start p-1 w-full space-x-1 scrollbar-hide dark:border-none dark:shadow-[inset_0_0.5px_0_rgb(255_255_255_/_0.08),_inset_0_0_1px_rgb(255_255_255_/_0.24),_0_0_0_0.5px_rgb(0,0,0,1),0px_0px_4px_rgba(0,_0,_0,_0.08),_0px_0px_10px_rgba(0,_0,_0,_0.12),_0px_0px_24px_rgba(0,_0,_0,_0.16),_0px_0px_80px_rgba(0,_0,_0,_0.2)]",
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
      <Button className="rounded-md" ref={ref} variant="ghost" {...props}>
        {children}
      </Button>
    );
  }
);
MenubarItem.displayName = "MenubarItem";

export { Menubar, MenubarItem };
