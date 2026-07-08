import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useRef } from 'react';
import { GameProvider, useGameState } from './context/GameStateContext';
import { SettingsProvider } from './context/SettingsContext';
import { AppShell } from './components/shared/AppShell';
import { useWakeLock } from './hooks/useWakeLock';
import SetupPage from './routes/SetupPage';
import GamePage from './routes/GamePage';
import ResultPage from './routes/ResultPage';
import PlayersPage from './routes/PlayersPage';
import ReportPage from './routes/ReportPage';

// Keeps collaborators/viewers in sync with the host: when the remote game
// state flips to active/ended (via realtime), follow along automatically
// instead of leaving the viewer stuck on a stale screen.
function RoomRouter() {
  const { state } = useGameState();
  const location = useLocation();
  const navigate = useNavigate();
  const prevRef = useRef({ active: state.active, ended: state.ended });

  useEffect(() => {
    const prev = prevRef.current;
    if (state.ended && !prev.ended && location.pathname !== '/result') {
      navigate({ pathname: '/result', search: location.search });
    } else if (state.active && !prev.active && !state.ended && location.pathname !== '/game') {
      navigate({ pathname: '/game', search: location.search });
    }
    prevRef.current = { active: state.active, ended: state.ended };
  }, [state.active, state.ended, location.pathname, location.search, navigate]);

  return null;
}

export default function App() {
  const location = useLocation();
  useWakeLock(location.pathname === '/game');

  return (
    <SettingsProvider>
      <GameProvider>
        <RoomRouter />
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
