import { components } from "zbsearch";

// zbsearch's English (Porter) stemmer, limited to inflections: plural, -ed, -ing
// (with a doubled consonant, "scrapping" -> "scrap") and a trailing -e. Porter's
// derivational steps over-stem for us: "customer" -> "custom" met custom fields,
// "shipment" -> "ship" and "operations" -> "oper" pulled in unrelated pages.
const porter = components.tokenizer.createTokenizer({
  language: "english",
  stemming: true
});
const INFLECTION = /^(?:e|e?s|[a-z]?(?:ed|ing))$/;

/** "orders" -> "order", "scrapping" -> "scrap"; any other word comes back unchanged. */
export function stemInflection(word: string): string {
  const [stem] = porter.tokenize(word, "english");
  if (!stem || !word.startsWith(stem)) return word;
  return INFLECTION.test(word.slice(stem.length)) ? stem : word;
}
