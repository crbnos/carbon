// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Text } from "@react-pdf/renderer";
import type { AddressKey, TextFn } from "../../template";
import { useTw } from "./tw";

/** One text per line, left out when it has nothing to print. */
export function useTextRows<K extends string>(t: TextFn<K>) {
  const tw = useTw();
  return {
    row: (key: K) => (t.prints(key) ? <Text>{t(key)}</Text> : null),
    boldRow: (key: K) =>
      t.prints(key) ? <Text style={tw("font-bold")}>{t(key)}</Text> : null
  };
}

/** A party's address, its name in bold. */
export function AddressRows<P extends string>({
  t,
  prefix
}: {
  t: TextFn<AddressKey<P>>;
  prefix: P;
}) {
  const { row, boldRow } = useTextRows(t);
  return (
    <>
      {boldRow(`${prefix}Name`)}
      {row(`${prefix}AddressLine1`)}
      {row(`${prefix}AddressLine2`)}
      {row(`${prefix}City`)}
      {row(`${prefix}StatePostal`)}
      {row(`${prefix}Country`)}
    </>
  );
}
