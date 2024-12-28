import { parseNumberFromUrlParam } from "@carbon/auth";
import type { RowSelectionState } from "@tanstack/react-table";
import type { Dispatch, SetStateAction } from "react";
import { flushSync } from "react-dom";
import { useUrlParams } from "~/hooks";

export function usePagination(
  count: number,
  setRowSelections: Dispatch<SetStateAction<RowSelectionState>>
) {
  const [params, setParams] = useUrlParams();
  const pageSize = parseNumberFromUrlParam(params, "limit", 100);
  const offset = parseNumberFromUrlParam(params, "offset", 0);

  const pageIndex = Math.floor(offset / pageSize) + 1;
  const pageCount = Math.ceil(count / pageSize);
  const canPreviousPage = pageIndex > 1;
  const canNextPage = pageIndex < Math.ceil(count / pageSize);

  const gotoPage = (page: number) => {
    flushSync(() => {
      setRowSelections({});
      setParams({
        ...Object.fromEntries(params),
        offset: (page - 1) * pageSize,
        limit: pageSize,
      });
    });

    window?.scrollTo({ top: 0, behavior: "smooth" });
  };

  const previousPage = () => {
    gotoPage(pageIndex - 1);
  };

  const nextPage = () => {
    gotoPage(pageIndex + 1);
  };

  const setPageSize = (pageSize: number) => {
    setParams({
      offset: 0,
      limit: pageSize,
    });
  };

  return {
    count,
    offset,
    pageIndex,
    pageCount,
    pageSize,
    canPreviousPage,
    canNextPage,
    gotoPage,
    nextPage,
    previousPage,
    setPageSize,
  };
}
