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
          "min-h-[2.5rem] flex items-center bg-card border border-border rounded-lg justify-start p-1 w-full space-x-1 scrollbar-hide",
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
