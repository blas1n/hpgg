export const HP_HOME = "https://www.heroesprofile.com/";

/** Heroes Profile API terms §4: every page showing its data says so in these words, with a visible link, on the first
 *  screen (not only in the footer), in body-sized text that is not styled as fine print. Same wording in every language.
 *
 *  It carries no layout of its own: `PageHead` puts it on the page title's line (owner 2026-10-01 — alone above the
 *  title it read as a line slapped under the header), and the two pages whose title is drawn into a banner or next to
 *  a portrait place it themselves. Sharing the title's line also costs the page no vertical room.
 *
 *  It never breaks mid-phrase: split over two lines it reads as a stray fragment, and keeping it whole is also what
 *  pushes a control sharing that row (the home page's mode toggle) onto its own line when the screen is narrow. */
export function HpCredit() {
  return (
    <p id="hp-attribution" className="whitespace-nowrap text-sm text-fg-2">
      Data provided by{" "}
      <a href={HP_HOME} rel="noopener" className="font-semibold text-primary underline-offset-2 hover:underline">
        Heroes Profile
      </a>
    </p>
  );
}
