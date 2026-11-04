/** Inline stroke icons (1.5 px, 24 px grid). */
import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement>;
const base = (d: React.ReactNode, props: P) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
    {d}
  </svg>
);

export const Icon = {
  play: (p: P = {}) => base(<path d="M7 4.5v15l12-7.5z" fill="currentColor" stroke="none" />, p),
  pause: (p: P = {}) => base(<><rect x="6" y="4.5" width="4" height="15" rx="1" fill="currentColor" stroke="none" /><rect x="14" y="4.5" width="4" height="15" rx="1" fill="currentColor" stroke="none" /></>, p),
  step: (p: P = {}) => base(<><path d="M6 5v14l10-7z" /><path d="M19 5v14" /></>, p),
  reset: (p: P = {}) => base(<><path d="M4 12a8 8 0 1 0 2.4-5.7" /><path d="M4 4v4.5h4.5" /></>, p),
  record: (p: P = {}) => base(<circle cx="12" cy="12" r="6" fill="currentColor" stroke="none" />, p),
  stop: (p: P = {}) => base(<rect x="6.5" y="6.5" width="11" height="11" rx="1.5" fill="currentColor" stroke="none" />, p),
  bolt: (p: P = {}) => base(<path d="M13 2 5 13.5h6l-1 8.5 8-11.5h-6z" />, p),
  spark: (p: P = {}) => base(<><path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8" /></>, p),
  brain: (p: P = {}) => base(<><path d="M9 4.5a3 3 0 0 0-5 2.6A3 3 0 0 0 3 12a3 3 0 0 0 2 2.8A3.5 3.5 0 0 0 9 19.5V4.5Z" /><path d="M15 4.5a3 3 0 0 1 5 2.6A3 3 0 0 1 21 12a3 3 0 0 1-2 2.8 3.5 3.5 0 0 1-4 4.7V4.5Z" /></>, p),
  search: (p: P = {}) => base(<><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" /></>, p),
  expand: (p: P = {}) => base(<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />, p),
  collapse: (p: P = {}) => base(<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />, p),
  settings: (p: P = {}) => base(<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z" /></>, p),
  folder: (p: P = {}) => base(<path d="M3.5 6.5a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2v8.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />, p),
  save: (p: P = {}) => base(<><path d="M5 4h11l3 3v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1z" /><path d="M8 4v5h7V4M8 20v-6h8v6" /></>, p),
  camera: (p: P = {}) => base(<><path d="M4 8h3l2-2.5h6L17 8h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></>, p),
  download: (p: P = {}) => base(<path d="M12 4v11m0 0-4-4m4 4 4-4M5 20h14" />, p),
  upload: (p: P = {}) => base(<path d="M12 20V9m0 0-4 4m4-4 4 4M5 4h14" />, p),
  target: (p: P = {}) => base(<><circle cx="12" cy="12" r="7.5" /><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /></>, p),
  focus: (p: P = {}) => base(<><path d="M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4" /><circle cx="12" cy="12" r="2.5" /></>, p),
  eye: (p: P = {}) => base(<><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" /><circle cx="12" cy="12" r="3" /></>, p),
  eyeOff: (p: P = {}) => base(<><path d="M3 3l18 18M10.6 5.6A9.8 9.8 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-3 3.8M6.1 6.1A16.6 16.6 0 0 0 2.5 12S6 18.5 12 18.5a9 9 0 0 0 4-.9" /></>, p),
  layers: (p: P = {}) => base(<><path d="m12 3 9 5-9 5-9-5z" /><path d="m3 13 9 5 9-5" /></>, p),
  compare: (p: P = {}) => base(<><path d="M9 4v16M15 4v16" /><path d="M4 8h5M15 16h5" /></>, p),
  network: (p: P = {}) => base(<><circle cx="5" cy="6" r="2" /><circle cx="19" cy="6" r="2" /><circle cx="12" cy="18" r="2" /><circle cx="12" cy="10" r="2" /><path d="M6.6 7.2 10.4 9M17.4 7.2 13.6 9M12 12v4" /></>, p),
  flask: (p: P = {}) => base(<><path d="M9 3h6M10 3v6l-5.5 9.5A1.5 1.5 0 0 0 5.8 21h12.4a1.5 1.5 0 0 0 1.3-2.5L14 9V3" /><path d="M7.5 15h9" /></>, p),
  chart: (p: P = {}) => base(<path d="M4 20V4M4 20h16M8 16l3.5-5 3 3L19 8" />, p),
  gauge: (p: P = {}) => base(<><path d="M4.5 17a8.5 8.5 0 1 1 15 0" /><path d="m12 13 4-5" /></>, p),
  close: (p: P = {}) => base(<path d="M6 6l12 12M18 6 6 18" />, p),
  undo: (p: P = {}) => base(<><path d="M9 14 4 9l5-5" /><path d="M4 9h10a6 6 0 0 1 0 12h-2" /></>, p),
  plus: (p: P = {}) => base(<path d="M12 5v14M5 12h14" />, p),
  trash: (p: P = {}) => base(<><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></>, p),
  fly: (p: P = {}) => base(<path d="M3 13l18-8-6 16-3-7z" />, p),
  orbit: (p: P = {}) => base(<><ellipse cx="12" cy="12" rx="9.5" ry="4.5" /><circle cx="12" cy="12" r="2.5" /></>, p),
  tour: (p: P = {}) => base(<><path d="M4 18c3-9 13-9 16 0" /><circle cx="12" cy="9.5" r="2" /></>, p),
  minimap: (p: P = {}) => base(<><rect x="3.5" y="4.5" width="17" height="15" rx="2" /><path d="m8 14 3-3 2 2 3-4" /></>, p),
  panelLeft: (p: P = {}) => base(<><rect x="3.5" y="4.5" width="17" height="15" rx="2" /><path d="M9 4.5v15" /></>, p),
  panelRight: (p: P = {}) => base(<><rect x="3.5" y="4.5" width="17" height="15" rx="2" /><path d="M15 4.5v15" /></>, p),
  reward: (p: P = {}) => base(<path d="m12 3 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.4 6.8 19.1l1-5.8L3.5 9.2l5.9-.9z" />, p),
  help: (p: P = {}) => base(<><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.5V14M12 17.2v.1" /></>, p),
  info: (p: P = {}) => base(<><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7.5v.1" /></>, p),
  sliders: (p: P = {}) => base(<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4" />, p),
  history: (p: P = {}) => base(<><path d="M3.5 12a8.5 8.5 0 1 0 2.5-6" /><path d="M3.5 4v4h4M12 8v4l3 2" /></>, p),
  chevron: (p: P = {}) => base(<path d="m9 6 6 6-6 6" />, p),
};
