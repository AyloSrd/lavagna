// Zoom and pan of the canvas stage: `screen = image * z + (x, y)`.

export interface View { x: number; y: number; z: number; }

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 6;
/** Fitting never blows a small image up past this. */
const MAX_FIT_ZOOM = 1.5;

const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

/**
 * View that shows the whole image centred in a `w`×`h` stage, leaving room
 * for the floating tool rail and bars. `narrow` uses the compact layout,
 * where the rail sits at the bottom.
 */
export function fitView(imageW: number, imageH: number, w: number, h: number, narrow: boolean): View {
  const padX = narrow ? 16 : 72;
  const padTop = narrow ? 56 : 60;
  const padBottom = narrow ? 64 : 60;
  const z = clampZoom(Math.min(MAX_FIT_ZOOM, (w - padX * 2) / imageW, (h - padTop - padBottom) / imageH));
  return {
    z,
    x: (w - imageW * z) / 2,
    y: padTop + (h - padTop - padBottom - imageH * z) / 2,
  };
}

/** Zoom to `z` keeping the image point under screen point (sx, sy) in place. */
export function zoomAround(v: View, sx: number, sy: number, z: number): View {
  const nz = clampZoom(z);
  const wx = (sx - v.x) / v.z;
  const wy = (sy - v.y) / v.z;
  return { z: nz, x: sx - wx * nz, y: sy - wy * nz };
}

export const toImage = (v: View, sx: number, sy: number) => ({ x: (sx - v.x) / v.z, y: (sy - v.y) / v.z });
export const toScreen = (v: View, x: number, y: number) => ({ x: x * v.z + v.x, y: y * v.z + v.y });
