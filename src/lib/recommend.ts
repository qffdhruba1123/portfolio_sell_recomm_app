import { type CashBalance, type Holding, type Institution, type Settings } from '../types'
import { formatEur, formatPct } from './format'
import {
  computeHoldingSale,
  type InstitutionTaxSummary,
  remainingAllowance,
  settleInstitutionTax,
} from './tax'

export type PriceMap = Record<string, number> // holdingId -> current price in EUR

export function totalQuantity(holding: Holding): number {
  return holding.lots.reduce((sum, l) => sum + l.quantity, 0)
}

export function totalHoldingsValueEur(holdings: Holding[], prices: PriceMap): number {
  return holdings.reduce((sum, h) => sum + (prices[h.id] != null ? totalQuantity(h) * prices[h.id] : 0), 0)
}

export function concentrationPct(holding: Holding, holdings: Holding[], prices: PriceMap): number {
  const total = totalHoldingsValueEur(holdings, prices)
  if (total <= 0 || prices[holding.id] == null) return 0
  return (totalQuantity(holding) * prices[holding.id]) / total
}

export interface LineItem {
  holdingId: string
  displayName: string
  institutionId: string
  institutionLabel: string
  quantitySold: number
  isFullPosition: boolean
  /** True if quantitySold isn't a whole number - some brokers don't support fractional-unit orders. */
  isFractionalUnit: boolean
  pricePerUnitEur: number
  grossProceedsEur: number
  grossGainLossEur: number
  exemptGrossGainLossEur: number
  taxableGainLossEur: number
  concentrationPctBefore: number
  rationale: string
  /** True if this same holding also appears in the other lens's plan - "sell this either way" signal. Set after both plans are built. */
  agreedByBothLenses: boolean
}

export interface InstitutionBreakdown extends InstitutionTaxSummary {
  institutionLabel: string
}

export interface SalePlan {
  lens: 'tax' | 'risk'
  lineItems: LineItem[]
  grossProceedsFromSalesEur: number
  shortfallEur: number
  institutionBreakdown: InstitutionBreakdown[]
  totalTaxEur: number
  totalFeesEur: number
  estimatedNetProceedsEur: number
}

export interface RecommendationResult {
  amountNeededEur: number
  cashAvailableEur: number
  cashUsedEur: number
  remainingNeededAfterCashEur: number
  holdingsExcludedNoPrice: Holding[]
  taxOptimizedPlan: SalePlan | null
  riskReductionPlan: SalePlan | null
  comparisonCallout: string | null
}

function institutionLabel(institutions: Institution[], id: string): string {
  return institutions.find((i) => i.id === id)?.label ?? 'Unknown institution'
}

function taxRationale(
  grossGainLossEur: number,
  exemptGrossGainLossEur: number,
  taxableGainLossEur: number,
  isEtf: boolean,
  institutionLabelText: string,
): string {
  const taxableGrossPortion = grossGainLossEur - exemptGrossGainLossEur

  if (exemptGrossGainLossEur !== 0 && Math.abs(taxableGrossPortion) < 0.005) {
    // Every consumed lot was pre-2009 - the whole sale is Bestandsschutz-exempt.
    return exemptGrossGainLossEur > 0
      ? `Gain of ${formatEur(exemptGrossGainLossEur)} is fully tax-exempt — these shares were acquired before 2009-01-01 (Bestandsschutz), grandfathered out of Abgeltungssteuer entirely.`
      : `Realizes a loss of ${formatEur(Math.abs(exemptGrossGainLossEur))} on pre-2009 shares (Bestandsschutz) — outside today's tax rules, so it doesn't reduce tax elsewhere either.`
  }

  const exemptNote =
    exemptGrossGainLossEur !== 0
      ? ` (${formatEur(Math.abs(exemptGrossGainLossEur))} of this is tax-exempt Bestandsschutz from pre-2009 lots)`
      : ''

  if (taxableGrossPortion <= 0) {
    return `Realizes a loss of ${formatEur(Math.abs(taxableGrossPortion))}${exemptNote} — no tax cost, and may reduce tax owed on other sales at ${institutionLabelText}.`
  }
  if (isEtf) {
    return `Gain of ${formatEur(taxableGrossPortion)}${exemptNote} (${formatEur(taxableGainLossEur)} after the 30% Teilfreistellung) — taxed via ${institutionLabelText}.`
  }
  return `Gain of ${formatEur(taxableGrossPortion)}${exemptNote}, fully taxable — individual stocks get no Teilfreistellung. Taxed via ${institutionLabelText}.`
}

