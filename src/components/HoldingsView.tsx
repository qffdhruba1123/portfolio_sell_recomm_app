import { useMemo, useRef, useState } from 'react'
import { usePortfolio } from '../state/PortfolioContext'
import type { Holding, Institution, Settings } from '../types'
import type { SecurityType } from '../types'
import { buildSingleHoldingSalePlan, totalQuantity, type PriceMap } from '../lib/recommend'
import { formatEur } from '../lib/format'
import { CSV_TEMPLATE_EXAMPLE_ROW, CSV_TEMPLATE_HEADER, type CsvImportSummary } from '../lib/csv'
import { getHistoricalPriceEur } from '../lib/yahoo'
import { Badge, Button, Card, Field, NumberInput, Select, TextInput } from './ui'
import { SalePlanFinancials } from './SalePlanSummary'

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

  const today = new Date().toISOString().slice(0, 10)
  const isFutureDate = acquiredAt > today

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
        <TextInput type="date" value={acquiredAt} max={today} onChange={(e) => setAcquiredAt(e.target.value)} />
      </Field>
      <Field label="Quantity">
        <NumberInput value={quantity} onChange={setQuantity} min={0} step="any" />
      </Field>
      <Field label="Unit cost (EUR)">
        <NumberInput value={unitCostEur} onChange={setUnitCostEur} min={0} step="any" />
      </Field>
      <Button variant="secondary" disabled={!acquiredAt || isFutureDate || fetching} onClick={handleFetchPrice}>
        {fetching ? 'Fetching…' : 'Fetch price for this date'}
      </Button>
      <Button
        disabled={!acquiredAt || isFutureDate || quantity <= 0}
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
      {isFutureDate && <p className="w-full text-xs text-red-600">Acquired date can't be in the future.</p>}
      {fetchError && <p className="w-full text-xs text-red-600">{fetchError}</p>}
    </div>
  )
}

