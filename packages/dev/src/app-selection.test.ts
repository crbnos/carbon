import { parseArgs } from "citty";
import { describe, expect, it } from "vitest";
import { parseAppIds, resolveAppSelection } from "./app-selection.js";

describe("parseAppIds", () => {
  it("accepts a single id", () => {
    expect(parseAppIds("erp")).toEqual(["erp"]);
  });

  it("accepts a comma-separated list", () => {
    expect(parseAppIds("erp,mes")).toEqual(["erp", "mes"]);
  });

  it("accepts a repeated flag (citty hands over an array)", () => {
    expect(parseAppIds(["erp", "mes"])).toEqual(["erp", "mes"]);
  });

  it("accepts repetition and commas together", () => {
    expect(parseAppIds(["erp,mes", "email"])).toEqual(["erp", "mes", "email"]);
  });

  it("trims whitespace and lowercases", () => {
    expect(parseAppIds(" ERP , Mes ")).toEqual(["erp", "mes"]);
  });

  it("dedupes, preserving the requested order", () => {
    expect(parseAppIds("mes,erp,mes")).toEqual(["mes", "erp"]);
  });

  it("rejects an unknown id, naming the valid ones", () => {
    expect(() => parseAppIds("erp,web")).toThrow(/Unknown app for --app: web/);
    expect(() => parseAppIds("erp,web")).toThrow(/erp, mes, assembler, email/);
  });

  it("lists every unknown id at once", () => {
    expect(() => parseAppIds("web,api")).toThrow(
      /Unknown apps for --app: web, api/
    );
  });

  it("rejects an empty value, pointing at --no-apps", () => {
    // `--app` with no value: mri yields "" for a declared string flag.
    expect(() => parseAppIds("")).toThrow(/--app needs at least one app id/);
    expect(() => parseAppIds(" , ")).toThrow(/--no-apps/);
  });
});

describe("resolveAppSelection", () => {
  it("falls through to the picker when no app flag is given", () => {
    expect(resolveAppSelection({ apps: true, all: false })).toEqual({
      kind: "prompt"
    });
  });

  it("returns the named apps for --app", () => {
    expect(resolveAppSelection({ apps: true, all: false, app: "erp" })).toEqual(
      {
        kind: "explicit",
        apps: ["erp"]
      }
    );
  });

  it("returns `all` for --all", () => {
    expect(resolveAppSelection({ apps: true, all: true })).toEqual({
      kind: "all"
    });
  });

  it("returns `none` for --no-apps", () => {
    expect(resolveAppSelection({ apps: false, all: false })).toEqual({
      kind: "none"
    });
  });

  it("rejects --app with --no-apps", () => {
    expect(() =>
      resolveAppSelection({ apps: false, all: false, app: "erp" })
    ).toThrow(/--app and --no-apps contradict/);
  });

  it("rejects --app with --all", () => {
    expect(() =>
      resolveAppSelection({ apps: true, all: true, app: "erp" })
    ).toThrow(/--app and --all contradict/);
  });

  it("rejects --all with --no-apps", () => {
    expect(() => resolveAppSelection({ apps: false, all: true })).toThrow(
      /--all and --no-apps contradict/
    );
  });

  it("reports the contradiction before the app ids are validated", () => {
    // Order matters: a user who passed both flags should be told that, not sent
    // to fix an id in a flag they are about to drop.
    expect(() =>
      resolveAppSelection({ apps: false, all: false, app: "nope" })
    ).toThrow(/--app and --no-apps contradict/);
  });

  it("defaults to the picker when the caller passes no flags at all", () => {
    // `crbn reset` re-enters `up()` this way.
    expect(resolveAppSelection({})).toEqual({ kind: "prompt" });
  });
});

// The `--app` design rests on citty handing repeated string flags over as an
// array (mri concatenates them). Pin that here rather than in a comment: it is
// the single assumption the flag would silently break on if citty changed.
describe("citty wiring", () => {
  // Mirrors the `up` args in main.ts, plus one flag from each orthogonal group
  // so a conflict between them would show up as a parse difference.
  const argsDef = {
    apps: { type: "boolean", default: true },
    app: { type: "string" },
    all: { type: "boolean", default: false },
    borrow: { type: "boolean", default: false },
    run: { type: "string" }
  } as const;

  const select = (argv: string[]) => {
    // biome-ignore lint/suspicious/noExplicitAny: citty's arg types are loose
    const parsed = parseArgs(argv, argsDef as any);
    return resolveAppSelection({
      apps: parsed.apps !== false,
      all: parsed.all === true,
      app: parsed.app as string | string[] | undefined
    });
  };

  it("parses a repeated flag", () => {
    expect(select(["--app", "erp", "--app", "mes"])).toEqual({
      kind: "explicit",
      apps: ["erp", "mes"]
    });
  });

  it("parses --app=value form", () => {
    expect(select(["--app=erp", "--app=assembler"])).toEqual({
      kind: "explicit",
      apps: ["erp", "assembler"]
    });
  });

  it("parses a comma list", () => {
    expect(select(["--app", "erp,mes"])).toEqual({
      kind: "explicit",
      apps: ["erp", "mes"]
    });
  });

  it("treats a valueless --app as empty, not as a boolean", () => {
    expect(() => select(["--app"])).toThrow(/at least one app id/);
  });

  it("composes with the orthogonal flags without disturbing them", () => {
    // biome-ignore lint/suspicious/noExplicitAny: citty's arg types are loose
    const parsed = parseArgs(
      ["--app", "mes", "--borrow", "--run", "pnpm test"],
      argsDef as any
    );
    expect(parsed.borrow).toBe(true);
    expect(parsed.run).toBe("pnpm test");
    expect(select(["--app", "mes", "--borrow", "--run", "pnpm test"])).toEqual({
      kind: "explicit",
      apps: ["mes"]
    });
  });

  it("leaves --all and --no-apps behaving as before", () => {
    expect(select(["--all"])).toEqual({ kind: "all" });
    expect(select(["--no-apps"])).toEqual({ kind: "none" });
    expect(select([])).toEqual({ kind: "prompt" });
  });
});
