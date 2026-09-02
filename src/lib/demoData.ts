import type { AppState } from '../types'
import { defaultSettings } from '../types'

/**
 * Realistic-looking, entirely fictional portfolio so a first-time visitor can see a
 * recommendation immediately instead of staring at an empty app. None of these
 * tickers/ISINs need to resolve on Yahoo Finance — demo prices are baked in below
 * rather than fetched, so the demo works offline and never burns real API calls.
 */
export const DEMO_PRICES_EUR: Record<string, number> = {
  'demo-mega-stock': 312.4,
  'demo-small-stock': 48.9,
  'demo-world-etf': 94.2,
  'demo-bond-etf': 51.1,
}

export function buildDemoState(): AppState {
  const institutions = [
    { id: 'demo-inst-main', label: 'Hauptbroker', submittedEur: 700, usedEur: 210 },
    { id: 'demo-inst-espp', label: 'Auslands-ESPP-Depot', submittedEur: 300, usedEur: 0 },
  ]

  const holdings = [
    {
      id: 'demo-mega-stock',
      identifier: 'US0000000001',
      displayName: 'Mega Tech Corp (demo)',
      securityType: 'STOCK' as const,
      institutionId: 'demo-inst-main',
      lots: [
        { id: 'l1', acquiredAt: '2017-03-01', quantity: 15, unitCostEur: 42.5, note: 'Initial purchase' },
        { id: 'l2', acquiredAt: '2019-11-15', quantity: 10, unitCostEur: 88.0 },
        { id: 'l3', acquiredAt: '2023-06-10', quantity: 5, unitCostEur: 260.0 },
      ],
    },
    {
      id: 'demo-small-stock',
      identifier: 'DE0000000002',
      displayName: 'Regional Industrial AG (demo)',
      securityType: 'STOCK' as const,
      institutionId: 'demo-inst-main',
      lots: [{ id: 'l4', acquiredAt: '2021-09-01', quantity: 40, unitCostEur: 62.0, note: 'Down since purchase' }],
    },
    {
      id: 'demo-world-etf',
      identifier: 'IE0000000003',
      displayName: 'World Equity ETF (demo)',
      securityType: 'ETF' as const,
      institutionId: 'demo-inst-main',
      lots: [
        { id: 'l5', acquiredAt: '2018-01-15', quantity: 60, unitCostEur: 55.0 },
        { id: 'l6', acquiredAt: '2022-04-01', quantity: 30, unitCostEur: 78.0 },
      ],
    },
    {
      id: 'demo-bond-etf',
      identifier: 'IE0000000004',
      displayName: 'Euro Bond ETF (demo)',
      securityType: 'ETF' as const,
      institutionId: 'demo-inst-espp',
      teilfreistellungOverride: 0, // bond ETFs don't qualify for the equity-fund Teilfreistellung
      lots: [{ id: 'l7', acquiredAt: '2020-05-01', quantity: 50, unitCostEur: 53.0, note: 'Bond fund, no Teilfreistellung' }],
    },
  ]

  const cashBalances = [
    { id: 'demo-cash-1', label: 'Tagesgeld', amountEur: 3500, institutionId: 'demo-inst-main' },
    { id: 'demo-cash-2', label: 'Girokonto', amountEur: 800, institutionId: 'demo-inst-main' },
  ]

  return {
    schemaVersion: 1,
    holdings,
    cashBalances,
    institutions,
    settings: { ...defaultSettings(), filingStatus: 'single' },
  }
}

export function isDemoHoldingId(id: string): boolean {
  return id in DEMO_PRICES_EUR
}
