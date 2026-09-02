import type { AppState } from '../types'
import { defaultSettings } from '../types'

/**
 * Real, well-known securities (verified against Yahoo Finance's chart endpoint
 * before picking these) so the demo fetches genuine live prices through the
 * normal pipeline instead of faking them — the demo doubles as a smoke test
 * that price lookups actually work. Lot cost bases are fictional and chosen to
 * illustrate a gain and a loss scenario, not real purchase history.
 *
 * Deliberately touches every field the app has: three institutions with
 * different broker fees and loss-pot carry-in balances, a Bestandsschutz
 * (pre-2009) lot, a Teilfreistellung override, and cash balances spanning
 * all three interest payout frequencies — so loading demo data shows what
 * each part of the app actually does instead of just a plausible-looking
 * portfolio.
 */
/** `existingCorsProxyPrefix`, if given, is preserved rather than reset to default — a user's already-configured proxy shouldn't be silently clobbered by loading demo data. */
export function buildDemoState(existingCorsProxyPrefix?: string): AppState {
  const institutions = [
    {
      id: 'demo-inst-main',
      label: 'Hauptbroker',
      submittedEur: 500,
      usedEur: 210,
      brokerFeeEur: 1.0,
      lossPotEquitiesEur: 300, // banked from an earlier stock sale this year - nets against Apple's gain below
    },
    {
      id: 'demo-inst-second',
      label: 'Zweitdepot',
      submittedEur: 300,
      usedEur: 0,
      brokerFeeEur: 0,
      lossPotGeneralEur: 500, // banked from an earlier fund sale this year - nets against VWCE's gain below
    },
    { id: 'demo-inst-third', label: 'Neobroker', submittedEur: 200, usedEur: 50, brokerFeeEur: 0.99 },
  ]

  const holdings = [
    {
      id: 'demo-aapl',
      identifier: 'AAPL',
      displayName: 'Apple Inc.',
      securityType: 'STOCK' as const,
      institutionId: 'demo-inst-main',
      lots: [
        { id: 'l0', acquiredAt: '2003-04-01', quantity: 5, unitCostEur: 8.0, note: 'Bestandsschutz — acquired before 2009, permanently tax-exempt' },
        { id: 'l1', acquiredAt: '2017-03-01', quantity: 15, unitCostEur: 42.5, note: 'Initial purchase' },
        { id: 'l2', acquiredAt: '2019-11-15', quantity: 10, unitCostEur: 88.0 },
        { id: 'l3', acquiredAt: '2023-06-10', quantity: 5, unitCostEur: 260.0 },
      ],
    },
    {
      id: 'demo-basf',
      identifier: 'BAS.DE',
      displayName: 'BASF SE',
      securityType: 'STOCK' as const,
      institutionId: 'demo-inst-main',
      lots: [{ id: 'l4', acquiredAt: '2021-09-01', quantity: 40, unitCostEur: 62.0, note: 'Down since purchase' }],
    },
    {
      id: 'demo-vwce',
      identifier: 'VWCE.DE',
      displayName: 'Vanguard FTSE All-World UCITS ETF',
      securityType: 'ETF' as const,
      institutionId: 'demo-inst-second',
      lots: [
        { id: 'l5', acquiredAt: '2019-08-01', quantity: 60, unitCostEur: 55.0 },
        { id: 'l6', acquiredAt: '2022-04-01', quantity: 30, unitCostEur: 110.0 },
      ],
    },
    {
      id: 'demo-euna',
      identifier: 'EUNA.DE',
      displayName: 'iShares Core Global Aggregate Bond UCITS ETF',
      securityType: 'ETF' as const,
      institutionId: 'demo-inst-third',
      teilfreistellungOverride: 0, // bond funds don't qualify for the equity-fund Teilfreistellung
      lots: [{ id: 'l7', acquiredAt: '2020-05-01', quantity: 500, unitCostEur: 5.1, note: 'Bond fund, no Teilfreistellung' }],
    },
  ]

  const cashBalances = [
    { id: 'demo-cash-1', label: 'Tagesgeld', amountEur: 3500, institutionId: 'demo-inst-main', interestRatePct: 2.5, interestPayoutFrequency: 'monthly' as const },
    { id: 'demo-cash-2', label: 'Girokonto', amountEur: 800, institutionId: 'demo-inst-main', interestRatePct: 0, interestPayoutFrequency: 'annually' as const },
    { id: 'demo-cash-3', label: 'Festgeld', amountEur: 2000, institutionId: 'demo-inst-third', interestRatePct: 3.2, interestPayoutFrequency: 'quarterly' as const },
  ]

  return {
    schemaVersion: 1,
    holdings,
    cashBalances,
    institutions,
    settings: {
      ...defaultSettings(),
      filingStatus: 'single',
      ...(existingCorsProxyPrefix ? { corsProxyPrefix: existingCorsProxyPrefix } : {}),
    },
  }
}

export function isDemoHoldingId(id: string): boolean {
  return id.startsWith('demo-')
}
