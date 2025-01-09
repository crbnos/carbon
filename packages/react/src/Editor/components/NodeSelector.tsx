import type { EditorInstance } from "novel";
import { EditorBubbleItem, useEditor } from "novel";
import type { IconType } from "react-icons";
import {
  LuCheck,
  LuChevronDown,
  LuHeading1,
  LuHeading2,
  LuHeading3,
  LuListOrdered,
  LuSquareCheck,
  LuText,
} from "react-icons/lu";

import { Popover } from "@radix-ui/react-popover";
import { Button } from "../../Button";
import { PopoverContent, PopoverTrigger } from "../../Popover";

export type SelectorItem = {
  name: string;
  icon: IconType;
  command: (editor: EditorInstance) => void;
  isActive: (editor: EditorInstance) => boolean;
};

const items: SelectorItem[] = [
  {
    name: "Text",
    icon: LuText,
    command: (editor) => editor.chain().focus().clearNodes().run(),
    // I feel like there has to be a more efficient way to do this – feel free to PR if you know how!
    isActive: (editor) =>
      editor.isActive("paragraph") &&
      !editor.isActive("bulletList") &&
      !editor.isActive("orderedList"),
  },
  {
    name: "Heading 1",
    icon: LuHeading1,
    command: (editor) =>
      editor.chain().focus().clearNodes().toggleHeading({ level: 1 }).run(),
    isActive: (editor) => editor.isActive("heading", { level: 1 }),
  },
  {
    name: "Heading 2",
    icon: LuHeading2,
    command: (editor) =>
      editor.chain().focus().clearNodes().toggleHeading({ level: 2 }).run(),
    isActive: (editor) => editor.isActive("heading", { level: 2 }),
  },
  {
    name: "Heading 3",
    icon: LuHeading3,
    command: (editor) =>
      editor.chain().focus().clearNodes().toggleHeading({ level: 3 }).run(),
    isActive: (editor) => editor.isActive("heading", { level: 3 }),
  },
  {
    name: "To-do List",
    icon: LuSquareCheck,
    command: (editor) =>
      editor.chain().focus().clearNodes().toggleTaskList().run(),
    isActive: (editor) => editor.isActive("taskItem"),
  },
  {
    name: "Bullet List",
    icon: LuListOrdered,
    command: (editor) =>
      editor.chain().focus().clearNodes().toggleBulletList().run(),
    isActive: (editor) => editor.isActive("bulletList"),
  },
  {
    name: "Numbered List",
    icon: LuListOrdered,
    command: (editor) =>
      editor.chain().focus().clearNodes().toggleOrderedList().run(),
    isActive: (editor) => editor.isActive("orderedList"),
  },
  // {
  //   name: "Code",
  //   icon: LuCode,
  //   command: (editor) =>
  //     editor.chain().focus().clearNodes().toggleCodeBlock().run(),
  //   isActive: (editor) => editor.isActive("codeBlock"),
  // },
];
interface NodeSelectorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const NodeSelector = ({ open, onOpenChange }: NodeSelectorProps) => {
  const { editor } = useEditor();
  if (!editor) return null;

  const activeItem = items.filter((item) => item.isActive(editor)).pop() ?? {
    name: "Multiple",
  };

  return (
    <Popover modal={true} open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button variant="ghost" rightIcon={<LuChevronDown />}>
          {activeItem.name}
        </Button>
      </PopoverTrigger>
      <PopoverContent sideOffset={5} align="start" className="w-48 p-1">
        {items.map((item, index) => (
          <EditorBubbleItem
            key={index}
            onSelect={(editor) => {
              item.command(editor);
              onOpenChange(false);
            }}
            className="flex cursor-pointer items-center justify-between rounded-sm px-2 py-1 text-sm hover:bg-accent"
          >
            <div className="flex items-center space-x-2">
              <div className="rounded-sm border p-1">
                <item.icon className="h-3 w-3" />
              </div>
              <span>{item.name}</span>
            </div>
            {activeItem.name === item.name && <LuCheck className="h-4 w-4" />}
          </EditorBubbleItem>
        ))}
      </PopoverContent>
    </Popover>
  );
};
