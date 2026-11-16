import NavBar from './components/shared/NavBar.jsx';
import HomeScreen from './components/Home/HomeScreen.jsx';
import ImportScreen from './components/Import/ImportScreen.jsx';
import ReadingSession from './components/ReadingSession/ReadingSession.jsx';
import GoalPlannerScreen from './components/GoalPlanner/GoalPlannerScreen.jsx';
import SettingsScreen from './components/Settings/SettingsScreen.jsx';
import SummaryScreen from './components/Summary/SummaryScreen.jsx';
import { AppProvider, SCREENS, useApp } from './state/appState.jsx';

function Shell() {
  const { screen, storageWarning } = useApp();

  return (
    <div className="min-h-screen bg-bg text-ink font-sans">
      <NavBar />
      <main className="pt-14">
        {storageWarning && (
          <div className="max-w-[680px] mx-auto px-4 sm:px-6 pt-4">
            <div className="bg-amber-soft border border-amber/25 text-ink text-[14px] rounded-[16px] px-4 py-3 anim-fade">
              {storageWarning}
            </div>
          </div>
        )}

        {screen === SCREENS.HOME && <HomeScreen />}
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
