import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AppHeader } from '../components/AppHeader';

const STEPS = ['data', 'features', 'model', 'alerts', 'feedback'] as const;

export default function About() {
  const { t } = useTranslation();
  return (
    <>
      <AppHeader />
      <main id="main" className="mx-auto max-w-3xl px-5 py-10 space-y-10">
        <header>
          <h1 className="text-[2.2rem] font-bold leading-tight">{t('about.title')}</h1>
          <p className="mt-3 text-[1.1rem] text-muted">{t('about.intro')}</p>
        </header>
        <section aria-labelledby="pipe">
          <h2 id="pipe" className="text-xl font-bold">{t('about.pipeline')}</h2>
          <ol className="mt-4 space-y-5">
            {STEPS.map((s, i) => (
              <li key={s} className="flex gap-4">
                <span className="h-9 w-9 shrink-0 rounded-full bg-brand-deep text-white font-mono font-bold inline-flex items-center justify-center" aria-hidden>{i + 1}</span>
                <div><h3 className="font-bold text-lg">{t(`about.p_${s}`)}</h3><p className="text-muted mt-0.5">{t(`about.p_${s}_d`)}</p></div>
              </li>
            ))}
          </ol>
        </section>
        <section aria-labelledby="status" className="card p-5 border-l-4 border-l-brand">
          <h2 id="status" className="text-xl font-bold">{t('about.status')}</h2>
          <p className="mt-2">{t('about.status_d')}</p>
        </section>
        <section aria-labelledby="hindcast" className="card p-5">
          <h2 id="hindcast" className="text-xl font-bold">{t('hindcast.about_title')}</h2>
          <p className="mt-2">{t('hindcast.about_body')}</p>
          <Link to="/hindcast" className="btn-secondary mt-3">{t('hindcast.link')}</Link>
        </section>
        <section aria-labelledby="credits">
          <h2 id="credits" className="text-xl font-bold">{t('about.credits')}</h2>
          <ul className="mt-3 space-y-2 list-disc pl-5">
            <li>{t('about.c_openmeteo')} <a className="text-brand underline" href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer">open-meteo.com</a> · <a className="text-brand underline" href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer">CC BY 4.0</a></li>
            <li>{t('about.c_imd')} <a className="text-brand underline" href="https://mausam.imd.gov.in/" target="_blank" rel="noopener noreferrer">mausam.imd.gov.in</a></li>
            <li>{t('about.c_esri')}</li>
            <li>{t('about.c_osm')} <a className="text-brand underline" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">openstreetmap.org/copyright</a></li>
            <li>{t('about.c_google')}</li>
            <li>{t('about.c_bhuvan')} <a className="text-brand underline" href="https://bhuvan.nrsc.gov.in/" target="_blank" rel="noopener noreferrer">bhuvan.nrsc.gov.in</a></li>
            <li>{t('about.c_boundary')}</li>
          </ul>
        </section>
        <section aria-labelledby="team">
          <h2 id="team" className="text-xl font-bold">{t('about.team')}</h2>
          <p className="mt-2">{t('about.team_d')} {t('app.team')}.</p>
        </section>
        <Link to="/" className="btn-secondary">{t('notfound.home')}</Link>
      </main>
    </>
  );
}
