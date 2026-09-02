import { describe, expect, it } from 'vitest'
import type { Holding, Institution, Lot, Settings } from '../types'
import { defaultSettings } from '../types'
import {
  applyAllowance,
  applyTeilfreistellung,
  checkAllowanceOverAllocation,
  computeHoldingSale,
  consumeLotsFifo,
  effectiveTaxRate,
  netTaxPools,
  remainingAllowance,
  settleInstitutionTax,
  suggestInstitutionToTrim,
} from './tax'

function lot(id: string, acquiredAt: string, quantity: number, unitCostEur: number): Lot {
  return { id, acquiredAt, quantity, unitCostEur }
}

function stock(overrides: Partial<Holding> = {}): Holding {
  return {
    id: 'h1',
    identifier: 'US0000000000',
    displayName: 'Test Stock',
    securityType: 'STOCK',
    institutionId: 'inst1',
    lots: [],
    ...overrides,
  }
}

function etf(overrides: Partial<Holding> = {}): Holding {
  return {
    id: 'h2',
    identifier: 'IE0000000000',
    displayName: 'Test ETF',
    securityType: 'ETF',
    institutionId: 'inst1',
    lots: [],
    ...overrides,
  }
}

describe('consumeLotsFifo', () => {
  it('consumes the oldest lot first', () => {
    const lots = [lot('b', '2023-01-01', 10, 50), lot('a', '2020-01-01', 10, 20)]
    const result = consumeLotsFifo(lots, 10)
    expect(result.consumed).toHaveLength(1)
    expect(result.consumed[0].lot.id).toBe('a')
    expect(result.shortfallQuantity).toBe(0)
  })

  it('splits a lot when a sale only partially consumes it', () => {
    const lots = [lot('a', '2020-01-01', 10, 20), lot('b', '2023-01-01', 10, 50)]
    const result = consumeLotsFifo(lots, 15)
    expect(result.consumed).toHaveLength(2)
    expect(result.consumed[0]).toMatchObject({ quantity: 10, costBasisEur: 200 })
    expect(result.consumed[1]).toMatchObject({ quantity: 5, costBasisEur: 250 })
  })

  it('understates cost basis if a blended average were used instead — cheapest lots go first on appreciation', () => {
    // Repeated small purchases at rising prices: FIFO consumes the cheapest (highest-gain) lot first.
    const lots = [lot('cheap', '2018-01-01', 5, 10), lot('expensive', '2024-01-01', 5, 90)]
    const result = consumeLotsFifo(lots, 5)
    expect(result.consumed[0].lot.id).toBe('cheap')
    expect(result.consumed[0].costBasisEur).toBe(50)
  })

  it('reports a shortfall when selling more than is held', () => {
    const result = consumeLotsFifo([lot('a', '2020-01-01', 5, 10)], 8)
    expect(result.shortfallQuantity).toBe(3)
    expect(result.consumed[0].quantity).toBe(5)
  })
})

describe('applyTeilfreistellung', () => {
  it('shields 30% of a gain', () => {
    expect(applyTeilfreistellung(1000, 0.3)).toBeCloseTo(700)
  })

  it('shields 30% of a loss symmetrically, not just gains', () => {
    expect(applyTeilfreistellung(-1000, 0.3)).toBeCloseTo(-700)
  })

  it('is a no-op at 0% (individual stocks)', () => {
    expect(applyTeilfreistellung(500, 0)).toBe(500)
    expect(applyTeilfreistellung(-500, 0)).toBe(-500)
  })
})

describe('computeHoldingSale', () => {
  it('computes gross and post-Teilfreistellung gain for a stock (0% shield)', () => {
    const h = stock({ lots: [lot('a', '2020-01-01', 10, 20)] })
    const result = computeHoldingSale(h, 10, 50)
    expect(result.grossGainLossEur).toBeCloseTo(300)
    expect(result.taxableGainLossEur).toBeCloseTo(300)
    expect(result.pool).toBe('STOCK')
  })

  it('applies the 30% ETF shield to the taxable amount only', () => {
    const h = etf({ lots: [lot('a', '2020-01-01', 10, 20)] })
    const result = computeHoldingSale(h, 10, 50)
    expect(result.grossGainLossEur).toBeCloseTo(300)
    expect(result.taxableGainLossEur).toBeCloseTo(210)
    expect(result.pool).toBe('FUND')
  })
})

