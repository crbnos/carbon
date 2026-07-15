import type { MessageDescriptor } from "@lingui/core";
import type { ReactNode } from "react";

export type Handle = {
  breadcrumb?: any;
  to?: string;
  module?: string;
};

// A breadcrumb label may be plain text/markup or a Lingui MessageDescriptor
// (produced by `msg\`...\``); the renderer resolves descriptors via i18n.
export type BreadcrumbValue = ReactNode | MessageDescriptor;

export type BreadcrumbSegment = {
  breadcrumb: BreadcrumbValue;
  to?: string;
};

// Detail-page breadcrumb: the list link followed by the current entity's
// readable id. `getEntity` reads the entity's readable identifier from this
// route's loader data; when it is missing (still loading), only the list link
// is shown. `breadcrumb` in `list` may be a string or a Lingui MessageDescriptor.
export function detailBreadcrumb(
  list: { breadcrumb: BreadcrumbValue; to: string },
  getEntity: (data: any) => BreadcrumbValue | undefined
) {
  return (_params: unknown, data: unknown): BreadcrumbSegment[] => {
    const entity = data ? getEntity(data) : undefined;
    return entity ? [list, { breadcrumb: entity }] : [list];
  };
}
