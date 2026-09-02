import { usePortfolio } from '../state/PortfolioContext'
import { concentrationPct, totalHoldingsValueEur, totalQuantity } from '../lib/recommend'
import { checkAllowanceOverAllocation } from '../lib/tax'
import { formatEur, formatPct } from '../lib/format'
import { Badge, Button, Card } from './ui'

export function Dashboard({ onNavigate }: { onNavigate: (tab: string) => void }) {
  const { state, prices, pricesLoading, refreshPrices, isDemo, loadDemoData } = usePortfolio()
  const { holdings, cashBalances, institutions, settings } = state

  const priceMap = Object.fromEntries(
    Object.entries(prices)
      .filter(([, info]) => Number.isFinite(info.price))
      .map(([id, info]) => [id, info.price]),
  )
  const holdingsValue = totalHoldingsValueEur(holdings, priceMap)
  const cashValue = cashBalances.reduce((s, c) => s + c.amountEur, 0)
  const totalValue = holdingsValue + cashValue
  const overAllocation = checkAllowanceOverAllocation(institutions, settings.filingStatus)

  const rankedHoldings = holdings
    .filter((h) => priceMap[h.id] != null)
    .map((h) => ({ h, pct: concentrationPct(h, holdings, priceMap) }))
    .sort((a, b) => b.pct - a.pct)

  const hasNoData = holdings.length === 0 && cashBalances.length === 0

  return (
    <div className="space-y-4">
      {isDemo && (
        <Card className="border-blue-200 bg-blue-50">
          <p className="text-sm text-blue-900">
            You're viewing <strong>demo data</strong> — fictional holdings so you can see how recommendations work.
            Go to Settings to clear it and enter your own.
          </p>
        </Card>
      )}

      {hasNoData && (
        <Card className="border-slate-300 bg-slate-50">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <p className="text-sm text-slate-700">
              No holdings or cash entered yet. New here? The Guide tab walks through setup in a few short steps.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => onNavigate('guide')}>
                Read the guide
              </Button>
              <Button onClick={loadDemoData}>Load demo data</Button>
            </div>
          </div>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <p className="text-xs text-slate-500">Total portfolio value</p>
          <p className="mt-1 text-2xl font-semibold text-slate-900">{formatEur(totalValue)}</p>
        </Card>
        <Card>
          <p className="text-xs text-slate-500">Holdings value</p>
          <p className="mt-1 text-2xl font-semibold text-slate-900">{formatEur(holdingsValue)}</p>
        </Card>
        <Card>
          <p className="text-xs text-slate-500">Cash</p>
          <p className="mt-1 text-2xl font-semibold text-slate-900">{formatEur(cashValue)}</p>
        </Card>
      </div>

      {overAllocation.isOverAllocated && (
        <Card className="border-red-200 bg-red-50">
          <p className="text-sm text-red-800">
            <strong>Freistellungsauftrag over-allocated:</strong> {formatEur(overAllocation.totalSubmittedEur)} submitted
            across institutions vs. a {formatEur(overAllocation.capEur)} annual cap ({formatEur(overAllocation.excessEur)} over).
            See Allowance for details.
          </p>
        </Card>
      )}

      <Card>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-semibold text-slate-900">Concentration</h2>
          <Button variant="secondary" onClick={() => refreshPrices()} disabled={pricesLoading}>
            {pricesLoading ? 'Refreshing…' : 'Refresh prices'}
          </Button>
        </div>
        {rankedHoldings.length === 0 ? (
          <p className="text-sm text-slate-500">No priced holdings yet.</p>
        ) : (
          <ul className="space-y-1">
            {rankedHoldings.map(({ h, pct }) => (
              <li key={h.id} className="flex items-center justify-between text-sm">
                <span>
                  {h.displayName} <span className="text-slate-400">({totalQuantity(h)} units)</span>
                </span>
                <span className="flex items-center gap-2">
                  {pct * 100 >= settings.concentrationThresholdPct && <Badge tone="warn">above threshold</Badge>}
                  <span className="font-medium">{formatPct(pct)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="flex justify-end">
        <Button onClick={() => onNavigate('recommend')}>Get a sell recommendation →</Button>
      </div>
    </div>
  )
}
