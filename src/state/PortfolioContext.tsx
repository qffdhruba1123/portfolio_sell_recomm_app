import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { AppState, CashBalance, Holding, Institution, Lot, Settings } from '../types'
import { emptyState } from '../types'
import { exportStateJson, loadState, parseImportedStateJson, saveState } from '../lib/storage'
import { buildDemoState, isDemoHoldingId } from '../lib/demoData'
import { getFxRate, resolveSymbol, YahooRateLimitError } from '../lib/yahoo'
import { uid } from '../lib/format'
import { buildCsvImportPlan, type CsvImportSummary, parseCsvRows } from '../lib/csv'

export interface PriceInfo {
  price: number
  currency: string
  stale: boolean
  source: 'live' | 'error'
  error?: string
}

/** Fetches and converts to EUR for a given set of holdings — shared by the manual refresh, the demo, and the auto-fetch-on-load effect, so there's exactly one place that talks to Yahoo Finance. */
async function fetchPricesForHoldings(holdings: Holding[], proxyPrefix: string): Promise<Record<string, PriceInfo>> {
  const entries = await Promise.all(
    holdings.map(async (h): Promise<[string, PriceInfo]> => {
      try {
        const resolved = await resolveSymbol(h.identifier, proxyPrefix)
        let priceEur = resolved.price
        if (resolved.currency !== 'EUR') {
          const rate = await getFxRate(resolved.currency, 'EUR', proxyPrefix)
          priceEur = resolved.price * rate
        }
        return [h.id, { price: priceEur, currency: 'EUR', stale: false, source: 'live' }]
      } catch (err) {
        const message = err instanceof YahooRateLimitError ? 'Rate-limited by Yahoo Finance — try again shortly.' : (err as Error).message
        return [h.id, { price: NaN, currency: 'EUR', stale: true, source: 'error', error: message }]
      }
    }),
  )
  return Object.fromEntries(entries)
}

interface PortfolioContextValue {
  state: AppState
  prices: Record<string, PriceInfo>
  pricesLoading: boolean
  isDemo: boolean

  addHolding: (h: Omit<Holding, 'id' | 'lots'>) => string
  updateHolding: (id: string, patch: Partial<Omit<Holding, 'id' | 'lots'>>) => void
  removeHolding: (id: string) => void
  addLot: (holdingId: string, lot: Omit<Lot, 'id'>) => void
  updateLot: (holdingId: string, lotId: string, patch: Partial<Omit<Lot, 'id'>>) => void
  removeLot: (holdingId: string, lotId: string) => void

  addCashBalance: (c: Omit<CashBalance, 'id'>) => void
  updateCashBalance: (id: string, patch: Partial<Omit<CashBalance, 'id'>>) => void
  removeCashBalance: (id: string) => void

  addInstitution: (i: Omit<Institution, 'id'>) => string
  updateInstitution: (id: string, patch: Partial<Omit<Institution, 'id'>>) => void
  removeInstitution: (id: string) => void

  updateSettings: (patch: Partial<Settings>) => void

  loadDemoData: () => void
  clearAllData: () => void
  exportJson: () => string
  importJson: (json: string) => void
  importHoldingsCsv: (csvText: string) => CsvImportSummary

  refreshPrices: () => Promise<void>
}

const PortfolioContext = createContext<PortfolioContextValue | null>(null)

