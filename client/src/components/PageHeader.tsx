import type { ReactNode } from 'react';

/** Page body under a PageHeader: the same width and rhythm on every officer page. */
export const PAGE_BODY = 'mx-auto max-w-6xl px-4 sm:px-6 py-6';

/** Officer pages: a title band under the dark header, so every page opens the same way (title, optional intro, actions). */
export function PageHeader({ title, intro, icon, actions, children }: {
  title: ReactNode; intro?: ReactNode; icon?: ReactNode; actions?: ReactNode; children?: ReactNode;
}) {
  return (
    <div className="border-b border-line bg-surface">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 pt-6 pb-5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <div className="min-w-0 flex-1">
            <h1 className="flex items-center gap-2.5 text-[1.625rem] font-semibold leading-tight">{icon}{title}</h1>
            {intro && <p className="mt-1.5 max-w-3xl text-muted">{intro}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
        {children && <div className="mt-4">{children}</div>}
      </div>
    </div>
  );
}

/** A quiet empty state: icon in a soft tile, then the existing message. */
export function EmptyState({ icon, children, className = '' }: { icon: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={`card flex flex-col items-center gap-3 px-6 py-10 text-center text-muted ${className}`}>
      <span className="grid h-12 w-12 place-items-center rounded-xl bg-surface-2 text-muted" aria-hidden>{icon}</span>
      <div className="max-w-md">{children}</div>
    </div>
  );
}
