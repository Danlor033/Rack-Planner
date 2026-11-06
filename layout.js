// The rack floors: which shelves exist, what each is called, which order to
// fill them in, and which stock goes on them. Two zones, 4KB and 6K4; one is
// in use at a time (Layout.use), and everything else asks Layout about that
// one.
//
// Every row is a line of rack columns; every column has three shelves
// ("layers") stacked up from the floor. Every shelf is the same length and
// depth in both zones; Layer 3, the top, is taller than the two below it.
const Layout = (function () {
  "use strict";

  const SHELF = { l: 240, w: 120, h: 85 };
  const LAYERS = 3;
  // Layers whose height is not SHELF.h.
  const HEIGHTS = { 3: 140 };

  // The opening of a shelf on `layer`.
  function shelfOf(layer) {
    return HEIGHTS[layer] ? { l: SHELF.l, w: SHELF.w, h: HEIGHTS[layer] } : SHELF;
  }

  // Columns in each row, Row 1 first, and the quantity that fills the
  // zone's shelves: 4KB Qty, or the 6K4 Qty from 6K4 storage.
  const ZONES = {
    "4kb": { key: "4kb", name: "4KB", rows: [14, 9, 9, 9, 9, 9, 9, 9], stock: (s) => s.quantity },
    "6k4": { key: "6k4", name: "6K4", rows: Array(17).fill(6), stock: (s) => s.qty6k4 },
  };

  // Every shelf of a zone, in label order: 4KB-1-1-1, 4KB-1-1-2, 4KB-1-1-3 ...
  for (const z of Object.values(ZONES)) {
    z.all = [];
    z.rows.forEach(function (cols, r) {
      for (let c = 1; c <= cols; c++) {
        for (let layer = 1; layer <= LAYERS; layer++) {
          z.all.push({ label: z.name + "-" + (r + 1) + "-" + c + "-" + layer, row: r + 1, col: c, layer: layer });
        }
      }
    });
  }

  let zone = ZONES["4kb"];

  // Which shelves count as the best ones, best first.
  const FILLS = {
    // The floor everywhere, then the middle shelf, then the top.
    layer: (a, b) => a.layer - b.layer || a.row - b.row || a.col - b.col,
    // Finish one row before starting the next, lowest shelves first within it.
    row: (a, b) => a.row - b.row || a.layer - b.layer || a.col - b.col,
    // Straight down the labels.
    label: (a, b) => a.row - b.row || a.col - b.col || a.layer - b.layer,
    // The highest column number first, and within a column the floor first.
    // Where several rows share a column number, Row 1 leads.
    colDesc: (a, b) => b.col - a.col || a.layer - b.layer || a.row - b.row,
  };

  return {
    ZONES: Object.keys(ZONES),
    // Switch zone; the caller draws again.
    use: function (key) { zone = ZONES[key] || ZONES["4kb"]; },
    get KEY() { return zone.key; },
    // "4KB" or "6K4": the labels' prefix, and the zone's name on the page.
    get NAME() { return zone.name; },
    get PREFIX() { return zone.name; },
    get ROWS() { return zone.rows; },
    get count() { return zone.all.length; },
    SHELF: SHELF,
    LAYERS: LAYERS,
    shelfOf: shelfOf,
    label: (row, col, layer) => zone.name + "-" + row + "-" + col + "-" + layer,
    all: () => zone.all.slice(),
    ordered: (fill) => zone.all.slice().sort(FILLS[fill] || FILLS.layer),
    // The SKU's stock in this zone: what its boxes are counted from.
    stock: (s) => zone.stock(s),
  };
})();
