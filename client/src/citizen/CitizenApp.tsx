// Citizen website: five sections with shared layout, alarm and viewed-place state.
import { Route, Routes } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CitizenProvider } from './CitizenContext';
import { CitizenLayout } from './CitizenLayout';
import CitizenHome from './CitizenHome';
import CitizenRoads from './CitizenRoads';
import CitizenAlerts from './CitizenAlerts';
import CitizenReport from './CitizenReport';
import { SettingsForm } from '../components/SettingsForm';

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
      <CitizenLayout>
        <Routes>
          <Route index element={<CitizenHome />} />
          <Route path="roads" element={<CitizenRoads />} />
          <Route path="alerts" element={<CitizenAlerts />} />
          <Route path="report" element={<CitizenReport />} />
          <Route path="profile" element={<Profile />} />
          <Route path="*" element={<CitizenHome />} />
        </Routes>
      </CitizenLayout>
    </CitizenProvider>
  );
}
