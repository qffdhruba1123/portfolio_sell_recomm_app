import { type AppState, emptyState } from '../types'

const STORAGE_KEY = 'portfolio-sell-recomm:state'
const CURRENT_VERSION = 1

type Migration = (state: any) => any

/** Keyed by the version a state is migrating FROM. Add entries when schemaVersion bumps. */
const MIGRATIONS: Record<number, Migration> = {}

function migrate(raw: any): AppState {
  let state = raw
  while (typeof state.schemaVersion === 'number' && state.schemaVersion < CURRENT_VERSION) {
    const migration = MIGRATIONS[state.schemaVersion]
    if (!migration) break
    state = migration(state)
  }
  return state as AppState
}

export function loadState(): AppState {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) return emptyState()
  try {
    const parsed = JSON.parse(raw)
    return migrate(parsed)
  } catch {
    return emptyState()
  }
}

export function saveState(state: AppState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}

export function exportStateJson(state: AppState): string {
  return JSON.stringify(state, null, 2)
}

export function parseImportedStateJson(json: string): AppState {
  const parsed = JSON.parse(json)
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Invalid file: not a JSON object.')
  }
  if (!Array.isArray(parsed.holdings) || !Array.isArray(parsed.institutions) || !Array.isArray(parsed.cashBalances)) {
    throw new Error('Invalid file: missing holdings, institutions, or cashBalances.')
  }
  return migrate(parsed)
}

// --- Small caches, kept separate from the versioned AppState so clearing/importing a backup never wipes them. ---

interface SymbolCacheEntry {
  symbol: string
  currency: string
}

const SYMBOL_CACHE_KEY = 'portfolio-sell-recomm:symbol-cache'

export function loadSymbolCache(): Record<string, SymbolCacheEntry> {
  try {
    return JSON.parse(localStorage.getItem(SYMBOL_CACHE_KEY) ?? '{}')
  } catch {
    return {}
  }
}

export function saveSymbolCacheEntry(identifier: string, entry: SymbolCacheEntry): void {
  const cache = loadSymbolCache()
  cache[identifier] = entry
  localStorage.setItem(SYMBOL_CACHE_KEY, JSON.stringify(cache))
}

interface PriceCacheEntry {
  price: number
  currency: string
  fetchedAtMs: number
}

const PRICE_CACHE_KEY = 'portfolio-sell-recomm:price-cache'

export function loadPriceCache(): Record<string, PriceCacheEntry> {
  try {
    return JSON.parse(localStorage.getItem(PRICE_CACHE_KEY) ?? '{}')
  } catch {
    return {}
  }
}

export function savePriceCacheEntry(symbol: string, entry: PriceCacheEntry): void {
  const cache = loadPriceCache()
  cache[symbol] = entry
  localStorage.setItem(PRICE_CACHE_KEY, JSON.stringify(cache))
}
