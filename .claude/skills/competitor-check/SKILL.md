---
name: competitor-check
description: Run a competitor/market intel refresh for a region or vertical — pricing, features, funding, gaps. Uses web search + fetch. Use quarterly or before entering a new market.
argument-hint: <region-or-vertical>
disable-model-invocation: true
---

Produce a competitor intel report for `$ARGUMENTS`.

## Steps

1. **Delegate to `qflo-market-researcher`** agent with this brief:
   - Target scope: `$ARGUMENTS` (e.g. "Morocco", "Gulf clinics", "Francophone Africa salons", "US nail salons").
   - Produce the standard market research output:
     - Top 5–10 competitors with pricing, revenue/funding (if public), customer counts, region/vertical focus
     - Feature matrix vs Qflo
     - Gaps (must-close table-stakes, competitive, nice-to-have)
     - Market sizing if available
     - Positioning recommendation for Qflo in this segment
     - Sources cited inline with URLs and dates

2. **Cross-check findings** against prior reports in `docs/market/` if any. Flag significant changes (pricing moves, funding rounds, competitors exiting like QLess).

3. **Write the report** to `docs/market/$ARGUMENTS-<YYYY-MM>.md`.

4. **Summarize** top 3 takeaways for the user.

Prefer primary sources (company pricing pages, filings) over aggregators. Flag stale data explicitly.
