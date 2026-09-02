export type FilingStatus = 'single' | 'married'
export type SecurityType = 'STOCK' | 'ETF' | 'OTHER'

export interface Institution {
  id: string
  label: string
  /** Freistellungsauftrag amount filed at this institution, EUR/year. */
  submittedEur: number
  /** Allowance already consumed at this institution this year, as reported by the broker. */
  usedEur: number
  /** Flat fee this institution charges per sell order, EUR - varies by broker (e.g. some neobrokers charge under 1 EUR/trade, others charge more). Optional/defaults to 0 so existing saved data doesn't need a migration. */
  brokerFeeEur?: number
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

export type InterestPayoutFrequency = 'monthly' | 'quarterly' | 'annually'

export interface CashBalance {
  id: string
  label: string
  amountEur: number
  institutionId: string
  /** Annual interest rate, e.g. 2.5 meaning 2.5%/year. Counts toward that institution's Sparerpauschbetrag same as dividends. Optional/defaults to 0 (no interest) when unset. */
  interestRatePct?: number
  /** How often the account pays out interest - affects how much of this year's interest is still ahead vs. already paid. Defaults to 'annually' when unset. */
  interestPayoutFrequency?: InterestPayoutFrequency
}

export interface Settings {
  filingStatus: FilingStatus
  churchTaxEnabled: boolean
  /** e.g. 0.08 or 0.09 */
  churchTaxRate: number
  concentrationThresholdPct: number
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

/** Sentinel for `Settings.corsProxyPrefix`: try a short built-in chain of public proxies rather than a single fixed one. Any other value is used as an exclusive, user-chosen override. */
export const AUTO_PROXY = 'auto'

export function defaultSettings(): Settings {
  return {
    filingStatus: 'single',
    churchTaxEnabled: false,
    churchTaxRate: 0.09,
    concentrationThresholdPct: 10,
    vorabpauschaleEur: 0,
    corsProxyPrefix: AUTO_PROXY,
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
