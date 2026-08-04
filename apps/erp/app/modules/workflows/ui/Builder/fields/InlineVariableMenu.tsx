import type {
  VariableTextMenuHandle,
  VariableTextMenuProps
} from "@carbon/react/VariableText";
import { forwardRef, useImperativeHandle } from "react";
import { readVariableMenuData } from "./menuBridge";
import { VariableTreeMenu } from "./VariableTreeMenu";

/** Hosts `VariableTreeMenu` inside the editor's suggestion popup. Mounted outside this
 * app's React tree, so its data comes from the module bridge, not from context. */
export const InlineVariableMenu = forwardRef<
  VariableTextMenuHandle,
  VariableTextMenuProps
>(function InlineVariableMenu(props, ref) {
  // The menu claims its keys on the document, so there is nothing left to hand back —
  // and declining here lets the suggestion plugin close its own popup on Escape.
  useImperativeHandle(ref, () => ({ onKeyDown: () => false }));

  const { tree, flat, emptyReason } = readVariableMenuData();

  return (
    <VariableTreeMenu
      tree={tree}
      flat={flat}
      emptyReason={emptyReason}
      query={props.query}
      onSelect={(item) => props.command(item)}
      // Backspace has to delete the `{` the user just typed.
      backspacePops={false}
    />
  );
});
