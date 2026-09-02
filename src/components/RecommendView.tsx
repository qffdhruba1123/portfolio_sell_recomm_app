import { useMemo, useState } from 'react'
import { usePortfolio } from '../state/PortfolioContext'
import { buildRecommendationSummaryText, recommend, retirementReference, totalHoldingsValueEur, type SalePlan } from '../lib/recommend'
import { formatEur } from '../lib/format'
import { Badge, Button, Card, NumberInput } from './ui'
import { SalePlanFinancials } from './SalePlanSummary'

function PlanCard({
  title,
  plan,
  cashUsedEur,
  stalePriceHoldingIds,
}: {
  title: string
  plan: SalePlan | null
  cashUsedEur: number
  stalePriceHoldingIds: Set<string>
}) {
  const { executePlan } = usePortfolio()
  const [executed, setExecuted] = useState(false)

  if (!plan) {
    return (
      <Card>
        <h3 className="font-semibold text-slate-900">{title}</h3>
        <p className="mt-2 text-sm text-slate-500">No sales needed — cash alone covers this request.</p>
      </Card>
    )
  }

  return (
    <Card>
      <h3 className="font-semibold text-slate-900">{title}</h3>
      <div className="mt-2 space-y-3">
        {cashUsedEur > 0 && (
          <p className="text-sm text-slate-600">
            Cash used first: <strong>{formatEur(cashUsedEur)}</strong>
          </p>
        )}
        <ul className="space-y-2">
          {plan.lineItems.map((li) => (
            <li key={li.holdingId} className="rounded-md border border-slate-200 p-2">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium text-slate-900">
                  {li.displayName} {li.isFullPosition ? '(full position)' : `(${li.quantitySold.toFixed(2)} units)`}
                </span>
                <span className="font-medium">{formatEur(li.grossProceedsEur)}</span>
              </div>
              <div className="mt-1 flex flex-wrap gap-1">
                {li.agreedByBothLenses && <Badge tone="good">picked by both plans</Badge>}
                {stalePriceHoldingIds.has(li.holdingId) && <Badge tone="warn">stale price</Badge>}
                {li.isFractionalUnit && <Badge tone="warn">fractional units</Badge>}
              </div>
              <p className="mt-1 text-xs text-slate-600">{li.rationale}</p>
              {li.isFractionalUnit && (
                <p className="mt-1 text-xs text-amber-700">
                  Requires selling a fractional number of units — not every broker supports this; round up to the
                  next whole unit if yours doesn't.
                </p>
              )}
            </li>
          ))}
        </ul>

        {plan.shortfallEur > 0 && (
          <p className="text-sm text-red-700">
            Shortfall: holdings + cash don't cover the full request by {formatEur(plan.shortfallEur)}.
          </p>
        )}

        <SalePlanFinancials plan={plan} />

        <div className="border-t border-slate-200 pt-2">
          {executed ? (
            <p className="text-sm text-emerald-700">
              ✓ Marked as executed — holdings, allowance used, and loss pots updated to match.
            </p>
          ) : (
            <Button
              variant="secondary"
              onClick={() => {
                if (
                  confirm(
                    "Mark this plan as executed? This updates your holdings' lots, each institution's allowance used, and loss pot balances to reflect the sale — as if you'd re-entered them by hand after actually selling. Export a backup first if you're unsure.",
                  )
                ) {
                  executePlan(plan)
                  setExecuted(true)
                }
              }}
            >
              Mark this plan as executed
            </Button>
          )}
          <p className="mt-1 text-xs text-slate-500">
            Only updates your own records here — never places a trade. Use this after you've actually sold these
            holdings at your broker.
          </p>
        </div>
      </div>
    </Card>
  )
}

