// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Range } from "@tiptap/core";
import { Command } from "cmdk";
import { useAtom, useSetAtom } from "jotai";
import type { ComponentPropsWithoutRef, FC } from "react";
import { createContext, forwardRef, useEffect } from "react";
import type tunnel from "tunnel-rat";
import { queryAtom, rangeAtom } from "../utils/atoms";
import { novelStore } from "../utils/store";

export const EditorCommandTunnelContext = createContext(
  {} as ReturnType<typeof tunnel>
);

interface EditorCommandOutProps {
  readonly query: string;
  readonly range: Range;
}

export const EditorCommandOut: FC<EditorCommandOutProps> = ({
  query,
  range
}) => {
  const setQuery = useSetAtom(queryAtom, { store: novelStore });
  const setRange = useSetAtom(rangeAtom, { store: novelStore });

  useEffect(() => {
    setQuery(query);
  }, [query, setQuery]);

  useEffect(() => {
    setRange(range);
  }, [range, setRange]);

  useEffect(() => {
    const navigationKeys = ["ArrowUp", "ArrowDown", "Enter"];
    const onKeyDown = (e: KeyboardEvent) => {
      if (navigationKeys.includes(e.key)) {
        e.preventDefault();
        const commandRef = document.querySelector("#slash-command");

        if (commandRef)
          commandRef.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: e.key,
              cancelable: true,
              bubbles: true
            })
          );

        return false;
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  return (
    <EditorCommandTunnelContext.Consumer>
      {(tunnelInstance) => <tunnelInstance.Out />}
    </EditorCommandTunnelContext.Consumer>
  );
};

export const EditorCommand = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof Command>
>(({ children, className, ...rest }, ref) => {
  const [query, setQuery] = useAtom(queryAtom);

  return (
    <EditorCommandTunnelContext.Consumer>
      {(tunnelInstance) => (
        <tunnelInstance.In>
          <Command
            ref={ref}
            onKeyDown={(e) => {
              e.stopPropagation();
            }}
            id="slash-command"
            className={className}
            {...rest}
          >
            <Command.Input
              value={query}
              onValueChange={setQuery}
              style={{ display: "none" }}
            />
            {children}
          </Command>
        </tunnelInstance.In>
      )}
    </EditorCommandTunnelContext.Consumer>
  );
});
export const EditorCommandList = Command.List;

EditorCommand.displayName = "EditorCommand";
