import { siGo, siPhp, siPython, siRuby, siSharp, siTypescript } from "simple-icons";
import { Brand, type SdkCard } from "./sdk-cards";

/* The generator languages, shared by the Client SDKs page (where each card jumps
 * to its own section) and the API overview (where the same cards send a reader
 * to that page). One list, so an edit to a description — or dropping a language,
 * as Java was — can never leave the two surfaces disagreeing.
 *
 * Each card carries its ANCHOR, not a href: `sdkLanguageCards()` leaves it a bare
 * fragment for the SDKs page's own cards and prefixes the path everywhere else,
 * so linking from a second page can't quietly turn the on-page jumps into
 * cross-document navigations. */
type SdkLanguage = Omit<SdkCard, "href"> & { anchor: string };

const SDK_LANGUAGES: SdkLanguage[] = [
  {
    glyph: <Brand path={siTypescript.path} />,
    tone: "bg-[#E8F0FB] text-[#3178C6]",
    name: "TypeScript",
    desc: "A fully typed client from @hey-api/openapi-ts — request and response types included.",
    anchor: "typescript",
    cta: "Generate"
  },
  {
    glyph: <Brand path={siPython.path} />,
    tone: "bg-[#EAF1F8] text-[#3776AB]",
    name: "Python",
    desc: "A modern typed client with openapi-python-client — attrs models and httpx under the hood.",
    anchor: "python",
    cta: "Generate"
  },
  {
    glyph: <Brand path={siGo.path} />,
    tone: "bg-[#E5F4F9] text-[#00ADD8]",
    name: "Go",
    desc: "A typed client from oapi-codegen — pure Go, no Java runtime needed.",
    anchor: "go",
    cta: "Generate"
  },
  {
    glyph: <Brand path={siRuby.path} />,
    tone: "bg-ed-red-bg text-[#CC342D]",
    name: "Ruby",
    desc: "A client from openapi-generator — its Docker image needs no Java install (-g ruby).",
    anchor: "any-language",
    cta: "Generate"
  },
  {
    glyph: <Brand path={siSharp.path} />,
    tone: "bg-[#EEEAF6] text-[#512BD4]",
    name: "C#",
    desc: "A client from openapi-generator — its Docker image needs no Java install (-g csharp).",
    anchor: "any-language",
    cta: "Generate"
  },
  {
    glyph: <Brand path={siPhp.path} />,
    tone: "bg-[#EBECF3] text-[#777BB4]",
    name: "PHP",
    desc: "A client from openapi-generator — its Docker image needs no Java install (-g php).",
    anchor: "any-language",
    cta: "Generate"
  }
];

/** `base` is the path to prefix — omit it on the Client SDKs page itself. */
export function sdkLanguageCards(base = ""): SdkCard[] {
  return SDK_LANGUAGES.map(({ anchor, ...card }) => ({
    ...card,
    href: `${base}#${anchor}`
  }));
}
