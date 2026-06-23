import type { ComponentType } from "react";
import { CSVLink as BaseCSVLink } from "react-csv";

// `@types/react-csv` types CSVLink as a class whose `React.Component` signature is
// incompatible with the current React types under tsgo ("Property 'refs' is missing
// in type Component<LinkProps>" → TS2786). Re-export it cast to a plain component
// type so it's usable as JSX. Props stay loose — callers already pass the right shape.
export const CSVLink = BaseCSVLink as unknown as ComponentType<
  Record<string, unknown>
>;
