import { loadPriceCache, loadSymbolCache, savePriceCacheEntry, saveSymbolCacheEntry } from './storage'

/**
 * Yahoo Finance's chart/search endpoints are unofficial, undocumented, and send no
 * Access-Control-Allow-Origin header — confirmed by direct inspection, not assumed.
 * A browser fetch() from any origin (localhost, GitHub Pages) is blocked by CORS,
 * so every call is routed through a configurable proxy prefix. If a proxy goes
 * down, changing PROXY_PREFIX (or the corsProxyPrefix setting) is a one-line fix.
 */
const YAHOO_HOST = 'https://query1.finance.yahoo.com'
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
const PRICE_CACHE_TTL_MS = 45_000
const EU_SUFFIXES = ['SG', 'DE', 'F', 'MU', 'MI']

export class YahooRateLimitError extends Error {
  constructor() {
    super('Yahoo Finance is rate-limiting requests right now.')
  }
}

function buildUrl(proxyPrefix: string, path: string): string {
  const target = `${YAHOO_HOST}${path}`
  return `${proxyPrefix}${encodeURIComponent(target)}`
}

async function fetchYahoo(proxyPrefix: string, path: string): Promise<any> {
  const res = await fetch(buildUrl(proxyPrefix, path), {
    headers: { 'User-Agent': USER_AGENT },
  })
  if (res.status === 429) throw new YahooRateLimitError()
  if (!res.ok) throw new Error(`Yahoo Finance request failed (${res.status}).`)
  return res.json()
}

export interface ChartMeta {
  currency: string | null
  regularMarketPrice: number | null
  regularMarketTime: number | null
  exchangeName: string | null
}

function extractMeta(json: any): ChartMeta | null {
  const result = json?.chart?.result?.[0]
  if (!result) return null
  const meta = result.meta ?? {}
  return {
    currency: meta.currency ?? null,
    regularMarketPrice: typeof meta.regularMarketPrice === 'number' ? meta.regularMarketPrice : null,
    regularMarketTime: meta.regularMarketTime ?? null,
    exchangeName: meta.exchangeName ?? null,
  }
}

/** A resolved quote must have a real price — a null price means a ticker collision (e.g. a delisted/mutual-fund lookalike), not a usable quote. */
function isUsableQuote(meta: ChartMeta | null): meta is ChartMeta & { currency: string; regularMarketPrice: number } {
  return !!meta && meta.regularMarketPrice != null && meta.currency != null
}

export interface LivePrice {
  symbol: string
  price: number
  currency: string
  asOfMs: number
  stale: boolean
}

/** Live/current price for an already-known Yahoo symbol, with a 45s cache and graceful rate-limit fallback. */
export async function getLivePrice(symbol: string, proxyPrefix: string): Promise<LivePrice> {
  const cache = loadPriceCache()
  const cached = cache[symbol]
  const now = Date.now()
  if (cached && now - cached.fetchedAtMs < PRICE_CACHE_TTL_MS) {
    return { symbol, price: cached.price, currency: cached.currency, asOfMs: cached.fetchedAtMs, stale: false }
  }

  try {
    const json = await fetchYahoo(proxyPrefix, `/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`)
    const meta = extractMeta(json)
    if (!isUsableQuote(meta)) throw new Error(`No usable quote for ${symbol}.`)
    savePriceCacheEntry(symbol, { price: meta.regularMarketPrice, currency: meta.currency, fetchedAtMs: now })
    return { symbol, price: meta.regularMarketPrice, currency: meta.currency, asOfMs: now, stale: false }
  } catch (err) {
    if (cached) {
      return { symbol, price: cached.price, currency: cached.currency, asOfMs: cached.fetchedAtMs, stale: true }
    }
    throw err
  }
}

export interface HistoricalPrice {
  dateMs: number
  close: number
}

/**
 * Closing price at or before a target date. Weekends/holidays have no bar for that
 * exact day, so this queries a window and takes the latest timestamp <= target.
 */
