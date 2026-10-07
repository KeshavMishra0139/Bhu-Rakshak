/** Smooth scrolling, unless the person has asked their device for reduced motion. */
export const scrollBehavior = (): ScrollBehavior =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
