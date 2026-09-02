import type { SalePlan } from '../lib/recommend'
import { formatEur } from '../lib/format'

/**
 * The proceeds/tax/fee math and per-institution breakdown, shared between a
 * full Recommend plan and a single ad hoc "record a sale" entry — both are
 * just a SalePlan with a different number of line items.
 */
export function SalePlanFinancials({ plan }: { plan: SalePlan }) {
  return (
    <div className="space-y-3">
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
            <table className="w-full min-w-[620px] text-xs">
              <thead>
                <tr className="text-left text-slate-500">
                  <th className="py-1">Institution</th>
                  <th className="py-1 text-right">Stock pool (this sale)</th>
                  <th className="py-1 text-right">Fund pool (this sale)</th>
                  <th className="py-1 text-right">Loss pots carried in</th>
                  <th className="py-1 text-right">Allowance used</th>
                  <th className="py-1 text-right">Tax</th>
                  <th className="py-1 text-right">Loss pots after</th>
                </tr>
              </thead>
              <tbody>
                {plan.institutionBreakdown.map((b) => {
                  const hasCarryIn = b.carryInLossPotEquitiesEur > 0 || b.carryInLossPotGeneralEur > 0
                  const { remainingEquityLossPotEur, remainingGeneralLossPotEur } = b.projectedRemainingLossPots
                  const hasRemaining = remainingEquityLossPotEur > 0 || remainingGeneralLossPotEur > 0
                  return (
                    <tr key={b.institutionId} className="border-t border-slate-100">
                      <td className="py-1">{b.institutionLabel}</td>
                      <td className="py-1 text-right">{formatEur(b.newStockPoolEur)}</td>
                      <td className="py-1 text-right">{formatEur(b.newFundPoolEur)}</td>
                      <td className="py-1 text-right">
                        {hasCarryIn ? (
                          <>
                            equities {formatEur(b.carryInLossPotEquitiesEur)}
                            <br />
                            general {formatEur(b.carryInLossPotGeneralEur)}
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="py-1 text-right">{formatEur(b.allowanceUsedEur)}</td>
                      <td className="py-1 text-right font-medium">{formatEur(b.taxEur)}</td>
                      <td className="py-1 text-right">
                        {hasRemaining ? (
                          <>
                            equities {formatEur(remainingEquityLossPotEur)}
                            <br />
                            general {formatEur(remainingGeneralLossPotEur)}
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