function riskRationale(pctBefore: number, thresholdPct: number, isStock: boolean): string {
  const pctText = formatPct(pctBefore, 1)
  if (pctBefore * 100 >= thresholdPct) {
    return `Currently ${pctText} of your portfolio — trimmed first to reduce concentration risk (above your ${thresholdPct}% threshold).`
  }
  if (isStock) return `Currently ${pctText} of your portfolio.`
  return `Currently ${pctText} of your portfolio. Funds are trimmed only after individual stocks, since single-company risk is the higher priority.`
}

interface RankedHolding {
  holding: Holding
  price: number
}

function standaloneEffectiveRate(
  holding: Holding,
  price: number,
  institutions: Institution[],
  settings: Settings,
): number {
  const sale = computeHoldingSale(holding, totalQuantity(holding), price)
  if (sale.taxableGainLossEur <= 0 || sale.proceedsEur <= 0) return -Infinity
  const institution = institutions.find((i) => i.id === holding.institutionId)
  const remaining = institution ? remainingAllowance(institution) : 0
  const stockPool = sale.pool === 'STOCK' ? sale.taxableGainLossEur : 0
  const fundPool = sale.pool === 'FUND' ? sale.taxableGainLossEur : 0
  const summary = settleInstitutionTax(holding.institutionId, stockPool, fundPool, remaining, settings, institution)
  return summary.taxEur / sale.proceedsEur
}

/**
 * Ranking only — a heuristic ordering of whole holdings, not a cross-holding
 * tax-lot optimizer. A real solver would jointly consider partial sells across
 * every holding to minimize tax exactly; that's over-engineering for a personal
 * tool with a handful of holdings, so this app deliberately doesn't build one.
 */
function rankTaxOptimized(candidates: RankedHolding[], institutions: Institution[], settings: Settings): RankedHolding[] {
  return [...candidates].sort(
    (a, b) =>
      standaloneEffectiveRate(a.holding, a.price, institutions, settings) -
      standaloneEffectiveRate(b.holding, b.price, institutions, settings),
  )
}

function rankRiskReduction(candidates: RankedHolding[], allHoldings: Holding[], prices: PriceMap): RankedHolding[] {
  return [...candidates].sort((a, b) => {
    const aStock = a.holding.securityType === 'STOCK'
    const bStock = b.holding.securityType === 'STOCK'
    if (aStock !== bStock) return aStock ? -1 : 1
    return concentrationPct(b.holding, allHoldings, prices) - concentrationPct(a.holding, allHoldings, prices)
  })
}

interface ChosenSale {
  holding: Holding
  price: number
  quantitySold: number
  isFullPosition: boolean
}

function walkUntilCovered(ordered: RankedHolding[], targetGrossEur: number): { chosen: ChosenSale[]; shortfallEur: number } {
  const chosen: ChosenSale[] = []
  let remaining = targetGrossEur
  for (const { holding, price } of ordered) {
    if (remaining <= 0) break
    const qty = totalQuantity(holding)
    const fullProceeds = qty * price
    if (fullProceeds <= remaining) {
      chosen.push({ holding, price, quantitySold: qty, isFullPosition: true })
      remaining -= fullProceeds
    } else {
      const partialQty = remaining / price
      chosen.push({ holding, price, quantitySold: partialQty, isFullPosition: false })
      remaining = 0
    }
  }
  return { chosen, shortfallEur: Math.max(remaining, 0) }
}

