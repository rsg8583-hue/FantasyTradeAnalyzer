# Calculation methodology

All numbers come from a deterministic engine (`src/lib/engine`). The AI only explains them.

## Where the data comes from

You build your own league: create teams and add players from **ESPN's public player pool**. No ESPN account, league link, or cookies are used. Each player carries ESPN's **full-season projected stat line**, which this app scores with the scoring preset you chose.

Demo mode uses fictional fixtures instead and is clearly labeled.

## Metric

For each of the two fantasy teams in a trade, separately:

```
Projected starting-lineup improvement (%) =
  100 × (projected lineup points after − projected lineup points before)
  ÷ projected lineup points before
```

- The two percentages are independent. They do not need to add up to 100% or to anything else.
- Example: a team going from 120 to 126 projected points is **+5.0%**. That is a 5% increase in projected lineup points, **not** a 5% increase in win probability.
- Results show the absolute point change next to the percentage, with one decimal place.
- If the baseline is zero or below, the percentage is **not available**. The point totals are still shown.

### Verdict

| Verdict | Condition |
| --- | --- |
| Both teams improve | Both percentages, rounded to 0.1, are above 0.0% |
| One team improves | Exactly one is |
| Neither team improves | Neither is |
| Insufficient data | Either team's percentage is not available |

A positive projected change is not evidence that a trade is fair.

## Projection window (horizon)

Custom leagues use a single window: **ESPN's full-season projection**, scored by the league's rules, for one best starting lineup. The same window is used before and after the trade. This is a season-long projected-points comparison, not a weekly matchup or a guarantee.

(The demo leagues instead use a weekly/daily window from a fictional calendar, to exercise bye weeks and multi-day scheduling.)

## Scoring

Scoring presets live in `src/lib/league/presets.ts`:

- **Football:** PPR, Half-PPR, or Standard. Stat ids follow ESPN's `PLAYER_STATS_MAP` (passing/rushing/receiving, kicking, and team defense).
- **Basketball:** a common points-league preset (PTS 1, REB 1, AST 2, STL/BLK 4, TO −2, plus shooting).

Each player's projected points = the preset's scoring rules applied to ESPN's projected stat line. The same scoring is used to rank players in the "add player" search.

### Guarding flaky data

ESPN's unofficial projection feed occasionally returns a corrupt stat value (e.g. millions of yards for one player). Any single stat value above 100,000 is ignored (`MAX_SANE_STAT` in `src/lib/projections/scoring.ts`); no real season stat approaches that, so this removes the bad value while keeping the player's other stats.

## Missing data is never zero

| Situation | Treatment |
| --- | --- |
| Player has a projection | Use it |
| ESPN returned no full-season projection for the player | **Missing** (`null`), never 0 |

When a player is missing:

- **A traded, dropped or added player** makes that team "insufficient data".
- **An uninvolved roster player** is left out of both the before and after lineups, and the result shows a warning that both totals may be understated.

## Lineup optimization

The best legal starting lineup is found with the Hungarian algorithm (exact maximum-weight assignment):

- Players are matched to individual starting slots (`lineupSlotCounts` expanded), and only to slots in their ESPN `eligibleSlots`.
- Each player fills at most one slot, so FLEX, OP, UT, G/F and similar slots never double-count.
- A slot with no eligible player stays empty and scores 0. A player with a negative projection may be benched instead of starting.
- Bench and IR slots never score.

If your team has no eligible player for a required slot (e.g. no kicker), that slot is empty and the result warns about it.

## Roster changes

- **Active limit:** the sum of non-IR slot counts for the preset.
- **Received players:** they take active spots. This is stated as an assumption.
- **Over the limit:** you choose exactly the required number of drops.
- **Open spots:** in a custom league you add replacement players directly to a team in the builder, so no free-agent list is offered during a trade; open spots are treated as empty (scoring 0).
- **Not modeled:** waiver priority, FAAB, or ESPN position maximums.

## Supported formats

Custom leagues are always points leagues (you pick the preset), so format detection is not needed. The category/keeper/dynasty detection in `src/lib/espn/normalize.ts` remains for the ESPN league adapter, which is retained in the codebase but no longer exposed in the UI.
