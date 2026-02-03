import { useField } from "@carbon/form";
import {
  Badge,
  BadgeCloseButton,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
  cn,
  FormControl,
  FormErrorMessage,
  FormHelperText,
  FormLabel,
  Popover,
  PopoverContent,
  PopoverTrigger,
  useMount
} from "@carbon/react";
import {
  type KeyboardEvent,
  useCallback,
  useMemo,
  useRef,
  useState
} from "react";
import { LuUsers } from "react-icons/lu";
import { useFetcher } from "react-router";
import type { Group } from "~/modules/users";
import { isValidEmail } from "~/utils/form";
import { path } from "~/utils/path";

type EmailRecipientsProps = {
  name: string;
  label?: string;
  helperText?: string;
  type?: "employee" | "supplier" | "customer";
};

type UserOption = {
  type: "user";
  id: string;
  name: string;
  email: string;
};

type GroupOption = {
  type: "group";
  id: string;
  name: string;
  emails: string[];
  memberCount: number;
};

type Option = UserOption | GroupOption;

const useEmailOptions = (type: "employee" | "supplier" | "customer") => {
  const groupsFetcher = useFetcher<{ groups: Group[] }>();

  useMount(() => {
    groupsFetcher.load(path.to.api.groupsByType(type));
  });

  const options = useMemo<Option[]>(() => {
    if (!groupsFetcher.data?.groups) return [];

    const opts: Option[] = [];
    const seenGroupIds = new Set<string>();

    const collectGroupEmails = (group: Group): string[] => {
      const groupEmails: string[] = [];
      group.data.users?.forEach((user) => {
        if (user.email) groupEmails.push(user.email);
      });
      group.children?.forEach((child) => {
        groupEmails.push(...collectGroupEmails(child));
      });
      return groupEmails;
    };

    const processGroup = (group: Group) => {
      if (seenGroupIds.has(group.data.id)) return;
      seenGroupIds.add(group.data.id);

      const groupEmails = [...new Set(collectGroupEmails(group))];
      if (groupEmails.length > 0) {
        opts.push({
          type: "group",
          id: group.data.id,
          name: group.data.name,
          emails: groupEmails,
          memberCount: groupEmails.length
        });
      }

      group.data.users?.forEach((user) => {
        if (user.email) {
          opts.push({
            type: "user",
            id: user.id,
            name: user.fullName,
            email: user.email
          });
        }
      });
    };

    groupsFetcher.data.groups.forEach(processGroup);

    const seenEmails = new Set<string>();
    return opts.filter((opt) => {
      if (opt.type === "group") return true;
      if (seenEmails.has(opt.email)) return false;
      seenEmails.add(opt.email);
      return true;
    });
  }, [groupsFetcher.data]);

  return options;
};

