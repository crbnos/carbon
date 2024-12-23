"use client";

import { type DialogProps } from "@radix-ui/react-dialog";
import type { VariantProps } from "class-variance-authority";
import { cva } from "class-variance-authority";
import { Command as CommandPrimitive } from "cmdk";
import type {
  ComponentPropsWithoutRef,
  ElementRef,
  HTMLAttributes,
} from "react";
import { forwardRef } from "react";
import { RxMagnifyingGlass } from "react-icons/rx";

import { Modal, ModalContent } from "./Modal";
import { cn } from "./utils/cn";

const Command = forwardRef<
  ElementRef<typeof CommandPrimitive>,
  ComponentPropsWithoutRef<typeof CommandPrimitive>
>(({ className, ...props }, ref) => (
  <CommandPrimitive
    ref={ref}
    className={cn(
      "flex h-full w-full flex-col overflow-hidden rounded-md bg-popover text-popover-foreground",
      className
    )}
    {...props}
  />
));
Command.displayName = CommandPrimitive.displayName;

interface CommandDialogProps extends DialogProps {}

const CommandDialog = ({ children, ...props }: CommandDialogProps) => {
  return (
    <Modal {...props}>
      <ModalContent className="overflow-hidden p-0">
        <Command className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group]:not([hidden])_~[cmdk-group]]:pt-0 [&_[cmdk-group]]:px-2 [&_[cmdk-input-wrapper]_svg]:h-5 [&_[cmdk-input-wrapper]_svg]:w-5 [&_[cmdk-input]]:h-12 [&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-3 [&_[cmdk-item]_svg]:h-5 [&_[cmdk-item]_svg]:w-5">
          {children}
        </Command>
      </ModalContent>
    </Modal>
  );
};

const commandInputVariants = cva(
  "flex h-10 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50",
  {
    variants: {
      size: {
        lg: "h-12 px-4 py-3 rounded-lg text-base",
        md: "h-10 px-3 py-2 rounded-md text-base",
        sm: "h-8  px-3 py-2 rounded text-sm",
      },
    },
  }
);

interface CommandInputProps
  extends Omit<ComponentPropsWithoutRef<typeof CommandPrimitive.Input>, "size">,
    VariantProps<typeof commandInputVariants> {}

const CommandInput = forwardRef<
  ElementRef<typeof CommandPrimitive.Input>,
  CommandInputProps
>(({ className, size, ...props }, ref) => (
  <div
    className="flex items-center border-b border-border px-3"
    cmdk-input-wrapper=""
  >
    <RxMagnifyingGlass className="mr-2 h-4 w-4 shrink-0 opacity-50" />
    <CommandPrimitive.Input
      ref={ref}
      className={cn(
        commandInputVariants({
          size,
        }),
        className
      )}
      {...props}
    />
  </div>
));

CommandInput.displayName = CommandPrimitive.Input.displayName;

const CommandList = forwardRef<
  ElementRef<typeof CommandPrimitive.List>,
  ComponentPropsWithoutRef<typeof CommandPrimitive.List>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.List
    ref={ref}
    className={cn(
      "max-h-[300px] overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent overflow-x-hidden",
      className
    )}
    {...props}
  />
));

CommandList.displayName = CommandPrimitive.List.displayName;

const CommandLoading = forwardRef<
  ElementRef<typeof CommandPrimitive.Loading>,
  ComponentPropsWithoutRef<typeof CommandPrimitive.Loading>
>((props, ref) => <CommandPrimitive.Loading ref={ref} {...props} />);

CommandLoading.displayName = CommandPrimitive.Loading.displayName;

const CommandEmpty = forwardRef<
  ElementRef<typeof CommandPrimitive.Empty>,
  ComponentPropsWithoutRef<typeof CommandPrimitive.Empty>
>((props, ref) => (
  <CommandPrimitive.Empty
    ref={ref}
    className="py-6 text-center text-sm"
    {...props}
  />
));

CommandEmpty.displayName = CommandPrimitive.Empty.displayName;

const CommandGroup = forwardRef<
  ElementRef<typeof CommandPrimitive.Group>,
  ComponentPropsWithoutRef<typeof CommandPrimitive.Group>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Group
    ref={ref}
    className={cn(
      "overflow-hidden p-1 text-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground",
      className
    )}
    {...props}
  />
));

CommandGroup.displayName = CommandPrimitive.Group.displayName;

const CommandSeparator = forwardRef<
  ElementRef<typeof CommandPrimitive.Separator>,
  ComponentPropsWithoutRef<typeof CommandPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Separator
    ref={ref}
    className={cn("-mx-1 h-px bg-border", className)}
    {...props}
  />
));
CommandSeparator.displayName = CommandPrimitive.Separator.displayName;

const CommandItem = forwardRef<
  ElementRef<typeof CommandPrimitive.Item>,
  ComponentPropsWithoutRef<typeof CommandPrimitive.Item>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Item
    ref={ref}
    className={cn(
      "relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none aria-selected:bg-accent aria-selected:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      className
    )}
    {...props}
  />
));

CommandItem.displayName = CommandPrimitive.Item.displayName;

const CommandShortcut = ({
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement>) => {
  return (
    <span
      className={cn(
        "ml-auto text-xs tracking-widest text-muted-foreground",
        className
      )}
      {...props}
    />
  );
};
CommandShortcut.displayName = "CommandShortcut";

const commandTriggerVariants = cva(
  "text-foreground flex w-full items-center justify-between whitespace-nowrap rounded-md border border-input shadow-sm ring-offset-background data-[placeholder]:text-muted-foreground ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 [&>span]:line-clamp-1 overflow-hidden",
  {
    variants: {
      size: {
        lg: "h-12 px-4 py-3 rounded-lg text-base space-x-4",
        md: "h-10 px-3 py-2 rounded-md text-sm space-x-3",
        sm: "h-8  px-3 py-2 rounded text-xs space-x-2",
      },
    },
    defaultVariants: {
      size: "md",
    },
  }
);

export const multiSelectTriggerVariants = cva(
  "w-full justify-between font-normal",
  {
    variants: {
      size: {
        lg: "text-base",
        md: "text-sm",
        sm: "text-xs",
      },
      hasSelections: {
        true: "h-full",
        false: "",
      },
    },
    compoundVariants: [
      {
        size: "lg",
        hasSelections: true,
        class: "py-3 px-4",
      },
      {
        size: "lg",
        hasSelections: false,
        class: "h-12",
      },
      {
        size: "md",
        hasSelections: true,
        class: "py-2 px-3",
      },
      {
        size: "md",
        hasSelections: false,
        class: "h-10",
      },
      {
        size: "sm",
        hasSelections: true,
        class: "py-1 px-2",
      },
      {
        size: "sm",
        hasSelections: false,
        class: "h-8",
      },
    ],
    defaultVariants: {
      size: "md",
      hasSelections: false,
    },
  }
);

interface CommandTriggerProps
  extends ComponentPropsWithoutRef<"button">,
    VariantProps<typeof commandTriggerVariants> {
  icon?: React.ReactNode;
}

const CommandTrigger = forwardRef<ElementRef<"button">, CommandTriggerProps>(
  ({ size, className, children, icon, ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      className={cn(
        commandTriggerVariants({
          size,
        }),
        className
      )}
      {...props}
    >
      {children}
      {icon ? (
        icon
      ) : (
        <RxMagnifyingGlass className="size-4 flex-shrink-0 opacity-50" />
      )}
    </button>
  )
);
CommandTrigger.displayName = "CommandTrigger";

export {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandLoading,
  CommandSeparator,
  CommandShortcut,
  CommandTrigger,
};