function buildPlan(
  lens: 'tax' | 'risk',
  chosen: ChosenSale[],
  shortfallEur: number,
  allHoldings: Holding[],
  prices: PriceMap,
  institutions: Institution[],
  settings: Settings,
): SalePlan {
  const lineItems: LineItem[] = []
  const poolsByInstitution: Record<string, { stock: number; fund: number }> = {}

  for (const { holding, price, quantitySold, isFullPosition } of chosen) {
    const sale = computeHoldingSale(holding, quantitySold, price)
    const pools = (poolsByInstitution[holding.institutionId] ??= { stock: 0, fund: 0 })
    if (sale.pool === 'STOCK') pools.stock += sale.taxableGainLossEur
    else pools.fund += sale.taxableGainLossEur

    const instLabel = institutionLabel(institutions, holding.institutionId)
    const pctBefore = concentrationPct(holding, allHoldings, prices)
    const rationale =
      lens === 'tax'
        ? taxRationale(sale.grossGainLossEur, sale.exemptGrossGainLossEur, sale.taxableGainLossEur, holding.securityType === 'ETF', instLabel)
        : riskRationale(pctBefore, settings.concentrationThresholdPct, holding.securityType === 'STOCK')

    lineItems.push({
      holdingId: holding.id,
      displayName: holding.displayName,
      institutionId: holding.institutionId,
      institutionLabel: instLabel,
      quantitySold,
      isFullPosition,
      isFractionalUnit: Math.abs(quantitySold - Math.round(quantitySold)) > 1e-9,
      pricePerUnitEur: price,
      grossProceedsEur: sale.proceedsEur,
      grossGainLossEur: sale.grossGainLossEur,
      exemptGrossGainLossEur: sale.exemptGrossGainLossEur,
      taxableGainLossEur: sale.taxableGainLossEur,
      concentrationPctBefore: pctBefore,
      rationale,
      agreedByBothLenses: false,
    })
  }

  const institutionBreakdown: InstitutionBreakdown[] = Object.entries(poolsByInstitution).map(([institutionId, pools]) => {
    const institution = institutions.find((i) => i.id === institutionId)
    const remaining = institution ? remainingAllowance(institution) : 0
    const summary = settleInstitutionTax(institutionId, pools.stock, pools.fund, remaining, settings, institution)
    return { ...summary, institutionLabel: institutionLabel(institutions, institutionId) }
  })

  const totalTaxEur = institutionBreakdown.reduce((sum, b) => sum + b.taxEur, 0)
  // One fee per holding touched (never per FIFO lot), at that holding's own institution's rate - fees vary by broker.
  const totalFeesEur = chosen.reduce((sum, { holding }) => {
    const institution = institutions.find((i) => i.id === holding.institutionId)
    return sum + (institution?.brokerFeeEur ?? 0)
  }, 0)
  const grossProceedsFromSalesEur = lineItems.reduce((sum, li) => sum + li.grossProceedsEur, 0)

  return {
    lens,
    lineItems,
    grossProceedsFromSalesEur,
    shortfallEur,
    institutionBreakdown,
    totalTaxEur,
    totalFeesEur,
    estimatedNetProceedsEur: grossProceedsFromSalesEur - totalTaxEur - totalFeesEur,
  }
}

function largestRemainingConcentrationPct(allHoldings: Holding[], prices: PriceMap, chosen: ChosenSale[]): number {
  const soldQty: Record<string, number> = {}
  for (const c of chosen) soldQty[c.holding.id] = (soldQty[c.holding.id] ?? 0) + c.quantitySold

  const remainingValues = allHoldings.map((h) => {
    if (prices[h.id] == null) return 0
    const qtyLeft = Math.max(totalQuantity(h) - (soldQty[h.id] ?? 0), 0)
    return qtyLeft * prices[h.id]
  })
  const total = remainingValues.reduce((s, v) => s + v, 0)
  if (total <= 0) return 0
  return Math.max(...remainingValues) / total
}

