// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type {
  MutableRefObject,
  ReactElement,
  ReactNode,
  RefCallback
} from "react";
import { Children, isValidElement } from "react";

/**
 * Gets only the valid children of a component,
 * and ignores any nullish or falsy child.
 *
 * @param children the children
 */
export function getValidChildren(children: ReactNode) {
  return Children.toArray(children).filter((child) =>
    isValidElement(child)
  ) as ReactElement[];
}

export const reactNodeToString = function (reactNode: ReactNode): string {
  let string = "";

  if (typeof reactNode === "string") {
    string = reactNode;
  } else if (typeof reactNode === "number") {
    string = reactNode.toString();
  } else if (reactNode instanceof Array) {
    reactNode.forEach(function (child) {
      string += reactNodeToString(child);
    });
  } else if (isValidElement(reactNode)) {
    if (reactNode.props.value) {
      // for Enumerable component
      string += reactNode.props.value;
    } else if (reactNode.props.status) {
      // for Status components
      string += reactNode.props.status;
    } else {
      string += reactNodeToString(reactNode.props.children);
    }
  }

  return string;
};

export type Merge<T, P> = P & Omit<T, keyof P>;

export type MaybeRenderProp<P> = ReactNode | ((props: P) => ReactNode);

export type ReactRef<T> = RefCallback<T> | MutableRefObject<T>;

export function assignRef<T = any>(
  ref: ReactRef<T> | null | undefined,
  value: T
) {
  if (ref == null) return;

  if (typeof ref === "function") {
    ref(value);
    return;
  }

  try {
    ref.current = value;
    // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
  } catch (error) {
    throw new Error(`Cannot assign value '${value}' to ref '${ref}'`);
  }
}

export function mergeRefs<T>(...refs: (ReactRef<T> | null | undefined)[]) {
  return (node: T | null) => {
    refs.forEach((ref) => {
      assignRef(ref, node);
    });
  };
}
