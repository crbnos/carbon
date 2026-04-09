import type { ButtonProps } from "@carbon/react";
import {
  Button,
  HStack,
  Kbd,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  useKeyboardShortcuts
} from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { useRef } from "react";
import { LuCirclePlus } from "react-icons/lu";
import { Link } from "react-router";

type NewProps = {
  label?: string;
  to: string;
  variant?: ButtonProps["variant"];
};

const New = ({ label, to, variant = "primary" }: NewProps) => {
  const { i18n, t } = useLingui();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const translatedLabel = label ? i18n._(label) : undefined;
  useKeyboardShortcuts({
    n: (event: KeyboardEvent) => {
      event.stopPropagation();
      buttonRef.current?.click();
    }
  });

  return (
    <Tooltip>
      <TooltipTrigger>
        <Button
          asChild
          leftIcon={<LuCirclePlus />}
          variant={variant}
          ref={buttonRef}
        >
          <Link to={to} prefetch="intent">
            {translatedLabel ? `${t`Add`} ${translatedLabel}` : t`Add`}
          </Link>
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        <HStack>
          <Kbd>N</Kbd>
        </HStack>
      </TooltipContent>
    </Tooltip>
  );
};

export default New;
