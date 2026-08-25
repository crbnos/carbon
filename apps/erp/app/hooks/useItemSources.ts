import { OnshapeLogo } from "@carbon/ee";
import type { ComponentType, SVGProps } from "react";
import { useMemo } from "react";
import { useIntegrations } from "./useIntegrations";

/**
 * An integration a Carbon item can be CREATED FROM — a CAD or PDM system that
 * owns the model and the part number, and hands both to Carbon.
 *
 * Not every CAD-category integration belongs here. The test is whether the
 * integration can seed a new item, not whether it touches geometry: one that
 * only attaches assets to items that already exist has nothing to offer a
 * blank form.
 */
export type ItemSource = {
  id: string;
  name: string;
  /**
   * The provider's own wordmark, rendered as the entire button. It carries the
   * brand better than the brand's name set in Carbon's type, which is why the
   * picker shows no text beside it — so this must be the WORDMARK (name
   * included), never a bare glyph.
   */
  Wordmark: ComponentType<SVGProps<SVGSVGElement>>;
};

/**
 * The registry. A future PDM joins by adding a row here and a picker the form
 * renders for its id — the label, the layout and the hide-when-none rule below
 * are already shared.
 */
const ITEM_SOURCES: ItemSource[] = [
  { id: "onshape", name: "Onshape", Wordmark: OnshapeLogo }
];

/**
 * The item sources this company has connected, in registry order.
 *
 * Presentation only. Every source's own routes re-read their settings
 * server-side and refuse when the integration is not connected, so an empty
 * list hiding the picker is never what keeps a source off a company that never
 * connected one.
 */
export function useItemSources(): ItemSource[] {
  const integrations = useIntegrations();
  const { has } = integrations;

  return useMemo(() => ITEM_SOURCES.filter((source) => has(source.id)), [has]);
}
