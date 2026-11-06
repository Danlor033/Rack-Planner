// What sits where: every shelf a SKU has been given by hand, and how many of
// its boxes each one holds.
//
// Shelves are chosen on the dashboard, and several SKUs may share one. The
// choices are worked through in the order they were made: each SKU puts as
// many of its remaining boxes on the shelf as fit in the room still free
// there, in a slice running front to back, the full height, only as wide as
// those boxes need. A later SKU on the same shelf gets the slice beside it.
// Boxes left over have no shelf yet. Nothing is placed automatically.
const Allocate = (function () {
  "use strict";

  const EPS = 1e-6;

  const DEFAULT_RULES = {
    turn: "any",     // "any" | "upright"
    days: 15,        // days of sales 4KB holds stock for
  };

  function text(v) {
    return v === null || v === undefined ? "" : String(v).trim();
  }

  // Blank sorts last; "Tier 2" before "Tier 10".
  function compareText(a, b) {
    const x = text(a), y = text(b);
    if (!x && !y) return 0;
    if (!x) return 1;
    if (!y) return -1;
    return x.localeCompare(y, undefined, { numeric: true, sensitivity: "base" });
  }

  const num = (v) => (typeof v === "number" && isFinite(v) ? v : 0);

  // Tier names are words, not letters -- "Tier 1", "GWP", "New SKU",
  // "Discontinue" -- so alphabetical order would put Discontinue first.
  // Numbered tiers lead, then gift and new lines, then anything
  // unrecognised, and discontinued lines last.
  function defaultRank(name) {
    const t = text(name).toLowerCase();
    if (!t) return 1000;
    const n = t.match(/^tier\s*(\d+)/);
    if (n) return 10 + Number(n[1]);
    if (/gwp|gift/.test(t)) return 200;
    if (/new/.test(t)) return 300;
    if (/discon|phase.?out|end.?of.?life|\beol\b/.test(t)) return 900;
    return 500;
  }

  // Every tier in the list, best first: the saved order where there is one,
  // and the default ranking for any tier it does not mention.
  function tierOrder(skus, saved) {
    const present = [...new Set(skus.map((s) => text(s.tier)))];
    const known = (saved || []).filter((t) => present.indexOf(t) >= 0);
    const rest = present.filter((t) => known.indexOf(t) < 0)
      .sort((a, b) => defaultRank(a) - defaultRank(b) || compareText(a, b));
    return known.concat(rest);
  }

  // What 4KB has to hold for a SKU: enough to sell from for `days` days.
  function neededQty(s, days) {
    return num(s.soldPerDay) * days;
  }

  // How many boxes that comes to, or null when it cannot be known because
  // nobody has said how many units a box holds. Rounded up: a part-full
  // carton still takes a whole carton's room on the shelf.
  function boxesWanted(s, days) {
    const needed = neededQty(s, days);
    const perBox = num(s.qtyPerBox);
    if (perBox <= 0) return needed > 0 ? null : 0;
    return Math.max(0, Math.ceil(needed / perBox - EPS));
  }

  // The boxes the zone in use actually has for a SKU: its 4KB Qty, or 6K4
  // Qty, in boxes, rounded up. These are what go on shelves, so No shelf
  // counts down from here. Null when there is stock but no Qty per box.
  function stockBoxes(s) {
    const qty = num(Layout.stock(s));
    const perBox = num(s.qtyPerBox);
    if (perBox <= 0) return qty > 0 ? null : 0;
    return Math.max(0, Math.ceil(qty / perBox - EPS));
  }

  function hasSize(s) {
    return num(s.length) > 0 && num(s.width) > 0 && num(s.height) > 0;
  }

  function boxOf(s) {
    return { l: s.length, w: s.width, h: s.height };
  }

  // skus: the list. shelves: [{ label, sku, qty }] -- sku being the SKU's
  // id, qty the units moved there (null: as many as fit, as for shelves
  // picked before a quantity was asked) -- in the order the shelves were
  // given. One entry per SKU on a shelf.
  function place(skus, shelves, rulesIn) {
    const rules = Object.assign({}, DEFAULT_RULES, rulesIn || {});
    const shelf = Layout.SHELF;
    const layers = [];
    for (let n = 1; n <= Layout.LAYERS; n++) layers.push(n);
    const days = num(rules.days) > 0 ? rules.days : DEFAULT_RULES.days;
    rules.days = days;

    const cache = new Map();
    // `height`: the shelf's, which depends on its layer.
    function packIn(length, box, height) {
      const h = height || shelf.h;
      const key = length.toFixed(3) + "|" + h + "|" + box.l + "|" + box.w + "|" + box.h;
      let hit = cache.get(key);
      if (!hit) {
        hit = Packer.pack({ l: length, w: shelf.w, h: h }, box, rules.turn);
        cache.set(key, hit);
      }
      return hit;
    }

    const spotOf = new Map(Layout.all().map((s) => [s.label, s]));
    const results = skus.map(function (s, i) {
      const wanted = boxesWanted(s, days);
      const stock = stockBoxes(s);
      return {
        index: i, order: i, sku: s, needed: neededQty(s, days),
        wanted: wanted === null ? 0 : wanted, stock: stock === null ? 0 : stock,
        counted: stock !== null && wanted !== null, placed: 0, unplaced: 0,
        placedQty: 0, qtyLeft: Math.max(0, num(Layout.stock(s))),
        perShelf: 0, perTop: 0, perLayer: {}, fits: false, spots: [], problem: null,
      };
    });
    function extent(result) {
      let x = 0;
      for (const b of result.blocks) x = Math.max(x, b.x + b.nx * b.l);
      return x;
    }

    // The narrowest slice of shelf that still holds `count` boxes.
    function slice(count, box, height) {
      let lo = 1, hi = Math.ceil(shelf.l);
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (packIn(mid, box, height).count >= count) hi = mid; else lo = mid + 1;
      }
      return { packLen: lo, len: Math.min(lo, extent(packIn(lo, box, height))) };
    }

    const byId = new Map(results.map((r) => [String(r.sku.id), r]));
    const left = new Map(results.map((r) => [r, r.counted ? r.stock : 0]));
    // Boxes on one empty shelf of each layer. perShelf is the usual shelf
    // (Layers 1 and 2), perTop the taller Layer 3.
    for (const r of results) {
      for (const n of layers) {
        r.perLayer[n] = hasSize(r.sku) ? packIn(shelf.l, boxOf(r.sku), Layout.shelfOf(n).h).count : 0;
      }
      r.perShelf = r.perLayer[1];
      r.perTop = r.perLayer[Layout.LAYERS];
      r.fits = layers.some((n) => r.perLayer[n] > 0);
    }

    const locations = new Map();
    const seen = new Set();
    for (const a of shelves) {
      const r = byId.get(String(a.sku));
      const spot = spotOf.get(a.label);
      if (!r || !spot || seen.has(a.label + "|" + r.index)) continue;
      seen.add(a.label + "|" + r.index);
      let rec = locations.get(a.label);
      if (!rec) {
        rec = {
          label: a.label, row: spot.row, col: spot.col, layer: spot.layer, shelf: Layout.shelfOf(spot.layer),
          sections: [], free: shelf.l, category: text(r.sku.category).toLowerCase(),
        };
        locations.set(a.label, rec);
      }
      // The boxes the quantity moved here comes to (a part-full carton is a
      // whole one), but no more than are left under No shelf or fit in the
      // room still free. No quantity: as many as fit.
      const s = r.sku;
      const perBox = num(s.qtyPerBox);
      const asked = num(a.qty) > 0 ? num(a.qty) : null;
      let boxes = 0, cut = { len: 0, packLen: 0 };
      if (left.get(r) > 0 && r.perLayer[spot.layer] && rec.free > 1) {
        const want = asked !== null && perBox > 0 ? Math.ceil(asked / perBox - EPS) : Infinity;
        boxes = Math.min(left.get(r), want, packIn(Math.floor(rec.free + EPS), boxOf(s), rec.shelf.h).count);
        if (boxes) cut = slice(boxes, boxOf(s), rec.shelf.h);
      }
      const qty = perBox > 0 ? Math.min(asked !== null ? asked : Infinity, boxes * perBox, r.qtyLeft) : 0;
      r.qtyLeft -= qty;
      r.placedQty += qty;
      rec.sections.push({ sku: r.index, x: shelf.l - rec.free, len: cut.len, packLen: cut.packLen, boxes: boxes, qty: qty });
      rec.free -= cut.len;
      left.set(r, left.get(r) - boxes);
      r.spots.push({ label: a.label, boxes: boxes, qty: qty, asked: asked });
    }

    for (const r of results) {
      const s = r.sku;
      const remaining = left.get(r);
      r.placed = (r.counted ? r.stock : 0) - remaining;
      r.unplaced = remaining;
      if (!r.counted) r.problem = "no-count";
      else if (r.stock <= 0) r.problem = "no-stock";
      else if (!hasSize(s)) r.problem = "no-size";
      else if (!r.fits) r.problem = "too-big";
      else if (remaining > 0) r.problem = r.spots.length ? "short" : "no-location";
    }

    // Totals.
    const volumeOf = (sh) => sh.l * sh.w * sh.h;
    const allVolume = Layout.all().reduce((n, spot) => n + volumeOf(Layout.shelfOf(spot.layer)), 0);
    let boxVolume = 0;
    for (const rec of locations.values()) {
      let v = 0;
      for (const sec of rec.sections) {
        const s = skus[sec.sku];
        if (sec.boxes && hasSize(s)) v += sec.boxes * s.length * s.width * s.height;
      }
      rec.volume = v;
      rec.fill = v / volumeOf(rec.shelf);
      boxVolume += v;
    }

    const counted = results.filter((r) => r.counted);
    const stats = {
      shelves: Layout.count,
      shelvesUsed: locations.size,
      skus: skus.length,
      skusNeeding: counted.filter((r) => r.stock > 0).length,
      skusPlaced: counted.filter((r) => r.stock > 0 && r.unplaced === 0 && r.placed > 0).length,
      skusNoCount: results.filter((r) => r.problem === "no-count").length,
      boxesWanted: counted.reduce((n, r) => n + r.wanted, 0),
      boxesStock: counted.reduce((n, r) => n + r.stock, 0),
      boxesPlaced: results.reduce((n, r) => n + r.placed, 0),
      boxesUnplaced: results.reduce((n, r) => n + r.unplaced, 0),
      fill: boxVolume / allVolume,
    };

    return {
      rules: rules, tiers: tierOrder(skus, rules.tiers), locations: locations,
      results: results, stats: stats, packIn: packIn,
    };
  }

  // Every box on one shelf, positioned for drawing. The boxes go in from the
  // floor up, so a part-full shelf looks the way it would on the day.
  function placementsOn(rec, skus, allocation) {
    const out = [];
    rec.sections.forEach(function (sec, i) {
      const s = skus[sec.sku];
      if (!sec.boxes || !hasSize(s)) return;
      const packed = allocation.packIn(sec.packLen, boxOf(s), rec.shelf.h);
      const all = Packer.placements(packed.blocks)
        .sort((a, b) => a.z - b.z || a.y - b.y || a.x - b.x)
        .slice(0, sec.boxes);
      for (const p of all) {
        p.x += sec.x;
        p.section = i;
        out.push(p);
      }
    });
    return out;
  }

  return {
    place: place,
    placementsOn: placementsOn,
    boxesWanted: boxesWanted,
    stockBoxes: stockBoxes,
    neededQty: neededQty,
    tierOrder: tierOrder,
    compareText: compareText,
    hasSize: hasSize,
    DEFAULT_RULES: DEFAULT_RULES,
  };
})();
