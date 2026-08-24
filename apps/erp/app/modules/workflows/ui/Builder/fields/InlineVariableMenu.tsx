import type {
  VariableTextMenuHandle,
  VariableTextMenuProps
} from "@carbon/react/VariableText";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState
} from "react";
import { readVariableMenuData } from "./menuBridge";
import { VariableTreeMenu } from "./VariableTreeMenu";

/** Hosts `VariableTreeMenu` inside the editor's suggestion popup. Mounted outside this
 * app's React tree, so its data comes from the module bridge, not from context. */
export const InlineVariableMenu = forwardRef<
  VariableTextMenuHandle,
  VariableTextMenuProps
>(function InlineVariableMenu({ editor, range, query, command }, ref) {
  // The menu claims its keys on the document, so there is nothing left to hand back —
  // and declining here lets the suggestion plugin close its own popup on Escape.
  useImperativeHandle(ref, () => ({ onKeyDown: () => false }));

  const { tree, flat, emptyReason } = readVariableMenuData();

  // The menu searches on its own box, seeded with whatever was typed after the `{`. The
  // editor keeps matching as it always did, so anything typed back in the field wins —
  // this only fires when `query` actually changes, which it cannot while the box has focus.
  const [search, setSearch] = useState(query);
  useEffect(() => setSearch(query), [query]);

  /** Picking puts the caret back in the editor, which blurs the search box mid-insert.
   * Without this latch that blur reads as leaving, and the dismissal below deletes the
   * range the token is being written into — the pick closes the menu and inserts nothing. */
  const picking = useRef(false);

  /** Closing without picking has to take the `{` with it: the popup is driven by that
   * match, so leaving the character behind would leave the menu open over a field the
   * user has already moved on from. `focus` hands the caret back to where they typed it. */
  const dismiss = (focus: boolean) => {
    const chain = editor.chain();
    (focus ? chain.focus() : chain).deleteRange(range).run();
  };

  return (
    <VariableTreeMenu
      tree={tree}
      flat={flat}
      emptyReason={emptyReason}
      query={search}
      onQueryChange={setSearch}
      onEscape={() => dismiss(true)}
      onSearchBlur={(next) => {
        if (picking.current) return;
        // Focus going back into the field is the user carrying on typing there, not
        // leaving: the same menu keeps matching on what the field itself holds.
        if (next !== null && editor.view.dom.contains(next)) return;
        // A click on nothing focusable leaves the page with no caret at all — that is the
        // one case the field has to be handed it back.
        dismiss(next === null);
      }}
      onSelect={(item) => {
        picking.current = true;
        command(item);
      }}
      // Backspace has to delete the `{` the user just typed.
      backspacePops={false}
    />
  );
});
