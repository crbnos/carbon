// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useDebounce } from "@carbon/react";
import idb from "localforage";
import { useCallback, useEffect, useState } from "react";
import { useFetcher, useNavigate } from "react-router";
import type { SearchResponse } from "~/routes/api+/search";
import type { RecentSearch, SearchResult } from "./types";

interface UseSearchOptions {
  companyId: string;
  onClose: () => void;
}

interface UseSearchReturn {
  input: string;
  setInput: (value: string) => void;
  isLoading: boolean;
  isDebouncing: boolean;
  searchResults: SearchResult[];
  recentSearches: RecentSearch[];
  onSelect: (
    route: { to: string; name: string },
    entityType?: string,
    module?: string
  ) => void;
  removeRecentSearch: (path: string) => void;
  resetInput: () => void;
}

export function useSearch({
  companyId,
  onClose
}: UseSearchOptions): UseSearchReturn {
  const navigate = useNavigate();
  const fetcher = useFetcher<SearchResponse>();
  const storageKey = `recentSearches_${companyId}`;

  const [input, setInputState] = useState("");
  const [isDebouncing, setIsDebouncing] = useState(false);
  const [recentSearches, setRecentSearches] = useState<RecentSearch[]>([]);

  const debounceSearch = useDebounce((q: string) => {
    if (q && q.length >= 2) {
      fetcher.load(`/api/search?q=${encodeURIComponent(q)}`);
    }
    setIsDebouncing(false);
  }, 500);

  // Load recent searches from IndexedDB
  useEffect(() => {
    const loadRecentSearches = async () => {
      const stored = await idb.getItem<RecentSearch[]>(storageKey);
      if (stored) {
        setRecentSearches(stored);
      } else {
        setRecentSearches([]);
      }
    };
    loadRecentSearches();
  }, [storageKey]);

  // Handle input changes with debounced search
  const setInput = useCallback(
    (value: string) => {
      setInputState(value);
      if (value && value.length >= 2) {
        setIsDebouncing(true);
        debounceSearch(value);
      }
    },
    [debounceSearch]
  );

  // Reset input without triggering search
  const resetInput = useCallback(() => {
    setInputState("");
  }, []);

  // Select a result and save to recent searches
  const onSelect = useCallback(
    async (
      route: { to: string; name: string },
      entityType?: string,
      module?: string
    ) => {
      navigate(route.to);
      onClose();

      const newRecent: RecentSearch = {
        to: route.to,
        name: route.name,
        entityType,
        module
      };

      const existingRecent =
        (await idb.getItem<RecentSearch[]>(storageKey)) ?? [];
      const filtered = existingRecent.filter((item) => item.to !== route.to);
      const updated = [newRecent, ...filtered].slice(0, 5);

      setRecentSearches(updated);
      await idb.setItem(storageKey, updated);
    },
    [navigate, onClose, storageKey]
  );

  // Remove a recent search
  const removeRecentSearch = useCallback(
    async (path: string) => {
      const existingRecent =
        (await idb.getItem<RecentSearch[]>(storageKey)) ?? [];
      const updated = existingRecent.filter((item) => item.to !== path);

      setRecentSearches(updated);
      await idb.setItem(storageKey, updated);
    },
    [storageKey]
  );

  // Filter out recent searches from API results
  const recentPaths = new Set(recentSearches.map((r) => r.to));
  const searchResults = (fetcher.data?.results ?? []).filter(
    (r) => !recentPaths.has(r.link)
  );

  const isLoading = fetcher.state === "loading";

  return {
    input,
    setInput,
    isLoading,
    isDebouncing,
    searchResults,
    recentSearches,
    onSelect,
    removeRecentSearch,
    resetInput
  };
}
