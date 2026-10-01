// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useVirtualizer } from "@tanstack/react-virtual";
import type {
  SuggestionKeyDownProps,
  SuggestionProps
} from "@tiptap/suggestion";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState
} from "react";
import type { MentionSuggestion } from "../extensions/mention";

export interface MentionListRef {
  onKeyDown: (props: SuggestionKeyDownProps) => boolean;
}

export interface MentionListProps extends SuggestionProps<MentionSuggestion> {}

const ITEM_HEIGHT = 44;
const MAX_VISIBLE_ITEMS = 6;

export const MentionList = forwardRef<MentionListRef, MentionListProps>(
  (props, ref) => {
    const [selectedIndex, setSelectedIndex] = useState(0);
    const parentRef = useRef<HTMLDivElement>(null);

    const virtualizer = useVirtualizer({
      count: props.items.length,
      getScrollElement: () => parentRef.current,
      estimateSize: () => ITEM_HEIGHT,
      overscan: 5
    });

    const selectItem = (index: number) => {
      const item = props.items[index];

      if (item) {
        props.command(item);
      }
    };

    const upHandler = () => {
      const newIndex =
        (selectedIndex + props.items.length - 1) % props.items.length;
      setSelectedIndex(newIndex);
      virtualizer.scrollToIndex(newIndex, { align: "auto" });
    };

    const downHandler = () => {
      const newIndex = (selectedIndex + 1) % props.items.length;
      setSelectedIndex(newIndex);
      virtualizer.scrollToIndex(newIndex, { align: "auto" });
    };

    const enterHandler = () => {
      selectItem(selectedIndex);
    };

    // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
    useEffect(() => setSelectedIndex(0), [props.items]);

    useImperativeHandle(ref, () => ({
      onKeyDown: ({ event }: SuggestionKeyDownProps) => {
        if (event.key === "ArrowUp") {
          upHandler();
          return true;
        }

        if (event.key === "ArrowDown") {
          downHandler();
          return true;
        }

        if (event.key === "Enter") {
          enterHandler();
          return true;
        }

        return false;
      }
    }));

    if (props.items.length === 0) {
      return (
        <div className="bg-popover border rounded-md shadow-md p-2 text-muted-foreground text-sm">
          No results
        </div>
      );
    }

    const virtualItems = virtualizer.getVirtualItems();

    return (
      <div className="bg-popover text-popover-foreground border rounded-md shadow-md overflow-hidden min-w-[240px]">
        <div
          ref={parentRef}
          className="overflow-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent"
          style={{
            height: `${
              Math.min(props.items.length, MAX_VISIBLE_ITEMS) * ITEM_HEIGHT
            }px`
          }}
        >
          <div
            style={{
              height: `${virtualizer.getTotalSize()}px`,
              width: "100%",
              position: "relative"
            }}
          >
            {virtualItems.map((virtualRow) => {
              const item = props.items[virtualRow.index];
              if (!item) return null;
              const isSelected = virtualRow.index === selectedIndex;

              return (
                <button
                  type="button"
                  className={`absolute top-0 left-0 w-full text-left px-3 text-sm ${
                    isSelected
                      ? "bg-accent text-accent-foreground"
                      : "hover:bg-accent/50"
                  }`}
                  style={{
                    height: `${ITEM_HEIGHT}px`,
                    transform: `translateY(${virtualRow.start}px)`
                  }}
                  key={item.id}
                  onClick={() => selectItem(virtualRow.index)}
                >
                  {item.helper ? (
                    <div className="flex flex-col justify-center gap-0.5 py-1 h-full">
                      <p className="line-clamp-1 leading-tight">{item.label}</p>
                      <p className="text-xs text-muted-foreground line-clamp-1 leading-tight">
                        {item.helper}
                      </p>
                    </div>
                  ) : (
                    <div className="flex items-center h-full">
                      <span className="line-clamp-1">{item.label}</span>
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    );
  }
);

MentionList.displayName = "MentionList";
