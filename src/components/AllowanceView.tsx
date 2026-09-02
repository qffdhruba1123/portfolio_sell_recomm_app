import { Fragment, useState } from 'react'
import { usePortfolio } from '../state/PortfolioContext'
import type { InterestPayoutFrequency } from '../types'
import { checkAllowanceOverAllocation, remainingAllowance, suggestAllowanceSplit, suggestInstitutionToTrim } from '../lib/tax'
import { estimateIncomeByInstitution, type IncomeSource } from '../lib/allowancePlanning'
import { formatEur } from '../lib/format'
import { Badge, Button, Card, Field, NumberInput, Select, TextInput } from './ui'

function NewInstitutionForm({ onAdd }: { onAdd: (label: string) => void }) {
  const [label, setLabel] = useState('')
  return (
    <div className="flex flex-wrap items-end gap-2">
      <Field label="New institution name">
        <TextInput value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Trade Republic" />
      </Field>
      <Button
        disabled={!label.trim()}
        onClick={() => {
          onAdd(label.trim())
          setLabel('')
        }}
      >
        Add institution
      </Button>
    </div>
  )
}

function NewCashForm({ institutions, onAdd }: { institutions: { id: string; label: string }[]; onAdd: (label: string, amountEur: number, institutionId: string) => void }) {
  const [label, setLabel] = useState('')
  const [amountEur, setAmountEur] = useState(0)
  const [institutionId, setInstitutionId] = useState(institutions[0]?.id ?? '')

  return (
    <div className="flex flex-wrap items-end gap-2">
      <Field label="Label">
        <TextInput value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Tagesgeld" />
      </Field>
      <Field label="Amount (EUR)">
        <NumberInput value={amountEur} onChange={setAmountEur} min={0} step="any" />
      </Field>
      <Field label="Institution">
        <Select value={institutionId} onChange={(e) => setInstitutionId(e.target.value)}>
          {institutions.map((i) => (
            <option key={i.id} value={i.id}>
              {i.label}
            </option>
          ))}
        </Select>
      </Field>
      <Button
        disabled={!label.trim() || !institutionId}
        onClick={() => {
          onAdd(label.trim(), amountEur, institutionId)
          setLabel('')
          setAmountEur(0)
        }}
      >
        Add cash balance
      </Button>
    </div>
  )
}

