/*
  Menu components are an abstraction over ContextMenu and DropdownMenu components.
*/
import type {
  ComponentPropsWithoutRef,
  ElementRef,
  PropsWithChildren,
} from "react";
import { createContext, forwardRef, useContext } from "react";
import {
  ContextMenuCheckboxItem,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
} from "./Context";
import type { DropdownMenuIconProps } from "./Dropdown";
import {
  DropdownMenuCheckboxItem,
  DropdownMenuGroup,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
} from "./Dropdown";

const MenuTypeContext = createContext<"context" | "dropdown">("dropdown");
const MenuTypeProvider = MenuTypeContext.Provider;

const Menu = ({
  type = "dropdown",
  ...props
}: PropsWithChildren<{
  type?: "context" | "dropdown";
}>) => <MenuTypeProvider value={type} {...props} />;

const useMenuType = () => {
  const type = useContext(MenuTypeContext);
  return type;
};

const MenuCheckboxItem = forwardRef<
  | ElementRef<typeof ContextMenuCheckboxItem>
  | ElementRef<typeof DropdownMenuCheckboxItem>,
  | ComponentPropsWithoutRef<typeof ContextMenuCheckboxItem>
  | ComponentPropsWithoutRef<typeof ContextMenuCheckboxItem>
>((props, ref) => {
  const type = useMenuType();

  if (type === "context") {
    return <ContextMenuCheckboxItem {...props} ref={ref} />;
  }

  return <DropdownMenuCheckboxItem {...props} ref={ref} />;
});
MenuCheckboxItem.displayName = "MenuCheckboxItem";

const MenuGroup = forwardRef<
  ElementRef<typeof ContextMenuGroup> | ElementRef<typeof DropdownMenuGroup>,
  | ComponentPropsWithoutRef<typeof ContextMenuGroup>
  | ComponentPropsWithoutRef<typeof ContextMenuGroup>
>((props, ref) => {
  const type = useMenuType();

  if (type === "context") {
    return <ContextMenuGroup {...props} ref={ref} />;
  }

  return <DropdownMenuGroup {...props} ref={ref} />;
});
MenuGroup.displayName = "MenuGroup";

const MenuIcon = forwardRef<ElementRef<"span">, DropdownMenuIconProps>(
  ({ className, ...props }, ref) => <DropdownMenuIcon ref={ref} {...props} />
);
MenuIcon.displayName = "MenuIcon";

const MenuItem = forwardRef<
  ElementRef<typeof ContextMenuItem> | ElementRef<typeof DropdownMenuItem>,
  | ComponentPropsWithoutRef<typeof ContextMenuItem>
  | ComponentPropsWithoutRef<typeof DropdownMenuItem>
>((props, ref) => {
  const type = useMenuType();

  if (type === "context") {
    return <ContextMenuItem {...props} ref={ref} />;
  }

  return <DropdownMenuItem {...props} ref={ref} />;
});
MenuItem.displayName = "MenuItem";

const MenuLabel = forwardRef<
  ElementRef<typeof ContextMenuLabel> | ElementRef<typeof DropdownMenuLabel>,
  | ComponentPropsWithoutRef<typeof ContextMenuLabel>
  | ComponentPropsWithoutRef<typeof DropdownMenuLabel>
>((props, ref) => {
  const type = useMenuType();

  if (type === "context") {
    return <ContextMenuLabel {...props} ref={ref} />;
  }

  return <DropdownMenuLabel {...props} ref={ref} />;
});
MenuLabel.displayName = "MenuLabel";

const MenuRadioGroup = forwardRef<
  | ElementRef<typeof ContextMenuRadioGroup>
  | ElementRef<typeof DropdownMenuRadioGroup>,
  | ComponentPropsWithoutRef<typeof ContextMenuRadioGroup>
  | ComponentPropsWithoutRef<typeof DropdownMenuRadioGroup>
>((props, ref) => {
  const type = useMenuType();

  if (type === "context") {
    return <ContextMenuRadioGroup {...props} ref={ref} />;
  }

  return <DropdownMenuRadioGroup {...props} ref={ref} />;
});
MenuRadioGroup.displayName = "MenuRadioGroup";

const MenuRadioItem = forwardRef<
  | ElementRef<typeof ContextMenuRadioItem>
  | ElementRef<typeof DropdownMenuRadioItem>,
  | ComponentPropsWithoutRef<typeof ContextMenuRadioItem>
  | ComponentPropsWithoutRef<typeof DropdownMenuRadioItem>
>((props, ref) => {
  const type = useMenuType();

  if (type === "context") {
    return <ContextMenuRadioItem {...props} ref={ref} />;
  }

  return <DropdownMenuRadioItem {...props} ref={ref} />;
});
MenuRadioItem.displayName = "MenuRadioItem";

const MenuSeparator = forwardRef<
  | ElementRef<typeof ContextMenuSeparator>
  | ElementRef<typeof DropdownMenuSeparator>,
  | ComponentPropsWithoutRef<typeof ContextMenuSeparator>
  | ComponentPropsWithoutRef<typeof DropdownMenuSeparator>
>((props, ref) => {
  const type = useMenuType();

  if (type === "context") {
    return <ContextMenuSeparator {...props} ref={ref} />;
  }

  return <DropdownMenuSeparator {...props} />;
});
MenuSeparator.displayName = "MenuSeparator";

const MenuShortcut = (
  props:
    | ComponentPropsWithoutRef<typeof ContextMenuShortcut>
    | ComponentPropsWithoutRef<typeof DropdownMenuShortcut>
) => {
  const type = useMenuType();

  if (type === "context") {
    return <ContextMenuShortcut {...props} />;
  }

  return <DropdownMenuShortcut {...props} />;
};

const MenuSub = (
  props:
    | ComponentPropsWithoutRef<typeof ContextMenuSub>
    | ComponentPropsWithoutRef<typeof DropdownMenuSub>
) => {
  const type = useMenuType();

  if (type === "context") {
    return <ContextMenuSub {...props} />;
  }

  return <DropdownMenuSub {...props} />;
};

const MenuSubContent = forwardRef<
  | ElementRef<typeof ContextMenuSubContent>
  | ElementRef<typeof DropdownMenuSubContent>,
  | ComponentPropsWithoutRef<typeof ContextMenuSubContent>
  | ComponentPropsWithoutRef<typeof DropdownMenuSubContent>
>((props, ref) => {
  const type = useMenuType();

  if (type === "context") {
    return <ContextMenuSubContent {...props} ref={ref} />;
  }

  return <DropdownMenuSubContent {...props} ref={ref} />;
});
MenuSubContent.displayName = "MenuSubContent";

export {
  Menu,
  MenuCheckboxItem,
  MenuGroup,
  MenuIcon,
  MenuItem,
  MenuLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuShortcut,
  MenuSub,
  MenuSubContent,
};
