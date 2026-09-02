import { describe, expect, it } from 'vitest'
import type { CashBalance, Holding, Institution } from '../types'
import { defaultSettings } from '../types'
import {
  buildRecommendationSummaryText,
  computeExecutionUpdates,
  computeFullLiquidationSummary,
  concentrationPct,
  findTaxLossHarvestingOpportunities,
  recommend,
  retirementReference,
  totalQuantity,
} from './recommend'

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

describe('recommend — loss pot carry-in', () => {
  it('reduces tax on a new stock gain by an institution\'s existing banked equity loss pot', () => {
    const withLossPot: Institution[] = [{ id: 'inst1', label: 'Broker A', submittedEur: 0, usedEur: 0, lossPotEquitiesEur: 1000 }]
    const h = holding({
      id: 'h1',
      institutionId: 'inst1',
      lots: [{ id: 'l1', acquiredAt: '2020-01-01', quantity: 10, unitCostEur: 10 }], // gain
    })
    const withCarryIn = recommend({
      amountNeededEur: 500,
      holdings: [h],
      cashBalances: [],
      institutions: withLossPot,
      settings: defaultSettings(),
      prices: { h1: 50 }, // gross gain 400
    })
    const withoutLossPot: Institution[] = [{ id: 'inst1', label: 'Broker A', submittedEur: 0, usedEur: 0 }]
    const withoutCarryIn = recommend({
      amountNeededEur: 500,
      holdings: [h],
      cashBalances: [],
      institutions: withoutLossPot,
      settings: defaultSettings(),
      prices: { h1: 50 },
    })
    expect(withCarryIn.taxOptimizedPlan?.totalTaxEur).toBe(0) // 400 gain fully absorbed by the 1000 loss pot
    expect(withoutCarryIn.taxOptimizedPlan?.totalTaxEur).toBeGreaterThan(0)
  })

  it('ranks a gain-making holding as favorably as a loss when its institution has enough banked loss to absorb it', () => {
    const withLossPot: Institution[] = [{ id: 'inst1', label: 'Broker A', submittedEur: 0, usedEur: 0, lossPotEquitiesEur: 1000 }]
    const shielded = holding({
      id: 'shielded',
      institutionId: 'inst1',
      lots: [{ id: 'l1', acquiredAt: '2020-01-01', quantity: 10, unitCostEur: 10 }], // +400 gain, fully absorbed by loss pot
    })
    const unshielded = holding({
      id: 'unshielded',
      institutionId: 'inst1',
      lots: [{ id: 'l2', acquiredAt: '2020-01-01', quantity: 10, unitCostEur: 30 }], // +200 gain, no loss pot left after "shielded" consumes it standalone... but ranking is per-holding standalone, so this alone would also see the same 1000 loss pot
    })
    const result = recommend({
      amountNeededEur: 100, // small enough that only one holding is needed
      holdings: [shielded, unshielded],
      cashBalances: [],
      institutions: withLossPot,
      settings: defaultSettings(),
      prices: { shielded: 50, unshielded: 50 },
    })
    // Both gains are individually fully absorbed by the standalone 1000 loss pot estimate, so both rank at the
    // cheapest tier (tied) - the point is neither is penalized as if the loss pot didn't exist.
    const pickedId = result.taxOptimizedPlan?.lineItems[0].holdingId
    expect(['shielded', 'unshielded']).toContain(pickedId)
    expect(result.taxOptimizedPlan?.totalTaxEur).toBe(0)
  })

  it('shows the projected remaining loss pot after the plan in the institution breakdown', () => {
    const withLossPot: Institution[] = [{ id: 'inst1', label: 'Broker A', submittedEur: 0, usedEur: 0, lossPotEquitiesEur: 1000 }]
    const h = holding({
      id: 'h1',
      institutionId: 'inst1',
      lots: [{ id: 'l1', acquiredAt: '2020-01-01', quantity: 10, unitCostEur: 10 }], // +400 gain
    })
    const result = recommend({
      amountNeededEur: 500,
      holdings: [h],
      cashBalances: [],
      institutions: withLossPot,
      settings: defaultSettings(),
      prices: { h1: 50 },
    })
    const breakdown = result.taxOptimizedPlan?.institutionBreakdown[0]
    expect(breakdown?.carryInLossPotEquitiesEur).toBe(1000)
    expect(breakdown?.projectedRemainingLossPots.remainingEquityLossPotEur).toBe(600) // 1000 - 400 gain consumed
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

describe('buildRecommendationSummaryText', () => {
  it('includes the requested amount, cash figures, and a no-sales-needed line when cash alone covers it', () => {
    const result = recommend({
      amountNeededEur: 500,
      holdings: [],
      cashBalances: [{ id: 'c1', label: 'Tagesgeld', amountEur: 5000, institutionId: 'inst1' }],
      institutions,
      settings: defaultSettings(),
      prices: {},
    })
    const text = buildRecommendationSummaryText(result, new Date('2026-01-15T00:00:00Z'))
    expect(text).toContain('500,00')
    expect(text).toContain('Generated 2026-01-15')
    expect(text).toContain('No sales needed')
    expect(text).toContain('Not financial or tax advice')
  })

  it('includes each line item, its rationale, and the institution breakdown for an actual sale plan', () => {
    const h = holding({
      id: 'h1',
      displayName: 'Test Holding',
      lots: [{ id: 'l1', acquiredAt: '2020-01-01', quantity: 10, unitCostEur: 100 }], // loss
    })
    const result = recommend({
      amountNeededEur: 500,
      holdings: [h],
      cashBalances: [],
      institutions,
      settings: defaultSettings(),
      prices: { h1: 50 },
    })
    const text = buildRecommendationSummaryText(result)
    expect(text).toContain('Test Holding')
    expect(text).toContain('Realizes a loss')
    expect(text).toContain('Per-institution tax breakdown')
    expect(text).toContain('Broker A') // institution label
  })

  it('mentions holdings excluded for having no fetchable price', () => {
    const priced = holding({ id: 'priced', lots: [{ id: 'l1', acquiredAt: '2020-01-01', quantity: 10, unitCostEur: 5 }] })
    const unpriced = holding({ id: 'unpriced', displayName: 'No Price Co', lots: [{ id: 'l2', acquiredAt: '2020-01-01', quantity: 10, unitCostEur: 5 }] })
    const result = recommend({
      amountNeededEur: 50,
      holdings: [priced, unpriced],
      cashBalances: [],
      institutions,
      settings: defaultSettings(),
      prices: { priced: 10 },
    })
    const text = buildRecommendationSummaryText(result)
    expect(text).toContain('No Price Co')
    expect(text).toContain('Manual review needed')
  })
})

describe('computeFullLiquidationSummary', () => {
  it('sums gross, exempt, and taxable gain/loss across all priced holdings', () => {
    const gain = holding({ id: 'gain', lots: [{ id: 'l1', acquiredAt: '2020-01-01', quantity: 10, unitCostEur: 10 }] }) // +400
    const loss = holding({ id: 'loss', lots: [{ id: 'l2', acquiredAt: '2020-01-01', quantity: 10, unitCostEur: 100 }] }) // -500
    const summary = computeFullLiquidationSummary([gain, loss], { gain: 50, loss: 50 }, institutions, defaultSettings())
    expect(summary.totalGrossGainLossEur).toBeCloseTo(-100) // 400 - 500
    expect(summary.totalExemptGainLossEur).toBe(0)
    expect(summary.totalTaxableGainLossEur).toBeCloseTo(-100)
  })

  it('applies per-institution netting and loss-pot carry-in, same as an actual plan', () => {
    const withLossPot: Institution[] = [{ id: 'inst1', label: 'Broker A', submittedEur: 0, usedEur: 0, lossPotEquitiesEur: 1000 }]
    const h = holding({ id: 'h1', institutionId: 'inst1', lots: [{ id: 'l1', acquiredAt: '2020-01-01', quantity: 10, unitCostEur: 10 }] }) // +400
    const summary = computeFullLiquidationSummary([h], { h1: 50 }, withLossPot, defaultSettings())
    expect(summary.estimatedTotalTaxEur).toBe(0) // fully absorbed by the loss pot
    expect(summary.institutionBreakdown[0].projectedRemainingLossPots.remainingEquityLossPotEur).toBe(600)
  })

  it('excludes holdings with no fetchable price rather than guessing', () => {
    const priced = holding({ id: 'priced', lots: [{ id: 'l1', acquiredAt: '2020-01-01', quantity: 10, unitCostEur: 5 }] })
    const unpriced = holding({ id: 'unpriced', lots: [{ id: 'l2', acquiredAt: '2020-01-01', quantity: 10, unitCostEur: 5 }] })
    const summary = computeFullLiquidationSummary([priced, unpriced], { priced: 10 }, institutions, defaultSettings())
    expect(summary.holdingsExcludedNoPrice.map((h) => h.id)).toEqual(['unpriced'])
  })

  it('returns zero across the board for an empty portfolio', () => {
    const summary = computeFullLiquidationSummary([], {}, institutions, defaultSettings())
    expect(summary.totalGrossGainLossEur).toBe(0)
    expect(summary.estimatedTotalTaxEur).toBe(0)
    expect(summary.institutionBreakdown).toEqual([])
  })
})

describe('findTaxLossHarvestingOpportunities', () => {
  it('flags a holding with a real unrealized loss', () => {
    const loss = holding({ id: 'loss', displayName: 'Loser Co', lots: [{ id: 'l1', acquiredAt: '2020-01-01', quantity: 10, unitCostEur: 100 }] }) // -500
    const opportunities = findTaxLossHarvestingOpportunities([loss], { loss: 50 }, institutions)
    expect(opportunities).toHaveLength(1)
    expect(opportunities[0].displayName).toBe('Loser Co')
    expect(opportunities[0].taxableLossEur).toBeCloseTo(500)
  })

  it('does not flag a holding with an unrealized gain', () => {
    const gain = holding({ id: 'gain', lots: [{ id: 'l1', acquiredAt: '2020-01-01', quantity: 10, unitCostEur: 10 }] })
    expect(findTaxLossHarvestingOpportunities([gain], { gain: 50 }, institutions)).toEqual([])
  })

  it('excludes a Bestandsschutz (pre-2009) loss, since it provides no tax benefit to harvest', () => {
    const oldLoss = holding({ id: 'old', lots: [{ id: 'l1', acquiredAt: '2005-01-01', quantity: 10, unitCostEur: 100 }] }) // -500, but exempt
    expect(findTaxLossHarvestingOpportunities([oldLoss], { old: 50 }, institutions)).toEqual([])
  })

  it('sorts opportunities by loss size descending', () => {
    const smallLoss = holding({ id: 'small', lots: [{ id: 'l1', acquiredAt: '2020-01-01', quantity: 10, unitCostEur: 20 }] }) // -100
    const bigLoss = holding({ id: 'big', lots: [{ id: 'l2', acquiredAt: '2020-01-01', quantity: 10, unitCostEur: 100 }] }) // -500
    const opportunities = findTaxLossHarvestingOpportunities([smallLoss, bigLoss], { small: 10, big: 50 }, institutions)
    expect(opportunities.map((o) => o.holdingId)).toEqual(['big', 'small'])
  })

  it('excludes a holding with no fetchable price', () => {
    const unpriced = holding({ id: 'unpriced', lots: [{ id: 'l1', acquiredAt: '2020-01-01', quantity: 10, unitCostEur: 100 }] })
    expect(findTaxLossHarvestingOpportunities([unpriced], {}, institutions)).toEqual([])
  })
})

describe('computeExecutionUpdates', () => {
  it('removes every lot fully consumed by a full-position sale', () => {
    const h = holding({
      id: 'h1',
      lots: [
        { id: 'l1', acquiredAt: '2018-01-01', quantity: 5, unitCostEur: 10 },
        { id: 'l2', acquiredAt: '2020-01-01', quantity: 5, unitCostEur: 20 },
      ],
    })
    const result = recommend({
      amountNeededEur: 1000,
      holdings: [h],
      cashBalances: [],
      institutions,
      settings: defaultSettings(),
      prices: { h1: 100 }, // full position = 10 * 100 = 1000, exactly covers it
    })
    const plan = result.taxOptimizedPlan!
    expect(plan.lineItems[0].isFullPosition).toBe(true)
    const updates = computeExecutionUpdates(plan, [h])
    expect(updates.lotUpdates[0].lotIdsToRemove.sort()).toEqual(['l1', 'l2'])
    expect(updates.lotUpdates[0].lotQuantityUpdates).toEqual([])
  })

  it('reduces (not removes) a lot only partially consumed by a partial sale', () => {
    const h = holding({ id: 'h1', lots: [{ id: 'l1', acquiredAt: '2020-01-01', quantity: 100, unitCostEur: 5 }] })
    const result = recommend({
      amountNeededEur: 250,
      holdings: [h],
      cashBalances: [],
      institutions,
      settings: defaultSettings(),
      prices: { h1: 10 }, // 25 units sold out of 100
    })
    const plan = result.taxOptimizedPlan!
    expect(plan.lineItems[0].isFullPosition).toBe(false)
    const updates = computeExecutionUpdates(plan, [h])
    expect(updates.lotUpdates[0].lotIdsToRemove).toEqual([])
    expect(updates.lotUpdates[0].lotQuantityUpdates).toEqual([{ lotId: 'l1', newQuantity: 75 }])
  })

  it('removes the oldest lot entirely and reduces the next when a partial sale spans two lots', () => {
    const h = holding({
      id: 'h1',
      lots: [
        { id: 'old', acquiredAt: '2018-01-01', quantity: 10, unitCostEur: 5 },
        { id: 'new', acquiredAt: '2022-01-01', quantity: 10, unitCostEur: 5 },
      ],
    })
    const result = recommend({
      amountNeededEur: 150,
      holdings: [h],
      cashBalances: [],
      institutions,
      settings: defaultSettings(),
      prices: { h1: 10 }, // 15 units needed: all 10 of "old" + 5 of "new"
    })
    const updates = computeExecutionUpdates(result.taxOptimizedPlan!, [h])
    expect(updates.lotUpdates[0].lotIdsToRemove).toEqual(['old'])
    expect(updates.lotUpdates[0].lotQuantityUpdates).toEqual([{ lotId: 'new', newQuantity: 5 }])
  })

  it('carries each institution\'s allowance-used delta and projected loss pots from the breakdown', () => {
    const withLossPot: Institution[] = [{ id: 'inst1', label: 'Broker A', submittedEur: 1000, usedEur: 0, lossPotEquitiesEur: 1000 }]
    const h = holding({ id: 'h1', institutionId: 'inst1', lots: [{ id: 'l1', acquiredAt: '2020-01-01', quantity: 10, unitCostEur: 10 }] }) // +400 gain
    const result = recommend({
      amountNeededEur: 500,
      holdings: [h],
      cashBalances: [],
      institutions: withLossPot,
      settings: defaultSettings(),
      prices: { h1: 50 },
    })
    const plan = result.taxOptimizedPlan!
    const updates = computeExecutionUpdates(plan, [h])
    expect(updates.institutionUpdates).toEqual([
      {
        institutionId: 'inst1',
        usedEurDelta: plan.institutionBreakdown[0].allowanceUsedEur,
        newLossPotEquitiesEur: 600, // 1000 - 400 gain consumed
        newLossPotGeneralEur: 0,
      },
    ])
  })

  it('does not duplicate an institution update when two line items share the same institution', () => {
    const h1 = holding({ id: 'h1', lots: [{ id: 'l1', acquiredAt: '2020-01-01', quantity: 10, unitCostEur: 100 }] }) // loss
    const h2 = holding({ id: 'h2', lots: [{ id: 'l2', acquiredAt: '2020-01-01', quantity: 10, unitCostEur: 200 }] }) // bigger loss
    const result = recommend({
      amountNeededEur: 1000,
      holdings: [h1, h2],
      cashBalances: [],
      institutions,
      settings: defaultSettings(),
      prices: { h1: 50, h2: 50 },
    })
    const plan = result.taxOptimizedPlan!
    expect(plan.lineItems.length).toBeGreaterThan(1) // both holdings needed to cover the amount
    const updates = computeExecutionUpdates(plan, [h1, h2])
    const instIds = updates.institutionUpdates.map((u) => u.institutionId)
    expect(new Set(instIds).size).toBe(instIds.length) // no duplicates
  })

  it('skips a line item gracefully if its holding is no longer present', () => {
    const h = holding({ id: 'h1', lots: [{ id: 'l1', acquiredAt: '2020-01-01', quantity: 10, unitCostEur: 10 }] })
    const result = recommend({
      amountNeededEur: 500,
      holdings: [h],
      cashBalances: [],
      institutions,
      settings: defaultSettings(),
      prices: { h1: 50 },
    })
    expect(() => computeExecutionUpdates(result.taxOptimizedPlan!, [])).not.toThrow()
    expect(computeExecutionUpdates(result.taxOptimizedPlan!, []).lotUpdates).toEqual([])
  })
})
