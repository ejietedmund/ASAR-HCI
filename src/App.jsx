import NavBar from './components/shared/NavBar.jsx';
import ImportScreen from './components/Import/ImportScreen.jsx';
import ReadingSession from './components/ReadingSession/ReadingSession.jsx';
import GoalPlannerScreen from './components/GoalPlanner/GoalPlannerScreen.jsx';
import SettingsScreen from './components/Settings/SettingsScreen.jsx';
import SummaryScreen from './components/Summary/SummaryScreen.jsx';
import { AppProvider, SCREENS, useApp } from './state/appState.jsx';

function Shell() {
  const { screen, storageWarning } = useApp();

  return (
    <div className="min-h-screen">
      <NavBar />
      <main className="pt-14">
        {storageWarning && (
          <div className="max-w-5xl mx-auto px-4 sm:px-6 pt-4">
            <div className="bg-[#FEF3C7] border border-[#FDE68A] text-amber-900 text-sm rounded-2xl px-4 py-3">
              {storageWarning}
            </div>
          </div>
        )}

        {screen === SCREENS.IMPORT && <ImportScreen />}
        {screen === SCREENS.READING && <ReadingSession />}
        {screen === SCREENS.GOAL_PLANNER && <GoalPlannerScreen />}
        {screen === SCREENS.SETTINGS && <SettingsScreen />}
        {screen === SCREENS.SUMMARY && <SummaryScreen />}
      </main>
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}
