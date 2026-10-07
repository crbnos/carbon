// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  CardHeader,
  Copy,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  Heading,
  HStack,
  IconButton
} from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { LuEllipsisVertical } from "react-icons/lu";
import {
  RecordHero,
  RecordPhoneChrome,
  recordHeroSlot
} from "./Layout/RecordHeader";

type DocumentHeaderProps = {
  title: string;
  subtitle?: string;
  status?: ReactNode;
  menuItems?: ReactNode;
  /** The document's actions, each in a RecordAction. */
  actions?: ReactNode;
  /** Defaults to `title`. */
  copyValue?: string;
  className?: string;
};

/**
 * A card form's header. Phones hide it: the hero shows at the page's
 * <RecordHeroTarget>, outside the card, and the actions move to the bottom
 * bar.
 */
const DocumentHeader = ({
  title,
  subtitle,
  status,
  menuItems,
  actions,
  copyValue = title,
  className
}: DocumentHeaderProps) => {
  const { t } = useLingui();
  return (
    <>
      <recordHeroSlot.Fill>
        <RecordHero subtitle={subtitle} status={status} />
      </recordHeroSlot.Fill>
      <RecordPhoneChrome menu={menuItems} copyValue={copyValue} />
      <CardHeader
        className={cn(
          "flex-row items-center justify-between compact:hidden",
          className
        )}
      >
        <div>
          <HStack>
            <Heading as="h1" size="h3" className="font-sans">
              {title}
            </Heading>
            <Copy text={copyValue} />
            {menuItems && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <IconButton
                    aria-label={t`More options`}
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
    </>
  );
};

export default DocumentHeader;
