import { describe, expect, it } from 'vitest'
import type { CashBalance, Holding, Institution } from '../types'
import { defaultSettings } from '../types'
import { concentrationPct, recommend, retirementReference, totalQuantity } from './recommend'

const institutions: Institution[] = [{ id: 'inst1', label: 'Broker A', submittedEur: 1000, usedEur: 0 }]

function holding(overrides: Partial<Holding>): Holding {
  return {
    id: overrides.id ?? 'h',
    identifier: 'X',
    displayName: overrides.id ?? 'Holding',
    securityType: 'STOCK',
    institutionId: 'inst1',
    lots: [],
    ...overrides,
  }
}

describe('recommend — cash-first', () => {
  it('covers the need entirely from cash when sufficient, recommending no sales', () => {
    const cashBalances: CashBalance[] = [{ id: 'c1', label: 'Tagesgeld', amountEur: 5000, institutionId: 'inst1' }]
    const result = recommend({
      amountNeededEur: 2000,
      holdings: [],
      cashBalances,
      institutions,
      settings: defaultSettings(),
      prices: {},
    })
    expect(result.cashUsedEur).toBe(2000)
    expect(result.remainingNeededAfterCashEur).toBe(0)
    expect(result.taxOptimizedPlan).toBeNull()
    expect(result.riskReductionPlan).toBeNull()
  })

  it('uses all available cash first, then sells to cover the remainder', () => {
    const cashBalances: CashBalance[] = [{ id: 'c1', label: 'Tagesgeld', amountEur: 500, institutionId: 'inst1' }]
    const h = holding({ id: 'h1', lots: [{ id: 'l1', acquiredAt: '2020-01-01', quantity: 10, unitCostEur: 20 }] })
    const result = recommend({
      amountNeededEur: 1500,
      holdings: [h],
      cashBalances,
      institutions,
      settings: defaultSettings(),
      prices: { h1: 100 },
    })
    expect(result.cashUsedEur).toBe(500)
    expect(result.remainingNeededAfterCashEur).toBe(1000)
    expect(result.taxOptimizedPlan?.lineItems[0].quantitySold).toBeCloseTo(10) // full position = 1000 EUR exactly
    expect(result.taxOptimizedPlan?.lineItems[0].isFullPosition).toBe(true)
  })
})

describe('recommend — tax-optimized lens', () => {
  it('sells a loss-making holding before a gain-making one', () => {
    const lossHolding = holding({
      id: 'loser',
      lots: [{ id: 'l1', acquiredAt: '2020-01-01', quantity: 10, unitCostEur: 100 }],
    })
    const gainHolding = holding({
      id: 'winner',
      lots: [{ id: 'l2', acquiredAt: '2020-01-01', quantity: 10, unitCostEur: 10 }],
    })
    const result = recommend({
      amountNeededEur: 500,
      holdings: [lossHolding, gainHolding],
      cashBalances: [],
      institutions,
      settings: defaultSettings(),
      prices: { loser: 50, winner: 50 }, // loser: -500 loss; winner: +400 gain
    })
    expect(result.taxOptimizedPlan?.lineItems[0].holdingId).toBe('loser')
  })

  it('produces a partial sale on the last holding needed, sized to hit the gross target', () => {
    const h = holding({ id: 'h1', lots: [{ id: 'l1', acquiredAt: '2020-01-01', quantity: 100, unitCostEur: 5 }] })
    const result = recommend({
      amountNeededEur: 250,
      holdings: [h],
      cashBalances: [],
      institutions,
      settings: defaultSettings(),
      prices: { h1: 10 },
    })
    const item = result.taxOptimizedPlan!.lineItems[0]
    expect(item.isFullPosition).toBe(false)
    expect(item.quantitySold).toBeCloseTo(25) // 25 * 10 = 250
  })

  it('flags a shortfall when total holdings + cash cannot cover the request', () => {
    const h = holding({ id: 'h1', lots: [{ id: 'l1', acquiredAt: '2020-01-01', quantity: 5, unitCostEur: 5 }] })
    const result = recommend({
      amountNeededEur: 1000,
      holdings: [h],
      cashBalances: [],
      institutions,
      settings: defaultSettings(),
      prices: { h1: 10 }, // only 50 EUR available
    })
    expect(result.taxOptimizedPlan?.shortfallEur).toBeCloseTo(950)
  })
})

