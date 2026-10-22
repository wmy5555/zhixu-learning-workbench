const shapes = {
  leaf:'<path d="M5 19C2 9 8 3 20 3c1 12-5 18-15 16Z"/><path d="m4 20 12-12M8 16v-6m0 6h6"/>',
  search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  plus:'<path d="M12 4v16M4 12h16"/>',
  home:'<path d="m3 10 9-7 9 7v10H15v-7H9v7H3Z"/>',
  book:'<path d="M12 5v16M12 5C8 3 4 3 2 4v15c4-1 7-1 10 2 3-3 6-3 10-2V4c-2-1-6-1-10 1Z"/>',
  check:'<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
  layers:'<path d="m3 7 9-4 9 4-9 4Zm0 5 9 4 9-4M3 17l9 4 9-4"/>',
  network:'<circle cx="5" cy="6" r="2.5"/><circle cx="19" cy="8" r="2.5"/><circle cx="10" cy="19" r="2.5"/><path d="m7 7 9 1M6 9l3 7m3 1 5-7"/>',
  chat:'<path d="M4 4h16v13H9l-5 4ZM8 9h8m-8 4h5"/>',
  settings:'<path d="m9 3-1 3-3 1v4l2 2-1 4 3 2 3-1 3 1 3-2-1-4 2-2V7l-3-1-1-3Z"/><circle cx="12" cy="11" r="3"/>',
  arrow:'<path d="M4 12h16m-6-6 6 6-6 6"/>',
  spark:'<path d="M12 2v20M2 12h20M5 5l14 14M5 19 19 5"/>',
  moon:'<path d="M20 15A9 9 0 0 1 9 4a9 9 0 1 0 11 11Z"/>',
  sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1"/>',
  close:'<path d="m6 6 12 12M6 18 18 6"/>',
  file:'<path d="M5 3h9l5 5v13H5Zm9 0v6h5M9 13h6m-6 4h6"/>',
};
export const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${shapes[name] || shapes.book}</svg>`;
