import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuTrigger,
  IconButton,
} from "@carbon/react";
import { LuHelpCircle, LuMessageSquare } from "react-icons/lu";

const HelpMenu = () => {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton
          className="hidden sm:flex"
          aria-label="Help"
          icon={<LuHelpCircle />}
          variant="ghost"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem asChild>
          <a
            href="https://github.com/barbinbrad/carbon/issues/new/choose"
            target="_blank"
            rel="noreferrer"
          >
            <DropdownMenuIcon icon={<LuHelpCircle />} />
            Help
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a
            href="https://github.com/barbinbrad/carbon/discussions/new/choose"
            target="_blank"
            rel="noreferrer"
          >
            <DropdownMenuIcon icon={<LuMessageSquare />} />
            Feedback
          </a>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default HelpMenu;