function buildComparisonCallout(
  taxPlan: SalePlan,
  riskPlan: SalePlan,
  allHoldings: Holding[],
  prices: PriceMap,
  chosenTax: ChosenSale[],
  chosenRisk: ChosenSale[],
): string {
  const deltaTax = riskPlan.totalTaxEur - taxPlan.totalTaxEur
  const largestBefore = largestRemainingConcentrationPct(allHoldings, prices, [])
  const largestAfterTax = largestRemainingConcentrationPct(allHoldings, prices, chosenTax)
  const largestAfterRisk = largestRemainingConcentrationPct(allHoldings, prices, chosenRisk)

  const taxDeltaText =
    deltaTax === 0
      ? 'the same estimated tax'
      : deltaTax > 0
        ? `${formatEur(deltaTax)} more tax`
        : `${formatEur(Math.abs(deltaTax))} less tax`

  return (
    `Tax-optimized: sells ${taxPlan.lineItems.length} holding(s), ~${formatEur(taxPlan.totalTaxEur)} tax, ` +
    `largest position afterward ~${formatPct(largestAfterTax)}. ` +
    `Risk-reduction: sells ${riskPlan.lineItems.length} holding(s), ~${formatEur(riskPlan.totalTaxEur)} tax (${taxDeltaText}), ` +
    `largest position afterward ~${formatPct(largestAfterRisk)} (from ~${formatPct(largestBefore)} today). ` +
    `Neither is "correct" — pick tax-optimized to minimize this sale's tax bill, or risk-reduction to cut concentration risk faster.`
  )
}

export interface RecommendInput {
  amountNeededEur: number
  holdings: Holding[]
  cashBalances: CashBalance[]
  institutions: Institution[]
  settings: Settings
  prices: PriceMap
}

/** Cash is always tapped first: zero tax event, zero market-timing risk. */
export function recommend(input: RecommendInput): RecommendationResult {
  const { amountNeededEur, holdings, cashBalances, institutions, settings, prices } = input
  const cashAvailableEur = cashBalances.reduce((sum, c) => sum + c.amountEur, 0)
  const cashUsedEur = Math.min(amountNeededEur, cashAvailableEur)
  const remainingNeededAfterCashEur = Math.max(amountNeededEur - cashUsedEur, 0)

  const holdingsExcludedNoPrice = holdings.filter((h) => prices[h.id] == null && totalQuantity(h) > 0)
  const eligible = holdings.filter((h) => prices[h.id] != null && totalQuantity(h) > 0)
  const candidates: RankedHolding[] = eligible.map((h) => ({ holding: h, price: prices[h.id] }))

  if (remainingNeededAfterCashEur <= 0 || candidates.length === 0) {
    return {
      amountNeededEur,
      cashAvailableEur,
      cashUsedEur,
      remainingNeededAfterCashEur,
      holdingsExcludedNoPrice,
      taxOptimizedPlan: null,
      riskReductionPlan: null,
      comparisonCallout: null,
    }
  }

  const taxOrdered = rankTaxOptimized(candidates, institutions, settings)
  const riskOrdered = rankRiskReduction(candidates, holdings, prices)

  const { chosen: chosenTax, shortfallEur: shortfallTax } = walkUntilCovered(taxOrdered, remainingNeededAfterCashEur)
  const { chosen: chosenRisk, shortfallEur: shortfallRisk } = walkUntilCovered(riskOrdered, remainingNeededAfterCashEur)

  const taxOptimizedPlan = buildPlan('tax', chosenTax, shortfallTax, holdings, prices, institutions, settings)
  const riskReductionPlan = buildPlan('risk', chosenRisk, shortfallRisk, holdings, prices, institutions, settings)

  // A holding picked by both lenses is a "sell this either way" signal, worth
  // surfacing without collapsing the two rankings into one blended score.
  const taxIds = new Set(taxOptimizedPlan.lineItems.map((li) => li.holdingId))
  const riskIds = new Set(riskReductionPlan.lineItems.map((li) => li.holdingId))
  for (const li of taxOptimizedPlan.lineItems) li.agreedByBothLenses = riskIds.has(li.holdingId)
  for (const li of riskReductionPlan.lineItems) li.agreedByBothLenses = taxIds.has(li.holdingId)

  return {
    amountNeededEur,
    cashAvailableEur,
    cashUsedEur,
    remainingNeededAfterCashEur,
    holdingsExcludedNoPrice,
    taxOptimizedPlan,
    riskReductionPlan,
    comparisonCallout: buildComparisonCallout(taxOptimizedPlan, riskReductionPlan, holdings, prices, chosenTax, chosenRisk),
  }
}

export interface RetirementReference {
  lowEur: number
  highEur: number
  totalPortfolioValueEur: number
}

