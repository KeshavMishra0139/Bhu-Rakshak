import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

export default function NotFound() {
  const { t } = useTranslation();
  return (
    <main id="main" className="mx-auto max-w-lg px-5 py-24">
      <h1 className="text-[1.8rem] font-bold">{t('notfound.title')}</h1>
      <p className="mt-2 text-muted">{t('notfound.body')}</p>
      <Link to="/" className="btn-primary mt-6">{t('notfound.home')}</Link>
    </main>
  );
}
