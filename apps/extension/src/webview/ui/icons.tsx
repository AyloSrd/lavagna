import React from 'react';

// Line icons on a 24×24 grid, stroked with currentColor so they follow the
// theme. Editors with icons only they use keep those next to the editor.

const PATHS = {
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
  redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h3"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5v.7"/><path d="M12 17h.01"/>',
  code: '<path d="m8 7-5 5 5 5"/><path d="m16 7 5 5-5 5"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M6 12h12"/>',
  fit: '<path d="M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>',
  duplicate: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  rename: '<path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17z"/><path d="M14 8l3 3"/>',
  swap: '<path d="M4 9h15l-4-4"/><path d="M20 15H5l4 4"/>',
  up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  down: '<path d="M12 5v14M6 13l6 6 6-6"/>',
  more: '<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  select: '<path d="M6 3.5 18 12l-5.3 1.1 3 5.6-2.2 1.2-3-5.6L6.5 18z"/>',
  hand: '<path d="M8 13V6.5a1.5 1.5 0 0 1 3 0V11"/><path d="M11 11V5a1.5 1.5 0 0 1 3 0v6"/><path d="M14 11V6.5a1.5 1.5 0 0 1 3 0V14c0 4-2.7 7-6.5 7-3 0-4.6-1.6-5.8-3.8l-1.6-3a1.5 1.5 0 0 1 2.6-1.5L8 15"/>',
  pen: '<path d="M4 20l1-4L16.5 4.5a2.1 2.1 0 0 1 3 3L8 19z"/><path d="M14.5 6.5l3 3"/>',
  marker: '<path d="M9 15l-4 4h6l1.5-1.5"/><path d="M9 15l7.5-7.5 3 3L12 18"/><path d="M14.5 5.5l4 4"/>',
  rect: '<rect x="4" y="6" width="16" height="12" rx="2"/>',
  ellipse: '<ellipse cx="12" cy="12" rx="8.5" ry="6.5"/>',
  arrow: '<path d="M5 19 19 5"/><path d="M10 5h9v9"/>',
  line: '<path d="M5 19 19 5"/>',
  text: '<path d="M5 7V5h14v2"/><path d="M12 5v14"/><path d="M9.5 19h5"/>',
  eraser: '<path d="M8 20h12"/><path d="M4.6 15.4 14 6l5 5-7.8 7.8a2 2 0 0 1-1.4.6H8z"/><path d="M9 11l5 5"/>',
  image: '<rect x="3.5" y="5" width="17" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="m20.5 16-5-5L6 19"/>',
  tidy: '<rect x="4" y="4" width="6" height="5" rx="1"/><rect x="14" y="4" width="6" height="5" rx="1"/><rect x="9" y="15" width="6" height="5" rx="1"/><path d="M7 9v2.5h10V9M12 11.5V15"/>',
  dirDown: '<path d="M12 4v16M6 14l6 6 6-6"/>',
  dirRight: '<path d="M4 12h16M14 6l6 6-6 6"/>',
  dirLeft: '<path d="M20 12H4M10 6l-6 6 6 6"/>',
  dirUp: '<path d="M12 20V4M6 10l6-6 6 6"/>',
  actor: '<circle cx="12" cy="6" r="2.6"/><path d="M12 8.6V15M7 11h10M12 15l-4 5M12 15l4 5"/>',
  participant: '<rect x="4" y="7" width="16" height="10" rx="2"/>',
  note: '<path d="M5 4h10l4 4v12H5z"/><path d="M15 4v4h4"/>',
  numbered: '<path d="M10 6h10M10 12h10M10 18h10"/><path d="M4 6h1v4M4 10h2"/><path d="M4 14h2l-2 4h2"/>',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg
      className="lv-svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      // Static, hard-coded markup from PATHS above — never user content.
      dangerouslySetInnerHTML={{ __html: PATHS[name] }}
    />
  );
}
