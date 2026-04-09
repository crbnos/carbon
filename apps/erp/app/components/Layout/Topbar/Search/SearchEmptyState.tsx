import { Skeleton } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { motion } from "framer-motion";
import { LuSearch } from "react-icons/lu";
import type { SearchEmptyStateProps } from "./types";

export function SearchEmptyState({ type, query }: SearchEmptyStateProps) {
  const { t } = useLingui();

  if (type === "loading") {
    return (
      <div className="px-3 py-2 space-y-2">
        {[1, 2, 3].map((i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: i * 0.05 }}
            className="flex items-center gap-3 px-3 py-3"
          >
            <Skeleton className="w-9 h-9 rounded-lg flex-shrink-0" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          </motion.div>
        ))}
      </div>
    );
  }

  if (type === "no-results") {
    return (
      <motion.div
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col items-center justify-center py-12 px-4 text-center"
      >
        <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-4">
          <LuSearch className="w-6 h-6 text-muted-foreground" />
        </div>
        <p className="text-sm font-medium text-foreground mb-1">
          <Trans>No results found</Trans>
        </p>
        <p className="text-sm text-muted-foreground">
          {t`No matches for "${query}". Try a different search term.`}
        </p>
      </motion.div>
    );
  }

  // Initial state - shown before user starts typing
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex flex-col items-center justify-center py-12 px-4 text-center"
    >
      <p className="text-sm text-muted-foreground">
        <Trans>Type to search across your workspace</Trans>
      </p>
    </motion.div>
  );
}
