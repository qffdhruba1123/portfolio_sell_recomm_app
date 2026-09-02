import { type Holding, type Institution, type Lot, type Settings, SPARERPAUSCHBETRAG, teilfreistellungRateFor } from '../types'

/**
 * German capital-gains tax primitives. Every function here is a pure, isolated
 * calculation so the asymmetric §20 EStG rule and FIFO consumption can be unit
 * tested directly against the cases that are easy to get backwards.
 */

export interface ConsumedChunk {
  lot: Lot
  quantity: number
  costBasisEur: number
}

export interface FifoConsumptionResult {
  consumed: ConsumedChunk[]
  /** Quantity requested but not covered by available lots (0 if fully covered). */
  shortfallQuantity: number
}

/** FIFO is mandatory under German tax law: oldest lots are consumed first, splitting a lot if needed. */
export function consumeLotsFifo(lots: Lot[], sellQuantity: number): FifoConsumptionResult {
  const sorted = [...lots].sort((a, b) => a.acquiredAt.localeCompare(b.acquiredAt) || a.id.localeCompare(b.id))
  const consumed: ConsumedChunk[] = []
  let remaining = sellQuantity

  for (const lot of sorted) {
    if (remaining <= 0) break
    const take = Math.min(lot.quantity, remaining)
    if (take <= 0) continue
    consumed.push({ lot, quantity: take, costBasisEur: take * lot.unitCostEur })
    remaining -= take
  }

  return { consumed, shortfallQuantity: Math.max(remaining, 0) }
}

/** Teilfreistellung shields the same fraction of a gain and a loss alike. */
export function applyTeilfreistellung(grossGainOrLossEur: number, rate: number): number {
  return grossGainOrLossEur * (1 - rate)
}

export type TaxPool = 'STOCK' | 'FUND'

/** §20 EStG restricts the *stock* loss pool only; the fund/other-income pool is never restricted. */
export function poolFor(holding: Holding): TaxPool {
  return holding.securityType === 'STOCK' ? 'STOCK' : 'FUND'
}

/** Shares acquired on or after this date fall under Abgeltungssteuer; anything older is grandfathered out (Bestandsschutz). */
export const BESTANDSSCHUTZ_CUTOFF = '2009-01-01'

/**
 * Bestandsschutz: shares acquired before 2009-01-01 are permanently outside the
 * Abgeltungssteuer regime introduced that year — gains on them are tax-free, and
 * (symmetrically) losses on them don't reduce tax elsewhere either, since they
 * never enter the taxable pools at all. FIFO's oldest-first rule already
 * consumes these lots before any newer one in a partial sale, so no separate
 * "prefer exempt lots first" logic is needed here - it falls out for free.
 */
export function isBestandsschutzLot(lot: Lot): boolean {
  return lot.acquiredAt < BESTANDSSCHUTZ_CUTOFF
}

export interface HoldingSaleResult {
  holdingId: string
  pool: TaxPool
  consumed: ConsumedChunk[]
  shortfallQuantity: number
  proceedsEur: number
  /** Total gain/loss across all consumed lots, exempt portion included - for display only. */
  grossGainLossEur: number
  /** Portion of grossGainLossEur from Bestandsschutz lots - permanently tax-free, never taxed, never usable to offset other gains. */
  exemptGrossGainLossEur: number
  /** Gross gain/loss after Teilfreistellung, from non-exempt lots only; this is what feeds the §20 EStG pools. */
  taxableGainLossEur: number
}

export function computeHoldingSale(
  holding: Holding,
  quantity: number,
  sellPricePerUnitEur: number,
): HoldingSaleResult {
  const { consumed, shortfallQuantity } = consumeLotsFifo(holding.lots, quantity)
  const quantitySold = consumed.reduce((sum, c) => sum + c.quantity, 0)
  const costBasisEur = consumed.reduce((sum, c) => sum + c.costBasisEur, 0)
  const proceedsEur = quantitySold * sellPricePerUnitEur
  const grossGainLossEur = proceedsEur - costBasisEur

  const exemptChunks = consumed.filter((c) => isBestandsschutzLot(c.lot))
  const taxableChunks = consumed.filter((c) => !isBestandsschutzLot(c.lot))
  const exemptGrossGainLossEur =
    exemptChunks.reduce((sum, c) => sum + c.quantity, 0) * sellPricePerUnitEur -
    exemptChunks.reduce((sum, c) => sum + c.costBasisEur, 0)
  const taxableGrossGainLossEur =
    taxableChunks.reduce((sum, c) => sum + c.quantity, 0) * sellPricePerUnitEur -
    taxableChunks.reduce((sum, c) => sum + c.costBasisEur, 0)

  const rate = teilfreistellungRateFor(holding)
  return {
    holdingId: holding.id,
    pool: poolFor(holding),
    consumed,
    shortfallQuantity,
    proceedsEur,
    grossGainLossEur,
    exemptGrossGainLossEur,
    taxableGainLossEur: applyTeilfreistellung(taxableGrossGainLossEur, rate),
  }
}

