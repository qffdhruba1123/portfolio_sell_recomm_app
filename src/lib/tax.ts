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

export interface RemainingLossPots {
  remainingEquityLossPotEur: number
  remainingGeneralLossPotEur: number
}

/**
 * What each loss pot balance would look like *after* netting these combined
 * (carry-in + new sale) pools — mirrors netTaxPools' branches exactly, since
 * a naive per-pool floor-at-zero would get the middle branch wrong: when a
 * fund/general loss offsets a stock gain, it's the *general* pot that gets
 * spent down, not the equity one, even though the gain was on the stock side.
 */
export function remainingLossPotsAfter(stockPoolEur: number, fundPoolEur: number): RemainingLossPots {
  if (stockPoolEur < 0) {
    // Stock loss is stranded - carries forward untouched. Fund pool taxed/carried independently.
    return { remainingEquityLossPotEur: -stockPoolEur, remainingGeneralLossPotEur: Math.max(-fundPoolEur, 0) }
  }
  if (fundPoolEur < 0) {
    // Fund loss gets consumed (up to the stock gain) to offset the stock gain - no equity loss existed here.
    return { remainingEquityLossPotEur: 0, remainingGeneralLossPotEur: Math.max(-(stockPoolEur + fundPoolEur), 0) }
  }
  return { remainingEquityLossPotEur: 0, remainingGeneralLossPotEur: 0 }
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

export interface LossPotCarryIn {
  lossPotEquitiesEur?: number
  lossPotGeneralEur?: number
}

export interface InstitutionTaxSummary {
  institutionId: string
  /** This sale's own contribution to each pool, before any carry-in. */
  newStockPoolEur: number
  newFundPoolEur: number
  /** Existing banked loss balances carried in from before this sale (entered manually from the broker's own loss-pot screen). */
  carryInLossPotEquitiesEur: number
  carryInLossPotGeneralEur: number
  /** Combined pool (carry-in + new) after the asymmetric §20 EStG netting. */
  netTaxableBeforeAllowanceEur: number
  allowanceUsedEur: number
  taxableAfterAllowanceEur: number
  taxEur: number
  /** What each loss pot should look like after this plan - a concrete, checkable prediction against the broker's next statement. */
  projectedRemainingLossPots: RemainingLossPots
}

/**
 * A new stock/fund gain is netted against any pre-existing banked loss pot
 * before tax is calculated, exactly as a broker's real-time withholding
 * does — otherwise every recommendation would evaluate each sale in
 * isolation, ignoring losses already realized earlier in the year.
 */
export function settleInstitutionTax(
  institutionId: string,
  newStockPoolEur: number,
  newFundPoolEur: number,
  remainingAllowanceEur: number,
  settings: Settings,
  carryIn: LossPotCarryIn = {},
): InstitutionTaxSummary {
  const carryInLossPotEquitiesEur = Math.max(carryIn.lossPotEquitiesEur ?? 0, 0)
  const carryInLossPotGeneralEur = Math.max(carryIn.lossPotGeneralEur ?? 0, 0)
  const combinedStockPoolEur = newStockPoolEur - carryInLossPotEquitiesEur
  const combinedFundPoolEur = newFundPoolEur - carryInLossPotGeneralEur

  const netTaxableBeforeAllowanceEur = netTaxPools(combinedStockPoolEur, combinedFundPoolEur)
  const { taxableAfterAllowanceEur, allowanceUsedEur } = applyAllowance(netTaxableBeforeAllowanceEur, remainingAllowanceEur)
  const taxEur = taxableAfterAllowanceEur * effectiveTaxRate(settings)
  return {
    institutionId,
    newStockPoolEur,
    newFundPoolEur,
    carryInLossPotEquitiesEur,
    carryInLossPotGeneralEur,
    netTaxableBeforeAllowanceEur,
    allowanceUsedEur,
    taxableAfterAllowanceEur,
    taxEur,
    projectedRemainingLossPots: remainingLossPotsAfter(combinedStockPoolEur, combinedFundPoolEur),
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

export interface AllowanceSplitSuggestion {
  institutionId: string
  estimatedIncomeEur: number
  suggestedSubmittedEur: number
}

/**
 * Suggests how to file the annual allowance across institutions, given each
 * institution's estimated capital income (dividends + interest) from a prior
 * period. Real-time withholding relief is only useful where income actually
 * occurs, so this greedily fills the highest-income institution first, up to
 * its own income or the remaining cap (whichever is smaller) — allocating
 * more than an institution's own income to it would just waste headroom
 * there instead of shielding income elsewhere. Any cap left over once every
 * institution's income is fully covered goes unallocated rather than being
 * spread arbitrarily.
 */
export function suggestAllowanceSplit(
  institutions: Institution[],
  estimatedIncomeByInstitutionEur: Record<string, number>,
  filingStatus: keyof typeof SPARERPAUSCHBETRAG,
): AllowanceSplitSuggestion[] {
  const capEur = SPARERPAUSCHBETRAG[filingStatus]
  const sorted = [...institutions].sort(
    (a, b) => (estimatedIncomeByInstitutionEur[b.id] ?? 0) - (estimatedIncomeByInstitutionEur[a.id] ?? 0),
  )
  let remaining = capEur
  return sorted.map((institution) => {
    const estimatedIncomeEur = Math.max(estimatedIncomeByInstitutionEur[institution.id] ?? 0, 0)
    const suggestedSubmittedEur = Math.round(Math.min(estimatedIncomeEur, Math.max(remaining, 0)))
    remaining -= suggestedSubmittedEur
    return { institutionId: institution.id, estimatedIncomeEur, suggestedSubmittedEur }
  })
}

/**
 * A stock split (or reverse split) is not a taxable event in Germany - it
 * just redistributes each lot's existing quantity and cost basis over more
 * (or fewer) shares, preserving total cost basis and, critically, the
 * original acquiredAt date (a split doesn't reset Bestandsschutz eligibility
 * or FIFO ordering). ratio > 1 for a split (e.g. 2 for a 2-for-1 split),
 * 0 < ratio < 1 for a reverse split (e.g. 0.5 for a 1-for-2 reverse split).
 */
export function applyStockSplit(lots: Lot[], ratio: number): Lot[] {
  if (!(ratio > 0)) throw new Error('Split ratio must be a positive number.')
  return lots.map((l) => ({ ...l, quantity: l.quantity * ratio, unitCostEur: l.unitCostEur / ratio }))
}
