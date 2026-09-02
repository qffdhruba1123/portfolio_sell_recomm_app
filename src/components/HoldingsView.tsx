import { useRef, useState } from 'react'
import { usePortfolio } from '../state/PortfolioContext'
import type { SecurityType } from '../types'
import { totalQuantity } from '../lib/recommend'
import { formatEur } from '../lib/format'
import { CSV_TEMPLATE_EXAMPLE_ROW, CSV_TEMPLATE_HEADER, type CsvImportSummary } from '../lib/csv'
import { getHistoricalPriceEur } from '../lib/yahoo'
import { Badge, Button, Card, Field, NumberInput, Select, TextInput } from './ui'

function downloadCsvTemplate() {
  const blob = new Blob([`${CSV_TEMPLATE_HEADER}\n${CSV_TEMPLATE_EXAMPLE_ROW}\n`], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'holdings-import-template.csv'
  a.click()
  URL.revokeObjectURL(url)
}

function CsvImportCard() {
  const { importHoldingsCsv } = usePortfolio()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [summary, setSummary] = useState<CsvImportSummary | null>(null)

  async function handleFile(file: File) {
    const text = await file.text()
    setSummary(importHoldingsCsv(text))
  }

  return (
    <Card>
      <h3 className="mb-1 font-semibold text-slate-900">Bulk upload via CSV</h3>
      <p className="mb-2 text-xs text-slate-500">
        Columns: <code>identifier, displayName, securityType, institution, acquiredAt, quantity, unitCostEur, note</code>.
        One row per lot — multiple rows with the same identifier + institution become one holding with multiple lots.
        An institution named in the file that doesn't exist yet is created automatically (allowance defaults to 0/0 —
        fill it in on the Allowance tab).
      </p>
      <div className="flex items-center gap-2">
        <Button variant="secondary" onClick={downloadCsvTemplate}>
          Download template
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) handleFile(file)
            e.target.value = ''
          }}
        />
        <Button onClick={() => fileInputRef.current?.click()}>Upload CSV</Button>
      </div>
      {summary && (
        <div className="mt-2 text-xs">
          <p className="text-slate-700">
            {summary.holdingsCreated} new holding(s), {summary.holdingsAppended} existing holding(s) got new lots,{' '}
            {summary.institutionsCreated} new institution(s) created.
          </p>
          {summary.errors.length > 0 && (
            <ul className="mt-1 space-y-0.5 text-red-600">
              {summary.errors.map((e, i) => (
                <li key={i}>
                  Row {e.rowNumber}: {e.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  )
}

function NewHoldingForm({ onAdd }: { onAdd: (h: { identifier: string; displayName: string; securityType: SecurityType; institutionId: string }) => void }) {
  const { state } = usePortfolio()
  const [identifier, setIdentifier] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [securityType, setSecurityType] = useState<SecurityType>('STOCK')
  const [institutionId, setInstitutionId] = useState(state.institutions[0]?.id ?? '')

  const canAdd = identifier.trim() && displayName.trim() && institutionId

  return (
    <Card>
      <h3 className="mb-2 font-semibold text-slate-900">Add holding</h3>
      <div className="grid gap-2 sm:grid-cols-4">
        <Field label="Ticker / ISIN">
          <TextInput value={identifier} onChange={(e) => setIdentifier(e.target.value)} placeholder="e.g. AAPL or US0378331005" />
        </Field>
        <Field label="Display name">
          <TextInput value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Apple Inc." />
        </Field>
        <Field label="Type">
          <Select value={securityType} onChange={(e) => setSecurityType(e.target.value as SecurityType)}>
            <option value="STOCK">Stock</option>
            <option value="ETF">ETF / Fund</option>
            <option value="OTHER">Other</option>
          </Select>
        </Field>
        <Field label="Institution">
          <Select value={institutionId} onChange={(e) => setInstitutionId(e.target.value)}>
            {state.institutions.length === 0 && <option value="">Add one in Allowance first</option>}
            {state.institutions.map((i) => (
              <option key={i.id} value={i.id}>
                {i.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="mt-3">
        <Button
          disabled={!canAdd}
          onClick={() => {
            onAdd({ identifier: identifier.trim(), displayName: displayName.trim(), securityType, institutionId })
            setIdentifier('')
            setDisplayName('')
          }}
        >
          Add holding
        </Button>
      </div>
    </Card>
  )
}

function LotRow({ lot, onRemove }: { lot: { id: string; acquiredAt: string; quantity: number; unitCostEur: number; note?: string }; onRemove: () => void }) {
  return (
    <tr className="border-t border-slate-100 text-sm">
      <td className="py-1">{lot.acquiredAt}</td>
      <td className="py-1 text-right">{lot.quantity}</td>
      <td className="py-1 text-right">{formatEur(lot.unitCostEur)}</td>
      <td className="py-1 text-right">{formatEur(lot.quantity * lot.unitCostEur)}</td>
      <td className="py-1 text-right">
        <button className="text-xs text-red-600 hover:underline" onClick={onRemove}>
          remove
        </button>
      </td>
    </tr>
  )
}

function AddLotForm({
  identifier,
  proxyPrefix,
  onAdd,
}: {
  identifier: string
  proxyPrefix: string
  onAdd: (acquiredAt: string, quantity: number, unitCostEur: number) => void
}) {
  const [acquiredAt, setAcquiredAt] = useState('')
  const [quantity, setQuantity] = useState(0)
  const [unitCostEur, setUnitCostEur] = useState(0)
  const [fetching, setFetching] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)

  async function handleFetchPrice() {
    setFetching(true)
    setFetchError(null)
    try {
      setUnitCostEur(await getHistoricalPriceEur(identifier, acquiredAt, proxyPrefix))
    } catch (err) {
      setFetchError((err as Error).message)
    } finally {
      setFetching(false)
    }
  }

  return (
    <div className="mt-2 flex flex-wrap items-end gap-2">
      <Field label="Acquired">
        <TextInput type="date" value={acquiredAt} onChange={(e) => setAcquiredAt(e.target.value)} />
      </Field>
      <Field label="Quantity">
        <NumberInput value={quantity} onChange={setQuantity} step="any" />
      </Field>
      <Field label="Unit cost (EUR)">
        <NumberInput value={unitCostEur} onChange={setUnitCostEur} step="any" />
      </Field>
      <Button variant="secondary" disabled={!acquiredAt || fetching} onClick={handleFetchPrice}>
        {fetching ? 'Fetching…' : 'Fetch price for this date'}
      </Button>
      <Button
        disabled={!acquiredAt || quantity <= 0}
        onClick={() => {
          onAdd(acquiredAt, quantity, unitCostEur)
          setAcquiredAt('')
          setQuantity(0)
          setUnitCostEur(0)
          setFetchError(null)
        }}
      >
        Add lot
      </Button>
      {fetchError && <p className="w-full text-xs text-red-600">{fetchError}</p>}
    </div>
  )
}

export function HoldingsView() {
  const { state, prices, pricesLoading, refreshPrices, addHolding, removeHolding, addLot, removeLot, updateHolding } = usePortfolio()

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => refreshPrices()} disabled={pricesLoading}>
          {pricesLoading ? 'Refreshing…' : 'Refresh prices'}
        </Button>
      </div>

      <CsvImportCard />

      <NewHoldingForm onAdd={(h) => addHolding(h)} />

      {state.holdings.map((h) => {
        const priceInfo = prices[h.id]
        const institution = state.institutions.find((i) => i.id === h.institutionId)
        return (
          <Card key={h.id}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-slate-900">{h.displayName}</h3>
                  <Badge>{h.securityType}</Badge>
                  {priceInfo?.stale && <Badge tone="warn">stale price</Badge>}
                  {priceInfo?.source === 'error' && <Badge tone="bad">no price</Badge>}
                </div>
                <p className="text-xs text-slate-500">
                  {h.identifier} · {institution?.label ?? 'no institution'} · {totalQuantity(h)} units
                  {priceInfo && Number.isFinite(priceInfo.price) && ` · ${formatEur(priceInfo.price)}/unit`}
                </p>
                {priceInfo?.error && <p className="text-xs text-red-600">{priceInfo.error}</p>}
              </div>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-1 text-xs text-slate-600">
                  Teilfreistellung override:
                  <NumberInput
                    className="w-16"
                    value={(h.teilfreistellungOverride ?? -1) < 0 ? NaN : (h.teilfreistellungOverride ?? 0) * 100}
                    onChange={(v) => updateHolding(h.id, { teilfreistellungOverride: v / 100 })}
                    step={1}
                  />
                  %
                </label>
                <button
                  className="text-xs text-red-600 hover:underline"
                  onClick={() => {
                    if (confirm(`Remove "${h.displayName}" and all ${h.lots.length} lot(s)? This can't be undone.`)) removeHolding(h.id)
                  }}
                >
                  remove holding
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="mt-2 w-full min-w-[420px] text-xs">
                <thead>
                  <tr className="text-left text-slate-500">
                    <th className="py-1">Acquired</th>
                    <th className="py-1 text-right">Qty</th>
                    <th className="py-1 text-right">Unit cost</th>
                    <th className="py-1 text-right">Cost basis</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {h.lots.map((lot) => (
                    <LotRow key={lot.id} lot={lot} onRemove={() => removeLot(h.id, lot.id)} />
                  ))}
                </tbody>
              </table>
            </div>

            <AddLotForm
              identifier={h.identifier}
              proxyPrefix={state.settings.corsProxyPrefix}
              onAdd={(acquiredAt, quantity, unitCostEur) => addLot(h.id, { acquiredAt, quantity, unitCostEur })}
            />
          </Card>
        )
      })}

      {state.holdings.length === 0 && <p className="text-sm text-slate-500">No holdings yet.</p>}
    </div>
  )
}
