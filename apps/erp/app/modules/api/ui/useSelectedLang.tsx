import { useParams } from "@remix-run/react";

export type ValidLang = "js" | "bash";

export function useSelectedLang(): ValidLang {
  const { lang } = useParams();
  if (isValidLang(lang)) {
    return lang;
  } else {
    return "js";
  }
}

// write a typescript is function that verifies the lang is valid
function isValidLang(lang: unknown): lang is ValidLang {
  return lang === "js" || lang === "bash";
}
