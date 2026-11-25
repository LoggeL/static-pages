import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ProgressProvider } from './context/ProgressContext';
import { AppShell } from './components/layout/AppShell';
import { DashboardPage } from './pages/DashboardPage';
import { UnitPage } from './pages/UnitPage';
import { StundentafelPage } from './pages/StundentafelPage';
import { ExamTrainerPage } from './pages/ExamTrainerPage';
import { GlossarPage } from './pages/GlossarPage';

export default function App() {
  return (
    <ProgressProvider>
      <HashRouter>
        <AppShell>
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/einheit/:unitId" element={<UnitPage />} />
            <Route path="/stundentafel" element={<StundentafelPage />} />
            <Route path="/pruefung" element={<ExamTrainerPage />} />
            <Route path="/glossar" element={<GlossarPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AppShell>
      </HashRouter>
    </ProgressProvider>
  );
}
