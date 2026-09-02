# Portfolio Sell-Recommendation Advisor

A personal finance tool that gives **sell recommendations** for two situations —
a sudden need for cash, or a retirement withdrawal — grounded in German
capital-gains tax rules (Abgeltungssteuer, FIFO lot accounting, Teilfreistellung,
the §20 EStG stock/fund loss-offset asymmetry, per-institution Freistellungsauftrag
tracking, Bestandsschutz for pre-2009 lots) and transparent about the trade-off
between minimizing tax and reducing concentration risk. It never executes a
trade and never connects to any brokerage account — every recommendation is
something you act on manually elsewhere.

**This is not financial or tax advice.** It's educational, rules-based decision
support. Consult a Steuerberater before acting on anything it shows you.

## This is a static site — your data never leaves your browser

There is no server, no database, no API backend. Everything — holdings, lots,
cash balances, institutions, tax settings — lives only in **this browser's
`localStorage`**. The only network calls this app makes are price lookups by
ticker symbol to Yahoo Finance (via a CORS proxy, see below); no personal data
is ever part of those requests, and nothing is ever sent to a server, because
there isn't one.

Because of that:

- **`localStorage` is fragile.** Clearing browser data, using a private/incognito
  window, or switching devices/browsers all wipe it. **Use the "Export JSON
  backup" button in Settings regularly** — it's the only backup mechanism.
- **This deployed site is public.** GitHub Pages has no login. Anyone with the
  URL sees the *empty* app shell (your data is per-browser, not baked into the
  deploy), but don't rely on that as security — never treat this as a private
  place to store anything you wouldn't want exposed if your own browser/device
  were compromised.
- Use **Settings → Import JSON backup** to restore, or **Settings → Load demo
  data** to explore the app with a fictional portfolio before entering your own.

## Try it with demo data

The Dashboard and Settings both offer a **"Load demo data"** button that fills
in a multi-institution portfolio (Apple, BASF, a world-equity ETF, a bond fund,
cash, Freistellungsaufträge) — real, well-known securities with fictional lot
histories, so their current prices are fetched live through the same Yahoo
Finance pipeline as your own holdings, rather than faked. It doubles as a quick
check that price lookups are working in your setup. Clear it from Settings
whenever you're ready
to enter your own.

## Bulk-importing holdings via CSV

Settings isn't the only way in — **Holdings → Bulk upload via CSV** accepts a
file with one row per lot:

```
identifier,displayName,securityType,institution,acquiredAt,quantity,unitCostEur,note
US0378331005,Apple Inc.,STOCK,Hauptbroker,2021-03-15,10,120.50,Initial purchase
```

- `securityType` must be `STOCK`, `ETF`, or `OTHER`.
- `acquiredAt` must be `YYYY-MM-DD`.
- Multiple rows with the same `identifier` + `institution` become **one
  holding with multiple lots** (this is how you enter a position built up from
  several purchases).
- The same identifier at two *different* institutions becomes two separate
  holdings — tax and allowance tracking are per-institution.
- An institution named in the file that doesn't exist yet is created
  automatically with a 0/0 allowance; fill in the real figures on the
  Allowance tab afterward.
- A row with a missing or invalid value is skipped and reported — never
  silently guessed.

Download the template button on that screen for a starting file.

Adding a lot by hand doesn't require knowing the exact purchase price either —
each holding's "Add lot" form has a **"Fetch price for this date"** button
that looks up the historical closing price for that ticker on the date you
picked (converted to EUR at that date's FX rate if needed) and fills in the
unit cost for you.

## Price data: Yahoo Finance via a CORS proxy

Yahoo Finance's chart/search endpoints are unofficial and send no
`Access-Control-Allow-Origin` header (confirmed by inspecting the response
headers directly, not assumed), so a browser can't call them cross-origin.
This app routes those calls through a proxy. The default, `auto`, tries a
short built-in chain of public proxies in order (any one of them can and does
go down or rate-limit independently — this was confirmed in production, not
just anticipated) so one failing doesn't break the app. If all of them stop
working for you, paste your own proxy URL into **Settings → CORS proxy
prefix** — a self-hosted one (e.g. a few lines on Cloudflare Workers) is the
most reliable option since it isn't shared. Price lookups are cached (symbol
resolution indefinitely, live quotes for ~45s) to stay under Yahoo's rate
limits; a rate-limited or failed lookup falls back to the last-known price
with a "stale" badge rather than failing the page. Use the **"Test
connection"** button in Settings to check your current proxy actually works
without needing to load demo data or add a real holding first.

## Guardrails against accidental data loss

