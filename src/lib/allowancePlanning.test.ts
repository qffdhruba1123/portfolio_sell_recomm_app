import { describe, expect, it } from 'vitest'
import type { Lot } from '../types'
import { estimateRemainingInterestEur, sumDividendsInWindow } from './allowancePlanning'

function lot(id: string, acquiredAt: string, quantity: number): Lot {
  return { id, acquiredAt, quantity, unitCostEur: 0 }
}

function dateMs(iso: string): number {
  return new Date(`${iso}T00:00:00Z`).getTime()
}

describe('sumDividendsInWindow', () => {
  it('weights a dividend by units held on that ex-date', () => {
    const lots = [lot('a', '2020-01-01', 10)]
    const dividends = [{ dateMs: dateMs('2023-06-15'), amount: 2 }]
    const total = sumDividendsInWindow(lots, dividends, new Date('2023-01-01'), new Date('2024-01-01'))
    expect(total).toBe(20) // 10 units * 2/unit
  })

  it('excludes events outside the [yearStart, yearEnd) window', () => {
    const lots = [lot('a', '2020-01-01', 10)]
    const dividends = [
      { dateMs: dateMs('2022-12-31'), amount: 2 }, // just before the window
      { dateMs: dateMs('2023-06-15'), amount: 3 }, // inside
      { dateMs: dateMs('2024-01-01'), amount: 4 }, // exactly at the exclusive end - excluded
    ]
    const total = sumDividendsInWindow(lots, dividends, new Date('2023-01-01T00:00:00Z'), new Date('2024-01-01T00:00:00Z'))
    expect(total).toBe(30) // only the 3/unit event counts
  })

  it('only counts units from lots already acquired by the ex-date, not later purchases', () => {
    const lots = [
      lot('early', '2020-01-01', 10),
      lot('late', '2023-08-01', 5), // acquired after the June ex-date below
    ]
    const dividends = [{ dateMs: dateMs('2023-06-15'), amount: 2 }]
    const total = sumDividendsInWindow(lots, dividends, new Date('2023-01-01'), new Date('2024-01-01'))
    expect(total).toBe(20) // only the 10 units held as of June count, not the 5 bought in August
  })

  it('sums multiple dividend events within the window', () => {
    const lots = [lot('a', '2020-01-01', 4)]
    const dividends = [
      { dateMs: dateMs('2023-03-15'), amount: 1 },
      { dateMs: dateMs('2023-09-15'), amount: 1.5 },
    ]
    const total = sumDividendsInWindow(lots, dividends, new Date('2023-01-01'), new Date('2024-01-01'))
    expect(total).toBeCloseTo(4 * 1 + 4 * 1.5) // 10
  })

  it('returns zero when no lots were held yet at any dividend ex-date', () => {
    const lots = [lot('a', '2023-12-01', 10)]
    const dividends = [{ dateMs: dateMs('2023-06-15'), amount: 2 }]
    const total = sumDividendsInWindow(lots, dividends, new Date('2023-01-01'), new Date('2024-01-01'))
    expect(total).toBe(0)
  })

  it('returns zero for an empty dividend list', () => {
    const lots = [lot('a', '2020-01-01', 10)]
    expect(sumDividendsInWindow(lots, [], new Date('2023-01-01'), new Date('2024-01-01'))).toBe(0)
  })
})

describe('estimateRemainingInterestEur', () => {
  it('projects the full year of interest when asked from January (monthly payouts)', () => {
    const today = new Date('2024-01-15T00:00:00Z')
    const result = estimateRemainingInterestEur(10_000, 2.4, 'monthly', today)
    expect(result).toBeCloseTo(10_000 * 0.024) // all 12 months still ahead
  })

  it('projects only the last month of interest when asked in December (monthly payouts)', () => {
    const today = new Date('2024-12-20T00:00:00Z')
    const result = estimateRemainingInterestEur(10_000, 2.4, 'monthly', today)
    expect(result).toBeCloseTo((10_000 * 0.024) / 12) // 1 of 12 months left
  })

  it('projects half a year of interest when asked exactly mid-year (monthly payouts)', () => {
    const today = new Date('2024-07-01T00:00:00Z') // July = month index 6, 6 months remain
    const result = estimateRemainingInterestEur(12_000, 6, 'monthly', today)
    expect(result).toBeCloseTo((12_000 * 0.06 * 6) / 12)
  })

  it('projects all four quarters when asked from Q1 (quarterly payouts)', () => {
    const today = new Date('2024-02-01T00:00:00Z')
    const result = estimateRemainingInterestEur(10_000, 4, 'quarterly', today)
    expect(result).toBeCloseTo(10_000 * 0.04) // full year, no quarterly payout has landed yet
  })

  it('projects only the last quarter when asked from Q4 (quarterly payouts)', () => {
    const today = new Date('2024-11-01T00:00:00Z')
    const result = estimateRemainingInterestEur(10_000, 4, 'quarterly', today)
    expect(result).toBeCloseTo((10_000 * 0.04) / 4) // 1 of 4 quarters left
  })

  it('always projects the full annual amount for annual payouts, regardless of the date', () => {
    const early = estimateRemainingInterestEur(5_000, 3, 'annually', new Date('2024-02-01T00:00:00Z'))
    const late = estimateRemainingInterestEur(5_000, 3, 'annually', new Date('2024-11-01T00:00:00Z'))
    expect(early).toBeCloseTo(150)
    expect(late).toBeCloseTo(150)
  })

  it('returns zero for a zero rate regardless of balance', () => {
    expect(estimateRemainingInterestEur(50_000, 0, 'monthly')).toBe(0)
  })
})