describe('recommend — Bestandsschutz (pre-2009 lots)', () => {
  it('ranks a fully pre-2009 gain ahead of an equal post-2009 gain in the tax-optimized lens', () => {
    const oldHolding = holding({
      id: 'old',
      lots: [{ id: 'l1', acquiredAt: '2005-01-01', quantity: 10, unitCostEur: 10 }],
    })
    const newHolding = holding({
      id: 'new',
      lots: [{ id: 'l2', acquiredAt: '2020-01-01', quantity: 10, unitCostEur: 10 }],
    })
    const result = recommend({
      amountNeededEur: 500,
      holdings: [oldHolding, newHolding],
      cashBalances: [],
      institutions,
      settings: defaultSettings(),
      prices: { old: 50, new: 50 }, // identical +400 gain on both
    })
    expect(result.taxOptimizedPlan?.lineItems[0].holdingId).toBe('old')
  })

  it('mentions Bestandsschutz in the rationale for a fully pre-2009 sale', () => {
    const oldHolding = holding({
      id: 'old',
      lots: [{ id: 'l1', acquiredAt: '2005-01-01', quantity: 10, unitCostEur: 10 }],
    })
    const result = recommend({
      amountNeededEur: 500,
      holdings: [oldHolding],
      cashBalances: [],
      institutions,
      settings: defaultSettings(),
      prices: { old: 50 },
    })
    expect(result.taxOptimizedPlan?.lineItems[0].rationale).toMatch(/Bestandsschutz/)
    expect(result.taxOptimizedPlan?.lineItems[0].exemptGrossGainLossEur).toBeCloseTo(400)
  })
})

describe('recommend — risk-reduction lens', () => {
  it('ranks stocks above funds and by concentration descending', () => {
    const smallStock = holding({
      id: 'smallStock',
      securityType: 'STOCK',
      lots: [{ id: 'l1', acquiredAt: '2020-01-01', quantity: 10, unitCostEur: 5 }],
    })
    const bigStock = holding({
      id: 'bigStock',
      securityType: 'STOCK',
      lots: [{ id: 'l2', acquiredAt: '2020-01-01', quantity: 100, unitCostEur: 5 }],
    })
    const fund = holding({
      id: 'fund',
      securityType: 'ETF',
      lots: [{ id: 'l3', acquiredAt: '2020-01-01', quantity: 1000, unitCostEur: 5 }],
    })
    const result = recommend({
      amountNeededEur: 100,
      holdings: [smallStock, bigStock, fund],
      cashBalances: [],
      institutions,
      settings: defaultSettings(),
      prices: { smallStock: 10, bigStock: 10, fund: 10 },
    })
    expect(result.riskReductionPlan?.lineItems[0].holdingId).toBe('bigStock')
  })
})

describe('recommend — excludes holdings with no fetchable price', () => {
  it('flags them for manual review instead of guessing', () => {
    const priced = holding({ id: 'priced', lots: [{ id: 'l1', acquiredAt: '2020-01-01', quantity: 10, unitCostEur: 5 }] })
    const unpriced = holding({ id: 'unpriced', lots: [{ id: 'l2', acquiredAt: '2020-01-01', quantity: 10, unitCostEur: 5 }] })
    const result = recommend({
      amountNeededEur: 50,
      holdings: [priced, unpriced],
      cashBalances: [],
      institutions,
      settings: defaultSettings(),
      prices: { priced: 10 },
    })
    expect(result.holdingsExcludedNoPrice.map((h) => h.id)).toEqual(['unpriced'])
  })
})

describe('concentrationPct and totalQuantity', () => {
  it('computes concentration as share of total holdings value, not including cash', () => {
    const a = holding({ id: 'a', lots: [{ id: 'l1', acquiredAt: '2020-01-01', quantity: 10, unitCostEur: 1 }] })
    const b = holding({ id: 'b', lots: [{ id: 'l2', acquiredAt: '2020-01-01', quantity: 10, unitCostEur: 1 }] })
    const prices = { a: 90, b: 10 } // a=900, b=100, total=1000
    expect(concentrationPct(a, [a, b], prices)).toBeCloseTo(0.9)
    expect(totalQuantity(a)).toBe(10)
  })
})

describe('recommend — agreedByBothLenses', () => {
  it('flags a holding picked by both lenses, and only that one', () => {
    // "agreed" is both the biggest loss (tax-optimized picks it first) and the
    // biggest concentration (risk-reduction picks it first too).
    const agreed = holding({
      id: 'agreed',
      lots: [{ id: 'l1', acquiredAt: '2020-01-01', quantity: 100, unitCostEur: 100 }], // huge loss, huge position
    })
    const taxOnly = holding({
      id: 'taxOnly',
      lots: [{ id: 'l2', acquiredAt: '2020-01-01', quantity: 1, unitCostEur: 100 }], // tiny loss, tiny position
    })
    const result = recommend({
      amountNeededEur: 1_000_000, // force both plans to need every holding
      holdings: [agreed, taxOnly],
      cashBalances: [],
      institutions,
      settings: defaultSettings(),
      prices: { agreed: 1, taxOnly: 1 },
    })
    const taxItem = result.taxOptimizedPlan!.lineItems.find((li) => li.holdingId === 'agreed')!
    const riskItem = result.riskReductionPlan!.lineItems.find((li) => li.holdingId === 'agreed')!
    expect(taxItem.agreedByBothLenses).toBe(true)
    expect(riskItem.agreedByBothLenses).toBe(true)
  })

  it('does not flag a holding that only one lens needed to pick', () => {
    const smallLoss = holding({
      id: 'smallLoss',
      lots: [{ id: 'l1', acquiredAt: '2020-01-01', quantity: 10, unitCostEur: 20 }],
    })
    const bigGainBigPosition = holding({
      id: 'bigGain',
      lots: [{ id: 'l2', acquiredAt: '2020-01-01', quantity: 1000, unitCostEur: 1 }],
    })
    // Amount needed is covered entirely by the small loss holding, so neither
    // lens needs to touch the big-gain/big-concentration holding at all.
    const result = recommend({
      amountNeededEur: 50,
      holdings: [smallLoss, bigGainBigPosition],
      cashBalances: [],
      institutions,
      settings: defaultSettings(),
      prices: { smallLoss: 10, bigGain: 10 },
    })
    const taxItem = result.taxOptimizedPlan!.lineItems.find((li) => li.holdingId === 'smallLoss')!
    expect(taxItem.agreedByBothLenses).toBe(false)
  })
})