/**
 * §20 Abs. 6 EStG netting, asymmetric by design:
 * - A stock-pool loss cannot offset a fund/other gain (stranded; only pool B's own positive result is taxable).
 * - A fund/other-pool loss CAN offset a stock gain.
 * No prior-year loss carryforward (Verlustvortrag) is modeled.
 */
export function netTaxPools(stockPoolEur: number, fundPoolEur: number): number {
  if (stockPoolEur < 0) return Math.max(fundPoolEur, 0)
  if (fundPoolEur < 0) return Math.max(stockPoolEur + fundPoolEur, 0)
  return stockPoolEur + fundPoolEur
}

export function remainingAllowance(institution: Institution): number {
  return Math.max(institution.submittedEur - institution.usedEur, 0)
}

export interface AllowanceApplication {
  taxableAfterAllowanceEur: number
  allowanceUsedEur: number
}

/** Allowance is applied once, at the whole-plan level, per institution — never per lot or per holding. */
export function applyAllowance(netTaxableEur: number, remainingAllowanceEur: number): AllowanceApplication {
  if (netTaxableEur <= 0) return { taxableAfterAllowanceEur: 0, allowanceUsedEur: 0 }
  const allowanceUsedEur = Math.min(netTaxableEur, Math.max(remainingAllowanceEur, 0))
  return { taxableAfterAllowanceEur: netTaxableEur - allowanceUsedEur, allowanceUsedEur }
}

/**
 * Flat Abgeltungssteuer + Soli, with church tax modeled as a simplified flat add-on
 * (not the real Kirchensteuerabzugsverfahren Sonderausgabenabzug — that exact mechanic is out of scope).
 */
export function effectiveTaxRate(settings: Settings): number {
  const soli = 0.055
  const church = settings.churchTaxEnabled ? settings.churchTaxRate : 0
  return 0.25 * (1 + soli + church)
}

export interface InstitutionTaxSummary {
  institutionId: string
  stockPoolEur: number
  fundPoolEur: number
  netTaxableBeforeAllowanceEur: number
  allowanceUsedEur: number
  taxableAfterAllowanceEur: number
  taxEur: number
}

export function settleInstitutionTax(
  institutionId: string,
  stockPoolEur: number,
  fundPoolEur: number,
  remainingAllowanceEur: number,
  settings: Settings,
): InstitutionTaxSummary {
  const netTaxableBeforeAllowanceEur = netTaxPools(stockPoolEur, fundPoolEur)
  const { taxableAfterAllowanceEur, allowanceUsedEur } = applyAllowance(netTaxableBeforeAllowanceEur, remainingAllowanceEur)
  const taxEur = taxableAfterAllowanceEur * effectiveTaxRate(settings)
  return {
    institutionId,
    stockPoolEur,
    fundPoolEur,
    netTaxableBeforeAllowanceEur,
    allowanceUsedEur,
    taxableAfterAllowanceEur,
    taxEur,
  }
}

export interface AllowanceOverAllocation {
  totalSubmittedEur: number
  capEur: number
  isOverAllocated: boolean
  excessEur: number
}

/** Germany centrally checks this via the BZSt registry — flag it, don't just silently compute. */
export function checkAllowanceOverAllocation(
  institutions: Institution[],
  filingStatus: keyof typeof SPARERPAUSCHBETRAG,
): AllowanceOverAllocation {
  const totalSubmittedEur = institutions.reduce((sum, i) => sum + i.submittedEur, 0)
  const capEur = SPARERPAUSCHBETRAG[filingStatus]
  const excessEur = Math.max(totalSubmittedEur - capEur, 0)
  return { totalSubmittedEur, capEur, isOverAllocated: excessEur > 0, excessEur }
}

/** When over-allocated, trim the institution with the most *unused* headroom — not just the lowest usage. */
export function suggestInstitutionToTrim(institutions: Institution[]): Institution | null {
  if (institutions.length === 0) return null
  return [...institutions].sort((a, b) => remainingAllowance(b) - remainingAllowance(a))[0]
}
