import type { IconType } from "react-icons";
import type { SearchResult } from "~/routes/api+/search";
import type { Route } from "~/types";

export type { SearchResult };

export type RecentSearch = Route & {
  entityType?: string;
  module?: string;
};

export type EntityType =
  | "item"
  | "job"
  | "salesOrder"
  | "purchaseOrder"
  | "customer"
  | "supplier"
  | "quote"
  | "salesRfq"
  | "supplierQuote"
  | "salesInvoice"
  | "purchaseInvoice"
  | "employee"
  | "issue"
  | "gauge";

export type EntityTypeFilter = "all" | EntityType;

export interface EntityTypeConfig {
  value: EntityTypeFilter;
  label: string;
  icon: IconType | null;
  bgColor: string;
  textColor: string;
}

export interface SearchResultItemProps {
  result: SearchResult;
  onSelect: () => void;
  searchQuery?: string;
}

export interface RecentSearchItemProps {
  result: RecentSearch;
  onSelect: () => void;
  onRemove: () => void;
  icon?: IconType;
}

export interface ModuleItemProps {
  name: string;
  to: string;
  icon?: IconType;
  onSelect: () => void;
}

export interface SearchFilterChipsProps {
  selectedFilter: EntityTypeFilter;
  onFilterChange: (filter: EntityTypeFilter) => void;
}

export interface SearchEmptyStateProps {
  type: "loading" | "no-results" | "initial";
  query?: string;
}
