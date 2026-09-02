import { useRef, useState } from 'react'
import { usePortfolio } from '../state/PortfolioContext'
import type { FilingStatus } from '../types'
import { SPARERPAUSCHBETRAG } from '../types'
import { getLivePrice } from '../lib/yahoo'
import { Badge, Button, Card, Field, NumberInput, Select, TextInput } from './ui'

export function SettingsView() {
  const { state, updateSettings, loadDemoData, clearAllData, exportJson, importJson, isDemo } = usePortfolio()
  const { settings } = state
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [proxyTest, setProxyTest] = useState<{ ok: boolean; message: string } | null>(null)
  const [testingProxy, setTestingProxy] = useState(false)

  async function handleTestProxy() {
    setTestingProxy(true)
    setProxyTest(null)
    try {
      const live = await getLivePrice('AAPL', settings.corsProxyPrefix)
      setProxyTest({ ok: true, message: `Success — got a live AAPL quote of ${live.price.toFixed(2)} ${live.currency}.` })
    } catch (err) {
      setProxyTest({ ok: false, message: (err as Error).message })
    } finally {
      setTestingProxy(false)
    }
  }

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
          <Button
            variant="danger"
            onClick={() => {
              if (confirm("Clear ALL data — holdings, cash, institutions, and settings? This can't be undone. Export a backup first if you're unsure.")) {
                clearAllData()
              }
            }}
          >
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
          reference only. Broker fees per sell order are set per institution on the Allowance tab, since they vary
          by broker rather than being a single app-wide number.
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
        <div className="mt-2 flex items-center gap-2">
          <Button variant="secondary" onClick={handleTestProxy} disabled={testingProxy}>
            {testingProxy ? 'Testing…' : 'Test connection'}
          </Button>
          {proxyTest && <Badge tone={proxyTest.ok ? 'good' : 'bad'}>{proxyTest.ok ? 'working' : 'failed'}</Badge>}
        </div>
        {proxyTest && <p className={`mt-1 text-xs ${proxyTest.ok ? 'text-emerald-700' : 'text-red-600'}`}>{proxyTest.message}</p>}
        <p className="mt-2 text-xs text-slate-500">
          Yahoo Finance's endpoints don't send CORS headers, so price lookups route through a proxy. The default,{' '}
          <code>auto</code>, tries a short built-in list of public proxies in order — public proxies are
          individually unreliable, so if one is down or rate-limited, it falls through to the next rather than
          failing outright. If all of them stop working for you (or you'd rather not depend on third-party
          proxies at all), paste your own proxy URL here — a self-hosted one (e.g. a few lines on Cloudflare
          Workers) is the most reliable option, since it isn't shared with other users. Any value other than{' '}
          <code>auto</code> is used exclusively, replacing the built-in list. Price data is not personal data
          (it's requested by ticker only), but it does route through a third-party service.
        </p>
      </Card>
    </div>
  )
}
