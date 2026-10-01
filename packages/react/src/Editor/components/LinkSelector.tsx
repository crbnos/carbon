// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useEditor } from "@carbon/tiptap";
import { useEffect, useRef } from "react";
import { LuCheck, LuLink, LuTrash } from "react-icons/lu";
import { IconButton } from "../../IconButton";
import { Popover, PopoverContent, PopoverTrigger } from "../../Popover";

export function isValidUrl(url: string) {
  try {
    new URL(url);
    return true;
    // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
  } catch (e) {
    return false;
  }
}
export function getUrlFromString(str: string) {
  if (isValidUrl(str)) return str;
  try {
    if (str.includes(".") && !str.includes(" ")) {
      return new URL(`https://${str}`).toString();
    }
    // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
  } catch (e) {
    return null;
  }
}
interface LinkSelectorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const LinkSelector = ({ open, onOpenChange }: LinkSelectorProps) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const { editor } = useEditor();

  // Autofocus on input by default
  useEffect(() => {
    inputRef.current && inputRef.current?.focus();
  });
  if (!editor) return null;

  return (
    <Popover modal={true} open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <IconButton aria-label="Link" icon={<LuLink />} variant="ghost" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-60 p-0" sideOffset={10}>
        <form
          onSubmit={(e) => {
            const target = e.currentTarget as HTMLFormElement;
            e.preventDefault();
            const input = target[0] as HTMLInputElement;
            const url = getUrlFromString(input.value);
            url && editor.chain().focus().setLink({ href: url }).run();
          }}
          className="flex  p-1 "
        >
          <input
            ref={inputRef}
            type="text"
            placeholder="Paste a link"
            className="flex-1 bg-background p-1 text-sm outline-none"
            defaultValue={editor.getAttributes("link").href || ""}
          />
          {editor.getAttributes("link").href ? (
            <IconButton
              aria-label="Remove link"
              icon={<LuTrash className="h-4 w-4" />}
              variant="secondary"
              type="button"
              className="flex h-8 items-center rounded-sm p-1 text-red-600 transition-colors hover:bg-red-100 dark:hover:bg-red-800"
              onClick={() => {
                editor.chain().focus().unsetLink().run();
              }}
            />
          ) : (
            <span className="h-8">
              <IconButton icon={<LuCheck />} aria-label="Linked" />
            </span>
          )}
        </form>
      </PopoverContent>
    </Popover>
  );
};