function AllowanceSplitSuggestionCard() {
  const { state, updateInstitution } = usePortfolio()
  const { holdings, cashBalances, institutions, settings } = state
  const previousYear = new Date().getFullYear() - 1

  const [suggestions, setSuggestions] = useState<ReturnType<typeof suggestAllowanceSplit> | null>(null)
  const [sourcesByInstitution, setSourcesByInstitution] = useState<Record<string, IncomeSource[]>>({})
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [unresolvedCount, setUnresolvedCount] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function toggleExpanded(institutionId: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(institutionId)) next.delete(institutionId)
      else next.add(institutionId)
      return next
    })
  }

  async function handleEstimate() {
    setLoading(true)
    setError(null)
    try {
      const estimate = await estimateIncomeByInstitution(holdings, cashBalances, previousYear, settings.corsProxyPrefix)
      setSuggestions(suggestAllowanceSplit(institutions, estimate.incomeByInstitutionEur, settings.filingStatus))
      setSourcesByInstitution(estimate.sourcesByInstitution)
      setUnresolvedCount(estimate.unresolvedHoldingIds.length)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card>
      <h2 className="mb-1 font-semibold text-slate-900">Suggest an allowance split</h2>
      <p className="mb-2 text-xs text-slate-500">
        Estimates each institution's {previousYear} dividend income (from Yahoo Finance's dividend history and your
        lot quantities, as a proxy for expected income) plus each cash balance's projected interest for the rest of
        this year (from the rate and payout frequency you enter below), then suggests filing the annual allowance
        wherever the income actually is — fully covering the highest-income institution first, since real-time
        withholding relief is only useful where income occurs. This is a planning estimate, not exact accounting: it
        assumes continuous holding since each lot's acquisition date (this app has no historical sale record) and
        converts foreign-currency dividends at a single mid-year FX rate rather than the rate on each payment date.
      </p>
      <Button variant="secondary" onClick={handleEstimate} disabled={loading || institutions.length === 0}>
        {loading ? 'Estimating…' : `Estimate from ${previousYear}'s dividends + interest`}
      </Button>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      {unresolvedCount > 0 && (
        <p className="mt-2 text-xs text-amber-700">
          {unresolvedCount} holding(s) couldn't be resolved on Yahoo Finance and were excluded from the estimate
          rather than guessed.
        </p>
      )}
      {suggestions && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[480px] text-sm">
            <thead>
              <tr className="text-left text-slate-500">
                <th className="py-1">Institution</th>
                <th className="py-1 text-right">Est. {previousYear} income</th>
                <th className="py-1 text-right">Suggested allowance</th>
                <th className="py-1 text-right">Currently submitted</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {suggestions.map((s) => {
                const institution = institutions.find((i) => i.id === s.institutionId)
                if (!institution) return null
                const sources = sourcesByInstitution[s.institutionId] ?? []
                const isExpanded = expanded.has(s.institutionId)
                return (
                  <Fragment key={s.institutionId}>
                    <tr className="border-t border-slate-100">
                      <td className="py-1">
                        <button
                          className="text-left hover:underline"
                          disabled={sources.length === 0}
                          onClick={() => toggleExpanded(s.institutionId)}
                          title={sources.length > 0 ? 'Show breakdown' : undefined}
                        >
                          {sources.length > 0 ? (isExpanded ? '▾ ' : '▸ ') : ''}
                          {institution.label}
                        </button>
                      </td>
                      <td className="py-1 text-right">{formatEur(s.estimatedIncomeEur)}</td>
                      <td className="py-1 text-right font-medium">{formatEur(s.suggestedSubmittedEur)}</td>
                      <td className="py-1 text-right text-slate-500">{formatEur(institution.submittedEur)}</td>
                      <td className="py-1 text-right">
                        <button
                          className="text-xs text-slate-700 hover:underline"
                          disabled={institution.submittedEur === s.suggestedSubmittedEur}
                          onClick={() => updateInstitution(institution.id, { submittedEur: s.suggestedSubmittedEur })}
                        >
                          apply
                        </button>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className="bg-slate-50">
                        <td colSpan={5} className="py-1 pl-6">
                          <ul className="space-y-0.5 py-1 text-xs text-slate-600">
                            {sources.map((source) => (
                              <li key={`${source.kind}-${source.id}`} className="flex justify-between">
                                <span>
                                  {source.kind === 'holding' ? '📈 ' : '💶 '}
                                  {source.label}
                                </span>
                                <span>{formatEur(source.estimatedIncomeEur)}</span>
                              </li>
                            ))}
                          </ul>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}

export function AllowanceView() {
  const {
    state,
    addInstitution,
    updateInstitution,
    removeInstitution,
    addCashBalance,
    updateCashBalance,
    removeCashBalance,
  } = usePortfolio()
  const { institutions, cashBalances, settings } = state

  const overAllocation = checkAllowanceOverAllocation(institutions, settings.filingStatus)
  const trimSuggestion = overAllocation.isOverAllocated ? suggestInstitutionToTrim(institutions) : null

  function handleRemoveInstitution(institutionId: string, label: string) {
    const holdingsUsing = state.holdings.filter((h) => h.institutionId === institutionId)
    const cashUsing = cashBalances.filter((c) => c.institutionId === institutionId)
    if (holdingsUsing.length > 0 || cashUsing.length > 0) {
      alert(
        `Can't remove "${label}" — ${holdingsUsing.length} holding(s) and ${cashUsing.length} cash balance(s) still reference it. Reassign or remove those first.`,
      )
      return
    }
    if (confirm(`Remove institution "${label}"? This can't be undone.`)) removeInstitution(institutionId)
  }

  return (
    <div className="space-y-4">
      <Card>
        <h2 className="mb-2 font-semibold text-slate-900">Freistellungsauftrag by institution</h2>
        <p className="mb-3 text-xs text-slate-500">
          Annual cap for {settings.filingStatus === 'single' ? 'single filers' : 'married filers'}:{' '}
          {formatEur(overAllocation.capEur)}. Enter the submitted and used figures exactly as shown on each broker's
          own tax-exemption screen — remaining is always derived, never edited directly. Sell fee is that broker's
          flat cost per sell order (varies by broker — e.g. some neobrokers charge under 1 EUR/trade).
        </p>

        {overAllocation.isOverAllocated && (
          <Card className="mb-3 border-red-200 bg-red-50">
            <p className="text-sm text-red-800">
              <strong>Over-allocated</strong> by {formatEur(overAllocation.excessEur)}: you've submitted{' '}
              {formatEur(overAllocation.totalSubmittedEur)} total, but the annual cap is {formatEur(overAllocation.capEur)}.
              Germany's BZSt registry cross-checks this across all institutions.
              {trimSuggestion && (
                <>
                  {' '}
                  Consider trimming <strong>{trimSuggestion.label}</strong> — it has the most unused headroom (
                  {formatEur(remainingAllowance(trimSuggestion))} unused).
                </>
              )}
            </p>
          </Card>
        )}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="text-left text-slate-500">
                <th className="py-1">Institution</th>
                <th className="py-1 text-right">Submitted</th>
                <th className="py-1 text-right">Used</th>
                <th className="py-1 text-right">Remaining</th>
                <th className="py-1 text-right">Sell fee</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {institutions.map((i) => (
                <tr key={i.id} className="border-t border-slate-100">
                  <td className="py-1">
                    <TextInput value={i.label} onChange={(e) => updateInstitution(i.id, { label: e.target.value })} />
                  </td>
                  <td className="py-1 text-right">
                    <NumberInput
                      className="text-right"
                      value={i.submittedEur}
                      onChange={(v) => updateInstitution(i.id, { submittedEur: v })}
                      min={0}
                      step="any"
                    />
                  </td>
                  <td className="py-1 text-right">
                    <NumberInput
                      className="text-right"
                      value={i.usedEur}
                      onChange={(v) => updateInstitution(i.id, { usedEur: v })}
                      min={0}
                      step="any"
                    />
                  </td>
                  <td className="py-1 text-right font-medium">{formatEur(remainingAllowance(i))}</td>
                  <td className="py-1 text-right">
                    <NumberInput
                      className="text-right"
                      value={i.brokerFeeEur ?? 0}
                      onChange={(v) => updateInstitution(i.id, { brokerFeeEur: v })}
                      min={0}
                      step="any"
                    />
                  </td>
                  <td className="py-1 text-right">
                    <button className="text-xs text-red-600 hover:underline" onClick={() => handleRemoveInstitution(i.id, i.label)}>
                      remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3">
          <NewInstitutionForm onAdd={(label) => addInstitution({ label, submittedEur: 0, usedEur: 0, brokerFeeEur: 0 })} />
        </div>
      </Card>

      <AllowanceSplitSuggestionCard />

      <Card>
        <h2 className="mb-2 font-semibold text-slate-900">Cash balances</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] text-sm">
            <thead>
              <tr className="text-left text-slate-500">
                <th className="py-1">Label</th>
                <th className="py-1">Institution</th>
                <th className="py-1 text-right">Amount</th>
                <th className="py-1 text-right">Rate (% p.a.)</th>
                <th className="py-1">Payout</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {cashBalances.map((c) => (
                <tr key={c.id} className="border-t border-slate-100">
                  <td className="py-1">
                    <TextInput value={c.label} onChange={(e) => updateCashBalance(c.id, { label: e.target.value })} />
                  </td>
                  <td className="py-1">
                    <Select value={c.institutionId} onChange={(e) => updateCashBalance(c.id, { institutionId: e.target.value })}>
                      {institutions.map((i) => (
                        <option key={i.id} value={i.id}>
                          {i.label}
                        </option>
                      ))}
                    </Select>
                  </td>
                  <td className="py-1 text-right">
                    <NumberInput
                      className="text-right"
                      value={c.amountEur}
                      onChange={(v) => updateCashBalance(c.id, { amountEur: v })}
                      min={0}
                      step="any"
                    />
                  </td>
                  <td className="py-1 text-right">
                    <NumberInput
                      className="text-right"
                      value={c.interestRatePct ?? 0}
                      onChange={(v) => updateCashBalance(c.id, { interestRatePct: v })}
                      min={0}
                      step="any"
                    />
                  </td>
                  <td className="py-1">
                    <Select
                      value={c.interestPayoutFrequency ?? 'annually'}
                      onChange={(e) => updateCashBalance(c.id, { interestPayoutFrequency: e.target.value as InterestPayoutFrequency })}
                    >
                      <option value="monthly">Monthly</option>
                      <option value="quarterly">Quarterly</option>
                      <option value="annually">Annually</option>
                    </Select>
                  </td>
                  <td className="py-1 text-right">
                    <button className="text-xs text-red-600 hover:underline" onClick={() => removeCashBalance(c.id)}>
                      remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {institutions.length === 0 ? (
          <p className="mt-3 text-xs text-slate-500">Add an institution above before adding cash balances.</p>
        ) : (
          <div className="mt-3">
            <NewCashForm institutions={institutions} onAdd={(label, amountEur, institutionId) => addCashBalance({ label, amountEur, institutionId })} />
          </div>
        )}
        <p className="mt-2 text-xs text-slate-500">
          Interest counts toward that institution's Sparerpauschbetrag the same as dividends and capital gains, but
          there's no way to fetch a bank's rate automatically — enter the rate and how often it's paid out, and the
          allowance-split suggestion above projects how much interest is still coming this year from today's
          balance (assumes the balance stays roughly constant and that payouts land on regular month/quarter/year
          boundaries).
        </p>
      </Card>

      <Card className="border-slate-300 bg-slate-50">
        <p className="text-xs text-slate-600">
          Filing the full annual allowance at whichever institution can best use it — and letting the unused portion
          carry through to your annual tax return for other income — is generally sound guidance. Exact mechanics
          (some foreign custodians don't support filing one at all) vary; this app doesn't model your annual tax
          return, only real-time per-institution withholding for a hypothetical sale. <Badge>informational only</Badge>
        </p>
      </Card>
    </div>
  )
}
