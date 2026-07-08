import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { GameProvider } from './context/GameStateContext';
import { SettingsProvider } from './context/SettingsContext';
import { AppShell } from './components/shared/AppShell';
import { useWakeLock } from './hooks/useWakeLock';
import SetupPage from './routes/SetupPage';
import GamePage from './routes/GamePage';
import ResultPage from './routes/ResultPage';
import PlayersPage from './routes/PlayersPage';
import ReportPage from './routes/ReportPage';

export default function App() {
  const location = useLocation();
  useWakeLock(location.pathname === '/game');

  return (
    <SettingsProvider>
      <GameProvider>
        <AppShell>
          <Routes>
            <Route path="/" element={<SetupPage />} />
            <Route path="/game" element={<GamePage />} />
            <Route path="/result" element={<ResultPage />} />
            <Route path="/players" element={<PlayersPage />} />
            <Route path="/report" element={<ReportPage />} />
            <Route path="*" element={<Navigate to={{ pathname: '/', search: location.search }} replace />} />
          </Routes>
        </AppShell>
      </GameProvider>
    </SettingsProvider>
  );
}