export function RecommendView() {
  const { state, prices } = usePortfolio()
  const [amount, setAmount] = useState(1000)
  const [mode, setMode] = useState<'cash' | 'retirement'>('cash')

  const priceMap = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(prices)
          .filter(([, info]) => Number.isFinite(info.price))
          .map(([id, info]) => [id, info.price]),
      ),
    [prices],
  )

  const result = useMemo(
    () =>
      recommend({
        amountNeededEur: amount,
        holdings: state.holdings,
        cashBalances: state.cashBalances,
        institutions: state.institutions,
        settings: state.settings,
        prices: priceMap,
      }),
    [amount, state, priceMap],
  )

  const totalPortfolioValueEur = useMemo(
    () => totalHoldingsValueEur(state.holdings, priceMap) + state.cashBalances.reduce((s, c) => s + c.amountEur, 0),
    [state.holdings, state.cashBalances, priceMap],
  )
  const retirementRef = retirementReference(totalPortfolioValueEur)

  const stalePriceHoldingIds = useMemo(
    () => new Set(Object.entries(prices).filter(([, info]) => info.stale).map(([id]) => id)),
    [prices],
  )
  const plansUseStalePrice = [...(result.taxOptimizedPlan?.lineItems ?? []), ...(result.riskReductionPlan?.lineItems ?? [])].some(
    (li) => stalePriceHoldingIds.has(li.holdingId),
  )
  const hasSalePlan = (result.taxOptimizedPlan?.lineItems.length ?? 0) > 0 || (result.riskReductionPlan?.lineItems.length ?? 0) > 0

  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'error'>('idle')

  async function handleCopySummary() {
    try {
      await navigator.clipboard.writeText(buildRecommendationSummaryText(result))
      setCopyStatus('copied')
      setTimeout(() => setCopyStatus('idle'), 2000)
    } catch {
      setCopyStatus('error')
    }
  }

  return (
    <div className="space-y-4">
      <Card className="print:hidden">
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex gap-2">
            <Button variant={mode === 'cash' ? 'primary' : 'secondary'} onClick={() => setMode('cash')}>
              Sudden cash need
            </Button>
            <Button variant={mode === 'retirement' ? 'primary' : 'secondary'} onClick={() => setMode('retirement')}>
              Retirement withdrawal
            </Button>
          </div>
          <div className="w-48">
            <label className="mb-1 block text-xs font-medium text-slate-600">Amount needed (EUR)</label>
            <NumberInput value={amount} onChange={setAmount} min={0} step={100} />
          </div>
        </div>
      </Card>

      {mode === 'retirement' && (
        <Card>
          <p className="text-xs text-slate-600">
            Context only, not a limit: a commonly-cited sustainable withdrawal rate (Bengen "4% rule" / Trinity Study
            lineage) suggests ~3–4% of your {formatEur(totalPortfolioValueEur)} portfolio per year, i.e. roughly{' '}
            <strong>{formatEur(retirementRef.lowEur)}–{formatEur(retirementRef.highEur)}</strong>. Enter whatever
            amount you actually need above — this app never caps it.
          </p>
        </Card>
      )}

      <div className="flex flex-wrap gap-2 print:hidden">
        <Button variant="secondary" onClick={() => window.print()}>
          Print / save as PDF
        </Button>
        <Button variant="secondary" onClick={handleCopySummary}>
          {copyStatus === 'copied' ? 'Copied!' : copyStatus === 'error' ? 'Copy failed — try again' : 'Copy summary as text'}
        </Button>
      </div>

      {result.holdingsExcludedNoPrice.length > 0 && (
        <Card className="border-amber-200 bg-amber-50">
          <p className="text-sm text-amber-900">
            <Badge tone="warn">Manual review needed</Badge>{' '}
            {result.holdingsExcludedNoPrice.map((h) => h.displayName).join(', ')} — no fetchable price, excluded from
            this recommendation.
          </p>
        </Card>
      )}

      <Card>
        <p className="text-sm text-slate-700">
          Cash available: <strong>{formatEur(result.cashAvailableEur)}</strong>. Used first:{' '}
          <strong>{formatEur(result.cashUsedEur)}</strong>. Remaining to cover via sales:{' '}
          <strong>{formatEur(result.remainingNeededAfterCashEur)}</strong>.
        </p>
      </Card>

      {plansUseStalePrice && (
        <Card className="border-amber-200 bg-amber-50">
          <p className="text-sm text-amber-900">
            <Badge tone="warn">stale price</Badge> At least one holding in these plans is priced from a stale (rate-
            limited or failed) quote — the tax and proceeds estimates below may be off. Refresh prices from the
            Holdings tab before acting on this.
          </p>
        </Card>
      )}

      {result.comparisonCallout && (
        <Card className="border-slate-300 bg-slate-50">
          <p className="text-sm text-slate-700">{result.comparisonCallout}</p>
        </Card>
      )}

      {hasSalePlan && mode === 'cash' && (
        <Card className="border-slate-300 bg-slate-50">
          <p className="text-sm text-slate-700">
            <strong>Timing tip:</strong> if this isn't urgent, splitting the sale across two calendar years (e.g.
            some in late December, the rest in early January) uses two separate years' Sparerpauschbetrag instead of
            one — a well-known way to reduce or eliminate the tax on a sale like this. Context only; the amount above
            is treated as needed now.
          </p>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <PlanCard key={`tax-${amount}`} title="Tax-optimized" plan={result.taxOptimizedPlan} cashUsedEur={result.cashUsedEur} stalePriceHoldingIds={stalePriceHoldingIds} />
        <PlanCard key={`risk-${amount}`} title="Risk-reduction" plan={result.riskReductionPlan} cashUsedEur={result.cashUsedEur} stalePriceHoldingIds={stalePriceHoldingIds} />
      </div>

      <p className="text-xs text-slate-400">
        Ranking is a heuristic ordering of whole holdings (losses/no-gain first for tax; concentration descending for
        risk), not a cross-holding tax-lot optimizer — appropriate for a handful of holdings, not a solver problem.
      </p>
    </div>
  )
}
