import { useState } from 'react';
import { useSettingsStore } from './store/settingsStore';
import { DashboardScreen } from './ui/DashboardScreen';
import { Onboarding } from './ui/Onboarding';
import { ReviewScreen } from './ui/ReviewScreen';
import { SettingsScreen } from './ui/SettingsScreen';
import { Table } from './ui/Table';

type Tab = 'table' | 'review' | 'dashboard' | 'settings';

const TABS: { id: Tab; label: string }[] = [
  { id: 'table', label: 'Table' },
  { id: 'review', label: 'Review' },
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'settings', label: 'Settings' },
];

function App() {
  const [tab, setTab] = useState<Tab>('table');
  const onboardingComplete = useSettingsStore((s) => s.onboardingComplete);

  if (!onboardingComplete) {
    return <Onboarding />;
  }

  return (
    <div className="flex min-h-svh flex-col bg-slate-950 text-slate-100">
      <nav className="flex items-center justify-center gap-1 border-b border-slate-800 px-4 py-2">
        <span className="mr-4 text-sm font-bold tracking-wide text-emerald-400">HoldemCoach</span>
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`rounded-lg px-3 py-1.5 text-sm transition-colors active:scale-95 ${
              tab === t.id ? 'bg-slate-800 text-slate-100' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <main key={tab} className="flex-1 animate-fade-in">
        {tab === 'table' && <Table />}
        {tab === 'review' && <ReviewScreen />}
        {tab === 'dashboard' && <DashboardScreen />}
        {tab === 'settings' && <SettingsScreen />}
      </main>
    </div>
  );
}

export default App;
