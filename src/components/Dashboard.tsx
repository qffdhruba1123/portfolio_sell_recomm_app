import { usePortfolio } from '../state/PortfolioContext'
import {
  computeFullLiquidationSummary,
  concentrationPct,
  findTaxLossHarvestingOpportunities,
  totalHoldingsValueEur,
  totalQuantity,
} from '../lib/recommend'
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
  const liquidation = computeFullLiquidationSummary(holdings, priceMap, institutions, settings)
  const harvestingOpportunities = findTaxLossHarvestingOpportunities(holdings, priceMap, institutions)

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

      {rankedHoldings.length > 0 && (
        <Card>
          <h2 className="mb-2 font-semibold text-slate-900">Tax position if sold today</h2>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <p className="text-xs text-slate-500">Unrealized gain/loss</p>
              <p className={`text-lg font-semibold ${liquidation.totalGrossGainLossEur >= 0 ? 'text-slate-900' : 'text-red-700'}`}>
                {formatEur(liquidation.totalGrossGainLossEur)}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Of which tax-exempt (Bestandsschutz)</p>
              <p className="text-lg font-semibold text-slate-900">{formatEur(liquidation.totalExemptGainLossEur)}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Estimated tax if fully liquidated</p>
              <p className="text-lg font-semibold text-slate-900">{formatEur(liquidation.estimatedTotalTaxEur)}</p>
            </div>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Not a recommendation to sell — a standing snapshot of where your portfolio's tax exposure sits right
            now, using current prices and each institution's remaining allowance and loss pots.
          </p>

          {harvestingOpportunities.length > 0 && (
            <div className="mt-3 border-t border-slate-200 pt-3">
              <p className="mb-1 text-sm font-medium text-slate-900">Tax-loss harvesting opportunities</p>
              <p className="mb-2 text-xs text-slate-500">
                These holdings have a real unrealized loss right now (Bestandsschutz-exempt lots excluded, since
                those provide no tax benefit either way). Realizing one banks a loss you can offset against a gain
                realized later this year at that institution — independent of any cash need.
              </p>
              <ul className="space-y-1">
                {harvestingOpportunities.map((o) => (
                  <li key={o.holdingId} className="flex items-center justify-between text-sm">
                    <span>
                      {o.displayName} <span className="text-slate-400">({o.institutionLabel})</span>
                    </span>
                    <span className="font-medium text-red-700">-{formatEur(o.taxableLossEur)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      )}

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
