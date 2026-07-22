import { useEffect, useRef, useState } from 'react';

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * Tweens a number toward `value` with a short ease-out (rAF, no dependency), so
 * pot/stack/percent readouts roll up or down satisfyingly instead of snapping.
 * Interrupts continue from the current displayed value (no jump), and the whole
 * effect collapses to an instant set when the user prefers reduced motion.
 */
export function AnimatedNumber({
  value,
  duration = 420,
  decimals = 0,
  className,
  animateOnMount = false,
}: {
  value: number;
  duration?: number;
  decimals?: number;
  className?: string;
  /** Count up from 0 on first render (e.g. a dashboard stat revealing). */
  animateOnMount?: boolean;
}) {
  const initial = animateOnMount ? 0 : value;
  const [display, setDisplay] = useState(initial);
  const currentRef = useRef(initial);

  useEffect(() => {
    if (prefersReducedMotion() || currentRef.current === value) {
      currentRef.current = value;
      setDisplay(value);
      return;
    }
    const from = currentRef.current;
    const to = value;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
      const cur = from + (to - from) * eased;
      currentRef.current = cur;
      setDisplay(cur);
      if (t < 1) raf = requestAnimationFrame(tick);
      else {
        currentRef.current = to;
        setDisplay(to);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);

  const shown = decimals > 0 ? display.toFixed(decimals) : String(Math.round(display));
  return <span className={className}>{shown}</span>;
}
