/** Decorative topographic contours for the brand panel (the terrain Bhu-Rakshak watches). */
export function Contours({ className = '' }: { className?: string }) {
  const rings = Array.from({ length: 11 }, (_, i) => i);
  return (
    <svg className={className} viewBox="0 0 600 600" preserveAspectRatio="xMidYMid slice" aria-hidden>
      <g fill="none" stroke="currentColor" strokeWidth="1.1">
        {rings.map((i) => {
          const s = 1 + i * 0.22;
          return (
            <path
              key={i}
              opacity={0.9 - i * 0.06}
              transform={`translate(360 250) scale(${s}) translate(-360 -250)`}
              d="M360 170 C 410 172, 452 200, 448 244 C 445 282, 420 300, 388 318 C 356 336, 330 352, 296 340 C 262 328, 256 296, 270 262 C 284 228, 300 214, 318 196 C 332 182, 342 170, 360 170 Z"
            />
          );
        })}
        {rings.slice(0, 6).map((i) => {
          const s = 1 + i * 0.3;
          return (
            <path
              key={`b${i}`}
              opacity={0.7 - i * 0.08}
              transform={`translate(140 470) scale(${s}) translate(-140 -470)`}
              d="M140 430 C 170 432, 190 452, 186 474 C 182 496, 160 506, 138 504 C 114 502, 98 488, 100 466 C 102 446, 118 430, 140 430 Z"
            />
          );
        })}
      </g>
    </svg>
  );
}
