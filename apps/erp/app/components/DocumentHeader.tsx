import {
  CardHeader,
  Copy,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  Heading,
  HStack,
  IconButton
} from "@carbon/react";
import type { ReactNode } from "react";
import { LuEllipsisVertical } from "react-icons/lu";

type DocumentHeaderProps = {
  title: string;
  subtitle?: string;
  status?: ReactNode;
  menuItems?: ReactNode;
  actions?: ReactNode;
};

const DocumentHeader = ({
  title,
  subtitle,
  status,
  menuItems,
  actions
}: DocumentHeaderProps) => {
  return (
    <CardHeader className="flex-row items-center justify-between">
      <div>
        <HStack>
          <Heading as="h1" size="h3">
            {title}
          </Heading>
          <Copy text={title} />
          {menuItems && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton
                  aria-label="More options"
                  icon={<LuEllipsisVertical />}
                  variant="secondary"
                  size="sm"
                />
              </DropdownMenuTrigger>
              <DropdownMenuContent>{menuItems}</DropdownMenuContent>
            </DropdownMenu>
          )}
          {status}
        </HStack>
        {subtitle && (
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        )}
      </div>
      {actions && <HStack>{actions}</HStack>}
    </CardHeader>
  );
};

export default DocumentHeader;
