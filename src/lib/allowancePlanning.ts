import type { CashBalance, Holding, InterestPayoutFrequency, Lot } from '../types'
import { type DividendEvent, getDividendHistory, getFxRate, resolveSymbol } from './yahoo'

const PAYOUTS_PER_YEAR: Record<InterestPayoutFrequency, number> = {
  monthly: 12,
  quarterly: 4,
  annually: 1,
}

/**
 * Projects the interest still to be paid out between now and the end of the
 * current calendar year, from an annual rate and payout frequency. Assumes
 * the balance stays constant and that payouts land on regular calendar
 * boundaries (month/quarter/year end) since the exact payout day isn't
 * tracked; for "annually", assumes that year's payout hasn't happened yet.
 * This is a forward projection, not a historical figure — unlike dividend
 * income (estimated from last year's actual payouts, since future ex-dates
 * can't be predicted), the remaining interest for the rest of *this* year
 * can be computed directly from a known rate and schedule.
 */
export function estimateRemainingInterestEur(
  balanceEur: number,
  annualRatePct: number,
  frequency: InterestPayoutFrequency,
  today: Date = new Date(),
): number {
  const payoutsPerYear = PAYOUTS_PER_YEAR[frequency]
  const monthIndex = today.getUTCMonth() // 0 = January
  const remainingPayouts =
    frequency === 'monthly' ? 12 - monthIndex : frequency === 'quarterly' ? 4 - Math.floor(monthIndex / 3) : 1
  const fullYearInterestEur = balanceEur * (annualRatePct / 100)
  return fullYearInterestEur * (remainingPayouts / payoutsPerYear)
}

/**
 * Sums dividend events falling within [yearStart, yearEnd), weighted by how
 * many units were held on each ex-date. Units held is derived from the app's
 * own lots (acquiredAt <= ex-date), since this app has no historical sale
 * record — it assumes continuous holding since each lot's acquisition, which
 * is the same assumption the rest of the app makes about its lot data.
 * Returns the amount in the security's native currency, not yet EUR-converted.
 */
export function sumDividendsInWindow(lots: Lot[], dividends: DividendEvent[], yearStart: Date, yearEnd: Date): number {
  const startMs = yearStart.getTime()
  const endMs = yearEnd.getTime()
  let total = 0
  for (const event of dividends) {
    if (event.dateMs < startMs || event.dateMs >= endMs) continue
    const exDateIso = new Date(event.dateMs).toISOString().slice(0, 10)
    const unitsHeld = lots.filter((l) => l.acquiredAt <= exDateIso).reduce((sum, l) => sum + l.quantity, 0)
    total += unitsHeld * event.amount
  }
  return total
}

/**
 * Estimated EUR dividend income a holding generated in a given calendar year.
 * Approximation: converts using a single mid-year (July 1) FX rate rather
 * than the rate on each individual ex-date, to avoid one extra network call
 * per dividend payment — fine for a planning estimate, not exact accounting.
 */
export async function estimateHoldingDividendIncomeEur(holding: Holding, year: number, proxyPrefix: string): Promise<number> {
  const resolved = await resolveSymbol(holding.identifier, proxyPrefix)
  const dividends = await getDividendHistory(resolved.symbol, proxyPrefix)
  const yearStart = new Date(`${year}-01-01T00:00:00Z`)
  const yearEnd = new Date(`${year + 1}-01-01T00:00:00Z`)
  const nativeAmount = sumDividendsInWindow(holding.lots, dividends, yearStart, yearEnd)
  if (nativeAmount === 0) return 0
  if (resolved.currency === 'EUR') return nativeAmount
  const midYear = new Date(`${year}-07-01T00:00:00Z`)
  const rate = await getFxRate(resolved.currency, 'EUR', proxyPrefix, midYear)
  return nativeAmount * rate
}

export interface IncomeSource {
  kind: 'holding' | 'cash'
  id: string
  label: string
  estimatedIncomeEur: number
}

export interface IncomeEstimate {
  incomeByInstitutionEur: Record<string, number>
  /** Per-institution breakdown of which holding/cash balance contributed how much - so the aggregated number isn't a black box. */
  sourcesByInstitution: Record<string, IncomeSource[]>
  /** Holdings whose dividend income couldn't be estimated (unresolvable symbol, etc.) - excluded rather than guessed. */
  unresolvedHoldingIds: string[]
}

/**
 * Sums each holding's estimated dividend income (from last year's actual
 * payouts, as a proxy for expected income) plus each cash balance's
 * projected remaining interest for the rest of *this* year (from its
 * manually-entered rate and frequency — there's no external source for a
 * bank's interest rate, so that side is never fetched, only entered),
 * grouped by institution. Combining a full-year proxy with a
 * remaining-this-year projection is a deliberate simplification: good enough
 * as one combined signal for where to file the allowance, not exact
 * accounting.
 */
export async function estimateIncomeByInstitution(
  holdings: Holding[],
  cashBalances: CashBalance[],
  year: number,
  proxyPrefix: string,
): Promise<IncomeEstimate> {
  const incomeByInstitutionEur: Record<string, number> = {}
  const sourcesByInstitution: Record<string, IncomeSource[]> = {}
  const unresolvedHoldingIds: string[] = []

  const addSource = (institutionId: string, source: IncomeSource) => {
    incomeByInstitutionEur[institutionId] = (incomeByInstitutionEur[institutionId] ?? 0) + source.estimatedIncomeEur
    ;(sourcesByInstitution[institutionId] ??= []).push(source)
  }

  await Promise.all(
    holdings.map(async (h) => {
      try {
        const amount = await estimateHoldingDividendIncomeEur(h, year, proxyPrefix)
        addSource(h.institutionId, { kind: 'holding', id: h.id, label: h.displayName, estimatedIncomeEur: amount })
      } catch {
        unresolvedHoldingIds.push(h.id)
      }
    }),
  )

  for (const c of cashBalances) {
    const remainingInterest = estimateRemainingInterestEur(c.amountEur, c.interestRatePct ?? 0, c.interestPayoutFrequency ?? 'annually')
    addSource(c.institutionId, { kind: 'cash', id: c.id, label: c.label, estimatedIncomeEur: remainingInterest })
  }

  return { incomeByInstitutionEur, sourcesByInstitution, unresolvedHoldingIds }
}
