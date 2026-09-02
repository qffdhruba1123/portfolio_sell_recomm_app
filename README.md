# Portfolio Sell-Recommendation Advisor

A personal finance tool that gives **sell recommendations** for two situations —
a sudden need for cash, or a retirement withdrawal — grounded in German
capital-gains tax rules (Abgeltungssteuer, FIFO lot accounting, Teilfreistellung,
the §20 EStG stock/fund loss-offset asymmetry, per-institution Freistellungsauftrag
tracking) and transparent about the trade-off between minimizing tax and
reducing concentration risk. It never executes a trade and never connects to
any brokerage account — every recommendation is something you act on manually
elsewhere.

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

## Price data: Yahoo Finance via a CORS proxy

Yahoo Finance's chart/search endpoints are unofficial and send no
`Access-Control-Allow-Origin` header (confirmed by inspecting the response
headers directly, not assumed), so a browser can't call them cross-origin.
This app routes those calls through a configurable proxy prefix
(`corsproxy.io` by default) — if that proxy is down, paste a different one into
**Settings → CORS proxy prefix**. Price lookups are cached (symbol resolution
indefinitely, live quotes for ~45s) to stay under Yahoo's rate limits; a
rate-limited or failed lookup falls back to the last-known price with a
"stale" badge rather than failing the page.

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