There's no undo — the JSON export in Settings is the only real safety net —
but removing a holding, an institution, or all data does ask for confirmation
first, since those can't be undone. Removing an institution that a holding or
cash balance still points at is blocked outright (with a message saying which
ones) rather than silently leaving them pointing at nothing.

## What the Recommend view surfaces beyond the raw numbers

- **Bestandsschutz**: shares acquired before 2009-01-01 are grandfathered out
  of Abgeltungssteuer entirely — gains on them are permanently tax-free, and
  (symmetrically) losses on them don't reduce tax elsewhere either, since they
  never enter the taxable pools. A line item's rationale says explicitly when
  some or all of a sale falls under this.
- **"Picked by both plans"** badge: when the same holding appears in both the
  tax-optimized and risk-reduction plans, that's a stronger signal than either
  ranking alone — shown as agreement between two transparent rankings, not a
  blended score.
- **Fractional-unit warning**: a partial sale can call for a non-whole
  quantity (e.g. "36.91 units"); flagged since not every broker supports
  fractional-unit orders.
- **Stale-price warning**: if any holding in a plan is priced from a stale
  (rate-limited or failed) quote, a banner says so before you act on the
  numbers.
- **Timing tip**: a plain-language note that splitting a non-urgent sale
  across two calendar years uses two separate years' Sparerpauschbetrag —
  context only, never applied automatically.

## Suggesting how to split your Freistellungsauftrag

The Allowance tab can estimate where your annual allowance is actually needed
and suggest filing it there, instead of splitting it evenly or guessing:

- Each holding's dividend income for last year is estimated from Yahoo
  Finance's dividend history and your lot quantities (a proxy for expected
  income, since future dividend dates can't be predicted).
- Each cash balance's interest for the *rest of this year* is projected from
  a rate (% per annum) and payout frequency you enter per balance — there's
  no way to fetch a bank's rate automatically.
- The suggestion fully covers whichever institution has the highest combined
  estimate first, since real-time withholding relief only helps where the
  income actually lands — not an even split, and not proportional either.

Each institution also has its own **sell fee** (a flat EUR cost per sell
order) instead of one app-wide number, since brokers charge very differently
— some neobrokers charge under 1 EUR/trade, others charge more.

If you file as married, the Allowance tab also notes a real practical
wrinkle: filing more than your own default half of the combined €2,000
allowance at an account held in only one spouse's name technically requires a
**joint Freistellungsauftrag** naming both spouses — not every broker's form
supports this cleanly, so it's worth checking before submitting an uneven
split at a single-name account.

## Loss pots carry into a new recommendation

Every recommendation used to net gains and losses only among the holdings in
that one plan, starting from zero — ignoring any loss already realized
earlier in the year at that institution. The Allowance tab now has a **loss
pots** section where you enter each institution's current banked balances
exactly as its own screen shows them (e.g. Scalable Capital labels these
"Loss pot (equities)" and "Loss pot (general)"). A new recommendation nets
against these first, same as the broker's own real-time withholding does —
so a stock gain gets reduced or zeroed out by an existing equity loss pot
before any tax shows up. The per-institution breakdown in the Recommend view
shows the carry-in amount used and a **projected remaining loss pot** after
the plan, which you can check against your broker's next statement.

The suggested split is never a black box either — clicking an institution's
row expands a breakdown of exactly which holding or cash balance contributed
how much to its estimate.

## Taking a recommendation with you

Every recommendation is something you act on manually elsewhere, so the
Recommend view has two ways to take it with you:

- **Print / save as PDF** uses the browser's print dialog, with the
  navigation, footer, and input controls hidden so only the actual
  recommendation prints.