describe('recommend — isFractionalUnit', () => {
  it('flags a partial sale that requires a non-whole quantity', () => {
    const h = holding({ id: 'h1', lots: [{ id: 'l1', acquiredAt: '2020-01-01', quantity: 100, unitCostEur: 5 }] })
    const result = recommend({
      amountNeededEur: 233, // 233 / 10 = 23.3, not a whole number
      holdings: [h],
      cashBalances: [],
      institutions,
      settings: defaultSettings(),
      prices: { h1: 10 },
    })
    expect(result.taxOptimizedPlan?.lineItems[0].isFractionalUnit).toBe(true)
  })

  it('does not flag a full-position sale (whole quantity by construction)', () => {
    const h = holding({ id: 'h1', lots: [{ id: 'l1', acquiredAt: '2020-01-01', quantity: 10, unitCostEur: 5 }] })
    const result = recommend({
      amountNeededEur: 100,
      holdings: [h],
      cashBalances: [],
      institutions,
      settings: defaultSettings(),
      prices: { h1: 10 },
    })
    expect(result.taxOptimizedPlan?.lineItems[0].isFractionalUnit).toBe(false)
  })
})

describe('recommend — per-institution broker fees', () => {
  it('charges each holding once at its own institution\'s fee rate, not a shared global rate', () => {
    const institutionsWithFees: Institution[] = [
      { id: 'cheap', label: 'Cheap broker', submittedEur: 1000, usedEur: 0, brokerFeeEur: 0.99 },
      { id: 'pricey', label: 'Pricey broker', submittedEur: 1000, usedEur: 0, brokerFeeEur: 5 },
    ]
    const a = holding({
      id: 'a',
      institutionId: 'cheap',
      lots: [{ id: 'l1', acquiredAt: '2020-01-01', quantity: 10, unitCostEur: 100 }], // loss, sells fully
    })
    const b = holding({
      id: 'b',
      institutionId: 'pricey',
      lots: [{ id: 'l2', acquiredAt: '2020-01-01', quantity: 10, unitCostEur: 100 }], // loss, sells fully
    })
    const result = recommend({
      amountNeededEur: 1000, // forces both holdings to be sold (500 + 500 = 1000)
      holdings: [a, b],
      cashBalances: [],
      institutions: institutionsWithFees,
      settings: defaultSettings(),
      prices: { a: 50, b: 50 },
    })
    expect(result.taxOptimizedPlan?.totalFeesEur).toBeCloseTo(0.99 + 5)
  })

  it('charges the fee once per holding touched, not per lot consumed within it', () => {
    const institutionsWithFees: Institution[] = [{ id: 'inst1', label: 'Broker A', submittedEur: 1000, usedEur: 0, brokerFeeEur: 2 }]
    const h = holding({
      id: 'h1',
      institutionId: 'inst1',
      lots: [
        { id: 'l1', acquiredAt: '2020-01-01', quantity: 5, unitCostEur: 10 },
        { id: 'l2', acquiredAt: '2021-01-01', quantity: 5, unitCostEur: 10 },
      ],
    })
    const result = recommend({
      amountNeededEur: 100,
      holdings: [h],
      cashBalances: [],
      institutions: institutionsWithFees,
      settings: defaultSettings(),
      prices: { h1: 10 },
    })
    expect(result.taxOptimizedPlan?.lineItems[0].isFullPosition).toBe(true) // consumes both lots in one sale
    expect(result.taxOptimizedPlan?.totalFeesEur).toBeCloseTo(2) // one fee, not two
  })

  it('treats a missing brokerFeeEur as zero rather than throwing', () => {
    const institutionsNoFee: Institution[] = [{ id: 'inst1', label: 'Broker A', submittedEur: 1000, usedEur: 0 }]
    const h = holding({ id: 'h1', institutionId: 'inst1', lots: [{ id: 'l1', acquiredAt: '2020-01-01', quantity: 10, unitCostEur: 10 }] })
    const result = recommend({
      amountNeededEur: 100,
      holdings: [h],
      cashBalances: [],
      institutions: institutionsNoFee,
      settings: defaultSettings(),
      prices: { h1: 10 },
    })
    expect(result.taxOptimizedPlan?.totalFeesEur).toBe(0)
  })
})

describe('retirementReference', () => {
  it('returns a 3-4% range that never caps the requested amount', () => {
    const ref = retirementReference(100_000)
    expect(ref.lowEur).toBeCloseTo(3000)
    expect(ref.highEur).toBeCloseTo(4000)
  })
})
