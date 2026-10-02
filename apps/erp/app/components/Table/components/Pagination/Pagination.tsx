// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  HStack,
  IconButton,
  ShortcutKey,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  useShortcutKeyMap
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ReactElement } from "react";
import { useCallback, useMemo, useRef } from "react";
import { BsChevronLeft, BsChevronRight } from "react-icons/bs";
import { PAGINATION_SHORTCUTS } from "~/shortcuts";
import { PAGE_SIZES } from "~/utils/pagination";

export type PaginationProps = {
  compact?: boolean;
  count: number;
  offset: number;
  pageIndex: number;
  pageSize: number;
  canPreviousPage: boolean;
  canNextPage: boolean;
  pageCount: number;
  gotoPage: (page: number) => void;
  nextPage: () => void;
  previousPage: () => void;
  setPageSize: (size: number) => void;
};

const Pagination = (props: PaginationProps) => {
  const { pageSize, setPageSize } = props;

  return (
    <>
      <hr className="m-0 h-px w-full border-none bg-gradient-to-r from-zinc-200/0 via-zinc-500/30 to-zinc-200/0" />
      <HStack
        className="text-center bg-card justify-between py-4 w-full z-[1] px-4"
        spacing={6}
      >
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="secondary">
              {pageSize} <Trans>rows</Trans>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-48">
            <DropdownMenuLabel>
              <Trans>Results per page</Trans>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuRadioGroup value={`${pageSize}`}>
              {PAGE_SIZES.map((size) => (
                <DropdownMenuRadioItem
                  key={`${size}`}
                  value={`${size}`}
                  onClick={() => {
                    setPageSize(size);
                  }}
                >
                  {size}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <HStack>
          <PaginationButtons {...props} />
        </HStack>
      </HStack>
    </>
  );
};

export const PaginationButtons = ({
  condensed = false,
  canNextPage,
  canPreviousPage,
  count,
  nextPage,
  offset,
  pageSize,
  previousPage
}: PaginationProps & { condensed?: boolean }) => {
  const { t } = useLingui();
  const nextButtonRef = useRef<HTMLButtonElement>(null);
  const previousButtonRef = useRef<HTMLButtonElement>(null);

  const scrollToTop = useCallback(() => {
    document
      .getElementById("table-container")
      ?.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const handlePreviousPage = useCallback(() => {
    previousPage();
    scrollToTop();
  }, [previousPage, scrollToTop]);

  const handleNextPage = useCallback(() => {
    nextPage();
    scrollToTop();
  }, [nextPage, scrollToTop]);

  useShortcutKeyMap(
    useMemo(
      () => [
        {
          shortcut: PAGINATION_SHORTCUTS.next,
          action: () => nextButtonRef.current?.click()
        },
        {
          shortcut: PAGINATION_SHORTCUTS.previous,
          action: () => previousButtonRef.current?.click()
        }
      ],
      []
    )
  );

  return (
    <>
      {condensed ? (
        <>
          <PaginationTooltip direction="previous">
            <IconButton
              ref={previousButtonRef}
              aria-label={t`Previous`}
              icon={<BsChevronLeft />}
              isDisabled={!canPreviousPage}
              onClick={handlePreviousPage}
              variant="secondary"
            />
          </PaginationTooltip>
          <PaginationTooltip direction="next">
            <IconButton
              ref={nextButtonRef}
              aria-label={t`Next`}
              icon={<BsChevronRight />}
              isDisabled={!canNextPage}
              onClick={handleNextPage}
              variant="secondary"
            />
          </PaginationTooltip>
        </>
      ) : (
        <>
          <div className="text-foreground text-sm font-medium align-center hidden lg:flex">
            {count > 0 ? offset + 1 : 0} - {Math.min(offset + pageSize, count)}{" "}
            <Trans>of</Trans> {count}
          </div>
          <PaginationTooltip direction="previous">
            <Button
              ref={previousButtonRef}
              variant="secondary"
              isDisabled={!canPreviousPage}
              onClick={handlePreviousPage}
              leftIcon={<BsChevronLeft />}
            >
              <Trans>Previous</Trans>
            </Button>
          </PaginationTooltip>
          <PaginationTooltip direction="next">
            <Button
              ref={nextButtonRef}
              variant="secondary"
              isDisabled={!canNextPage}
              onClick={handleNextPage}
              rightIcon={<BsChevronRight />}
            >
              <Trans>Next</Trans>
            </Button>
          </PaginationTooltip>
        </>
      )}
    </>
  );
};

/** Says what the button does, then its key — a bare arrow keycap reads as "chevron". */
const PaginationTooltip = ({
  direction,
  children
}: {
  direction: keyof typeof PAGINATION_SHORTCUTS;
  children: ReactElement;
}) => (
  <Tooltip>
    <TooltipTrigger asChild>{children}</TooltipTrigger>
    <TooltipContent>
      <HStack>
        <span>
          {direction === "previous" ? (
            <Trans>Previous page</Trans>
          ) : (
            <Trans>Next page</Trans>
          )}
        </span>
        <ShortcutKey
          shortcut={PAGINATION_SHORTCUTS[direction]}
          variant="small"
        />
      </HStack>
    </TooltipContent>
  </Tooltip>
);

export default Pagination;
