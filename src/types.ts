export type FilingStatus = 'single' | 'married'
export type SecurityType = 'STOCK' | 'ETF' | 'OTHER'

export interface Institution {
  id: string
  label: string
  /** Freistellungsauftrag amount filed at this institution, EUR/year. */
  submittedEur: number
  /** Allowance already consumed at this institution this year, as reported by the broker. */
  usedEur: number
}

export interface Lot {
  id: string
  /** ISO date (yyyy-mm-dd) */
  acquiredAt: string
  quantity: number
  unitCostEur: number
  note?: string
}

export interface Holding {
  id: string
  /** ISIN, ticker, or any user-chosen identifier. Not validated as a real ISIN. */
  identifier: string
  displayName: string
  securityType: SecurityType
  institutionId: string
  /** Resolved Yahoo Finance symbol, cached once found. */
  yahooSymbol?: string
  /** 0-1. If unset, defaults by securityType (ETF: 0.3, STOCK/OTHER: 0). */
  teilfreistellungOverride?: number
  lots: Lot[]
}

export interface CashBalance {
  id: string
  label: string
  amountEur: number
  institutionId: string
}

export interface Settings {
  filingStatus: FilingStatus
  churchTaxEnabled: boolean
  /** e.g. 0.08 or 0.09 */
  churchTaxRate: number
  concentrationThresholdPct: number
  brokerFeeEur: number
  /** Manually entered, this year's Vorabpauschale total across the portfolio. Known gap: not computed. */
  vorabpauschaleEur: number
  corsProxyPrefix: string
}

export interface AppState {
  schemaVersion: number
  holdings: Holding[]
  cashBalances: CashBalance[]
  institutions: Institution[]
  settings: Settings
}

export const DEFAULT_TEILFREISTELLUNG: Record<SecurityType, number> = {
  STOCK: 0,
  ETF: 0.3,
  OTHER: 0,
}

/** Confirmed current as of this writing (post-2023 Jahressteuergesetz). Re-verify if tax law changes. */
export const SPARERPAUSCHBETRAG: Record<FilingStatus, number> = {
  single: 1000,
  married: 2000,
}

export function defaultSettings(): Settings {
  return {
    filingStatus: 'single',
    churchTaxEnabled: false,
    churchTaxRate: 0.09,
    concentrationThresholdPct: 10,
    brokerFeeEur: 0,
    vorabpauschaleEur: 0,
    corsProxyPrefix: 'https://corsproxy.io/?url=',
  }
}

export function emptyState(): AppState {
  return {
    schemaVersion: 1,
    holdings: [],
    cashBalances: [],
    institutions: [],
    settings: defaultSettings(),
  }
}

export function teilfreistellungRateFor(holding: Holding): number {
  if (holding.teilfreistellungOverride != null) return holding.teilfreistellungOverride
  return DEFAULT_TEILFREISTELLUNG[holding.securityType]
}