export async function getHistoricalClose(
  symbol: string,
  targetDate: Date,
  proxyPrefix: string,
): Promise<HistoricalPrice | null> {
  const period1 = Math.floor(targetDate.getTime() / 1000) - 7 * 86_400
  const period2 = Math.floor(targetDate.getTime() / 1000) + 1 * 86_400
  const json = await fetchYahoo(
    proxyPrefix,
    `/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&period1=${period1}&period2=${period2}`,
  )
  const result = json?.chart?.result?.[0]
  const timestamps: number[] = result?.timestamp ?? []
  const closes: number[] = result?.indicators?.quote?.[0]?.close ?? []
  const targetSec = Math.floor(targetDate.getTime() / 1000)

  let best: HistoricalPrice | null = null
  for (let i = 0; i < timestamps.length; i++) {
    const ts = timestamps[i]
    const close = closes[i]
    if (ts <= targetSec && close != null && (best === null || ts > best.dateMs / 1000)) {
      best = { dateMs: ts * 1000, close }
    }
  }
  return best
}

export interface DividendEvent {
  dateMs: number
  amount: number
}

export async function getDividendHistory(symbol: string, proxyPrefix: string, range = '5y'): Promise<DividendEvent[]> {
  const json = await fetchYahoo(proxyPrefix, `/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=${range}&events=div`)
  const dividends = json?.chart?.result?.[0]?.events?.dividends ?? {}
  return Object.values(dividends as Record<string, { amount: number; date: number }>).map((d) => ({
    dateMs: d.date * 1000,
    amount: d.amount,
  }))
}

/** Units of `to` per 1 `from`, e.g. from=USD,to=EUR -> EUR per USD. */
export async function getFxRate(from: string, to: string, proxyPrefix: string, atDate?: Date): Promise<number> {
  const symbol = `${from}${to}=X`
  if (!atDate) {
    const live = await getLivePrice(symbol, proxyPrefix)
    return live.price
  }
  const historical = await getHistoricalClose(symbol, atDate, proxyPrefix)
  if (!historical) throw new Error(`No FX rate found for ${symbol} near ${atDate.toISOString()}.`)
  return historical.close
}

export interface SearchResult {
  symbol: string
  exchange: string
  quoteType: string
  name: string
}

export async function searchSymbol(query: string, proxyPrefix: string): Promise<SearchResult[]> {
  const json = await fetchYahoo(proxyPrefix, `/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=5&newsCount=0`)
  const quotes: any[] = json?.quotes ?? []
  return quotes
    .filter((q) => q.symbol)
    .map((q) => ({
      symbol: q.symbol,
      exchange: q.exchDisp ?? q.exchange ?? '',
      quoteType: q.quoteType ?? '',
      name: q.longname ?? q.shortname ?? q.symbol,
    }))
}

export interface ResolvedSymbol {
  symbol: string
  currency: string
  price: number
  /** True if resolved via a guessed EU-exchange suffix rather than the primary search hit. */
  viaEuGuess: boolean
}

/**
 * Resolves a user-entered identifier (ISIN, name, or ticker) to a Yahoo symbol,
 * preferring an EU listing quoted directly in EUR over the primary US listing + FX
 * conversion. Cached indefinitely once found — re-resolving on every load is what
 * trips Yahoo's rate limit.
 */
export async function resolveSymbol(identifier: string, proxyPrefix: string): Promise<ResolvedSymbol> {
  const cache = loadSymbolCache()
  const cached = cache[identifier]
  if (cached) {
    const live = await getLivePrice(cached.symbol, proxyPrefix)
    return { symbol: cached.symbol, currency: live.currency, price: live.price, viaEuGuess: false }
  }

  const euGuessResults = await Promise.allSettled(
    EU_SUFFIXES.map((sfx) => getLivePrice(`${identifier}.${sfx}`, proxyPrefix)),
  )
  const euHit = euGuessResults.find(
    (r): r is PromiseFulfilledResult<LivePrice> => r.status === 'fulfilled' && r.value.currency === 'EUR',
  )
  if (euHit) {
    saveSymbolCacheEntry(identifier, { symbol: euHit.value.symbol, currency: euHit.value.currency })
    return { symbol: euHit.value.symbol, currency: euHit.value.currency, price: euHit.value.price, viaEuGuess: true }
  }

  const searchResults = await searchSymbol(identifier, proxyPrefix)
  const firstTradable = searchResults.find((r) => r.quoteType === 'EQUITY' || r.quoteType === 'ETF')
  if (!firstTradable) throw new Error(`No Yahoo Finance symbol found for "${identifier}".`)

  const live = await getLivePrice(firstTradable.symbol, proxyPrefix)
  saveSymbolCacheEntry(identifier, { symbol: firstTradable.symbol, currency: live.currency })
  return { symbol: firstTradable.symbol, currency: live.currency, price: live.price, viaEuGuess: false }
}
