// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Font, renderToBuffer, Text } from "@react-pdf/renderer";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { documentSettingsSchema } from "../template/schema";
import Template from "./components/Template";
import { BUILT_IN_FONTS, getSafeFontFamily } from "./fonts";

// Letters outside the "latin" subset that real addresses carry: Polish,
// Czech, Hungarian, Romanian, Turkish. "Przemyśl" printed as "Przemy[".
const CENTRAL_EUROPEAN = "śłąęźżćńőűčřšžďťğışț";

const BODY_FONTS =
  documentSettingsSchema.shape.fontFamily.removeDefault().options;

function loadFaces(stack: string[], fontWeight: number) {
  return Promise.all(
    stack
      .filter((family) => !BUILT_IN_FONTS.includes(family))
      .map(async (fontFamily) => {
        const font = Font.getFont({ fontFamily, fontWeight });
        await font.load();
        if (!font.data) throw new Error(`${fontFamily} did not load`);
        return font.data;
      })
  );
}

async function drawsEveryLetter(stack: string[], fontWeight: number) {
  const faces = await loadFaces(stack, fontWeight);
  return [...CENTRAL_EUROPEAN].filter(
    (letter) =>
      !faces.some((face) => face.hasGlyphForCodePoint(letter.codePointAt(0)))
  );
}

describe("getSafeFontFamily", () => {
  it.each(BODY_FONTS)("%s draws Central European letters", async (family) => {
    const stack = getSafeFontFamily(family);
    expect(stack[0]).toBe(family);
    expect(await drawsEveryLetter(stack, 400)).toEqual([]);
    expect(await drawsEveryLetter(stack, 700)).toEqual([]);
  });

  // pdfkit reuses an embedded font by PostScript name, so two faces sharing one
  // draw the second face's glyph ids from the first: the wrong letters.
  it.each(BODY_FONTS)(
    "%s stacks faces with distinct PostScript names",
    async (family) => {
      const faces = await loadFaces(getSafeFontFamily(family), 400);
      const names = faces.map((face) => face.postscriptName);
      expect(new Set(names).size).toBe(names.length);
    }
  );

  it("falls back to Helvetica for an unregistered family", () => {
    expect(getSafeFontFamily("Comic Sans")[0]).toBe("Helvetica");
  });

  it("renders a document with Central European text", async () => {
    const pdf = await renderToBuffer(
      createElement(
        Template,
        { title: "Invoice", meta: {} as never, fontFamily: "Inter" },
        createElement(Text, null, `Przemyśl ${CENTRAL_EUROPEAN}`)
      ) as never
    );
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
  });
});
