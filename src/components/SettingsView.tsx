import { useRef, useState } from 'react'
import { usePortfolio } from '../state/PortfolioContext'
import type { FilingStatus } from '../types'
import { SPARERPAUSCHBETRAG } from '../types'
import { Button, Card, Field, NumberInput, Select, TextInput } from './ui'

export function SettingsView() {
  const { state, updateSettings, loadDemoData, clearAllData, exportJson, importJson, isDemo } = usePortfolio()
  const { settings } = state
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [importError, setImportError] = useState<string | null>(null)

  function handleExport() {
    const json = exportJson()
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `portfolio-sell-recomm-backup-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function handleImportFile(file: File) {
    setImportError(null)
    try {
      const text = await file.text()
      importJson(text)
    } catch (err) {
      setImportError((err as Error).message)
    }
  }

  return (
    <div className="space-y-4">
      <Card className="border-blue-300 bg-blue-50">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-blue-900">Backup your data</h2>
            <p className="text-xs text-blue-800">
              Everything lives only in this browser's localStorage — it's cleared by clearing browser data, private
              windows, or switching devices. Export regularly; this is the only backup.
            </p>
          </div>
          <Button onClick={handleExport}>Export JSON backup</Button>
        </div>
      </Card>

      <Card>
        <h2 className="mb-2 font-semibold text-slate-900">Restore from backup</h2>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) handleImportFile(file)
            e.target.value = ''
          }}
        />
        <Button variant="secondary" onClick={() => fileInputRef.current?.click()}>
          Import JSON backup
        </Button>
        <p className="mt-1 text-xs text-slate-500">This replaces all current data in this browser.</p>
        {importError && <p className="mt-1 text-xs text-red-600">{importError}</p>}
      </Card>

      <Card>
        <h2 className="mb-2 font-semibold text-slate-900">Demo data</h2>
        <p className="mb-2 text-xs text-slate-500">
          Load a fictional portfolio to try the app, or clear it to start entering your own real data.
        </p>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={loadDemoData}>
            Load demo data
          </Button>
          <Button variant="danger" onClick={clearAllData}>
            Clear all data
          </Button>
        </div>
        {isDemo && <p className="mt-2 text-xs text-blue-700">Currently viewing demo data.</p>}
      </Card>

      <Card>
        <h2 className="mb-2 font-semibold text-slate-900">Tax settings</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Filing status">
            <Select
              value={settings.filingStatus}
              onChange={(e) => updateSettings({ filingStatus: e.target.value as FilingStatus })}
            >
              <option value="single">Single ({SPARERPAUSCHBETRAG.single} EUR/year allowance)</option>
              <option value="married">Married ({SPARERPAUSCHBETRAG.married} EUR/year allowance)</option>
            </Select>
          </Field>
          <Field label="Church tax">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={settings.churchTaxEnabled}
                onChange={(e) => updateSettings({ churchTaxEnabled: e.target.checked })}
              />
              <NumberInput
                disabled={!settings.churchTaxEnabled}
                value={settings.churchTaxRate * 100}
                onChange={(v) => updateSettings({ churchTaxRate: v / 100 })}
                step={0.5}
              />
              <span className="text-xs text-slate-500">% (simplified flat add-on, not the real withholding formula)</span>
            </div>
          </Field>
          <Field label="Concentration threshold (%)">
            <NumberInput
              value={settings.concentrationThresholdPct}
              onChange={(v) => updateSettings({ concentrationThresholdPct: v })}
              step={1}
            />
          </Field>
          <Field label="Broker fee per sell order (EUR)">
            <NumberInput value={settings.brokerFeeEur} onChange={(v) => updateSettings({ brokerFeeEur: v })} step="any" />
          </Field>
          <Field label="This year's Vorabpauschale (EUR, manual)">
            <NumberInput
              value={settings.vorabpauschaleEur}
              onChange={(v) => updateSettings({ vorabpauschaleEur: v })}
              step="any"
            />
          </Field>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Vorabpauschale is entered manually and not included in the recommendation's tax math — the Bundesbank
          Basiszins it depends on changes yearly and isn't reliably fetchable. Known gap, shown here for your own
          reference only.
        </p>
      </Card>

      <Card>
        <h2 className="mb-2 font-semibold text-slate-900">Price data</h2>
        <Field label="CORS proxy prefix">
          <TextInput
            value={settings.corsProxyPrefix}
            onChange={(e) => updateSettings({ corsProxyPrefix: e.target.value })}
          />
        </Field>
        <p className="mt-1 text-xs text-slate-500">
          Yahoo Finance's endpoints don't send CORS headers, so price lookups route through this proxy — the target
          URL is appended after this prefix. If it stops working, paste in a different proxy (e.g. your own, or
          another public one). Price data is not personal data (it's requested by ticker only), but it does route
          through a third-party service.
        </p>
      </Card>
    </div>
  )
}
