# Weekly meta report: how to write it

The owner's bar (2026-10-05): a report explains the meta. A list of numbers is not a report.
Its example chain: Xal'atath is overpowered → she deals more damage than a tank can absorb, but she
is a frail mage → Zeratul, who dives frail mages, rises. Every report follows a chain like that,
built from this week's evidence (`data/weekly/<week>.evidence.json`, written by
`uv run python tools/weekly_evidence.py <week>`).

Basis: Storm League only. In Quick Match heroes are picked before the map and the teams are known,
so there are no counter picks to explain.

## What the evidence holds

- `centre`: the hero most present this week (pick + ban). It includes:
  - use (ban, pick, win rate, games) and rank;
  - specs: life and its rank in the role;
  - per-game averages, each ranked overall and in the role;
  - matchups: who holds it down and who it crushes, each gap marked `significant` or not.
- `risers` / `fallers`: the biggest rank moves. Each has its matchup with the centre (`vs_centre`) and
  this patch's own change to the hero (`patch_change`: buff, nerf, mixed or hotfix).
- `heroes`: every cited hero (the centre, its significant matchups, the top three risers and the top
  three fallers):
  - `kit`: each ability with its hotkey, what it does, its cooldown and its cost (game data);
  - `talents`: each level's talents, most played first, with popularity and win rate. Every talent
    after the most picked one has `vs_top` (its win rate minus the top pick's) and `significant`.
    These are Storm League numbers for the patch to date (`data/weekly/<week>.talents.json`).

## The shape of a report (4–6 paragraphs)

1. **The centre.** Name the hero and how much it dominates: ban, pick, win rate, games.
2. **Why it is strong.** Go from the numbers to the kit to the build.
   - Give the averages that set it apart (e.g. damage 1st of 91, deaths 75th).
   - Name the ability that explains each one, with its cooldown (e.g. "hard to catch": E Void Step
     teleports three times every 15 s and can stop anywhere).
   - Name the build players settle on and what it adds. Use `talents`: what nearly everyone takes,
     and which choices are real splits.
   - A talent that wins clearly more or less than the top pick is worth a sentence only when it is
     `significant`.
3. **What answers it.** Name the significant counters, with games and gap. Then say what in that
   hero's kit plausibly answers the centre's strength (e.g. a reliable lockdown against a
   teleport). This is interpretation: say so. Hunches are named as hunches, briefly.
4. **The ripple.** Explain how the centre moved others, and only through the data:
   - a riser that holds the centre down is a candidate;
   - a hero the centre crushes that fell is a candidate;
   - a mover with `patch_change` set may be the patch itself; say so and do not credit the meta;
   - a big mover with no link to the centre gets its own short explanation from its kit and talents,
     or is left out.
5. **What a player can take from it.** Draw on the paragraphs above and add no new claims. Cover:
   - ban or pick priority;
   - the talent to take and the one to skip;
   - how to play against the centre (what it lacks, what its cooldowns leave open).
6. **Limits** (one or two sentences). Say what the data cannot show yet and what to watch next week.

## Rules

- **Every number comes from the evidence and is given with its sample.** After writing, re-check every
  number, rank and "biggest" claim in both languages against the evidence JSON, one by one.
- **Interpretation is marked.** A claim about why (a mechanism from the kit) is written as reasoning
  ("~때문으로 보인다", "likely because"), never as a measured fact. It must name the ability or
  talent it rests on.
- **No number without a "so what".** If a number does not move the argument, drop it.
- **Popularity is not strength.** A talent everyone takes is the consensus, not proof that it is best.
  Win-rate gaps between talents also reflect who picks them: say "the players who take it win more",
  not "it is stronger", unless the gap is `significant` and large.
- **Findings and hunches.** A matchup or talent gap is a finding only when `significant` is true
  (100+ games, outside the 95 % margin). Otherwise call it a hunch, or leave it out.
- **No causes the data cannot show.** Matchups and talents are the patch to date; ranks are this week
  against the baseline.
- **Plain, direct sentences.** Korean first; the English says the same, not a looser paraphrase.

## The file

Write the prose to `data/weekly/<week>.analysis.json`, shaped like `2026-w40.analysis.json`:

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

The title states the week's thesis, not a list. `notes` gives the basis (regions, patch, baseline),
the finding rule and the sources (Heroes Profile; game data). The status stays `draft` until the
owner approves the PR; it is then set to `reviewed`.
