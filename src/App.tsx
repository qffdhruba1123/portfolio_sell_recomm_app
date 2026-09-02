import { useState } from 'react'
import { PortfolioProvider } from './state/PortfolioContext'
import { Disclaimer } from './components/Disclaimer'
import { Dashboard } from './components/Dashboard'
import { RecommendView } from './components/RecommendView'
import { HoldingsView } from './components/HoldingsView'
import { AllowanceView } from './components/AllowanceView'
import { SettingsView } from './components/SettingsView'

type Tab = 'dashboard' | 'recommend' | 'holdings' | 'allowance' | 'settings'

const TABS: { id: Tab; label: string }[] = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'recommend', label: 'Recommend' },
  { id: 'holdings', label: 'Holdings' },
  { id: 'allowance', label: 'Allowance' },
  { id: 'settings', label: 'Settings' },
]

function AppShell() {
  const [tab, setTab] = useState<Tab>('dashboard')

  return (
    <div className="min-h-screen bg-slate-50">
      <Disclaimer />
      <header className="border-b border-slate-200 bg-white px-4 py-3">
        <h1 className="text-lg font-semibold text-slate-900">Portfolio Sell-Recommendation Advisor</h1>
      </header>
      <nav className="flex gap-1 border-b border-slate-200 bg-white px-4">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-3 py-2 text-sm font-medium ${
              tab === t.id ? 'border-b-2 border-slate-900 text-slate-900' : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <main className="mx-auto max-w-5xl p-4">
        {tab === 'dashboard' && <Dashboard onNavigate={(t) => setTab(t as Tab)} />}
        {tab === 'recommend' && <RecommendView />}
        {tab === 'holdings' && <HoldingsView />}
        {tab === 'allowance' && <AllowanceView />}
        {tab === 'settings' && <SettingsView />}
      </main>
      <footer className="mx-auto max-w-5xl px-4 py-6 text-center text-xs text-slate-400">
        Built and maintained for free.{' '}
        <a href="https://buymeacoffee.com/qffdhruba" target="_blank" rel="noopener" className="underline hover:text-slate-600">
          ☕ Buy me a coffee
        </a>{' '}
        ·{' '}
        <a href="https://ko-fi.com/cueeffeffdee" target="_blank" rel="noopener" className="underline hover:text-slate-600">
          ☕ Ko-fi
        </a>
      </footer>
    </div>
  )
}

export default function App() {
  return (
    <PortfolioProvider>
      <AppShell />
    </PortfolioProvider>
  )
}
