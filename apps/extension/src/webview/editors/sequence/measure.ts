import type { Measure } from './layout';

// Text widths for the layout, measured with an offscreen canvas in the
// webview's own font so labels, hit areas and the inline field line up.

const CACHE_LIMIT = 2000;

export function createMeasure(): Measure {
  const ctx = document.createElement('canvas').getContext('2d');
  const family = getComputedStyle(document.body).fontFamily || 'sans-serif';
  const cache = new Map<string, number>();
  return (text, size = 12, weight = 400) => {
    const key = `${size}|${weight}|${text}`;
    let w = cache.get(key);
    if (w === undefined) {
      if (!ctx) {
        return text.length * size * 0.55;
      }
      ctx.font = `${weight} ${size}px ${family}`;
      w = ctx.measureText(text).width;
      if (cache.size > CACHE_LIMIT) {
        cache.clear();
      }
      cache.set(key, w);
    }
    return w;
  };
}