export default function EmailRecipients({
  name,
  label,
  helperText,
  type = "employee"
}: EmailRecipientsProps) {
  const { error, defaultValue, validate } = useField(name);
  const [emails, setEmails] = useState<string[]>(defaultValue ?? []);
  const [inputValue, setInputValue] = useState("");
  const [inputError, setInputError] = useState(false);
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const options = useEmailOptions(type);

  // Filter options based on search
  const filteredOptions = useMemo(() => {
    if (!inputValue.trim()) return options;
    const search = inputValue.toLowerCase();
    return options.filter((opt) => {
      if (opt.type === "user") {
        return (
          opt.name.toLowerCase().includes(search) ||
          opt.email.toLowerCase().includes(search)
        );
      }
      return opt.name.toLowerCase().includes(search);
    });
  }, [options, inputValue]);

  const addEmail = useCallback(
    (email: string) => {
      const trimmed = email.trim().toLowerCase();
      if (trimmed && !emails.includes(trimmed)) {
        setEmails((prev) => [...prev, trimmed]);
        validate();
      }
    },
    [emails, validate]
  );

  const addEmails = useCallback(
    (newEmails: string[]) => {
      const toAdd = newEmails
        .map((e) => e.trim().toLowerCase())
        .filter((e) => e && !emails.includes(e));
      if (toAdd.length > 0) {
        setEmails((prev) => [...prev, ...toAdd]);
        validate();
      }
    },
    [emails, validate]
  );

  const removeEmail = useCallback(
    (email: string) => {
      setEmails((prev) => prev.filter((e) => e !== email));
      validate();
    },
    [validate]
  );

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const value = inputValue.trim();
      if (value) {
        if (isValidEmail(value)) {
          addEmail(value);
          setInputValue("");
          setOpen(false);
          setInputError(false);
        } else {
          setInputError(true);
        }
      }
    } else if (e.key === "Escape") {
      setOpen(false);
      inputRef.current?.blur();
    } else if (e.key === "Backspace" && !inputValue && emails.length > 0) {
      removeEmail(emails[emails.length - 1]);
    } else if (e.key === "ArrowDown" && filteredOptions.length > 0) {
      e.preventDefault();
      setOpen(true);
    }
  };

  const handleSelect = (option: Option) => {
    if (option.type === "user") {
      addEmail(option.email);
    } else {
      addEmails(option.emails);
    }
    setInputValue("");
    setOpen(false);
    inputRef.current?.focus();
  };

  return (
    <FormControl isInvalid={!!error}>
      {label && <FormLabel htmlFor={name}>{label}</FormLabel>}
      {emails.map((email, index) => (
        <input
          key={email}
          type="hidden"
          name={`${name}[${index}]`}
          value={email}
        />
      ))}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <div
            className={cn(
              "flex flex-wrap gap-1 min-h-10 w-full rounded-md border bg-transparent px-3 py-2 text-sm ring-offset-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 cursor-text",
              inputError ? "border-destructive" : "border-input"
            )}
            onClick={(e) => {
              // Prevent popover toggle, just focus input
              e.preventDefault();
              inputRef.current?.focus();
            }}
          >
            {emails.map((email) => (
              <Badge
                key={email}
                variant="secondary"
                className="border border-card shadow-sm"
              >
                {email}
                <BadgeCloseButton
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    removeEmail(email);
                  }}
                />
              </Badge>
            ))}
            <input
              ref={inputRef}
              value={inputValue}
              onChange={(e) => {
                setInputValue(e.target.value);
                setInputError(false);
                setOpen(true);
              }}
              onFocus={() => setOpen(true)}
              onBlur={(e) => {
                // Delay close to allow click on popover items
                const relatedTarget = e.relatedTarget as HTMLElement;
                if (
                  !relatedTarget?.closest("[data-radix-popper-content-wrapper]")
                ) {
                  setTimeout(() => setOpen(false), 150);
                }
              }}
              onKeyDown={handleKeyDown}
              placeholder={
                emails.length === 0 ? "Search or enter email..." : ""
              }
              className="flex-1 min-w-[120px] bg-transparent outline-none placeholder:text-muted-foreground"
            />
          </div>
        </PopoverTrigger>
        <PopoverContent
          className="w-[--radix-popover-trigger-width] p-0"
          align="start"
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
          onPointerDownOutside={(e) => {
            // Don't close if clicking inside the trigger
            const target = e.target as HTMLElement;
            if (target.closest("[data-radix-popper-content-wrapper]")) {
              e.preventDefault();
            }
          }}
        >
          <Command shouldFilter={false}>
            <CommandList>
              <CommandEmpty>
                {inputValue ? (
                  <span
                    className={cn(
                      "text-sm",
                      inputError ? "text-destructive" : "text-muted-foreground"
                    )}
                  >
                    {isValidEmail(inputValue)
                      ? "Press Enter to add this email"
                      : "Enter a valid email address"}
                  </span>
                ) : (
                  <span className="text-muted-foreground text-sm">
                    Search users or type an email
                  </span>
                )}
              </CommandEmpty>
              {filteredOptions.length > 0 && (
                <CommandGroup>
                  {filteredOptions.map((option) => (
                    <CommandItem
                      key={
                        option.type === "user"
                          ? `user-${option.id}`
                          : `group-${option.id}`
                      }
                      value={
                        option.type === "user"
                          ? `${option.name} ${option.email}`
                          : option.name
                      }
                      onSelect={() => handleSelect(option)}
                      className="cursor-pointer"
                    >
                      {option.type === "group" ? (
                        <div className="flex items-center gap-2">
                          <LuUsers className="h-4 w-4 text-muted-foreground" />
                          <div className="flex flex-col">
                            <span>{option.name}</span>
                            <span className="text-xs text-muted-foreground">
                              {option.memberCount} member
                              {option.memberCount !== 1 ? "s" : ""}
                            </span>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-col">
                          <span>{option.name}</span>
                          <span className="text-xs text-muted-foreground">
                            {option.email}
                          </span>
                        </div>
                      )}
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {helperText && <FormHelperText>{helperText}</FormHelperText>}
      {error && <FormErrorMessage>{error}</FormErrorMessage>}
    </FormControl>
  );
}
