import { usePortfolio } from '../state/PortfolioContext'
import { Badge, Button, Card } from './ui'

interface StepProps {
  n: number
  title: string
  children: React.ReactNode
}

function Step({ n, title, children }: StepProps) {
  return (
    <div className="flex gap-3">
      <div className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-slate-900 text-xs font-semibold text-white">
        {n}
      </div>
      <div>
        <p className="font-medium text-slate-900">{title}</p>
        <p className="text-sm text-slate-600">{children}</p>
      </div>
    </div>
  )
}

function Term({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="font-medium text-slate-900">{term}</dt>
      <dd className="text-sm text-slate-600">{children}</dd>
    </div>
  )
}

export function GuideView({ onNavigate }: { onNavigate: (tab: string) => void }) {
  const { loadDemoData } = usePortfolio()

  return (
    <div className="space-y-4">
      <Card>
        <h2 className="mb-1 font-semibold text-slate-900">What this app does</h2>
        <p className="text-sm text-slate-600">
          You tell it how much cash you need (or plan to withdraw in retirement), and it recommends which
          holdings to sell — weighing German tax rules against concentration risk — so you don't have to work
          that out by hand. It never places a trade; you always sell manually at your own broker afterward.
        </p>
      </Card>

      <Card>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold text-slate-900">Quick start</h2>
          <Button onClick={loadDemoData}>Load demo data</Button>
        </div>
        <div className="space-y-4">
          <Step n={1} title="Explore with demo data, or start entering your own">
            "Load demo data" fills in a fictional portfolio so you can see a real recommendation immediately.
            When you're ready, clear it from Settings and enter your own holdings instead.
          </Step>
          <Step n={2} title="Add your institutions and allowance figures — Allowance tab">
            Add each broker/bank you hold something at, and copy the submitted/used Freistellungsauftrag figures
            from that broker's own tax-exemption screen. Add your cash balances here too.
          </Step>
          <Step n={3} title="Add your holdings — Holdings tab">
            Enter each stock/ETF and its purchase lots one at a time, or upload them all at once via the CSV
            bulk-upload format described on that tab.
          </Step>
          <Step n={4} title="Get a recommendation — Recommend tab">
            Enter the amount you need. You'll see two plans side by side — one that minimizes tax, one that
            reduces concentration risk — each with a plain-language reason for every holding it picks.
          </Step>
          <Step n={5} title="Back up your data — Settings tab">
            Everything lives only in this browser. Click "Export JSON backup" regularly — it's the only way to
            not lose your data if you clear your browser or switch devices.
          </Step>
        </div>
        <div className="mt-4 flex gap-2">
          <Button variant="secondary" onClick={() => onNavigate('holdings')}>
            Go to Holdings →
          </Button>
          <Button variant="secondary" onClick={() => onNavigate('recommend')}>
            Go to Recommend →
          </Button>
        </div>
      </Card>

      <Card>
        <h2 className="mb-2 font-semibold text-slate-900">Terms used in this app</h2>
        <dl className="grid gap-3 sm:grid-cols-2">
          <Term term="Freistellungsauftrag">
            An instruction to a bank/broker to pay out up to a set amount of capital gains/interest/dividends per
            year tax-free. You can split it across institutions — the Allowance tab tracks each one.
          </Term>
          <Term term="Sparerpauschbetrag">
            The annual tax-free allowance itself: €1,000/year single, €2,000/year married. This is the cap your
            Freistellungsaufträge can add up to across all institutions.
          </Term>
          <Term term="Teilfreistellung">
            A 30% partial exemption on gains and losses for equity funds/ETFs (individual stocks get 0%). Applied
            automatically by security type, with a per-holding override if a fund doesn't qualify.
          </Term>
          <Term term="FIFO">
            "First in, first out" — German tax law requires that when you sell part of a position built from
            several purchases, the oldest shares are treated as sold first.
          </Term>
          <Term term="Abgeltungssteuer">
            The flat 26.375% capital-gains tax rate (25% + a 5.5% surcharge on the tax itself), before any
            allowance. Church tax adds more if enabled in Settings.
          </Term>
          <Term term="Tax-optimized vs. risk-reduction">
            Two different, equally valid ways to pick what to sell — minimize this sale's tax bill, or cut your
            biggest single-company exposure. Neither is "correct"; the app shows both so you can decide.
          </Term>
        </dl>
      </Card>

      <Card className="border-slate-300 bg-slate-50">
        <h2 className="mb-2 font-semibold text-slate-900">Frequently asked</h2>
        <div className="space-y-2 text-sm text-slate-600">
          <p>
            <strong className="text-slate-800">Is my data private?</strong> Yes — it never leaves this browser.
            There's no server and no login. See Settings for the backup/export details.
          </p>
          <p>
            <strong className="text-slate-800">Why two plans instead of one recommendation?</strong> Minimizing
            tax and minimizing risk can point at different holdings. Picking one silently would hide that
            trade-off — <Badge>see the disclaimer at the top of every page</Badge>.
          </p>
          <p>
            <strong className="text-slate-800">Is this financial advice?</strong> No. It's rules-based decision
            support for a handful of manually-tracked holdings. Talk to a Steuerberater before acting.
          </p>
        </div>
      </Card>
    </div>
  )
}
