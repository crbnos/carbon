import { Text, View } from "@react-pdf/renderer";
import type { TermsBlock as TermsBlockType } from "../../template";
import { Note } from "../components";
import { hasContent, resolveTerms } from "./resolveTerms";
import { useTw } from "./tw";
import type { SalesInvoiceData } from "./types";

export function TermsBlock({
  block,
  data
}: {
  block: TermsBlockType;
  data: SalesInvoiceData;
}) {
  const tw = useTw();
  const { theme, vars } = data;
  const terms = resolveTerms(block, data.terms, vars);
  if (!hasContent(terms)) return null;

  return (
    <View break>
      <View style={tw("border-b border-gray-400 mb-3 pb-2 mt-2")}>
        <Text
          style={[
            tw("text-[14px] font-bold uppercase tracking-wide"),
            { color: theme.accent }
          ]}
        >
          Terms & Conditions
        </Text>
      </View>
      <Note content={terms!} />
    </View>
  );
}
