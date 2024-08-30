import { useUrlParams } from "~/hooks";

export function useSort() {
  const [params, setParams] = useUrlParams();
  const sorts = params.getAll("sort");

  const isSorted = (columnId: string): -1 | null | 1 => {
    if (sorts.includes(`${columnId}:asc`)) return 1;
    if (sorts.includes(`${columnId}:desc`)) return -1;
    return null;
  };

  const reorderSorts = (newOrder: string[]) => {
    setParams({ sort: newOrder });
  };

  const removeSortBy = (sort: string) => {
    setParams({ sort: sorts.filter((s) => s !== sort) });
  };

  const toggleSortByAscending = (columnId: string) => {
    const existingSort = [...sorts];
    const sortAsc = `${columnId}:asc`;
    const sortDesc = `${columnId}:desc`;

    if (!existingSort.includes(sortAsc)) {
      setParams({
        sort: existingSort.filter((s) => s !== sortDesc).concat(sortAsc),
      });
    } else {
      setParams({
        sort: existingSort.filter((s) => s !== sortAsc),
      });
    }
  };

  const toggleSortByDescending = (columnId: string) => {
    const existingSort = [...sorts];
    const sortAsc = `${columnId}:asc`;
    const sortDesc = `${columnId}:desc`;

    if (!existingSort.includes(sortDesc)) {
      setParams({
        sort: existingSort.filter((s) => s !== sortAsc).concat(sortDesc),
      });
    } else {
      setParams({
        sort: existingSort.filter((s) => s !== sortDesc),
      });
    }
  };

  const toggleSortBy = (columnId: string) => {
    const existingSort = [...sorts];
    const sortAsc = `${columnId}:asc`;
    const sortDesc = `${columnId}:desc`;

    if (existingSort.includes(sortAsc)) {
      setParams({
        sort: existingSort.filter((s) => s !== sortAsc).concat(sortDesc),
      });
    } else if (existingSort.includes(sortDesc)) {
      setParams({ sort: existingSort.filter((s) => s !== sortDesc) });
    } else {
      setParams({ sort: existingSort.concat(sortAsc) });
    }
  };

  const toggleSortByDirection = (columnId: string) => {
    const existingSort = [...sorts];
    const sortAsc = `${columnId}:asc`;
    const sortDesc = `${columnId}:desc`;

    if (existingSort.includes(sortAsc)) {
      setParams({
        sort: existingSort.map((s) => (s === sortAsc ? sortDesc : s)),
      });
    } else if (existingSort.includes(sortDesc)) {
      setParams({
        sort: existingSort.map((s) => (s === sortDesc ? sortAsc : s)),
      });
    }
  };

  return {
    sorts,
    isSorted,
    reorderSorts,
    removeSortBy,
    toggleSortBy,
    toggleSortByAscending,
    toggleSortByDirection,
    toggleSortByDescending,
  };
}
