// Strong ease-out: motion starts at full speed, so UI responds the instant it is touched.
const ease = [0.23, 1, 0.32, 1] as const;
const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

// Reduced motion keeps fades but drops movement; Motion's own policy still paints the first moved frame.
const preset =
  (moved: { x?: number; y?: number; scale?: number }, duration = 0.2) =>
  () => {
    const hidden: Record<string, number> = { opacity: 0, ...(reduced() ? {} : moved) };
    return {
      initial: hidden,
      animate: Object.fromEntries(Object.keys(hidden).map(key => [key, key === 'opacity' || key === 'scale' ? 1 : 0])),
      // Exits are quicker than entrances so dismissing never feels like waiting.
      exit: { ...hidden, transition: { duration: duration * 0.6, ease } },
      transition: { duration, ease },
    };
  };

export const fade = preset({}, 0.15);
export const pop = preset({ scale: 0.96 }, 0.15);
export const drop = preset({ y: -4 }, 0.15);
export const rise = preset({ y: 8 }, 0.15);
export const slide = (x: number) => preset({ x })();