export function PortfolioProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>(() => loadState())
  const [prices, setPrices] = useState<Record<string, PriceInfo>>({})
  const [pricesLoading, setPricesLoading] = useState(false)

  useEffect(() => {
    saveState(state)
  }, [state])

  const isDemo = useMemo(() => state.holdings.some((h) => isDemoHoldingId(h.id)), [state.holdings])

  const mergePrices = useCallback((fetched: Record<string, PriceInfo>) => {
    setPrices((prev) => {
      const next = { ...prev }
      for (const [id, info] of Object.entries(fetched)) {
        if (info.source === 'error' && prev[id] && prev[id].source !== 'error') continue // keep last-known-good on transient failure
        next[id] = info
      }
      return next
    })
  }, [])

  const refreshPrices = useCallback(async () => {
    setPricesLoading(true)
    const fetched = await fetchPricesForHoldings(state.holdings, state.settings.corsProxyPrefix)
    mergePrices(fetched)
    setPricesLoading(false)
  }, [state.holdings, state.settings.corsProxyPrefix, mergePrices])

  // Auto-fetch prices for any holding that doesn't have one yet - covers the
  // initial load of a session with saved holdings (real or demo), and CSV/demo
  // imports, without requiring a manual "Refresh prices" click first.
  useEffect(() => {
    const withoutPrice = state.holdings.filter((h) => !(h.id in prices))
    if (withoutPrice.length === 0) return
    setPricesLoading(true)
    fetchPricesForHoldings(withoutPrice, state.settings.corsProxyPrefix).then((fetched) => {
      mergePrices(fetched)
      setPricesLoading(false)
    })
    // Deliberately keyed off `state.holdings` only - `prices` changes as a
    // *result* of this effect, so including it would refetch in a loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.holdings])

  const addHolding = useCallback((h: Omit<Holding, 'id' | 'lots'>): string => {
    const id = uid()
    setState((s) => ({ ...s, holdings: [...s.holdings, { ...h, id, lots: [] }] }))
    return id
  }, [])

  const updateHolding = useCallback((id: string, patch: Partial<Omit<Holding, 'id' | 'lots'>>) => {
    setState((s) => ({ ...s, holdings: s.holdings.map((h) => (h.id === id ? { ...h, ...patch } : h)) }))
  }, [])

  const removeHolding = useCallback((id: string) => {
    setState((s) => ({ ...s, holdings: s.holdings.filter((h) => h.id !== id) }))
    setPrices((p) => {
      const next = { ...p }
      delete next[id]
      return next
    })
  }, [])

  const addLot = useCallback((holdingId: string, lot: Omit<Lot, 'id'>) => {
    setState((s) => ({
      ...s,
      holdings: s.holdings.map((h) => (h.id === holdingId ? { ...h, lots: [...h.lots, { ...lot, id: uid() }] } : h)),
    }))
  }, [])

  const updateLot = useCallback((holdingId: string, lotId: string, patch: Partial<Omit<Lot, 'id'>>) => {
    setState((s) => ({
      ...s,
      holdings: s.holdings.map((h) =>
        h.id === holdingId ? { ...h, lots: h.lots.map((l) => (l.id === lotId ? { ...l, ...patch } : l)) } : h,
      ),
    }))
  }, [])

  const removeLot = useCallback((holdingId: string, lotId: string) => {
    setState((s) => ({
      ...s,
      holdings: s.holdings.map((h) => (h.id === holdingId ? { ...h, lots: h.lots.filter((l) => l.id !== lotId) } : h)),
    }))
  }, [])

  const addCashBalance = useCallback((c: Omit<CashBalance, 'id'>) => {
    setState((s) => ({ ...s, cashBalances: [...s.cashBalances, { ...c, id: uid() }] }))
  }, [])

  const updateCashBalance = useCallback((id: string, patch: Partial<Omit<CashBalance, 'id'>>) => {
    setState((s) => ({ ...s, cashBalances: s.cashBalances.map((c) => (c.id === id ? { ...c, ...patch } : c)) }))
  }, [])

  const removeCashBalance = useCallback((id: string) => {
    setState((s) => ({ ...s, cashBalances: s.cashBalances.filter((c) => c.id !== id) }))
  }, [])

  const addInstitution = useCallback((i: Omit<Institution, 'id'>): string => {
    const id = uid()
    setState((s) => ({ ...s, institutions: [...s.institutions, { ...i, id }] }))
    return id
  }, [])

  const updateInstitution = useCallback((id: string, patch: Partial<Omit<Institution, 'id'>>) => {
    setState((s) => ({ ...s, institutions: s.institutions.map((i) => (i.id === id ? { ...i, ...patch } : i)) }))
  }, [])

  const removeInstitution = useCallback((id: string) => {
    setState((s) => ({ ...s, institutions: s.institutions.filter((i) => i.id !== id) }))
  }, [])

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setState((s) => ({ ...s, settings: { ...s.settings, ...patch } }))
  }, [])

  const loadDemoData = useCallback(() => {
    setState((s) => buildDemoState(s.settings.corsProxyPrefix))
    // Prices aren't set here - the auto-fetch-on-load effect fetches real
    // live quotes for these real tickers automatically, same as any holding.
    setPrices({})
  }, [])

  const clearAllData = useCallback(() => {
    setState(emptyState())
    setPrices({})
  }, [])

  const exportJson = useCallback(() => exportStateJson(state), [state])

  const importJson = useCallback((json: string) => {
    const imported = parseImportedStateJson(json)
    setState(imported)
    setPrices({})
  }, [])

  const importHoldingsCsv = useCallback(
    (csvText: string): CsvImportSummary => {
      const { rows, errors } = parseCsvRows(csvText)
      const plan = buildCsvImportPlan(rows, state.holdings, state.institutions)
      const summary: CsvImportSummary = { ...plan.summary, errors }
      if (plan.newHoldings.length === 0 && plan.appendedLots.length === 0) return summary

      setState((s) => {
        const institutionIdByKey = new Map<string, string>()
        const newInstitutions: Institution[] = plan.newInstitutions.map((i) => {
          const id = uid()
          institutionIdByKey.set(i.label.trim().toLowerCase(), id)
          return { ...i, id }
        })
        const resolveInstitutionId = (key: string): string =>
          s.institutions.find((i) => i.label.trim().toLowerCase() === key)?.id ?? institutionIdByKey.get(key)!

        const newHoldings: Holding[] = plan.newHoldings.map((nh) => ({
          ...nh.holding,
          id: uid(),
          institutionId: resolveInstitutionId(nh.institutionKey),
          lots: nh.lots.map((l) => ({ ...l, id: uid() })),
        }))

        const appendedByHoldingId = new Map(plan.appendedLots.map((a) => [a.holdingId, a.lots]))

        return {
          ...s,
          institutions: [...s.institutions, ...newInstitutions],
          holdings: [
            ...s.holdings.map((h) => {
              const toAppend = appendedByHoldingId.get(h.id)
              return toAppend ? { ...h, lots: [...h.lots, ...toAppend.map((l) => ({ ...l, id: uid() }))] } : h
            }),
            ...newHoldings,
          ],
        }
      })

      return summary
    },
    [state.holdings, state.institutions],
  )

  const value: PortfolioContextValue = {
    state,
    prices,
    pricesLoading,
    isDemo,
    addHolding,
    updateHolding,
    removeHolding,
    addLot,
    updateLot,
    removeLot,
    addCashBalance,
    updateCashBalance,
    removeCashBalance,
    addInstitution,
    updateInstitution,
    removeInstitution,
    updateSettings,
    loadDemoData,
    clearAllData,
    exportJson,
    importJson,
    importHoldingsCsv,
    refreshPrices,
  }

  return <PortfolioContext.Provider value={value}>{children}</PortfolioContext.Provider>
}

export function usePortfolio(): PortfolioContextValue {
  const ctx = useContext(PortfolioContext)
  if (!ctx) throw new Error('usePortfolio must be used within a PortfolioProvider')
  return ctx
}
