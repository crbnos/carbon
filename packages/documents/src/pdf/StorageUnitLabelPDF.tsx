// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { LabelSize } from "@carbon/utils";
import { Document, Page, Text, View } from "@react-pdf/renderer";
import type { StorageUnitLabelItem } from "../zpl/StorageUnitLabelZPL";
import { getLabelPdfGeometry } from "./components/labelGeometry";

interface StorageUnitLabelProps {
  items: StorageUnitLabelItem[];
  labelSize: LabelSize;
}

/**
 * Renders one page per storage unit, each page exactly the label size,
 * matching the ZPL generator: the unit name vertically centered at the
 * left margin.
 */
const StorageUnitLabelPDF = ({ items, labelSize }: StorageUnitLabelProps) => {
  const g = getLabelPdfGeometry(labelSize);
  const titleFontSize = (40 / 25) * g.titleFontSize;

  return (
    <Document>
      {items.map((item) => (
        <Page key={item.id} size={[g.pageWidth, g.pageHeight]}>
          <View
            style={{
              flex: 1,
              justifyContent: "center",
              paddingLeft: g.margin,
              paddingRight: g.margin
            }}
          >
            <Text
              style={{
                fontSize: titleFontSize,
                fontFamily: "Helvetica-Bold"
              }}
            >
              {item.name}
            </Text>
          </View>
        </Page>
      ))}
    </Document>
  );
};

export default StorageUnitLabelPDF;