describe('netTaxPools — the asymmetric §20 EStG rule', () => {
  it('strands a stock loss: it must NOT offset a fund gain', () => {
    // -1000 stock loss, +800 fund gain -> only the fund's own positive result is taxable.
    expect(netTaxPools(-1000, 800)).toBe(800)
  })

  it('lets a fund loss offset a stock gain', () => {
    // +1000 stock gain, -300 fund loss -> reduces the stock gain.
    expect(netTaxPools(1000, -300)).toBe(700)
  })

  it('floors a fund loss offsetting a stock gain at zero, never goes negative', () => {
    expect(netTaxPools(200, -900)).toBe(0)
  })

  it('sums two positive pools directly', () => {
    expect(netTaxPools(500, 300)).toBe(800)
  })

  it('is fully stranded when both pools are negative', () => {
    expect(netTaxPools(-500, -300)).toBe(0)
  })
})

describe('applyAllowance', () => {
  it('shields up to the remaining allowance, taxing only the excess', () => {
    expect(applyAllowance(1200, 1000)).toEqual({ taxableAfterAllowanceEur: 200, allowanceUsedEur: 1000 })
  })

  it('does not use more allowance than the taxable amount needs', () => {
    expect(applyAllowance(300, 1000)).toEqual({ taxableAfterAllowanceEur: 0, allowanceUsedEur: 300 })
  })

  it('is a no-op on a non-positive taxable amount', () => {
    expect(applyAllowance(0, 1000)).toEqual({ taxableAfterAllowanceEur: 0, allowanceUsedEur: 0 })
    expect(applyAllowance(-50, 1000)).toEqual({ taxableAfterAllowanceEur: 0, allowanceUsedEur: 0 })
  })
})

describe('effectiveTaxRate', () => {
  it('is 26.375% flat with no church tax', () => {
    const settings: Settings = { ...defaultSettings(), churchTaxEnabled: false }
    expect(effectiveTaxRate(settings)).toBeCloseTo(0.26375)
  })

  it('adds church tax as a flat rate add-on when enabled', () => {
    const settings: Settings = { ...defaultSettings(), churchTaxEnabled: true, churchTaxRate: 0.09 }
    expect(effectiveTaxRate(settings)).toBeCloseTo(0.25 * (1 + 0.055 + 0.09))
  })
})

describe('settleInstitutionTax end to end', () => {
  it('nets pools, applies allowance, then taxes the remainder', () => {
    const settings: Settings = { ...defaultSettings(), churchTaxEnabled: false }
    // stock gain 1000, fund loss -200 -> net 800; allowance 500 remaining -> taxable 300
    const summary = settleInstitutionTax('inst1', 1000, -200, 500, settings)
    expect(summary.netTaxableBeforeAllowanceEur).toBe(800)
    expect(summary.allowanceUsedEur).toBe(500)
    expect(summary.taxableAfterAllowanceEur).toBe(300)
    expect(summary.taxEur).toBeCloseTo(300 * 0.26375)
  })
})

describe('remainingAllowance', () => {
  it('derives remaining from submitted minus used, never stored directly', () => {
    const inst: Institution = { id: 'i1', label: 'Broker A', submittedEur: 1000, usedEur: 400 }
    expect(remainingAllowance(inst)).toBe(600)
  })

  it('floors at zero if used somehow exceeds submitted', () => {
    const inst: Institution = { id: 'i1', label: 'Broker A', submittedEur: 500, usedEur: 700 }
    expect(remainingAllowance(inst)).toBe(0)
  })
})

describe('checkAllowanceOverAllocation', () => {
  it('flags when submitted amounts across institutions exceed the annual cap', () => {
    const institutions: Institution[] = [
      { id: 'i1', label: 'Broker A', submittedEur: 700, usedEur: 0 },
      { id: 'i2', label: 'Broker B', submittedEur: 600, usedEur: 0 },
    ]
    const result = checkAllowanceOverAllocation(institutions, 'single')
    expect(result.totalSubmittedEur).toBe(1300)
    expect(result.capEur).toBe(1000)
    expect(result.isOverAllocated).toBe(true)
    expect(result.excessEur).toBe(300)
  })

  it('does not flag when within the cap', () => {
    const institutions: Institution[] = [{ id: 'i1', label: 'Broker A', submittedEur: 900, usedEur: 0 }]
    const result = checkAllowanceOverAllocation(institutions, 'single')
    expect(result.isOverAllocated).toBe(false)
  })
})

describe('suggestInstitutionToTrim', () => {
  it('picks the institution with the most unused headroom, not the lowest usage', () => {
    const institutions: Institution[] = [
      // Lower usedEur, but also lower submittedEur -> less headroom than B.
      { id: 'a', label: 'A', submittedEur: 300, usedEur: 50 }, // headroom 250
      { id: 'b', label: 'B', submittedEur: 1000, usedEur: 200 }, // headroom 800
    ]
    expect(suggestInstitutionToTrim(institutions)?.id).toBe('b')
  })
})