/** Context only — a commonly-cited heuristic range, never a cap on what the user can enter. */
export function retirementReference(totalPortfolioValueEur: number): RetirementReference {
  return {
    lowEur: totalPortfolioValueEur * 0.03,
    highEur: totalPortfolioValueEur * 0.04,
    totalPortfolioValueEur,
  }
}

function formatPlanText(plan: SalePlan | null, cashUsedEur: number): string {
  if (!plan) return 'No sales needed — cash alone covers this request.'

  const lines: string[] = []
  if (cashUsedEur > 0) lines.push(`Cash used first: ${formatEur(cashUsedEur)}`)
  for (const li of plan.lineItems) {
    const qtyText = li.isFullPosition ? 'full position' : `${li.quantitySold.toFixed(2)} units`
    lines.push(`- ${li.displayName} (${qtyText}): ${formatEur(li.grossProceedsEur)}`)
    lines.push(`    ${li.rationale}`)
  }
  if (plan.shortfallEur > 0) {
    lines.push(`Shortfall: holdings + cash don't cover the full request by ${formatEur(plan.shortfallEur)}.`)
  }
  lines.push('')
  lines.push(`Gross proceeds from sales: ${formatEur(plan.grossProceedsFromSalesEur)}`)
  lines.push(`Estimated tax: -${formatEur(plan.totalTaxEur)}`)
  lines.push(`Broker fees: -${formatEur(plan.totalFeesEur)}`)
  lines.push(`Estimated net proceeds: ${formatEur(plan.estimatedNetProceedsEur)}`)

  if (plan.institutionBreakdown.length > 0) {
    lines.push('')
    lines.push('Per-institution tax breakdown:')
    for (const b of plan.institutionBreakdown) {
      const carryInNote =
        b.carryInLossPotEquitiesEur > 0 || b.carryInLossPotGeneralEur > 0
          ? ` (carry-in loss pots: equities ${formatEur(b.carryInLossPotEquitiesEur)}, general ${formatEur(b.carryInLossPotGeneralEur)})`
          : ''
      lines.push(
        `  ${b.institutionLabel}: stock pool ${formatEur(b.newStockPoolEur)}, fund pool ${formatEur(b.newFundPoolEur)}${carryInNote}, allowance used ${formatEur(b.allowanceUsedEur)}, tax ${formatEur(b.taxEur)}`,
      )
    }
  }
  return lines.join('\n')
}

/**
 * Plain-text summary of a recommendation, suitable for printing, emailing, or
 * bringing to a Steuerberater — every recommendation here is something you
 * act on manually elsewhere, so this is the "take it with you" artifact.
 */
export function buildRecommendationSummaryText(result: RecommendationResult, generatedAt: Date = new Date()): string {
  const lines: string[] = []
  lines.push('Portfolio Sell-Recommendation Advisor')
  lines.push(`Generated ${generatedAt.toISOString().slice(0, 10)}`)
  lines.push('')
  lines.push(`Amount needed: ${formatEur(result.amountNeededEur)}`)
  lines.push(`Cash available: ${formatEur(result.cashAvailableEur)} — used first: ${formatEur(result.cashUsedEur)}`)
  lines.push(`Remaining to cover via sales: ${formatEur(result.remainingNeededAfterCashEur)}`)
  lines.push('')

  if (result.holdingsExcludedNoPrice.length > 0) {
    lines.push(
      `Manual review needed (no fetchable price, excluded): ${result.holdingsExcludedNoPrice.map((h) => h.displayName).join(', ')}`,
    )
    lines.push('')
  }

  if (result.comparisonCallout) {
    lines.push(result.comparisonCallout)
    lines.push('')
  }

  lines.push('=== Tax-optimized plan ===')
  lines.push(formatPlanText(result.taxOptimizedPlan, result.cashUsedEur))
  lines.push('')
  lines.push('=== Risk-reduction plan ===')
  lines.push(formatPlanText(result.riskReductionPlan, result.cashUsedEur))
  lines.push('')
  lines.push('Not financial or tax advice — educational, rules-based decision support only. Consult a Steuerberater before acting on this.')

  return lines.join('\n')
}
