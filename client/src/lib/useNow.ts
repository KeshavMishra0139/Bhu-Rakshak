import { useEffect, useState } from 'react';

/** Re-render every `ms` milliseconds (for "updated x sec ago" labels). */
export function useNow(ms = 5000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}