function RecordSaleForm({
  holding,
  currentPrice,
  allHoldings,
  institutions,
  settings,
  priceMap,
}: {
  holding: Holding
  currentPrice: number | undefined
  allHoldings: Holding[]
  institutions: Institution[]
  settings: Settings
  priceMap: PriceMap
}) {
  const { executePlan } = usePortfolio()
  const [open, setOpen] = useState(false)
  const [quantity, setQuantity] = useState(0)
  const [pricePerUnitEur, setPricePerUnitEur] = useState(0)

  const totalQty = totalQuantity(holding)
  if (totalQty <= 0) return null

  if (!open) {
    return (
      <button
        className="text-xs text-slate-600 hover:underline"
        onClick={() => {
          setQuantity(totalQty)
          setPricePerUnitEur(Number.isFinite(currentPrice) ? (currentPrice as number) : 0)
          setOpen(true)
        }}
      >
        record a sale
      </button>
    )
  }

  const plan =
    quantity > 0 && pricePerUnitEur > 0
      ? buildSingleHoldingSalePlan(holding, quantity, pricePerUnitEur, allHoldings, priceMap, institutions, settings)
      : null

  return (
    <div className="mt-2 w-full rounded-md border border-slate-200 p-2">
      <p className="text-xs text-slate-600">
        For a sale made on your own initiative — not from a Recommend plan. Records it the same way: consumes FIFO
        lots and updates allowance used and loss pots at this holding's institution.
      </p>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <Field label="Quantity sold">
          <NumberInput className="w-28" value={quantity} onChange={setQuantity} min={0} max={totalQty} step="any" />
        </Field>
        <Field label="Price per unit (EUR)">
          <NumberInput className="w-28" value={pricePerUnitEur} onChange={setPricePerUnitEur} min={0} step="any" />
        </Field>
      </div>
      {quantity > totalQty && <p className="mt-1 text-xs text-red-600">Only {totalQty} unit(s) are held — will be capped at that amount.</p>}

      {plan && plan.lineItems.length > 0 && (
        <div className="mt-2">
          <SalePlanFinancials plan={plan} />
        </div>
      )}

      <div className="mt-2 flex gap-2">
        <Button
          disabled={!plan || plan.lineItems.length === 0}
          onClick={() => {
            if (!plan || plan.lineItems.length === 0) return
            const li = plan.lineItems[0]
            if (
              confirm(
                `Record this sale of ${li.quantitySold.toFixed(2)} unit(s) of "${holding.displayName}"? This updates this holding's lots and the allowance used / loss pots at ${li.institutionLabel}. Export a backup first if you're unsure.`,
              )
            ) {
              executePlan(plan)
              setOpen(false)
              setQuantity(0)
              setPricePerUnitEur(0)
            }
          }}
        >
          Record this sale
        </Button>
        <Button variant="secondary" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

function StockSplitForm({ holding }: { holding: Holding }) {
  const { applyStockSplitToHolding } = usePortfolio()
  const [open, setOpen] = useState(false)
  const [ratio, setRatio] = useState(2)

  const totalQty = totalQuantity(holding)
  if (totalQty <= 0) return null

  if (!open) {
    return (
      <button className="text-xs text-slate-600 hover:underline" onClick={() => setOpen(true)}>
        record a stock split
      </button>
    )
  }

  const totalCostEur = holding.lots.reduce((sum, l) => sum + l.quantity * l.unitCostEur, 0)
  const avgUnitCostEur = totalQty > 0 ? totalCostEur / totalQty : 0
  const validRatio = ratio > 0

  return (
    <div className="mt-2 w-full rounded-md border border-slate-200 p-2">
      <p className="text-xs text-slate-600">
        A split changes share count and cost-per-share but never total cost basis or acquired dates — not a taxable
        event in Germany. Enter the ratio: 2 for a 2-for-1 split, 0.5 for a 1-for-2 reverse split, 1.5 for a 3-for-2
        split.
      </p>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <Field label="Split ratio">
          <NumberInput className="w-24" value={ratio} onChange={setRatio} min={0} step="any" />
        </Field>
        {validRatio && (
          <p className="text-xs text-slate-500">
            {totalQty.toFixed(4)} units @ avg {formatEur(avgUnitCostEur)} → {(totalQty * ratio).toFixed(4)} units @
            avg {formatEur(avgUnitCostEur / ratio)}
          </p>
        )}
      </div>
      <div className="mt-2 flex gap-2">
        <Button
          disabled={!validRatio || ratio === 1}
          onClick={() => {
            if (
              confirm(
                `Apply a ${ratio}:1 split to "${holding.displayName}"? This rewrites every lot's quantity and unit cost — make sure ${ratio} is the correct ratio (e.g. 2 for a 2-for-1 split).`,
              )
            ) {
              applyStockSplitToHolding(holding.id, ratio)
              setOpen(false)
              setRatio(2)
            }
          }}
        >
          Apply split
        </Button>
        <Button variant="secondary" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

export function HoldingsView() {
  const { state, prices, pricesLoading, refreshPrices, addHolding, removeHolding, addLot, removeLot, updateHolding } = usePortfolio()

  const priceMap: PriceMap = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(prices)
          .filter(([, info]) => Number.isFinite(info.price))
          .map(([id, info]) => [id, info.price]),
      ),
    [prices],
  )

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

            <div className="mt-2 flex flex-wrap gap-3 border-t border-slate-100 pt-2">
              <RecordSaleForm
                holding={h}
                currentPrice={priceInfo?.price}
                allHoldings={state.holdings}
                institutions={state.institutions}
                settings={state.settings}
                priceMap={priceMap}
              />
              <StockSplitForm holding={h} />
            </div>
          </Card>
        )
      })}

      {state.holdings.length === 0 && <p className="text-sm text-slate-500">No holdings yet.</p>}
    </div>
  )
}
