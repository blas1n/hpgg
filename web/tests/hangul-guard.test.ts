import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";
import ts from "typescript";

// #10: every UI string lives in the message tables (src/i18n/ko.ts, src/i18n/en.ts). A Korean string anywhere else in
// app/ or src/ would show Korean on the English pages. Comments may be in any language: only code is scanned, through
// the TypeScript parser (string and template literals, JSX text, regular expressions).

const HANGUL = /[ᄀ-ᇿ㄰-㆏가-힣]/;
const web = join(dirname(fileURLToPath(import.meta.url)), "..");
/** The message tables. Korean text belongs in ko.ts only; tests/i18n.test.ts checks en.ts has none. */
const TABLES = new Set(["src/i18n/ko.ts", "src/i18n/en.ts"]);

export function hangulInCode(source: string, fileName: string): string[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: string[] = [];
  const visit = (n: ts.Node) => {
    if (
      ts.isStringLiteral(n) ||
      ts.isNoSubstitutionTemplateLiteral(n) ||
      ts.isTemplateHead(n) ||
      ts.isTemplateMiddle(n) ||
      ts.isTemplateTail(n) ||
      ts.isJsxText(n) ||
      ts.isRegularExpressionLiteral(n)
    ) {
      const text = n.getText(sf);
      if (HANGUL.test(text)) out.push(`${fileName}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}: ${text.trim().slice(0, 60)}`);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : /\.(ts|tsx)$/.test(e.name) ? [join(dir, e.name)] : []));

describe("no hard-coded Hangul outside the message table", () => {
  it("control: the scanner flags Korean in JSX text, attributes, strings, templates and regexes, and ignores comments", () => {
    const planted = [
      "// 주석은 괜찮다",
      "/** 설명 */",
      "export const a = <p title=\"제목\">본문</p>;",
      "export const b = '문자열';",
      "export const c = `템플릿 ${a}`;",
      "export const d = /[가-힣]/;",
      "export const e = 'plain English';",
    ].join("\n");
    expect(hangulInCode(planted, "planted.tsx").map((s) => s.split(": ")[1])).toEqual(['"제목"', "본문", "'문자열'", "`템플릿 ${", "/[가-힣]/"]);
  });

  it("app/ and src/ carry no Korean text outside the message tables", () => {
    const files = [...walk(join(web, "app")), ...walk(join(web, "src"))].map((f) => relative(web, f));
    expect(files.length).toBeGreaterThan(40); // control: the walk finds the code
    expect(files).toContain("src/i18n/ko.ts"); // control: the table exists where the exclusion says
    const found = files.filter((f) => !TABLES.has(f)).flatMap((f) => hangulInCode(readFileSync(join(web, f), "utf-8"), f));
    expect(found).toEqual([]);
  });
});
