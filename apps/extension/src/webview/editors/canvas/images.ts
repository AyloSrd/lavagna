// Pictures inserted into the canvas, decoded once and looked up by id. Marks
// keep only the id (see ImageMark), so the same decoded image serves the live
// view, undo, duplicates and the flattened PNG.

const images = new Map<string, HTMLImageElement>();
let counter = 0;

/** Decode `src` (a data: URI from the host) and register it; resolves with its id. */
export async function registerImage(src: string): Promise<{ asset: string; image: HTMLImageElement }> {
  const image = new window.Image();
  image.src = src;
  await image.decode();
  counter += 1;
  const asset = `img${counter}`;
  images.set(asset, image);
  return { asset, image };
}

export const imageAsset = (asset: string): HTMLImageElement | undefined => images.get(asset);
