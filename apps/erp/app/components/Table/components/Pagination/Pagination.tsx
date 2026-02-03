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
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  useKeyboardShortcuts,
  usePrettifyShortcut
} from "@carbon/react";
import { useCallback, useRef } from "react";
import { BsChevronLeft, BsChevronRight } from "react-icons/bs";

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

  const pageSizes = [20, 100, 500, 1000];
  if (!pageSizes.includes(pageSize)) {
    pageSizes.push(pageSize);
    pageSizes.sort();
  }

  return (
    <>
      <hr className="m-0 h-px w-full border-none bg-gradient-to-r from-zinc-200/0 via-zinc-500/30 to-zinc-200/0" />
      <HStack
        className="text-center bg-card justify-between py-4 w-full z-[1] px-4"
        spacing={6}
      >
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="secondary">{pageSize} rows</Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-48">
            <DropdownMenuLabel>Results per page</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuRadioGroup value={`${pageSize}`}>
              {pageSizes.map((size) => (
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
  const nextButtonRef = useRef<HTMLButtonElement>(null);
  const previousButtonRef = useRef<HTMLButtonElement>(null);
  const prettifyShortcut = usePrettifyShortcut();

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

  useKeyboardShortcuts({
    ArrowRight: (event: KeyboardEvent) => {
      event.stopPropagation();
      nextButtonRef.current?.click();
    },
    ArrowLeft: (event: KeyboardEvent) => {
      event.stopPropagation();
      previousButtonRef.current?.click();
    }
  });

  return (
    <>
      {condensed ? (
        <>
          <Tooltip>
            <TooltipTrigger>
              <IconButton
                aria-label="Previous"
                icon={<BsChevronLeft />}
                isDisabled={!canPreviousPage}
                onClick={handlePreviousPage}
                variant="secondary"
              />
            </TooltipTrigger>
            <TooltipContent>
              <HStack>{prettifyShortcut("ArrowLeft")}</HStack>
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger>
              <IconButton
                aria-label="Next"
                icon={<BsChevronRight />}
                isDisabled={!canNextPage}
                onClick={handleNextPage}
                variant="secondary"
              />
            </TooltipTrigger>
            <TooltipContent>
              <HStack>{prettifyShortcut("ArrowRight")}</HStack>
            </TooltipContent>
          </Tooltip>
        </>
      ) : (
        <>
          <div className="text-foreground text-sm font-medium align-center hidden lg:flex">
            {count > 0 ? offset + 1 : 0} - {Math.min(offset + pageSize, count)}{" "}
            of {count}
          </div>
          <Tooltip>
            <TooltipTrigger>
              <Button
                ref={previousButtonRef}
                variant="secondary"
                isDisabled={!canPreviousPage}
                onClick={handlePreviousPage}
                leftIcon={<BsChevronLeft />}
              >
                Previous
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <HStack>{prettifyShortcut("ArrowLeft")}</HStack>
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger>
              <Button
                ref={nextButtonRef}
                variant="secondary"
                isDisabled={!canNextPage}
                onClick={handleNextPage}
                rightIcon={<BsChevronRight />}
              >
                Next
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <HStack>{prettifyShortcut("ArrowRight")}</HStack>
            </TooltipContent>
          </Tooltip>
        </>
      )}
    </>
  );
};

export default Pagination;
