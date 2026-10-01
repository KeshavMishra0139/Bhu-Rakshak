// Citizen website: six sections with shared layout, alarm and viewed-place state.
import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CitizenProvider } from './CitizenContext';
import { CitizenLayout } from './CitizenLayout';
import { SaathiProvider } from './Saathi';
import CitizenHome from './CitizenHome';
import CitizenRoads from './CitizenRoads';
import CitizenAlerts from './CitizenAlerts';
import CitizenReport from './CitizenReport';
import { SettingsForm } from '../components/SettingsForm';

const RiskMapPage = lazy(() => import('./RiskMapPage'));
const CorridorCheckPage = lazy(() => import('./CorridorCheckPage'));

function Profile() {
  const { t } = useTranslation();
  return (
    <div className="max-w-3xl space-y-4">
      <h1 className="text-[1.8rem] font-bold">{t('citizen.profile_title')}</h1>
      <SettingsForm variant="citizen" />
    </div>
  );
}

export default function CitizenApp() {
  return (
    <CitizenProvider>
      <SaathiProvider>
      <CitizenLayout>
        <Routes>
          <Route index element={<CitizenHome />} />
          <Route path="map" element={<Suspense fallback={<div className="h-[60vh] rounded-card bg-surface-2 animate-pulse" />}><RiskMapPage /></Suspense>} />
          <Route path="roads" element={<CitizenRoads />} />
          <Route path="roads/check" element={<Suspense fallback={<div className="h-[60vh] rounded-card bg-surface-2 animate-pulse" />}><CorridorCheckPage /></Suspense>} />
          <Route path="alerts" element={<CitizenAlerts />} />
          <Route path="report" element={<CitizenReport />} />
          <Route path="profile" element={<Profile />} />
          <Route path="*" element={<CitizenHome />} />
        </Routes>
      </CitizenLayout>
      </SaathiProvider>
    </CitizenProvider>
  );
}
