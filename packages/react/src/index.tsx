import type { JSONContent } from "novel";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "./Accordion";
import { ActionMenu } from "./ActionMenu";
import { Alert, AlertDescription, AlertTitle } from "./Alert";
import { AutodeskViewer } from "./AutodeskViewer";
import type { AvatarProps } from "./Avatar";
import {
  Avatar,
  AvatarGroup,
  AvatarGroupList,
  AvatarOverflowIndicator,
} from "./Avatar";
import type { BadgeProps } from "./Badge";
import { Badge, BadgeCloseButton } from "./Badge";
import type { ButtonProps } from "./Button";
import { Button, buttonVariants } from "./Button";
import {
  Card,
  CardAction,
  CardAttribute,
  CardAttributeLabel,
  CardAttributeValue,
  CardAttributes,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "./Card";
import { Checkbox } from "./Checkbox";
import { ClientOnly } from "./ClientOnly";
import { CodeBlock } from "./CodeBlock";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "./Collapsible";
import type { ComboboxProps } from "./Combobox";
import { Combobox } from "./Combobox";
import {
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
  multiSelectTriggerVariants,
} from "./Command";
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuPortal,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "./Context";
import { Count } from "./Count";
import {
  DatePicker,
  DateRangePicker,
  DateTimePicker,
  TimePicker,
} from "./Date";
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "./Drawer";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "./Dropdown";
import { Editor } from "./Editor";
import { File } from "./File";
import {
  FormControl,
  FormErrorMessage,
  FormHelperText,
  FormLabel,
} from "./Form";
import { HStack } from "./HStack";
import { HTML } from "./HTML";
import { Heading } from "./Heading";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "./HoverCard";
import { RichText, useRichText } from "./RichText";

import { generateHTML as DefaultGenerateHTML } from "@tiptap/react";
import ActionBar, { ActionBarButton } from "./ActionBar";
import type { CreatableComboboxProps } from "./CreateableCombobox";
import { CreatableCombobox } from "./CreateableCombobox";
import type { CreatableMultiSelectProps } from "./CreateableMultiSelect";
import { CreatableMultiSelect } from "./CreateableMultiSelect";
import { defaultExtensions } from "./Editor/extensions";
import { IconButton } from "./IconButton";
import type { InputProps } from "./Input";
import {
  Input,
  InputGroup,
  InputLeftAddon,
  InputLeftElement,
  InputRightAddon,
  InputRightElement,
} from "./Input";
import { Kbd } from "./Kbd";
import { Label } from "./Label";
import {
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
} from "./Menu";
import { Menubar, MenubarItem } from "./Menubar";
import {
  Modal,
  ModalBody,
  ModalClose,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  ModalPortal,
  ModalTitle,
  ModalTrigger,
} from "./Modal";
import {
  ModalCard,
  ModalCardBody,
  ModalCardContent,
  ModalCardDescription,
  ModalCardFooter,
  ModalCardHeader,
  ModalCardProvider,
  ModalCardTitle,
  ModalCardTypeContext,
  ModalCardTypeProvider,
  useModalCardType,
} from "./ModalCard";
import {
  ModalDrawer,
  ModalDrawerBody,
  ModalDrawerContent,
  ModalDrawerDescription,
  ModalDrawerFooter,
  ModalDrawerHeader,
  ModalDrawerProvider,
  ModalDrawerTitle,
  ModalDrawerTypeContext,
  ModalDrawerTypeProvider,
  useModalDrawerType,
} from "./ModalDrawer";
import type { MultiSelectProps } from "./MultiSelect";
import { MultiSelect } from "./MultiSelect";
import type { NumberFieldProps } from "./Number";
import {
  NumberDecrementStepper,
  NumberField,
  NumberIncrementStepper,
  NumberInput,
  NumberInputGroup,
  NumberInputStepper,
} from "./Number";
import type { OperatingSystemPlatform } from "./OperatingSystem";
import {
  OperatingSystemContextProvider,
  useOperatingSystem,
} from "./OperatingSystem";
import { Paragraph } from "./Paragraph";
import {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverFooter,
  PopoverHeader,
  PopoverTrigger,
} from "./Popover";
import { Progress } from "./Progress";
import { RadioGroup, RadioGroupItem } from "./Radio";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "./Resizable";
import { ScrollArea, ScrollBar } from "./ScrollArea";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "./Select";
import { Separator } from "./Separator";
import { ShortcutKey, shortcutKeyVariants } from "./ShortcutKey";
import { Skeleton } from "./Skeleton";
import { Slider } from "./Slider";
import { Spinner } from "./Spinner";
import { Status } from "./Status";
import { Switch } from "./Switch";
import { Table, TableCaption, Tbody, Td, Tfoot, Th, Thead, Tr } from "./Table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./Tabs";
import type { TextareaProps } from "./Textarea";
import { Textarea } from "./Textarea";
import { Toaster, toast } from "./Toast";
import { Toggle } from "./Toggle";
import { ToggleGroup, ToggleGroupItem } from "./ToggleGroup";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./Tooltip";
import { VStack } from "./VStack";
import type {
  Modifier,
  Shortcut,
  ShortcutDefinition,
} from "./hooks/useShortcutKeys";
import { cn } from "./utils/cn";
import { getValidChildren, reactNodeToString } from "./utils/react";

const generateHTML = (content: JSONContent) => {
  if (typeof window === "undefined") {
    return "";
  }
  if (!content || !("type" in content)) {
    return "";
  }
  return DefaultGenerateHTML(content, defaultExtensions);
};

export * from "./hooks";
export {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  ActionBar,
  ActionBarButton,
  ActionMenu,
  Alert,
  AlertDescription,
  AlertTitle,
  AutodeskViewer,
  Avatar,
  AvatarGroup,
  AvatarGroupList,
  AvatarOverflowIndicator,
  Badge,
  BadgeCloseButton,
  Button,
  Card,
  CardAction,
  CardAttribute,
  CardAttributeLabel,
  CardAttributeValue,
  CardAttributes,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Checkbox,
  ClientOnly,
  CodeBlock,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Combobox,
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
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuPortal,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
  Count,
  CreatableCombobox,
  CreatableMultiSelect,
  DatePicker,
  DateRangePicker,
  DateTimePicker,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  Editor,
  File,
  FormControl,
  FormErrorMessage,
  FormHelperText,
  FormLabel,
  HStack,
  HTML,
  Heading,
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
  IconButton,
  Input,
  InputGroup,
  InputLeftAddon,
  InputLeftElement,
  InputRightAddon,
  InputRightElement,
  Kbd,
  Label,
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
  Menubar,
  MenubarItem,
  Modal,
  ModalBody,
  ModalCard,
  ModalCardBody,
  ModalCardContent,
  ModalCardDescription,
  ModalCardFooter,
  ModalCardHeader,
  ModalCardProvider,
  ModalCardTitle,
  ModalCardTypeContext,
  ModalCardTypeProvider,
  ModalClose,
  ModalContent,
  ModalDescription,
  ModalDrawer,
  ModalDrawerBody,
  ModalDrawerContent,
  ModalDrawerDescription,
  ModalDrawerFooter,
  ModalDrawerHeader,
  ModalDrawerProvider,
  ModalDrawerTitle,
  ModalDrawerTypeContext,
  ModalDrawerTypeProvider,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  ModalPortal,
  ModalTitle,
  ModalTrigger,
  MultiSelect,
  NumberDecrementStepper,
  NumberField,
  NumberIncrementStepper,
  NumberInput,
  NumberInputGroup,
  NumberInputStepper,
  OperatingSystemContextProvider,
  Paragraph,
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverFooter,
  PopoverHeader,
  PopoverTrigger,
  Progress,
  RadioGroup,
  RadioGroupItem,
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  RichText,
  ScrollArea,
  ScrollBar,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
  Separator,
  ShortcutKey,
  Skeleton,
  Slider,
  Spinner,
  Status,
  Switch,
  Table,
  TableCaption,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Tbody,
  Td,
  Textarea,
  Tfoot,
  Th,
  Thead,
  TimePicker,
  Toaster,
  Toggle,
  ToggleGroup,
  ToggleGroupItem,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  Tr,
  VStack,
  buttonVariants,
  cn,
  generateHTML,
  getValidChildren,
  multiSelectTriggerVariants,
  reactNodeToString,
  shortcutKeyVariants,
  toast,
  useModalCardType,
  useModalDrawerType,
  useOperatingSystem,
  useRichText,
};
export type {
  AvatarProps,
  BadgeProps,
  ButtonProps,
  ComboboxProps,
  CreatableComboboxProps,
  CreatableMultiSelectProps,
  InputProps,
  JSONContent,
  Modifier,
  MultiSelectProps,
  NumberFieldProps,
  OperatingSystemPlatform,
  Shortcut,
  ShortcutDefinition,
  TextareaProps,
};
