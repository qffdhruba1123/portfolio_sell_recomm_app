import { useState } from 'react'
import { usePortfolio } from '../state/PortfolioContext'
import { checkAllowanceOverAllocation, remainingAllowance, suggestInstitutionToTrim } from '../lib/tax'
import { formatEur } from '../lib/format'
import { Badge, Button, Card, Field, NumberInput, Select, TextInput } from './ui'

function NewInstitutionForm({ onAdd }: { onAdd: (label: string) => void }) {
  const [label, setLabel] = useState('')
  return (
    <div className="flex items-end gap-2">
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
    <div className="flex items-end gap-2">
      <Field label="Label">
        <TextInput value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Tagesgeld" />
      </Field>
      <Field label="Amount (EUR)">
        <NumberInput value={amountEur} onChange={setAmountEur} step="any" />
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

  return (
    <div className="space-y-4">
      <Card>
        <h2 className="mb-2 font-semibold text-slate-900">Freistellungsauftrag by institution</h2>
        <p className="mb-3 text-xs text-slate-500">
          Annual cap for {settings.filingStatus === 'single' ? 'single filers' : 'married filers'}:{' '}
          {formatEur(overAllocation.capEur)}. Enter the submitted and used figures exactly as shown on each broker's
          own tax-exemption screen — remaining is always derived, never edited directly.
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

        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-500">
              <th className="py-1">Institution</th>
              <th className="py-1 text-right">Submitted</th>
              <th className="py-1 text-right">Used</th>
              <th className="py-1 text-right">Remaining</th>
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
                    step="any"
                  />
                </td>
                <td className="py-1 text-right">
                  <NumberInput
                    className="text-right"
                    value={i.usedEur}
                    onChange={(v) => updateInstitution(i.id, { usedEur: v })}
                    step="any"
                  />
                </td>
                <td className="py-1 text-right font-medium">{formatEur(remainingAllowance(i))}</td>
                <td className="py-1 text-right">
                  <button className="text-xs text-red-600 hover:underline" onClick={() => removeInstitution(i.id)}>
                    remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-3">
          <NewInstitutionForm onAdd={(label) => addInstitution({ label, submittedEur: 0, usedEur: 0 })} />
        </div>
      </Card>

      <Card>
        <h2 className="mb-2 font-semibold text-slate-900">Cash balances</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-500">
              <th className="py-1">Label</th>
              <th className="py-1">Institution</th>
              <th className="py-1 text-right">Amount</th>
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
                    step="any"
                  />
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
        {institutions.length === 0 ? (
          <p className="mt-3 text-xs text-slate-500">Add an institution above before adding cash balances.</p>
        ) : (
          <div className="mt-3">
            <NewCashForm institutions={institutions} onAdd={(label, amountEur, institutionId) => addCashBalance({ label, amountEur, institutionId })} />
          </div>
        )}
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
