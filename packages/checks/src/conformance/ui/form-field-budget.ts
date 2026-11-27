// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { defineCheck } from "../../check";
import { typescript } from "../../sources/inputs";
import { lineOf } from "../../sources/text";

// A form that asks for everything on one screen overloads the user: the
// project contract's Add Line had 17 fields in one three-column grid, with
// holes where hidden fields had been (Brad, 2026-10-23). The carbon-design
// forms guide (`references/forms.md` §4a) sets the budget: flat up to ~8
// fields, titled groups to ~14, steps beyond. This check counts the named
// fields a form file renders and flags one over the budget that has no
// groups, folds or steps. It reads the file, not the screen: fields behind a
// condition count too, so it nudges rather than measures.
export const formFieldBudget = defineCheck({
  files: typescript,
  id: "form-field-budget",
  description:
    "a form with more than 14 fields groups them (FormGroup / FormFold) or steps them (FormStep*)",
  provenance: {
    deprecates: "a long flat form grid",
    replacedBy: "FormGroup, FormFold and FormStep* from ~/components/Form",
    since: "2026-10-23"
  },
  rule() {
    // The budget the description states.
    const budget = 14;
    const appUi = /^apps\/(?:erp|mes)\/app\/.*\.tsx$/;
    const validatedForm = /<ValidatedForm\b/;
    // A field is a JSX element with a literal `name` prop; `Hidden` posts a value
    // the user never sees.
    const field = /<([A-Z][A-Za-z0-9.]*)\b[^<>]*?\bname="[^"]+"/g;
    // The grouping pieces of `~/components/Form` (FormLayout), the setup
    // wizard's sections and the older heavy subheading.
    const grouped =
      /<(?:FormGroup|FormFold|FormStepPanel|FormSection|SetupSection)\b|<Subheading[^>]*variant="heavy"/;

    return (file, contents) => {
      if (!appUi.test(file)) return [];
      // A Properties panel is a column of autosaving fields, one form each,
      // not one long form.
      if (/Properties(?:\.ee)?\.tsx$/.test(file)) return [];
      const form = validatedForm.exec(contents);
      if (!form) return [];
      if (grouped.test(contents)) return [];
      let fields = 0;
      for (const match of contents.matchAll(field)) {
        if (match[1] !== "Hidden") fields += 1;
      }
      if (fields <= budget) return [];
      return [
        {
          file,
          line: lineOf(contents, form.index),
          // One key per file: an old form stays baselined as it changes.
          snippet: "<ValidatedForm>",
          message: `This form renders ${fields} fields in one grid (budget ${budget}). Group them with FormGroup / FormFold, or step them with FormStepBar / FormStepPanel / FormStepButtons (carbon-design forms.md §4a)`
        }
      ];
    };
  }
});
