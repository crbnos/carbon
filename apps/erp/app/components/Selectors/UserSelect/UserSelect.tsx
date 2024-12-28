/**
 * Welcome to UserSelect
 *
 * Controlled, accessible, multi-user select component for groups and people.
 *
 * A combobox is the combination of an `<input type="text"/>` and a list. In
 * this case, the list conforms to the `treeselect` pattern.
 *
 * @see WAI-ARIA Comobox https://www.w3.org/WAI/ARIA/apg/patterns/combobox/
 * @see WAI-ARIA Tree View https://www.w3.org/WAI/ARIA/apg/patterns/treeview/
 */

import { FormLabel } from "@carbon/react";
import { usePermissions } from "~/hooks";
import Combobox from "./components/Combobox";
import Container from "./components/Container";
import Input from "./components/Input";
import Popover from "./components/Popover";
import SelectionList from "./components/SelectionList";
import TreeSelect from "./components/TreeSelect";
import { UserSelectContext } from "./provider";
import type { UserSelectProps } from "./types";
import useUserSelect from "./useUserSelect";

export default function Component(props: UserSelectProps) {
  const permissions = usePermissions();

  if (!permissions.is("employee")) return null;
  return <UserSelect {...props} />;
}

const UserSelect = (props: UserSelectProps) => {
  const state = useUserSelect(props);
  const {
    dropdown,
    innerProps: { hideSelections, isMulti, label, readOnly, width },
    refs: { containerRef },
    selectionItemsById,
  } = state;

  return (
    <UserSelectContext.Provider value={state}>
      {label && <FormLabel>{label}</FormLabel>}
      <Container ref={containerRef} width={width}>
        {!(readOnly && isMulti) && (
          <Combobox>
            <Input />
            {dropdown.isOpen && (
              <Popover>
                <TreeSelect />
              </Popover>
            )}
          </Combobox>
        )}
        {!hideSelections &&
          isMulti &&
          Object.keys(selectionItemsById).length > 0 && <SelectionList />}
      </Container>
    </UserSelectContext.Provider>
  );
};
