// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ComboboxProps } from "@carbon/form";
import { CreatableCombobox } from "@carbon/form";
import { useLoaderQuery } from "@carbon/query";
import { useMemo, useRef } from "react";
import { Enumerable } from "~/components/Enumerable";
import { useDrawerItem } from "~/hooks";
import type { getDepartmentsList } from "~/modules/people/people.service";
import DepartmentForm from "~/modules/people/ui/Departments/DepartmentForm";
import { path } from "~/utils/path";
import { useEmptyState } from "./emptyStates";

type DepartmentSelectProps = Omit<ComboboxProps, "options">;

const Department = (props: DepartmentSelectProps) => {
  const create = useDrawerItem<string>();
  const triggerRef = useRef<HTMLButtonElement>(null);

  const options = useDepartments();

  const emptyMessage = useEmptyState("department", {
    onCreate: () => create.open("")
  });

  return (
    <>
      <CreatableCombobox
        ref={triggerRef}
        options={options.map((o) => ({
          value: o.value,
          label: <Enumerable value={o.label} />
        }))}
        emptyMessage={emptyMessage}
        {...props}
        label={props?.label ?? "Department"}
        onCreateOption={(option) => {
          create.open(option);
        }}
      />
      {create.item !== null && (
        <DepartmentForm
          key={create.key}
          open={create.isOpen}
          type="modal"
          onClose={() => {
            create.close();
            create.afterClose(() => triggerRef.current?.click());
          }}
          initialValues={{
            name: create.item
          }}
        />
      )}
    </>
  );
};

Department.displayName = "Department";

export default Department;

export const useDepartments = () => {
  const departmentFetcher = useLoaderQuery<
    Awaited<ReturnType<typeof getDepartmentsList>>
  >(path.to.api.departments);

  const options = useMemo(
    () =>
      departmentFetcher.data?.data
        ? departmentFetcher.data?.data.map((c) => ({
            value: c.id,
            label: c.name
          }))
        : [],
    [departmentFetcher.data]
  );

  return options;
};
