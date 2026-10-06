# Weekly meta report: how to write it

## What the owner asked for

These are the owner's notes from 2026-10-05 and 2026-10-06. The role model is the YouTube channel 프로관전러 P.S.

- **One central pick.** A report takes one central pick and shows how it changed the whole game, not one hero's stats. Example chain: Xal'atath is overpowered → she out-damages what tanks can absorb, but she is a frail mage → Zeratul, who dives frail mages, rises.
- **Not a list.** Which talents are taken and a win-rate counter table are not a report.
- **A counter is a build in someone's hands, not a hero.** Picking the counter is not enough. Say why it counters, and how to play it.
  - Example: the community counters Xal'atath with Zeratul. Only basic-attack Zeratul is said to work, and players who don't know that drag his win rate down.
  - So check the build and the MMR before calling anything a counter.
- **No guessing.** Every claim stands on per-game data. Guessing a playstyle from talent names is not analysis.

Basis: Storm League. Quick Match is used only to check how a build fares in the game itself, and is always named as Quick Match. Players pick before the map and teams are known, so Quick Match says nothing about the draft.

## Inputs

- **Per-game analysis** (the main evidence): `data/weekly/<week>.replays.json`, from
  `uv run python tools/weekly_replays.py <week> --snapshots <dir> [--hotfix <build>]`.
  - The games are the daily replay sample (`collector/replay_sample.py`, about 1,200 Storm League and 300 Quick Match a day). They are stored on the `snapshots` branch as `snapshots/<KST day>/replays_*.jsonl.gz`. The tool keeps the games played Monday to Sunday KST.
  - `draft`: ban rate, first-ban rate, pick rate, pick round (first / middle / last), win rate when picked.
  - `bans`: where the ban slots go.
  - `shape`: games with the centre against games without — length, its team's level lead at 10 minutes, its record by game length (≤15 / 15–20 / >20 min).
  - `talents`: the centre's own talents per level.
  - `answered_by`: what the other team picks after the centre, how much more often than in other games (`lift`), and how those games go.
  - `answers[<hero>]`, for the most lifted answers:
    - its record against the centre by talent at each level, overall and in high/low-MMR games (`sl`; `qm` apart);
    - what differs between its wins and losses: the centre's deaths, deaths while outnumbered, time dead, damage; the answer's teamfight damage, stuns, roots, silences; game length (`contrast_*`).
  - `hotfix` (when the centre was changed during the week): the same before and after the build, plus its record against teams with more or less control (`vs_control`: roots, stuns, silences).
- **Patch and hotfix changes:** Blizzard's notes first (`data/patchnotes.json`, `notes[].hotfixes`).
  - `data/hotfixes.json` (a diff of the game data) can add changes the note leaves out. 98348 had three: the Dark Heart's detonation radius 4→3, Unstable Core's radius 4→3, and how long Xal'atath reveals herself when the Dark Heart lands, 0.125→1.1 s.
  - Name those as "공지 외 변경" (not in the notes).
  - Where the two disagree, say what the data shows. The 10/5 note puts "Void Eruption damage −20% / −5%" under the ability. In the data, only the split orbs of the level-20 talent 전령의 소모 changed (400→320 … 700→665); the base explosion is still 400–700.
- **Kit:** `data/talents/<slug>.json` → `game.abilities` (tooltip, cooldown, cost) and `talents` (names, tooltips).
- **Tier and matchup aggregates:** `data/weekly/<week>.evidence.json` (`tools/weekly_evidence.py`), for the rank context only.

## The shape of a report

1. **Title: the week's thesis**, one sentence a player would repeat. Not a list.
2. **The central pick and the draft around it.**
   - How it is treated: banned first? picked first when open?
   - What happens to the other ban slots because of it.
3. **How games changed.**
   - Length, the level lead at 10 minutes, when it wins and when it does not (by game length).
   - Say what that means for how the game is played: who wants the game short and who wants it long.
4. **What changed this week** (only if a patch or hotfix touched the centre).
   - The official change.
   - Before and after: ban, pick, win rate, the build players moved to.
   - Whether the change's own target (e.g. roots against Void Step) now beats it more (`vs_control`).
5. **The answers, and when they work.**
   - What players actually draft into the centre (lift) and whether it wins.
   - For each answer worth a paragraph: which build of it wins, in whose hands (MMR), and what its wins look like next to its losses.
   - This is where "a counter is a build in someone's hands" is shown, not said.
6. **How to play it.**
   - Concrete advice for playing the centre, and against it.
   - Each point must come from a difference in the data (wins vs losses, before vs after, game length), together with the kit fact that explains it.
7. **What we don't know yet** (two or three sentences). What the sample cannot settle, and what to watch next week.

## Rules

- **Every claim has its number and its sample** (games). A rate on fewer than 30 games is not a claim. Leave it out, or put it in section 7.
- **A difference is a finding only if it is large for its sample.** For two win rates, the gap must exceed about 2 × √(p(1−p)/n₁ + p(1−p)/n₂) × 100 points. Otherwise it is not stated as a difference.
- **No hypotheses scattered through the text.** Interpretation is allowed only when it names the data it explains and the kit fact behind it (ability, number, cooldown). Unsupported guesses go nowhere; open questions go in section 7.
- **The patch is not the meta.** A hero the patch changed moves for that reason first. Say so, and do not credit the central pick.
- **Popularity is not strength.** A talent most players take is the consensus, not proof it is best. Compare win rates only where the samples allow it, and within the same MMR band where possible.
- **Names are the game's own, never from memory.**
  - Owner 2026-10-06: "퀴라가 아니라 키히라". A wrong name is the first thing readers notice.
  - Take every hero, ability and talent name from `names` in `<week>.replays.json` (from `data/heroes_ko.json` and `data/talents/`).
  - Then run `uv run python tools/check_names.py <week>`. It must print `names ok`.
- **Plain, direct sentences.** Korean first; the English says the same.
- **Check every number.** After writing, check every number, rank and "most" against `<week>.replays.json`, `<week>.evidence.json` and the patch note, one by one.

## The file

Write the report to `data/weekly/<week>.analysis.json`, shaped like `2026-w40.analysis.json`:

```json
{
  "week": "<week>",
  "status": "draft",
  "basis": "sl",
  "title": {"ko": "...", "en": "..."},
  "paragraphs": {"ko": ["..."], "en": ["..."]},
  "notes": {"ko": "...", "en": "..."}
}
```

`notes` names:
- the basis (Storm League games in the sample, the week, the regions);
- the finding rule;
- the sources: Heroes Profile replays and stats, Blizzard's patch notes, game data.

The status stays `draft` until the owner approves the PR; it is then set to `reviewed`.
