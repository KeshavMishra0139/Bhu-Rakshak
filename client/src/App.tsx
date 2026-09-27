import { lazy, Suspense, type ReactNode } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ThemeProvider } from './theme/ThemeProvider';
import { AuthProvider, useAuth } from './auth/AuthProvider';
import { RequireRole } from './auth/RequireRole';
import { RiskStreamProvider } from './live/RiskStreamProvider';
import { ToastProvider } from './components/Toasts';
import { IS_PANE } from './lib/viewAs';
import { AppLoader } from './components/AppLoader';
import Landing from './pages/Landing';
import Login from './pages/Login';
import Signup from './pages/Signup';
import Pending from './pages/Pending';
import NotFound from './pages/NotFound';

const CitizenApp = lazy(() => import('./citizen/CitizenApp'));
const AuthorityApp = lazy(() => import('./authority/AuthorityApp'));
const AdminApp = lazy(() => import('./admin/AdminApp'));
const About = lazy(() => import('./pages/About'));
const DevBar = lazy(() => import('./dev/DevBar').then((m) => ({ default: m.DevBar })));
const SplitView = lazy(() => import('./dev/SplitView'));

function SkipLink() {
  const { t } = useTranslation();
  return <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[1200] btn-primary">{t('common.skip_to_content')}</a>;
}

function Skeleton() {
  return <AppLoader />;
}

/** Developer bar on top of everything, only for a real developer session and never inside split-view panes. */
function DevFrame({ children }: { children: ReactNode }) {
  const { me } = useAuth();
  const dev = !!me?.dev_mode && !IS_PANE;
  return (
    <>
      {dev && <Suspense fallback={null}><DevBar /></Suspense>}
      <div style={dev ? { paddingTop: 'var(--devbar-h, 40px)' } : undefined}>{children}</div>
    </>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <RiskStreamProvider>
            <ToastProvider>
              <SkipLink />
              <DevFrame>
                <Suspense fallback={<Skeleton />}>
                  <Routes>
                    <Route path="/" element={<Landing />} />
                    <Route path="/login" element={<Login />} />
                    <Route path="/signup" element={<Signup />} />
                    <Route path="/pending" element={<Pending />} />
                    <Route path="/about" element={<About />} />
                    <Route path="/citizen/*" element={<RequireRole roles={['citizen']}><CitizenApp /></RequireRole>} />
                    <Route path="/authority/*" element={<RequireRole roles={['authority']}><AuthorityApp /></RequireRole>} />
                    <Route path="/admin/*" element={<RequireRole roles={['admin']}><AdminApp /></RequireRole>} />
                    <Route path="/dev/split" element={<SplitView />} />
                    <Route path="*" element={<NotFound />} />
                  </Routes>
                </Suspense>
              </DevFrame>
            </ToastProvider>
          </RiskStreamProvider>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}
