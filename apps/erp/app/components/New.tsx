import {
  Button,
  HStack,
  Kbd,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  useKeyboardShortcuts,
} from "@carbon/react";
import { Link } from "@remix-run/react";
import { useRef } from "react";
import { LuCirclePlus } from "react-icons/lu";

type NewProps = {
  label?: string;
  to: string;
};

const New = ({ label, to }: NewProps) => {
  const buttonRef = useRef<HTMLButtonElement>(null);
  useKeyboardShortcuts({
    n: (event: KeyboardEvent) => {
      event.stopPropagation();
      buttonRef.current?.click();
    },
  });

  return (
    <Tooltip>
      <TooltipTrigger>
        <Button asChild leftIcon={<LuCirclePlus />} ref={buttonRef}>
          <Link to={to} prefetch="intent">
            New
          </Link>
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        <HStack>
          <span>New {label}</span>
          <Kbd>N</Kbd>
        </HStack>
      </TooltipContent>
    </Tooltip>
  );
};

export default New;
