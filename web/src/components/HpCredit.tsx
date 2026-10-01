export const HP_HOME = "https://www.heroesprofile.com/";

/** Heroes Profile API terms §4: every page showing its data says so in these words, with a visible link, on the first
 *  screen (not only in the footer), in body-sized text that is not styled as fine print. Same wording in every language.
 *  It stands in the pages' top margin (their <main> is mt-2), so the tier table keeps 14 rows above the fold at 1280×900. */
export function HpCredit() {
  return (
    <p id="hp-attribution" className="page-x pt-2 text-sm text-fg-2">
      Data provided by{" "}
      <a href={HP_HOME} rel="noopener" className="font-semibold text-primary underline-offset-2 hover:underline">
        Heroes Profile
      </a>
    </p>
  );
}