- **Copy summary as text** puts a plain-text version (amount, both plans,
  every line item's rationale, totals, and the disclaimer) on your clipboard
  — useful for pasting into an email to a Steuerberater or into your own notes.

## Keeping your records in sync after you actually sell

Each plan has a **"Mark this plan as executed"** button. It never places a
trade — there is no brokerage connection anywhere in this app — it only
updates your *own* records here, exactly as if you'd re-derived and re-typed
these numbers by hand after actually selling at your broker: it consumes the
same FIFO lots the plan already computed (removing a fully-sold lot,
reducing a partially-sold one), adds each affected institution's allowance
used, and replaces its loss pots with the plan's own projected after-values.
Use it only once you've actually executed the sale elsewhere. It's a real
mutation, so it asks for confirmation first, and — like every other change in
this app — it's undoable only via your last JSON export.

## Recording sales, splits, and a new tax year

Not every sale comes from a Recommend plan — sometimes you sell because of
news, a personal rebalancing decision, or anything else unrelated to a cash
need this app computed. Each holding on the Holdings tab has a **"record a
sale"** link for exactly that: enter the quantity and price you actually sold
at, and it shows the same tax/fee breakdown a Recommend plan would (FIFO lot
selection, Bestandsschutz, Teilfreistellung, per-institution netting against
loss pots) before you confirm. Confirming updates your lots and that
institution's allowance-used and loss pots the same way "Mark this plan as
executed" does — it's the same underlying calculation, just for a single
holding you're recording after the fact rather than a multi-holding plan this
app suggested.

Each holding also has a **"record a stock split"** link. A split (or reverse
split) isn't a taxable event in Germany — it only changes share count and
cost-per-share, never total cost basis or a lot's acquired date (so
Bestandsschutz eligibility and FIFO order are unaffected). Enter the ratio
(2 for a 2-for-1 split, 0.5 for a 1-for-2 reverse split, 1.5 for a 3-for-2
split) and it rewrites every lot accordingly, with a before/after preview
shown first.

The Allowance tab has a **"Start new tax year"** button. Each institution's
"used" allowance figure is a per-calendar-year budget that resets to zero
every January at the broker itself — this button does the same here in one
click, once that's actually happened at your brokers, instead of editing each
institution's used figure by hand. It deliberately leaves loss pots and
submitted amounts untouched, since only usage resets — losses carry forward
and your filed split doesn't change on its own.

## Two things the Dashboard watches without you asking

- **Tax position if sold today**: your portfolio's total unrealized
  gain/loss at current prices, how much of it is permanently Bestandsschutz-
  exempt, and the estimated tax if you liquidated everything right now
  (using the same per-institution netting, allowance, and loss-pot logic as
  an actual plan) — a standing exposure snapshot, not a recommendation.
- **Tax-loss harvesting opportunities**: holdings sitting on a real
  unrealized loss right now, independent of any cash need — realizing one
  banks a loss pot that offsets a gain realized later this year. Bestandsschutz
  losses are excluded, since those provide no tax benefit to harvest.

## Basic data-entry guardrails

Numeric fields that represent real-world non-negative quantities (lot
quantity, unit cost, cash amounts, allowance figures, fees, rates) clamp to
zero if you type a negative number, and a lot's acquired date can't be set in
the future. These catch fat-finger mistakes; they don't validate anything
deeper (e.g. a suspiciously large quantity), consistent with the app trusting
whatever you enter as ground truth.

## Known simplifications (stated, not hidden)

- **Vorabpauschale** is entered manually in Settings and not included in the
  recommendation's tax math — the Bundesbank Basiszins it depends on changes
  yearly and isn't reliably fetchable from a static client-side app.
- **Church tax** is modeled as a simplified flat add-on to the effective rate,
  not the real Kirchensteuerabzugsverfahren (a Sonderausgabenabzug reduction).
- **No prior-year loss carryforward (Verlustvortrag)** is modeled — a stranded
  loss in a given sale plan just isn't usable elsewhere in this app.
- **No cross-institution netting** — German tax law nets everything at the
  annual tax return, but a broker's real-time withholding can only see its own
  institution, and that's what this app simulates. The per-institution
  breakdown in the Recommend view is deliberately not collapsed into one number.
- **Tax-optimized ranking is a heuristic**, not a cross-holding tax-lot solver —
  appropriate for a handful of manually-tracked holdings, not an optimization
  problem.

## Development

```bash
npm install
npm run dev      # local dev server
npm test         # Vitest — FIFO, §20 EStG netting, Teilfreistellung, allowance, CSV import
npm run build    # type-check + production build to dist/
```

The tax engine ([src/lib/tax.ts](src/lib/tax.ts)) and recommendation engine
([src/lib/recommend.ts](src/lib/recommend.ts)) are unit tested directly,
including the asymmetric cases that are easy to get backwards (a stock loss
must *not* offset a fund gain; a fund loss *must* be able to offset a stock
gain).

### Deployment

Pushing to `main` runs [.github/workflows/deploy.yml](.github/workflows/deploy.yml):
tests, build, then deploy to GitHub Pages. Vite's `base` in
[vite.config.ts](vite.config.ts) is set to `/portfolio_sell_recomm_app/` for
this project site — if you fork this under a different repo name, update that
path too, or assets will 404.

---

Built and maintained for free — if it's useful to you:
[☕ Buy me a coffee](https://buymeacoffee.com/qffdhruba) ·
[☕ Ko-fi](https://ko-fi.com/cueeffeffdee)
