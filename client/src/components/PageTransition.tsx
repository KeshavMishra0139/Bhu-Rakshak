import type { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';

/** Each page rises in gently when you navigate (re-keyed on the path). Keeps full height for the map page. */
export function PageTransition({ children, className = 'h-full' }: { children: ReactNode; className?: string }) {
  const { pathname } = useLocation();
  return <div key={pathname} className={`page-enter ${className}`}>{children}</div>;
}
