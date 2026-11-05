// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Text, View } from "@react-pdf/renderer";
import type { TermsBlock as TermsBlockType } from "../../../template";
import { Note } from "../../components";
import { hasContent, resolveTerms } from "../resolveTerms";
import { useTw } from "../tw";
import type { PurchasingRfqData } from "./types";

export function TermsBlock({
  block,
  data
}: {
  block: TermsBlockType;
  data: PurchasingRfqData;
}) {
  const tw = useTw();
  const { theme, vars } = data;
  const terms = resolveTerms(block, data.terms, vars);
  if (!hasContent(terms)) return null;

  return (
    <View>
      <Text
        style={[tw("text-[16px] font-bold mt-2 mb-3"), { color: theme.accent }]}
      >
        Terms and Conditions
      </Text>
      <Note content={terms!} />
    </View>
  );
}
