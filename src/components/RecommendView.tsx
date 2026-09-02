import { useMemo, useState } from 'react'
import { usePortfolio } from '../state/PortfolioContext'
import { recommend, retirementReference, totalHoldingsValueEur, type SalePlan } from '../lib/recommend'
import { formatEur } from '../lib/format'
import { Badge, Button, Card, NumberInput } from './ui'

function PlanCard({ title, plan, cashUsedEur }: { title: string; plan: SalePlan | null; cashUsedEur: number }) {
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
              <p className="mt-1 text-xs text-slate-600">{li.rationale}</p>
            </li>
          ))}
        </ul>

        {plan.shortfallEur > 0 && (
          <p className="text-sm text-red-700">
            Shortfall: holdings + cash don't cover the full request by {formatEur(plan.shortfallEur)}.
          </p>
        )}

        <div className="border-t border-slate-200 pt-2 text-sm">
          <div className="flex justify-between">
            <span>Gross proceeds from sales</span>
            <span>{formatEur(plan.grossProceedsFromSalesEur)}</span>
          </div>
          <div className="flex justify-between">
            <span>Estimated tax</span>
            <span>−{formatEur(plan.totalTaxEur)}</span>
          </div>
          <div className="flex justify-between">
            <span>Broker fees</span>
            <span>−{formatEur(plan.totalFeesEur)}</span>
          </div>
          <div className="flex justify-between font-semibold text-slate-900">
            <span>Estimated net proceeds</span>
            <span>{formatEur(plan.estimatedNetProceedsEur)}</span>
          </div>
          {plan.estimatedNetProceedsEur < plan.grossProceedsFromSalesEur && (
            <p className="mt-1 text-xs text-slate-500">
              Tax is typically withheld by the broker at the time of sale — you may need to sell a bit more than the
              requested amount to net the full sum after tax and fees.
            </p>
          )}
        </div>

        {plan.institutionBreakdown.length > 0 && (
          <div className="border-t border-slate-200 pt-2">
            <p className="mb-1 text-xs font-medium text-slate-600">Per-institution tax breakdown</p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px] text-xs">
                <thead>
                  <tr className="text-left text-slate-500">
                    <th className="py-1">Institution</th>
                    <th className="py-1 text-right">Stock pool</th>
                    <th className="py-1 text-right">Fund pool</th>
                    <th className="py-1 text-right">Allowance used</th>
                    <th className="py-1 text-right">Tax</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.institutionBreakdown.map((b) => (
                    <tr key={b.institutionId} className="border-t border-slate-100">
                      <td className="py-1">{b.institutionLabel}</td>
                      <td className="py-1 text-right">{formatEur(b.stockPoolEur)}</td>
                      <td className="py-1 text-right">{formatEur(b.fundPoolEur)}</td>
                      <td className="py-1 text-right">{formatEur(b.allowanceUsedEur)}</td>
                      <td className="py-1 text-right font-medium">{formatEur(b.taxEur)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
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

  return (
    <div className="space-y-4">
      <Card>
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

        {mode === 'retirement' && (
          <p className="mt-3 rounded-md bg-slate-50 p-2 text-xs text-slate-600">
            Context only, not a limit: a commonly-cited sustainable withdrawal rate (Bengen "4% rule" / Trinity Study
            lineage) suggests ~3–4% of your {formatEur(totalPortfolioValueEur)} portfolio per year, i.e. roughly{' '}
            <strong>{formatEur(retirementRef.lowEur)}–{formatEur(retirementRef.highEur)}</strong>. Enter whatever
            amount you actually need above — this app never caps it.
          </p>
        )}
      </Card>

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

      {result.comparisonCallout && (
        <Card className="border-slate-300 bg-slate-50">
          <p className="text-sm text-slate-700">{result.comparisonCallout}</p>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <PlanCard title="Tax-optimized" plan={result.taxOptimizedPlan} cashUsedEur={result.cashUsedEur} />
        <PlanCard title="Risk-reduction" plan={result.riskReductionPlan} cashUsedEur={result.cashUsedEur} />
      </div>

      <p className="text-xs text-slate-400">
        Ranking is a heuristic ordering of whole holdings (losses/no-gain first for tax; concentration descending for
        risk), not a cross-holding tax-lot optimizer — appropriate for a handful of holdings, not a solver problem.
      </p>
    </div>
  )
}
