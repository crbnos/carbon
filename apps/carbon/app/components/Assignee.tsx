import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  Popover,
  PopoverContent,
  PopoverTrigger,
  cn,
} from "@carbon/react";
import { useFetcher, useFetchers } from "@remix-run/react";
import type { ComponentPropsWithoutRef } from "react";
import { forwardRef, useMemo, useState } from "react";
import { RxCheck } from "react-icons/rx";
import { useUser } from "~/hooks";
import { usePeople } from "~/stores";
import { path } from "~/utils/path";
import EmployeeAvatar from "./EmployeeAvatar";

export type ComboboxProps = Omit<
  ComponentPropsWithoutRef<"button">,
  "onChange"
> & {
  id: string;
  table: string;
  size?: "sm" | "md" | "lg";
  value?: string;
  isReadOnly?: boolean;
  placeholder?: string;
  onChange?: (selected: string) => void;
};

const Assign = forwardRef<HTMLButtonElement, ComboboxProps>(
  (
    {
      id,
      table,
      size,
      value,
      isReadOnly,
      placeholder,
      onChange,
      className,
      ...props
    },
    ref
  ) => {
    const [open, setOpen] = useState(false);
    const [people] = usePeople();
    const fetcher = useFetcher<{}>();
    const user = useUser();

    const handleChange = (value: string) => {
      const formData = new FormData();
      formData.append("id", id);
      formData.append("assignee", value);
      formData.append("table", table);

      fetcher.submit(formData, {
        method: "post",
        action: path.to.api.assign,
      });
    };

    const options = useMemo(() => {
      const base =
        people
          .filter((person) => person.id !== user.id)
          .map((person) => ({
            value: person.id,
            label: person.name,
          })) ?? [];

      return [
        { value: "", label: "Unassigned" },
        { value: user.id, label: `${user.firstName} ${user.lastName}` },
        ...base,
      ];
    }, [people, user]);

    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            className={cn(
              "rounded-md px-2.5 py-0.5 text-sm transition-colors cursor-pointer bg-background hover:bg-accent hover:text-accent-foreground border border-input",
              className
            )}
            role="combobox"
            aria-expanded={open}
            aria-controls="assignee-options"
            ref={ref}
            onClick={() => setOpen(true)}
            disabled={isReadOnly}
            {...props}
          >
            {value ? (
              <EmployeeAvatar size={size ?? "xs"} employeeId={value ?? null} />
            ) : (
              <span className="text-sm">Unassigned</span>
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent className="min-w-[200px] w-[--radix-popover-trigger-width] p-0">
          <Command id="assignee-options">
            <CommandInput placeholder="Search..." className="h-9" />
            <CommandEmpty>No option found.</CommandEmpty>
            <CommandGroup>
              {options.map((option) => (
                <CommandItem
                  value={
                    typeof option.label === "string" ? option.label : undefined
                  }
                  key={option.value}
                  onSelect={() => {
                    handleChange(option.value);
                    onChange?.(option.value);
                    setOpen(false);
                  }}
                >
                  {option.label}

                  <RxCheck
                    className={cn(
                      "ml-auto h-4 w-4",
                      option.value === value ? "opacity-100" : "opacity-0"
                    )}
                  />
                </CommandItem>
              ))}
            </CommandGroup>
          </Command>
        </PopoverContent>
      </Popover>
    );
  }
);
Assign.displayName = "Assign";

export default Assign;

export function useOptimisticAssignment({
  id,
  table,
}: {
  id: string;
  table: string;
}) {
  const fetchers = useFetchers();
  const assignFetcher = fetchers.find(
    (f) => f.formAction === path.to.api.assign
  );

  if (assignFetcher && assignFetcher.formData) {
    if (
      assignFetcher.formData.get("id") === id &&
      assignFetcher.formData.get("table") === table
    ) {
      return assignFetcher.formData.get("assignee") as string;
    }
  }
}
