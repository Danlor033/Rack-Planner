// The racks dashboard: every shelf in the 4KB racks, what the imported sheet
// puts on it, and the rules that decided.
//
// Placement is never stored. It is worked out here from the sheet and the
// rules every time, so a rule change shows at once and every PC that opens
// the page sees the same racks.
const Dashboard = (function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const SECTION_COLORS = ["#2f6fed", "#f0982c", "#17a673", "#e05260", "#8b5cf6", "#0ea5b7", "#d4a106", "#64748b"];
  const TIER_COLORS = ["#17a673", "#2f6fed", "#f0982c", "#e05260", "#8b5cf6", "#0ea5b7", "#64748b"];

  const el = {
    empty: $("dashEmpty"), dash: $("dash"), source: $("dashSource"),
    search: $("dashSearch"), exportBtn: $("dashExport"),
    varBtn: $("varBtn"), varModal: $("varModal"), varClose: $("varClose"), varCat: $("varCat"), varExport: $("varExport"),
    varStats: $("varStats"), varNote: $("varNote"), varTable: $("varTable"), varBody: $("varBody"),
    varShortN: $("varShortN"), varOverN: $("varOverN"), varNoneN: $("varNoneN"), varTabs: [...document.querySelectorAll("[data-var]")],
    varSearch: $("varSearch"), stock6Sync: $("stock6Sync"),
    kShelves: $("kShelves"), kBoxes: $("kBoxes"), kMiss: $("kMiss"), kMissWrap: $("kMissWrap"),
    kSkus: $("kSkus"), kFill: $("kFill"),
    map: $("rackMap"), mapReset: $("mapReset"),
    detail: $("detail"), detailClose: $("detailClose"),
    dLabel: $("dLabel"), dWhere: $("dWhere"), dCanvas: $("dCanvas"), dTable: $("dTable"),
    skuFilter: $("skuFilter"), skuTable: $("skuTable"),
    gap: $("dataGap"), gapText: $("dataGapText"), gapShow: $("dataGapShow"),
    ruleDays: $("ruleDays"), skuStatus: $("skuStatus"),
    catList: $("catList"), catHint: $("catHint"), skuAdd: $("skuAdd"),
    pickModal: $("pickModal"), pickTitle: $("pickTitle"), pickSub: $("pickSub"),
    pickMap: $("pickMap"), pickClose: $("pickClose"), pickLegend: $("pickLegend"), pickHint: $("pickHint"),
    mapLegend: $("mapLegend"), soldSync: $("soldSync"), liveSync: $("liveSync"), stockSync: $("stockSync"),
    jstDialog: $("jstDialog"),
    catStats: $("catStats"), catModal: $("catModal"), catTitle: $("catTitle"), catClose: $("catClose"), catAdd: $("catAdd"), catBody: $("catBody"),
    skuDialog: $("skuDialog"), skuForm: $("skuForm"), skuFormError: $("skuFormError"),
    skuCancel: $("skuCancel"),
    askDialog: $("askDialog"), askTitle: $("askTitle"), askField: $("askField"), askFieldLabel: $("askFieldLabel"),
    askInput: $("askInput"), askHint: $("askHint"), askError: $("askError"), askBody: $("askBody"), askYes: $("askYes"), askNo: $("askNo"), catOptions: $("catOptions"), tierOptions: $("tierOptions"),
  };

  const state = {
    data: null,        // { import, skus }
    rules: Object.assign({}, Allocate.DEFAULT_RULES),
    alloc: null,
    selected: null,    // shelf label
    category: null,    // the category whose SKUs are open; ALL for every one
    picking: null,     // the SKU (result index) a shelf is being picked for
    search: "",
    colors: null,
    view: null,
  };

  // --- small helpers ---------------------------------------------------------

  function esc(v) {
    return String(v === null || v === undefined ? "" : v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  const fmt = (n) => (n === null || n === undefined || n === "" ? "" : Number(n).toLocaleString());
  const pct = (f) => Math.round(f * 100) + "%";
  const dark = () => document.documentElement.getAttribute("data-theme") === "dark";

  // Distinct, stable colours: values sorted, then spaced round the colour
  // wheel by the golden angle so neighbours never look alike.
  function wheel(values) {
    const map = new Map();
    values.forEach(function (v, i) {
      const hue = Math.round((205 + i * 137.508) % 360);
      map.set(v, "hsl(" + hue + ", 62%, 52%)");
    });
    return map;
  }

  // One colour per category, far enough apart to tell on the map, given in
  // name order so a category keeps its colour as SKUs come and go. Past
  // twenty, the wheel takes over.
  const CATEGORY_COLORS = [
    "#1f77b4", "#ff7f0e", "#2ca02c", "#d62728", "#9467bd", "#8c564b", "#e377c2", "#7f7f7f",
    "#bcbd22", "#17becf", "#393b79", "#ffbb78", "#98df8a", "#ff9896", "#c5b0d5", "#c49c94",
    "#f7b6d2", "#dbdb8d", "#9edae5", "#aec7e8",
  ];

  function buildColors() {
    const skus = state.data.skus;
    const uniq = (f) => [...new Set(skus.map(f))].sort(Allocate.compareText);
    const tiers = new Map();
    uniq((s) => s.tier).forEach((t, i) => tiers.set(t, TIER_COLORS[i % TIER_COLORS.length]));
    const names = uniq((s) => s.category || "");
    const extra = wheel(names.slice(CATEGORY_COLORS.length));
    const category = new Map(names.map((c, i) => [c, CATEGORY_COLORS[i] || extra.get(c)]));
    state.colors = {
      category: category,
      tier: tiers,
      sku: wheel(uniq((s) => s.sku)),
    };
  }

  // The map, the shelves and the legend are coloured by category.
  function colorOf(skuIndex) {
    return categoryColor(state.data.skus[skuIndex].category);
  }

  function categoryColor(name) {
    return state.colors.category.get(name || "") || "#94a3b8";
  }

  // The key to the map's colours: categories (or tiers), each with how many
  // shelves it has. Ones with no shelf yet are shown faded.
  function legendHtml(by) {
    if (by === "sku") return '<span class="sub">Each SKU has its own colour.</span>';
    const shelves = new Map();
    for (const rec of state.alloc.locations.values()) {
      const keys = new Set(rec.sections.map(function (sec) {
        const s = state.data.skus[sec.sku];
        return by === "tier" ? s.tier || "" : s.category || "";
      }));
      for (const k of keys) shelves.set(k, (shelves.get(k) || 0) + 1);
    }
    const keys = [...state.colors[by].keys()];
    return keys.map(function (k) {
      const n = shelves.get(k) || 0;
      return '<span' + (n ? "" : ' class="off"') + ' title="' + n + " shel" + (n === 1 ? "f" : "ves") + '">' +
        '<i style="background:' + state.colors[by].get(k) + '"></i>' +
        esc(k || (by === "tier" ? "(no tier)" : "(no category)")) + "</span>";
    }).join("");
  }

  // --- loading -------------------------------------------------------------

  const ALL = "__all__";

  // Nothing saved yet is an empty list, not an error: SKUs can be added by
  // hand from here.
  function load(data) {
    state.data = data && data.skus ? data : { import: null, skus: [] };
    if (!state.data.shelves) state.data.shelves = [];
    el.empty.hidden = true;
    el.dash.hidden = false;
    state.rules = Object.assign({}, Allocate.DEFAULT_RULES, (state.data.import && state.data.import.rules) || {});
    el.ruleDays.value = state.rules.days;

    buildColors();
    recompute();
  }

  function layout() {
    return Allocate.place(state.data.skus, state.data.shelves, state.rules);
  }

  function recompute() {
    state.alloc = layout();
    render();
  }

  // --- drawing everything ----------------------------------------------------

  function render() {
    renderKpis();
    renderMap();
    renderDetail();
    renderCategories();
    renderSkus();
  }

  function catName(c) { return c || "(no category)"; }

  function renderKpis() {
    const s = state.alloc.stats;
    const cats = new Set(state.data.skus.map((k) => k.category || ""));
    el.source.textContent = s.skus.toLocaleString() + " SKUs in " + cats.size + " categor" + (cats.size === 1 ? "y" : "ies");
    el.kShelves.textContent = s.shelvesUsed + " / " + s.shelves;
    el.kBoxes.textContent = s.boxesPlaced.toLocaleString() + " / " + s.boxesStock.toLocaleString();
    el.kMiss.textContent = s.boxesUnplaced.toLocaleString();
    el.kMissWrap.classList.toggle("bad", s.boxesUnplaced > 0);
    el.kSkus.textContent = s.skusPlaced + " / " + s.skusNeeding;
    el.kFill.textContent = pct(s.fill);

    // SKUs with stock in 4KB Qty but no box count: the racks cannot
    // hold what nobody has said the size of. Easy to miss in a table, so it
    // is said up front.
    if (s.skusNoCount) {
      const units = state.alloc.results.filter((r) => r.problem === "no-count")
        .reduce((n, r) => n + (Number(r.sku.quantity) || 0), 0);
      el.gapText.innerHTML = "<b>" + s.skusNoCount + " SKUs</b> have stock (" + units.toLocaleString() +
        " units in 4KB Qty) but no <em>Qty per box</em>, so their boxes " +
        "cannot be counted and the racks have no room set aside for them. Click <em>Show them</em> to fill it in.";
      el.gap.hidden = false;
    } else {
      el.gap.hidden = true;
    }
  }

  function matches(rec, label) {
    const q = state.search;
    if (!q) return true;
    if (label.toLowerCase().includes(q)) return true;
    if (!rec) return false;
    return rec.sections.some(function (sec) {
      const s = state.data.skus[sec.sku];
      return [s.sku, s.category, s.tier].some((v) => String(v || "").toLowerCase().includes(q));
    });
  }

  // pick: the result index a shelf is being picked for, when drawing the
  // picker; its own shelves are marked, and search and selection are left
  // out.
  // How many boxes of SKU `index` still fit in the room left on a shelf,
  // or on it empty. A SKU with no box size cannot be fitted anywhere.
  function roomFor(label, index) {
    const s = state.data.skus[index];
    const rec = state.alloc.locations.get(label);
    if (!rec) return state.alloc.results[index].perLayer[layerOf(label)] || 0;
    if (!Allocate.hasSize(s) || rec.free < 1) return 0;
    return state.alloc.packIn(Math.floor(rec.free + 1e-6), { l: s.length, w: s.width, h: s.height }, rec.shelf.h).count;
  }

  function layerOf(label) {
    return Number(label.split("-")[3]);
  }

  function cellHtml(row, col, layer, pick) {
    const label = Layout.label(row, col, layer);
    const rec = state.alloc.locations.get(label);
    const shelf = Layout.shelfOf(layer);
    const cls = ["cell"];
    if (!rec) cls.push("free");
    if (pick === undefined) {
      if (state.selected === label) cls.push("selected");
      if (state.search) cls.push(matches(rec, label) ? "hit" : "dim");
    } else {
      cls.push("pick", rec && rec.sections.some((sec) => sec.sku === pick) ? "mine"
        : roomFor(label, pick) <= 0 ? "full" : !rec ? "vacant" : "taken");
    }

    let inner = "";
    let tip = label + (rec ? " · " + pct(rec.fill) + " full" : pick === undefined ? " · empty" : " · vacant");
    if (rec) {
      for (const sec of rec.sections) {
        const s = state.data.skus[sec.sku];
        const slab = sec.len * shelf.w * shelf.h;
        const level = sec.boxes && Allocate.hasSize(s) ? Math.min(1, (sec.boxes * s.length * s.width * s.height) / slab) : 0;
        inner += '<i style="left:' + (sec.x / shelf.l * 100).toFixed(2) + "%;width:" +
          (sec.len / shelf.l * 100).toFixed(2) + "%;height:" + Math.max(8, level * 100).toFixed(1) +
          "%;background:" + colorOf(sec.sku) + '"></i>';
        tip += "\n" + s.sku + " ×" + sec.boxes + (s.category ? "  · " + s.category : "") + (s.tier ? "  · " + s.tier : "");
      }
      if (rec.sections.length > 1) inner += '<b class="n">' + rec.sections.length + "</b>";
    }
    if (pick !== undefined && cls.indexOf("full") >= 0) tip += rec ? "\nNo room left for this SKU" : "\nThis SKU's box is too tall for this layer";
    // An occupied shelf is tinted its colour all over, so a shelf with a
    // single box still reads as its category; the bar shows how full it is.
    const tint = rec ? ' style="background:color-mix(in srgb, ' + colorOf(rec.sections[0].sku) + ' 30%, transparent)"' : "";
    return '<div class="' + cls.join(" ") + '" data-label="' + label + '"' + tint + ' title="' + esc(tip) + '">' + inner + "</div>";
  }

  function renderMap() {
    el.map.innerHTML = mapHtml();
    el.mapLegend.innerHTML = legendHtml("category");
  }

  function mapHtml(pick) {
    let html = "";
    const widest = Math.max.apply(null, Layout.ROWS);
    // The categories on each row, most shelves first.
    const rowNames = new Map();
    const perRow = new Map();
    for (const rec of state.alloc.locations.values()) {
      if (!perRow.has(rec.row)) perRow.set(rec.row, new Map());
      for (const c of new Set(rec.sections.map((sec) => catName(state.data.skus[sec.sku].category)))) {
        perRow.get(rec.row).set(c, (perRow.get(rec.row).get(c) || 0) + 1);
      }
    }
    for (const [row, m] of perRow) rowNames.set(row, [...m].sort((x, y) => y[1] - x[1]).map((e) => e[0]));
    Layout.ROWS.forEach(function (cols, i) {
      const row = i + 1;
      let used = 0;
      let colsHtml = "";
      for (let col = 1; col <= cols; col++) {
        colsHtml += '<div class="rack-col">';
        for (let layer = Layout.LAYERS; layer >= 1; layer--) {
          if (state.alloc.locations.has(Layout.label(row, col, layer))) used++;
          colsHtml += cellHtml(row, col, layer, pick);
        }
        colsHtml += '<div class="col-num">Col ' + col + "</div></div>";
      }
      const name = rowNames.has(row) ? '<span class="row-cat">' + rowNames.get(row).map(esc).join(" · ") + "</span>" : "";
      html += '<div class="rack-row"><div class="rack-row-head"><b>Row ' + row + "</b>" + name +
        '<span class="sub">' + cols + " columns · " + used + " of " + cols * Layout.LAYERS + " shelves used</span></div>" +
        '<div class="rack-cols" style="--max:' + widest + '"><div class="layer-axis"><span>Layer 3</span><span>Layer 2</span><span>Layer 1</span></div>' +
        colsHtml + "</div></div>";
    });
    return html;
  }

  function renderDetail() {
    const label = state.selected;
    el.detail.hidden = !label;
    document.body.classList.toggle("detail-open", !!label);
    if (!label) return;

    const [, row, col, layer] = label.split("-").map(Number);
    const rec = state.alloc.locations.get(label) || null;
    el.dLabel.textContent = label;
    const stat = (name, value) => "<div><dt>" + name + "</dt><dd>" + value + "</dd></div>";
    el.dWhere.innerHTML = stat("Row", row) + stat("Column", col) +
      stat("Layer", layer + ' <span class="sub">' + (layer === 1 ? "floor" : layer === Layout.LAYERS ? "top" : "middle") +
        " \u00b7 " + Layout.shelfOf(layer).h + " cm tall</span>") +
      stat("Full", rec ? pct(rec.fill) : "0%");

    // The map's colours, unless two SKUs here would share one.
    let colors = SECTION_COLORS;
    if (rec) {
      const mapColors = rec.sections.map((sec) => colorOf(sec.sku));
      if (new Set(mapColors).size === mapColors.length) colors = mapColors;
    }
    const colorFor = (i) => (colors === SECTION_COLORS ? SECTION_COLORS[i % SECTION_COLORS.length] : colors[i]);

    const shelf = Layout.shelfOf(layer);
    if (!state.view && View3D.available()) state.view = View3D.create(el.dCanvas);
    // Back out far enough for the shelf when its height changes.
    if (state.view && state.viewH !== shelf.h) {
      state.view.frame(shelf, 0.75);
      state.viewH = shelf.h;
    }
    if (state.view) {
      const placements = rec ? Allocate.placementsOn(rec, state.data.skus, state.alloc) : [];
      for (const p of placements) p.color = colorFor(p.section);
      state.view.show(shelf, placements, dark(), {
        what: "Shelf",
        dims: (p) => {
          const s = state.data.skus[rec.sections[p.section].sku];
          return { l: s.length, w: s.width, h: s.height };
        },
        group: (p) => p.section,
      });
    }

    if (!rec) {
      el.dTable.innerHTML = '<p class="sub detail-none">Empty shelf — nothing in the sheet needs it.</p>';
      return;
    }

    // One card per SKU on the shelf, every number named.
    const dash = '<span class="sub">—</span>';
    const boxes = rec.sections.reduce((n, sec) => n + sec.boxes, 0);
    // Opened for one SKU from the variance report: its other shelves, a
    // click away, and its card picked out.
    let html = "";
    const focus = state.focus !== null && state.focus !== undefined ? state.alloc.results[state.focus] : null;
    if (focus && focus.spots.length > 1) {
      html += '<p class="detail-jump"><b>' + esc(focus.sku.sku) + "</b> is on " + focus.spots.length + " shelves: " +
        focus.spots.map((p) => '<button type="button" class="ghost small' + (p.label === label ? " on" : "") +
          '" data-jump="' + p.label + '">' + p.label + " \u00b7 " + fmt(p.boxes) + " box" + (p.boxes === 1 ? "" : "es") + "</button>").join("") + "</p>";
    }
    html += '<p class="detail-sum"><b>' + rec.sections.length + "</b> SKU" + (rec.sections.length === 1 ? "" : "s") +
      " · <b>" + fmt(boxes) + "</b> box" + (boxes === 1 ? "" : "es") + " on this shelf</p>";
    rec.sections.forEach(function (sec, i) {
      const s = state.data.skus[sec.sku];
      const fact = (name, value, wide) => '<div' + (wide ? ' class="wide"' : "") + "><dt>" + name + "</dt><dd>" +
        (value === "" || value === null || value === undefined ? dash : value) + "</dd></div>";
      html += '<article class="dsku' + (focus && sec.sku === focus.index ? " focus" : "") + '">' +
        '<header><span class="chip" style="background:' + colorFor(i) + '"></span><b>' + esc(s.sku) + "</b></header>" +
        "<dl>" +
        fact("Category", esc(s.category)) +
        fact("Tier", esc(s.tier)) +
        fact("Sold per day", fmt(s.soldPerDay)) +
        fact("Qty per box", s.qtyPerBox > 0 ? fmt(s.qtyPerBox) : "") +
        fact("Boxes on shelf", "<b>" + fmt(sec.boxes) + "</b>") +
        fact("Qty on shelf", s.qtyPerBox > 0 ? fmt(sec.qty) : "") +
        fact("Box size (L × W × H)", [s.length, s.width, s.height].join(" × ") + " cm", true) +
        "</dl></article>";
    });
    const free = shelf.l - rec.sections.reduce((n, s) => n + s.len, 0);
    if (free > 0.5 && rec.sections.length && rec.sections[0].len < shelf.l) {
      html += '<p class="sub detail-free">' + Math.round(free) + " cm of shelf width still free</p>";
    }
    el.dTable.innerHTML = html;
  }

  const WHY = {
    "too-big": "box is bigger than a shelf",
    "no-size": "no L / W / H",
    "no-location": "pick a location",
    "short": "needs more shelves",
    "no-stock": "no 4KB Qty",
    "no-count": "no qty per box",
  };
  const ATTENTION = ["too-big", "no-size", "no-location", "short", "no-count"];
  // Problems that stop a location being picked at all.
  const BLOCKERS = ["too-big", "no-size", "no-count", "no-stock"];

  // The SKU list's columns after #, Tier, (Category,) SKU, in order, under
  // the heading of their group. "edit" makes a number editable in place; the
  // rest are worked out (see worked()) and kept up to date where they stand.
  // w is the width in px; SKU and Locations share what is left.
  const COLUMNS = [
    { group: "4KB stock vs sales", head: "4KB Qty", w: 66, worked: "quantity", title: "From JSTERP Zone Inventory, every 30 seconds" },
    { group: "4KB stock vs sales", head: "Sold/Day", w: 60, worked: "sold", title: "Live from the Google Sheet, column D" },
    { group: "4KB stock vs sales", head: "Needed", w: 66, worked: "needed", title: "Sold per day \u00d7 days of stock" },
    { group: "Boxes", head: "Qty/Box", w: 62, edit: "qtyPerBox" },
    { group: "Boxes", head: "Boxes", w: 54, worked: "boxes", title: "4KB Qty \u00f7 Qty/Box, rounded up" },
    { group: "Boxes", head: "Per Shelf", w: 54, worked: "perShelf", title: "Boxes that fit on one empty Layer 1 or 2 shelf (85 cm); L3: on the taller Layer 3 (140 cm)" },
    { group: "Boxes", head: "Shelf Needed", w: 58, worked: "shelvesNeeded", title: "Boxes \u00f7 Per Shelf, rounded up (Layer 1 and 2 shelves)" },
    { group: "On shelves", head: "Placed", w: 56, worked: "placed", title: "Boxes already on a shelf" },
    { group: "On shelves", head: "No shelf", w: 58, worked: "unplaced", title: "Boxes of the 4KB Qty not on a shelf yet" },
    { group: "Box size (cm)", head: "L", w: 48, edit: "length" },
    { group: "Box size (cm)", head: "W", w: 48, edit: "width" },
    { group: "Box size (cm)", head: "H", w: 48, edit: "height" },
    { head: "Locations", w: 0, worked: "locations", cls: "locs" },
  ];

  // A box that is empty but needed for this SKU to get a shelf.
  function wanting(r, key) {
    const s = r.sku;
    if (key === "qtyPerBox") return r.problem === "no-count";
    if (key === "length" || key === "width" || key === "height") return r.problem === "no-size" || !(s[key] > 0) && s.soldPerDay > 0;
    return false;
  }

  const needsAttention = (r) => ATTENTION.indexOf(r.problem) >= 0;

  const COPY_ICON = '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="9" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M3.5 10.5h-1a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v1" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>';
  const EDIT_ICON = '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M10.8 2.7l2.5 2.5L6 12.5l-3.2.7.7-3.2z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M9.3 4.2l2.5 2.5" stroke="currentColor" stroke-width="1.4"/></svg>';
  const DONE_ICON = '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  // A copy button: copies its data-copy and shows a tick for a moment.
  function copyButton(btn) {
    const was = btn.title;
    copyText(btn.dataset.copy).then(function () {
      btn.innerHTML = DONE_ICON;
      btn.classList.add("done");
      btn.title = "Copied";
      setTimeout(function () {
        btn.innerHTML = COPY_ICON;
        btn.classList.remove("done");
        btn.title = was;
      }, 1200);
    }).catch(function () { btn.title = "Could not copy"; });
  }

  // The clipboard API only exists on https and localhost. The office copy is
  // plain http on the network, so there the old copy command does the job.
  function copyText(value) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(value).catch(function () { return copyByCommand(value); });
    }
    return copyByCommand(value);
  }

  function copyByCommand(value) {
    return new Promise(function (resolve, reject) {
      const area = document.createElement("textarea");
      area.value = value;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand("copy");
      area.remove();
      if (ok) resolve(); else reject(new Error("copy refused"));
    });
  }

  // Each location: the shelf (opens it), boxes and qty this SKU has there,
  // a copy button, and the x that takes the SKU off it.
  function locationsHtml(r) {
    const perBox = r.sku.qtyPerBox > 0 ? r.sku.qtyPerBox : 0;
    const where = r.spots.map(function (p) {
      const shared = (state.alloc.locations.get(p.label) || { sections: [] }).sections.length > 1;
      return '<span class="loc-chip"><a href="#" data-loc="' + p.label + '">' + p.label + "</a>" +
        '<span class="loc-qty">' + fmt(p.boxes) + " box" + (p.boxes === 1 ? "" : "es") +
        (perBox ? " \u00b7 " + fmt(p.qty) + " qty" +
          '<button type="button" class="copy-btn edit-btn" data-edit-qty="' + p.label + '" data-edit-sku="' + r.index +
          '" title="Change the qty on ' + p.label + '" aria-label="Change the qty on ' + p.label + '">' + EDIT_ICON + "</button>" : "") +
        "</span>" +
        // A shelf that filled up before this SKU got any room on it, for
        // instance when the SKU before it was given its qty per box later.
        (!p.boxes && r.counted && r.stock > 0 && r.fits
          ? '<span class="loc-noroom" title="The shelf is full: none of this SKU\u2019s boxes fit. Delete this location.">no room</span>'
          : shared ? '<span class="loc-mixed" title="Shared with other SKUs">mixed</span>' : "") +
        '<span class="loc-acts"><button type="button" class="copy-btn" data-copy="' + p.label + '" title="Copy location" aria-label="Copy ' + p.label + '">' + COPY_ICON + "</button>" +
        '<button type="button" class="loc-free" data-free="' + p.label + '" data-free-sku="' + r.index + '" title="Delete this location" aria-label="Delete ' + p.label + '">\u00d7</button></span></span>';
    }).join("");
    const total = r.spots.length > 1 && perBox
      ? '<span class="loc-total">Total ' + fmt(r.placed) + " boxes \u00b7 " + fmt(r.placedQty) + " qty</span>" : "";
    // What keeps the SKU off the shelves, if anything; otherwise the button
    // when boxes are still waiting. A red No shelf count already says that
    // a location is wanted, so no tag repeats it.
    const why = whyNoLocation(r);
    const blocked = BLOCKERS.indexOf(r.problem) >= 0;
    const foot = !why
      ? '<button type="button" class="ghost small loc-pick" data-pick="' + r.index + '">+ Select location</button>'
      : blocked ? '<span class="tag' + (needsAttention(r) ? " bad" : "") + '" title="' + esc(why) + '">' + WHY[r.problem] + "</span>" : "";
    return where + total + (foot ? '<span class="loc-foot">' + foot + "</span>" : "");
  }

  // Another location is only for boxes still waiting under No shelf, and
  // only when a box can go on a shelf at all. Null when one may be added,
  // otherwise why not.
  function whyNoLocation(r) {
    if (!r.counted) return "Fill in Qty/Box first — the boxes cannot be counted without it.";
    if (r.stock <= 0) return "There is no stock in 4KB Qty.";
    if (!Allocate.hasSize(r.sku)) return "Fill in L, W and H first.";
    if (!r.fits) return "The box is bigger than a shelf.";
    if (r.unplaced <= 0) return "Every box of the 4KB Qty already has a shelf — nothing left under No shelf.";
    return null;
  }

  // Layers 1 and 2, and under it the taller Layer 3 when that holds more.
  function perShelfHtml(r) {
    if (!r.fits) return "";
    const low = r.perShelf ? fmt(r.perShelf) : '<span class="sub">\u2014</span>';
    return r.perTop !== r.perShelf
      ? low + '<span class="per-top" title="On a Layer 3 shelf (140 cm tall)">L3 ' + fmt(r.perTop) + "</span>" : low;
  }

  // The value of one worked-out column for a SKU.
  function worked(key, r) {
    switch (key) {
      case "quantity": return fmt(r.sku.quantity);
      case "sold": return fmt(r.sku.soldPerDay);
      case "needed": return fmt(r.needed);
      case "boxes": return "<b>" + (r.problem === "no-count" ? "?" : fmt(r.stock)) + "</b>";
      case "perShelf": return perShelfHtml(r);
      case "shelvesNeeded": {
        const per = r.perShelf || r.perTop;
        return per && r.counted && r.stock > 0 ? fmt(Math.ceil(r.stock / per)) : "";
      }
      case "placed": return fmt(r.placed);
      case "unplaced": return r.unplaced ? '<span class="pending">' + fmt(r.unplaced) + "</span>" : "";
      case "locations": return locationsHtml(r);
    }
    return "";
  }

  // After an edit, the rows already on screen get their worked-out cells
  // brought up to date and nothing else is touched. Rebuilding the whole
  // list -- some 1,500 inputs -- stalled every edit and replaced the box the
  // cursor had just moved on to.
  function updateSkus() {
    const body = el.skuTable.tBodies[0];
    if (!body) return;
    for (const tr of body.rows) {
      if (tr.dataset.sku === undefined) continue;
      const r = state.alloc.results[Number(tr.dataset.sku)];
      for (const td of tr.querySelectorAll("td[data-w]")) {
        const html = worked(td.dataset.w, r);
        if (td.innerHTML !== html) td.innerHTML = html;
      }
      for (const input of tr.querySelectorAll("input[data-field]")) {
        input.classList.toggle("want", !!wanting(r, input.dataset.field));
        // A save that failed puts the old number back.
        const v = r.sku[input.dataset.field];
        const shown = v === null || v === undefined ? "" : String(v);
        if (input !== document.activeElement && input.value !== shown) input.value = shown;
      }
    }
  }

  // One button per category, the biggest first -- the same order the rows
  // are handed out in -- with how many SKUs it has.
  // What one category (or ALL) takes on the racks: shelves holding any of
  // its SKUs, which rows those are in, and the boxes placed.
  function categoryUse(key) {
    const skus = state.data.skus;
    const rows = new Set();
    let shelves = 0;
    for (const rec of state.alloc.locations.values()) {
      if (key === ALL || rec.sections.some((sec) => (skus[sec.sku].category || "") === key)) {
        shelves++;
        rows.add(rec.row);
      }
    }
    const results = state.alloc.results.filter((r) => key === ALL || (r.sku.category || "") === key);
    return {
      skus: results.length,
      shelves: shelves,
      rows: [...rows].sort((a, b) => a - b),
      boxes: results.reduce((n, r) => n + r.placed, 0),
    };
  }

  function renderCatStats() {
    if (state.category === null) return;
    const u = categoryUse(state.category);
    const stat = (name, value) => "<div><dt>" + name + "</dt><dd>" + value + "</dd></div>";
    el.catStats.innerHTML = stat("SKUs", fmt(u.skus)) +
      stat("Shelves", fmt(u.shelves) + ' <span class="sub">of ' + Layout.count + "</span>") +
      stat("Boxes placed", fmt(u.boxes)) +
      stat(u.rows.length === 1 ? "Row" : "Rows", u.rows.length ? u.rows.join(", ") : "\u2014");
  }

  function renderCategories() {
    const by = new Map();
    for (const r of state.alloc.results) {
      const c = r.sku.category || "";
      const e = by.get(c) || { name: c, skus: 0, attention: 0 };
      e.skus++;
      if (needsAttention(r)) e.attention++;
      by.set(c, e);
    }
    for (const e of by.values()) e.shelves = categoryUse(e.name).shelves;
    const cats = [...by.values()].sort((a, b) => b.skus - a.skus || Allocate.compareText(a.name, b.name));
    if (state.category !== null && state.category !== ALL && !by.has(state.category)) state.category = null;

    const button = (key, name, e) => '<button type="button" class="cat-btn' + (state.category === key ? " on" : "") +
      '" data-cat="' + esc(key) + '"><b>' + (key === ALL ? "" : '<i style="background:' + categoryColor(key) + '"></i>') +
      esc(name) + '</b><span class="cnt">' + e.skus.toLocaleString() +
      " SKU" + (e.skus === 1 ? "" : "s") + " · " + e.shelves.toLocaleString() + " shel" + (e.shelves === 1 ? "f" : "ves") +
      (e.attention ? ' · <span class="warn">' + e.attention + " need" + (e.attention === 1 ? "s" : "") + " attention</span>" : "") +
      "</span></button>";
    const total = {
      skus: state.alloc.results.length, shelves: state.alloc.locations.size,
      attention: state.alloc.results.filter(needsAttention).length,
    };
    el.catList.innerHTML = (cats.length > 1 ? button(ALL, "All categories", total) : "") +
      cats.map((e) => button(e.name, catName(e.name), e)).join("");
    el.catOptions.innerHTML = cats.filter((e) => e.name).map((e) => '<option value="' + esc(e.name) + '">').join("");
    el.tierOptions.innerHTML = state.alloc.tiers.filter(Boolean).map((t) => '<option value="' + esc(t) + '">').join("");
  }

  function renderSkus() {
    const picked = state.category;
    el.catHint.textContent = state.data.skus.length
      ? "Click a category to see and edit its SKUs, best seller first."
      : "No SKUs yet \u2014 add the first one with + Add SKU.";
    el.catModal.hidden = picked === null;
    document.body.classList.toggle("cat-open", picked !== null);
    if (picked === null) { el.skuTable.innerHTML = ""; return; }
    el.catTitle.textContent = picked === ALL ? "All categories" : catName(picked);
    renderCatStats();

    const filter = el.skuFilter.value;
    // Best seller first. The order is set when the list is drawn, and an
    // edit does not redraw it, so a row never jumps away while somebody is
    // typing in it. The # column gives its priority on the racks.
    const sold = (r) => (typeof r.sku.soldPerDay === "number" ? r.sku.soldPerDay : -1);
    const rows = state.alloc.results
      .filter((r) => picked === ALL || (r.sku.category || "") === picked)
      .sort((a, b) => sold(b) - sold(a) || Allocate.compareText(a.sku.sku, b.sku.sku))
      .filter(function (r) {
        if (filter === "missing") return ATTENTION.indexOf(r.problem) >= 0;
        if (filter === "nocount") return r.problem === "no-count";
        if (filter === "placed") return r.placed > 0 && r.unplaced === 0;
        return true;
      });

    const days = state.rules.days;
    // Category only when more than one is listed: inside one it says the same
    // thing on every row.
    const withCat = picked === ALL;
    // Narrow enough to fit the window without sideways scrolling: headings
    // and long names wrap, and SKU and Locations share what is left.
    const widths = [36, 96].concat(withCat ? [96] : [], [0], COLUMNS.map((c) => c.w));
    const lead = ["#", "Tier"].concat(withCat ? ["Category"] : [], ["SKU"]);
    // Two heading rows: the groups, then the columns. A column starting a
    // group gets a line on its left, all the way down.
    const starts = COLUMNS.map((c, i) => i === 0 || c.group !== COLUMNS[i - 1].group);
    let groups = "", heads = "";
    COLUMNS.forEach(function (c, i) {
      const title = c.worked === "needed" ? "Sold per day \u00d7 " + days + " days of stock" : c.title;
      const th = (attrs, text) => "<th" + attrs + (title ? ' title="' + title + '"' : "") + ">" + text + "</th>";
      const cls = starts[i] ? ' class="g-start"' : "";
      if (!c.group) { groups += th(' rowspan="2"' + cls, c.head); return; }
      if (starts[i]) {
        const span = COLUMNS.filter((d) => d.group === c.group).length;
        groups += '<th class="g-start g-name" colspan="' + span + '">' + c.group + "</th>";
      }
      heads += th(cls, c.head);
    });
    let html = "<colgroup>" + widths.map((w) => (w ? '<col style="width:' + w + 'px">' : "<col>")).join("") + "</colgroup>" +
      '<thead><tr class="groups">' + lead.map((h) => '<th rowspan="2">' + h + "</th>").join("") + groups + "</tr>" +
      "<tr>" + heads + "</tr></thead><tbody>";
    // # counts down this list from 1, whatever is open.
    rows.forEach(function (r, i) {
      const s = r.sku;
      const cells = COLUMNS.map(function (c, k) {
        const g = starts[k] ? " g-start" : "";
        if (c.edit) {
          const v = s[c.edit];
          return '<td class="num edit-col' + g + '"><input class="cell-in' + (wanting(r, c.edit) ? " want" : "") +
            '" type="number" min="0" step="any" inputmode="decimal" data-sku="' + r.index +
            '" data-field="' + c.edit + '" value="' + (v === null || v === undefined ? "" : v) + '"' +
            (Auth.canEdit() ? "" : " readonly") + "></td>";
        }
        return '<td class="' + (c.cls || "num") + g + '" data-w="' + c.worked + '">' + worked(c.worked, r) + "</td>";
      }).join("");
      html += '<tr data-sku="' + r.index + '">' +
        '<td class="sub">' + (i + 1) + "</td>" +
        "<td>" + esc(s.tier) + "</td>" +
        (withCat ? '<td class="wrap"><i class="cat-dot" style="background:' + categoryColor(s.category) + '"></i>' + esc(s.category) + "</td>" : "") +
        '<td class="sku-name wrap"><span class="sku-wrap"><b>' + esc(s.sku) + "</b>" +
        '<button type="button" class="copy-btn" data-copy="' + esc(s.sku) + '" title="Copy SKU" aria-label="Copy ' + esc(s.sku) + '">' +
        COPY_ICON + "</button></span></td>" +
        cells + "</tr>";
    });
    if (!rows.length) html += '<tr><td colspan="' + widths.length + '" class="sub">Nothing to show.</td></tr>';
    el.skuTable.innerHTML = html + "</tbody>";
  }


  // --- interaction -----------------------------------------------------------

  function select(label, scroll) {
    state.selected = label;
    el.map.querySelectorAll(".cell.selected").forEach((c) => c.classList.remove("selected"));
    const cell = el.map.querySelector('.cell[data-label="' + label + '"]');
    if (cell) {
      cell.classList.add("selected");
      if (scroll) cell.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
    renderDetail();
    if (scroll) el.map.scrollIntoView({ block: "start", behavior: "smooth" });
  }

  el.map.addEventListener("click", function (e) {
    const cell = e.target.closest(".cell");
    if (cell) select(cell.dataset.label, false);
  });

  function closeDetail() {
    state.selected = null;
    state.focus = null;
    el.map.querySelectorAll(".cell.selected").forEach((c) => c.classList.remove("selected"));
    el.detail.hidden = true;
    document.body.classList.remove("detail-open");
  }

  el.detailClose.addEventListener("click", closeDetail);
  el.dTable.addEventListener("click", function (e) {
    const jump = e.target.closest("button[data-jump]");
    if (jump) select(jump.dataset.jump, false);
  });
  // Esc closes the window on top: the shelf, then the category. The Add SKU
  // form closes itself.
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape" || el.skuDialog.open || el.askDialog.open) return;
    if (!el.detail.hidden) closeDetail();
    else if (!el.varModal.hidden) closeVariance();
    else if (!el.pickModal.hidden) closePicker();
    else if (!el.catModal.hidden) closeCategory();
  });

  el.skuTable.addEventListener("click", function (e) {
    const link = e.target.closest("a[data-loc]");
    if (link) {
      e.preventDefault();
      select(link.dataset.loc, true);
      return;
    }
    const copy = e.target.closest("button[data-copy]");
    if (copy) { copyButton(copy); return; }
    const free = e.target.closest("button[data-free]");
    if (free) { freeShelf(free.dataset.free, Number(free.dataset.freeSku)); return; }
    const edit = e.target.closest("button[data-edit-qty]");
    if (edit) { editShelfQty(edit.dataset.editQty, Number(edit.dataset.editSku)); return; }
    const pick = e.target.closest("button[data-pick]");
    if (pick) { openPicker(Number(pick.dataset.pick)); return; }
    if (e.target.closest("input, select, button")) return;
    const tr = e.target.closest("tr[data-sku]");
    if (!tr) return;
    const r = state.alloc.results[Number(tr.dataset.sku)];
    el.search.value = r.sku.sku;
    state.search = r.sku.sku.toLowerCase();
    renderMap();
    if (r.spots.length) select(r.spots[0].label, true);
  });

  // --- asking first ----------------------------------------------------------

  // A question in a window of its own, over everything else. Resolves true
  // for the confirm button, false for Cancel, Esc or clicking outside.
  // With opts.number ({ label, value, max, hint }) it asks for a whole number
  // from 1 to max instead, and resolves that number, or null.
  // The answer is taken from the button pressed (or Esc, or a click outside)
  // at that moment, not from the dialog's close event, which a browser may
  // hold back until it next draws the page.
  let askNumber = null;
  let askSettle = null;
  function ask(opts) {
    return new Promise(function (resolve) {
      askSettle = function (yes) {
        askSettle = null;
        resolve(askNumber ? (yes ? Number(el.askInput.value) : null) : yes);
      };
      el.askTitle.textContent = opts.title;
      el.askBody.innerHTML = opts.body;
      el.askYes.textContent = opts.yes || "OK";
      el.askYes.classList.toggle("danger", !!opts.danger);
      askNumber = opts.number || null;
      el.askField.hidden = !askNumber;
      el.askError.hidden = true;
      if (askNumber) {
        el.askFieldLabel.textContent = askNumber.label;
        el.askInput.max = askNumber.max;
        el.askInput.value = askNumber.value;
        el.askHint.textContent = askNumber.hint || "";
      }
      el.askDialog.returnValue = "";
      el.askDialog.showModal();
      if (askNumber) { el.askInput.focus(); el.askInput.select(); } else el.askNo.focus();
    });
  }
  el.askDialog.querySelector("form").addEventListener("submit", function (e) {
    if (askSettle) askSettle(!!e.submitter && e.submitter.value === "yes");
  });
  el.askDialog.addEventListener("cancel", function () { if (askSettle) askSettle(false); });
  el.askDialog.addEventListener("close", function () { if (askSettle) askSettle(el.askDialog.returnValue === "yes"); });
  el.askDialog.addEventListener("click", function (e) {
    if (e.target !== el.askDialog) return;
    if (askSettle) askSettle(false);
    el.askDialog.close("no");
  });
  // A number out of range keeps the window open and says why.
  el.askYes.addEventListener("click", function (e) {
    if (!askNumber) return;
    const v = Number(el.askInput.value);
    if (!(Number.isInteger(v) && v >= 1 && v <= askNumber.max)) {
      e.preventDefault();
      el.askError.textContent = "Enter a whole number from 1 to " + fmt(askNumber.max) + ".";
      el.askError.hidden = false;
      el.askInput.focus();
    }
  });
  // Enter in the box means OK, not the first button (Cancel).
  el.askInput.addEventListener("keydown", function (e) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    el.askYes.click();
  });

  // One SKU as a line in a question: colour, code, and what it has there.
  function askLine(index, note, isNew) {
    const s = state.data.skus[index];
    return '<li' + (isNew ? ' class="new"' : "") + '><i class="cat-dot" style="background:' + categoryColor(s.category) + '"></i>' +
      "<b>" + esc(s.sku) + '</b><span class="sub">' + note + "</span></li>";
  }

  // --- choosing shelves -------------------------------------------------------

  // Picking a shelf on the rack map. Vacant shelves are given at once; an
  // occupied one asks first.
  function openPicker(index) {
    if (whyNoLocation(state.alloc.results[index])) return;
    state.picking = index;
    renderPicker();
    el.pickModal.hidden = false;
  }

  function closePicker() {
    state.picking = null;
    el.pickModal.hidden = true;
    el.pickMap.innerHTML = "";
  }

  function renderPicker() {
    if (state.picking === null) return;
    const r = state.alloc.results[state.picking];
    el.pickTitle.textContent = r.sku.sku;
    const vacant = Layout.count - state.alloc.locations.size;
    const facts = [catName(r.sku.category)];
    if (r.counted && r.stock > 0) facts.push(fmt(r.unplaced) + " of " + fmt(r.stock) + (r.stock === 1 ? " box" : " boxes") +
      " (" + fmt(r.qtyLeft) + " qty) still to place");
    if (r.fits) {
      facts.push(r.perTop === r.perShelf ? fmt(r.perShelf) + " fit on a shelf"
        : fmt(r.perShelf) + " fit on a Layer 1\u20132 shelf, " + fmt(r.perTop) + " on Layer 3");
    }
    facts.push(r.spots.length ? "on " + r.spots.map((p) => p.label).join(", ") : "no shelf yet");
    facts.push(vacant + " shelves vacant");
    el.pickSub.textContent = facts.join(" · ");
    el.pickMap.innerHTML = mapHtml(state.picking);
    el.pickLegend.innerHTML = legendHtml("category");
  }

  el.pickMap.addEventListener("click", function (e) {
    const cell = e.target.closest(".cell[data-label]");
    if (!cell || cell.classList.contains("mine")) return;
    if (cell.classList.contains("full")) {
      pickNote(cell.dataset.label + " is full \u2014 there is no room left on it for this SKU. Pick another shelf.");
      return;
    }
    giveShelf(state.picking, cell.dataset.label);
  });

  const PICK_HINT = el.pickHint.textContent;
  let pickNoteTimer = null;
  function pickNote(text) {
    el.pickHint.textContent = text;
    el.pickHint.classList.add("bad-text");
    clearTimeout(pickNoteTimer);
    pickNoteTimer = setTimeout(function () {
      el.pickHint.textContent = PICK_HINT;
      el.pickHint.classList.remove("bad-text");
    }, 4000);
  }
  el.pickClose.addEventListener("click", closePicker);
  el.pickModal.addEventListener("click", function (e) {
    if (e.target === el.pickModal) closePicker();
  });

  async function giveShelf(index, label) {
    const r = state.alloc.results[index];
    const why = whyNoLocation(r);
    if (why) { pickNote(why); return; }
    if (roomFor(label, index) <= 0) {
      pickNote(state.alloc.locations.has(label)
        ? label + " is full \u2014 there is no room left on it for this SKU. Pick another shelf."
        : r.sku.sku + "'s box is too tall for Layer " + layerOf(label) + ". Pick another shelf.");
      return;
    }
    if (!r.sku.id) {
      failed = "This SKU was loaded before shelves could be chosen \u2014 reload the page, then try again.";
      status();
      return;
    }
    // How much may go: what is still without a shelf, and what fits here.
    const rec = state.alloc.locations.get(label);
    const perBox = r.sku.qtyPerBox;
    const roomBoxes = roomFor(label, index);
    const max = Math.max(0, Math.min(r.qtyLeft, Math.min(roomBoxes, r.unplaced) * perBox));
    if (max < 1) {
      pickNote("Nothing of " + r.sku.sku + " is left to move.");
      return;
    }
    const limit = "Up to " + fmt(max) + ". " + fmt(r.qtyLeft) + " qty still without a shelf; " +
      (rec ? "the " + Math.round(rec.free) + " cm still free here" : "this empty shelf") + " holds " +
      fmt(roomBoxes) + " box" + (roomBoxes === 1 ? "" : "es") + " of " + fmt(perBox) + " (" + fmt(roomBoxes * perBox) + " qty).";
    const qty = await ask({
      title: rec ? "Mix " + (rec.sections.length + 1) + " SKUs in " + label + "?" : "Move " + r.sku.sku + " to " + label,
      body: rec
        ? "<p>" + label + " already holds:</p><ul class=\"ask-list\">" +
          rec.sections.map((sec) => askLine(sec.sku, fmt(sec.qty) + " qty \u00b7 " + fmt(sec.boxes) + " box" + (sec.boxes === 1 ? "" : "es"))).join("") +
          askLine(index, "goes in beside " + (rec.sections.length === 1 ? "it" : "them"), true) + "</ul>"
        : '<ul class="ask-list">' + askLine(index, fmt(r.qtyLeft) + " qty without a shelf", true) + "</ul>",
      yes: rec ? "Mix them" : "Move here",
      number: { label: "Quantity to move", value: max, max: max, hint: limit },
    });
    if (qty === null) return;
    failed = null;
    saving++;
    status();
    try {
      const head = await ensureImport();
      const given = await DB.shelves.assign(head.id, label, r.sku.id, qty);
      state.data.shelves = state.data.shelves.concat([given]);
      closePicker();
      refresh();
    } catch (err) {
      console.error(err);
      failed = "Could not give " + label + " to " + r.sku.sku + ": " + err.message;
    } finally {
      saving--;
      status();
    }
  }

  // A new quantity for a SKU already on a shelf: up to what it has there
  // plus what is still without a shelf, and no more than the room it has
  // there plus the room still free on the shelf.
  async function editShelfQty(label, index) {
    const r = state.alloc.results[index];
    if (!r) return;
    const spot = r.spots.find((p) => p.label === label);
    const perBox = r.sku.qtyPerBox;
    if (!spot || !(perBox > 0)) return;
    const rec = state.alloc.locations.get(label);
    const roomBoxes = spot.boxes + (rec ? roomFor(label, index) : 0);
    const max = Math.max(1, Math.min(spot.qty + r.qtyLeft, roomBoxes * perBox));
    const qty = await ask({
      title: "Change the qty on " + label,
      body: '<ul class="ask-list">' + askLine(index, "now " + fmt(spot.qty) + " qty \u00b7 " + fmt(spot.boxes) +
        " box" + (spot.boxes === 1 ? "" : "es"), true) + "</ul>",
      yes: "Save",
      number: {
        label: "Quantity on " + label, value: spot.qty, max: max,
        hint: "Up to " + fmt(max) + ". " + fmt(spot.qty) + " here now, " + fmt(r.qtyLeft) + " still without a shelf; " +
          "this shelf has room for " + fmt(roomBoxes) + " box" + (roomBoxes === 1 ? "" : "es") + " of " + fmt(perBox) +
          " (" + fmt(roomBoxes * perBox) + " qty) of it.",
      },
    });
    if (qty === null || qty === spot.qty) return;
    failed = null;
    saving++;
    status();
    try {
      await DB.shelves.setQty(state.data.import.id, label, r.sku.id, qty);
      state.data.shelves = state.data.shelves.map((a) => (a.label === label && String(a.sku) === String(r.sku.id)
        ? Object.assign({}, a, { qty: qty }) : a));
      refresh();
    } catch (err) {
      console.error(err);
      failed = "Could not change the qty on " + label + ": " + err.message;
    } finally {
      saving--;
      status();
    }
  }

  async function freeShelf(label, index) {
    const r = state.alloc.results[index];
    if (!r) return;
    const rec = state.alloc.locations.get(label);
    const mine = rec ? rec.sections.find((sec) => sec.sku === index) : null;
    const others = rec ? rec.sections.filter((sec) => sec.sku !== index) : [];
    const ok = await ask({
      title: "Delete location " + label + "?",
      body: '<ul class="ask-list">' + askLine(index, mine ? fmt(mine.qty) + " qty \u00b7 " + fmt(mine.boxes) + " box" + (mine.boxes === 1 ? "" : "es") + " here" : "") + "</ul>" +
        "<p>" + esc(r.sku.sku) + " is taken off " + label + "." +
        (others.length ? " The " + (others.length === 1 ? "other SKU stays" : others.length + " other SKUs stay") + " on it."
          : " The shelf will be vacant.") +
        (mine && mine.boxes ? " Its " + fmt(mine.boxes) + " box" + (mine.boxes === 1 ? "" : "es") + " go back under <em>No shelf</em>." : "") + "</p>",
      yes: "Delete",
      danger: true,
    });
    if (!ok) return;
    failed = null;
    saving++;
    status();
    try {
      await DB.shelves.free(state.data.import.id, label, r.sku.id);
      state.data.shelves = state.data.shelves.filter((a) => !(a.label === label && String(a.sku) === String(r.sku.id)));
      if (state.selected === label && !state.data.shelves.some((a) => a.label === label)) closeDetail();
      refresh();
    } catch (err) {
      console.error(err);
      failed = "Could not take " + r.sku.sku + " off " + label + ": " + err.message;
    } finally {
      saving--;
      status();
    }
  }

  // An edit is saved the moment it is committed (Enter, Tab, or clicking
  // away), and the racks are laid out again with the new numbers.
  let saving = 0;
  let failed = null;
  function status() {
    if (failed) {
      el.skuStatus.textContent = failed;
      el.skuStatus.className = "save-status bad-text";
    } else {
      el.skuStatus.textContent = saving ? "Saving\u2026" : "Changes are saved for everyone";
      el.skuStatus.className = "save-status sub";
    }
  }

  el.skuTable.addEventListener("change", function (e) {
    const input = e.target.closest("input[data-field]");
    if (!input || !Auth.canEdit()) return;
    const r = state.alloc.results[Number(input.dataset.sku)];
    const field = input.dataset.field;
    const raw = input.value.trim();
    const value = raw === "" ? null : Number(raw);
    if (value !== null && !(isFinite(value) && value >= 0)) {
      input.value = r.sku[field] === null || r.sku[field] === undefined ? "" : r.sku[field];
      return;
    }
    const before = r.sku[field] === undefined ? null : r.sku[field];
    if (value === before) return;
    if (!r.sku.id) {
      failed = "This sheet was loaded before editing existed \u2014 reload the page, then edit.";
      status();
      return;
    }

    r.sku[field] = value;
    failed = null;
    saving++;
    status();
    const patch = {};
    patch[field] = value;
    DB.imports.updateSku(r.sku.id, patch)
      .catch(function (err) {
        console.error(err);
        r.sku[field] = before;
        failed = "Could not save " + r.sku.sku + ": " + err.message + " \u2014 the old value is back.";
        refresh();
      })
      .finally(function () { saving--; status(); });
    refresh();
  });

  // Lay out again and redraw everything but the SKU list, whose rows only
  // have their worked-out numbers brought up to date.
  let refreshTimer = null;
  function refresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(function () {
      state.alloc = layout();
      renderKpis();
      renderMap();
      renderDetail();
      renderCategories();
      renderCatStats();
      updateSkus();
      if (state.picking !== null) renderPicker();
      if (!el.varModal.hidden) renderVariance();
    }, 0);
  }

  let searchTimer = null;
  el.search.addEventListener("input", function () {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(function () {
      state.search = el.search.value.trim().toLowerCase();
      renderMap();
    }, 120);
  });
  // Enter jumps to the first shelf that matches.
  el.search.addEventListener("keydown", function (e) {
    if (e.key !== "Enter") return;
    state.search = el.search.value.trim().toLowerCase();
    renderMap();
    const hit = el.map.querySelector(".cell.hit:not(.free)") || el.map.querySelector(".cell.hit");
    if (hit) select(hit.dataset.label, true);
  });


  // Back to how the map looks when the page opens: no search, no shelf
  // picked, coloured by category, scrolled to the start. Rules and SKUs are
  // left alone.
  el.mapReset.addEventListener("click", function () {
    el.search.value = "";
    state.search = "";
    closeDetail();
    renderMap();
    el.map.scrollLeft = 0;
  });
  el.skuFilter.addEventListener("change", renderSkus);

  // The days of stock re-lay the racks at once and are saved for everyone.
  // The other rules are no longer on the page; the ones saved with the
  // list still apply.
  let saveTimer = null;
  function ruleChanged() {
    if (!Auth.canEdit()) return;
    const days = Math.round(Number(el.ruleDays.value));
    state.rules = Object.assign({}, state.rules, {
      days: days >= 1 && days <= 365 ? days : state.rules.days,
    });
    el.ruleDays.value = state.rules.days;
    recompute();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      ensureImport()
        .then((head) => DB.imports.setRules(head.id, state.rules))
        .then(function () { state.data.import.rules = state.rules; })
        .catch(function (e) { console.error(e); alert("The new rules could not be saved: " + e.message); });
    }, 400);
  }
  el.ruleDays.addEventListener("change", ruleChanged);

  function openCategory(key, filter) {
    state.category = key;
    el.skuFilter.value = filter || "all";
    renderCategories();
    renderSkus();
    el.catBody.scrollTop = 0;
  }

  function closeCategory() {
    state.category = null;
    renderCategories();
    renderSkus();
  }

  el.gapShow.addEventListener("click", function () { openCategory(ALL, "nocount"); });

  el.catList.addEventListener("click", function (e) {
    const btn = e.target.closest("button[data-cat]");
    if (btn) openCategory(btn.dataset.cat);
  });
  el.catClose.addEventListener("click", closeCategory);
  // A click on the dimmed page around the window closes it too.
  el.catModal.addEventListener("click", function (e) {
    if (e.target === el.catModal) closeCategory();
  });

  // --- adding and removing SKUs ---------------------------------------------

  // The list SKUs belong to. One is made the first time it is needed.
  async function ensureImport() {
    if (!state.data.import) state.data.import = await DB.imports.create(state.rules);
    return state.data.import;
  }

  function relayout() {
    buildColors();
    recompute();
  }

  const NUMBERS = ["soldPerDay", "quantity", "length", "width", "height", "qtyPerBox"];

  function openAdd() {
    el.skuForm.reset();
    el.skuFormError.hidden = true;
    if (state.category !== null && state.category !== ALL) el.skuForm.querySelector('[name="category"]').value = state.category;
    el.skuDialog.showModal();
    el.skuForm.querySelector('[name="sku"]').focus();
  }
  el.skuAdd.addEventListener("click", openAdd);
  el.catAdd.addEventListener("click", openAdd);
  el.skuCancel.addEventListener("click", function () { el.skuDialog.close(); });

  el.skuForm.addEventListener("submit", async function (e) {
    e.preventDefault();
    // By name through querySelector: elements.length is the form's own
    // count of its controls, not the Length box.
    const box = (name) => el.skuForm.querySelector('[name="' + name + '"]');
    const fail = function (msg, field) {
      el.skuFormError.textContent = msg;
      el.skuFormError.hidden = false;
      if (field) box(field).focus();
    };
    const sku = { sku: box("sku").value.trim(), category: box("category").value.trim(), tier: box("tier").value.trim() };
    if (!sku.sku) return fail("Give the SKU code.", "sku");
    if (!sku.category) return fail("Give the category.", "category");
    const taken = state.data.skus.find((s) => String(s.sku).toLowerCase() === sku.sku.toLowerCase());
    if (taken) return fail(sku.sku + " is already in the list, under " + catName(taken.category) + ".", "sku");
    for (const k of NUMBERS) {
      const raw = box(k).value.trim();
      const v = raw === "" ? null : Number(raw);
      if (v !== null && !(isFinite(v) && v >= 0)) return fail("That is not a number.", k);
      sku[k] = v;
    }

    const save = document.getElementById("skuSave");
    save.disabled = true;
    try {
      const head = await ensureImport();
      const line = state.data.skus.reduce((n, s) => Math.max(n, Number(s.line) || 0), 0) + 1;
      const added = await DB.imports.addSku(head.id, sku, line);
      state.data.skus.push(added);
      el.skuDialog.close();
      state.category = added.category || "";
      el.skuFilter.value = "all";
      relayout();
      const tr = el.skuTable.querySelector('tr[data-sku="' + (state.data.skus.length - 1) + '"]');
      if (tr) {
        tr.classList.add("just-added");
        tr.scrollIntoView({ block: "center", behavior: "smooth" });
      }
    } catch (err) {
      console.error(err);
      fail("Could not save: " + err.message);
    } finally {
      save.disabled = false;
    }
  });

  el.exportBtn.addEventListener("click", function () {
    if (!Excel.available()) { alert("The spreadsheet library did not load, so the list cannot be written."); return; }
    Excel.putAway(state.data.skus, state.alloc, state.data.import);
  });

  // --- variance: 4KB stock against what sales need, and what 6K4 can do -------

  // One SKU's gap, in qty and in boxes, and what to do about it. Short: how
  // many boxes 6K4 can send, at most the boxes 4KB is short. Over: the whole
  // boxes 4KB can send back to 6K4 and still hold what is needed.
  function varianceOf(r) {
    const s = r.sku;
    const qty = Number(s.quantity) || 0;
    const diff = Math.round((qty - r.needed) * 100) / 100;
    const perBox = s.qtyPerBox > 0 ? s.qtyPerBox : null;
    const has6 = s.qty6k4 !== null && s.qty6k4 !== undefined;
    const q6 = Number(s.qty6k4) || 0;
    const v = { r: r, diff: diff, perBox: perBox, q6: has6 ? q6 : null, kind: "", note: "" };
    if (diff < 0) {
      const gap = -diff;
      v.gapBoxes = perBox ? Math.max(0, Math.ceil(gap / perBox - 1e-9)) : null;
      v.boxes6 = perBox && has6 ? Math.max(0, Math.ceil(q6 / perBox - 1e-9)) : null;
      if (!has6) { v.kind = "unknown"; v.note = "6K4 has not been synced yet."; }
      else if (q6 <= 0) { v.kind = "none"; v.note = "No stock in 6K4."; }
      else if (!perBox) { v.kind = "nocount"; v.note = "6K4 has " + fmt(q6) + " qty; fill in Qty/Box to count boxes."; }
      else if (q6 >= gap) {
        v.kind = "covered"; v.bring = v.gapBoxes;
        v.note = "Bring " + fmt(v.bring) + " box" + (v.bring === 1 ? "" : "es") + " from 6K4 (6K4 has " + fmt(v.boxes6) + ").";
      } else {
        v.kind = "partial"; v.bring = v.boxes6;
        v.note = "6K4 has only " + fmt(v.boxes6) + " box" + (v.boxes6 === 1 ? "" : "es") + " (" + fmt(q6) + " qty): bring all, still " +
          fmt(gap - q6) + " short.";
      }
    } else if (diff > 0) {
      v.moveBoxes = perBox ? Math.floor(diff / perBox + 1e-9) : null;
      v.moveQty = perBox ? v.moveBoxes * perBox : null;
      if (!perBox) { v.kind = "nocount"; v.note = "Fill in Qty/Box to count the boxes to send to 6K4."; }
      else if (v.moveBoxes > 0) {
        v.kind = "move";
        v.note = "Transfer " + fmt(v.moveBoxes) + " box" + (v.moveBoxes === 1 ? "" : "es") + " (" + fmt(v.moveQty) + " qty) to 6K4.";
      } else { v.kind = "keep"; v.note = "Less than one box over: keep it in 4KB."; }
    }
    return v;
  }

  // Every SKU off by anything, biggest gap first: short with something in
  // 6K4 (or 6K4 not known), short with nothing in 6K4, and over.
  function variances(category) {
    const out = { short: [], over: [], none: [] };
    for (const r of state.alloc.results) {
      if (category !== null && catName(r.sku.category) !== category) continue;
      if (!(Number(r.sku.quantity) || 0) && !r.needed) continue;
      const v = varianceOf(r);
      if (v.diff < 0) out[v.kind === "none" ? "none" : "short"].push(v);
      else if (v.diff > 0) out.over.push(v);
    }
    out.short.sort((a, b) => a.diff - b.diff);
    out.none.sort((a, b) => a.diff - b.diff);
    out.over.sort((a, b) => b.diff - a.diff);
    return out;
  }

  const VAR_TONE = { covered: "good", partial: "warn", none: "bad", unknown: "", nocount: "warn", move: "info", keep: "" };
  // short | over | none (short, with nothing in 6K4).
  let varTab = "short";

  // The categories in the order of the category cards: most SKUs first.
  function categoryOrder() {
    const count = new Map();
    for (const r of state.alloc.results) {
      const c = catName(r.sku.category);
      count.set(c, (count.get(c) || 0) + 1);
    }
    return [...count.keys()].sort((a, b) => count.get(b) - count.get(a) || Allocate.compareText(a, b));
  }

  function varRows(all) {
    const rows = all[varTab];
    const q = el.varSearch.value.trim().toLowerCase();
    return q ? rows.filter((v) => v.r.sku.sku.toLowerCase().indexOf(q) >= 0) : rows;
  }

  function renderVariance() {
    const cat = el.varCat.value || null;
    const all = variances(cat);
    const sum = (list, key) => list.reduce((n, v) => n + (v[key] || 0), 0);
    el.varShortN.textContent = all.short.length;
    el.varOverN.textContent = all.over.length;
    el.varNoneN.textContent = all.none.length;
    el.varStats.innerHTML =
      "<div><dt>Short in 4KB</dt><dd>" + fmt(all.short.length) + ' <span class="sub">SKUs</span></dd></div>' +
      "<div><dt>Bring from 6K4</dt><dd>" + fmt(sum(all.short, "bring")) + ' <span class="sub">boxes</span></dd></div>' +
      "<div><dt>No stock in 6K4</dt><dd>" + fmt(all.none.length) + ' <span class="sub">SKUs</span></dd></div>' +
      "<div><dt>Over in 4KB</dt><dd>" + fmt(all.over.length) + ' <span class="sub">SKUs</span></dd></div>' +
      "<div><dt>Transfer to 6K4</dt><dd>" + fmt(sum(all.over, "moveBoxes")) + ' <span class="sub">boxes</span></dd></div>';
    if (!el.varNote.dataset.held) {
      const synced = state.data.skus.some((s) => s.qty6k4 !== null && s.qty6k4 !== undefined);
      el.varNote.textContent = "Needed = sold per day × " + state.rules.days + " days. " +
        (synced ? "Click a SKU to see its boxes on the shelf: how they are turned and where they sit."
          : "6K4 Qty has not been synced yet: the laptops need extension " + Accounts.EXT_VERSION + ".");
      el.varNote.classList.toggle("bad-text", !synced);
    }
    el.varTabs.forEach((b) => b.classList.toggle("on", b.dataset.var === varTab));

    const rows = varRows(all);
    const short = varTab !== "over";
    const head = short
      ? ["#", "SKU", "4KB Qty", "Needed", "Short", "Qty/Box", "Short (boxes)", "6K4 Qty", "6K4 boxes", "Bring from 6K4", "What to do"]
      : ["#", "SKU", "4KB Qty", "Needed", "Over", "Qty/Box", "Transfer to 6K4", "Qty to transfer", "What to do"];
    const cell = (n) => "<td>" + (n === null || n === undefined ? '<span class="sub">—</span>' : fmt(n)) + "</td>";
    const line = function (v, i) {
      const s = v.r.sku;
      const lead = '<td class="sub">' + (i + 1) + "</td>" +
        '<td class="sku-name"><span class="sku-wrap"><b>' + esc(s.sku) + "</b>" +
        '<button type="button" class="copy-btn" data-copy="' + esc(s.sku) + '" title="Copy SKU" aria-label="Copy ' + esc(s.sku) + '">' +
        COPY_ICON + "</button></span></td>" + cell(s.quantity) + cell(Math.round(v.r.needed * 100) / 100);
      const what = '<td><span class="var-what ' + (VAR_TONE[v.kind] || "") + '">' + esc(v.note) + "</span></td>";
      const title = v.r.spots.length ? "On " + v.r.spots.map((p) => p.label).join(", ") + " — click to see its boxes on the shelf"
        : "Not on any 4KB shelf yet";
      const open = '<tr data-var-sku="' + v.r.index + '" title="' + esc(title) + '">';
      if (short) {
        return open + lead + '<td><span class="remark short">−' + fmt(-v.diff) + "</span></td>" +
          cell(v.perBox) + cell(v.gapBoxes) + cell(v.q6) + cell(v.boxes6) +
          "<td><b>" + (v.bring ? fmt(v.bring) : "") + "</b></td>" + what + "</tr>";
      }
      return open + lead + '<td><span class="remark over">+' + fmt(v.diff) + "</span></td>" +
        cell(v.perBox) + "<td><b>" + (v.moveBoxes ? fmt(v.moveBoxes) : "") + "</b></td>" +
        cell(v.moveBoxes ? v.moveQty : null) + what + "</tr>";
    };

    // One group per category, like the SKU list, with what the group comes to.
    let body = "";
    for (const c of categoryOrder()) {
      const group = rows.filter((v) => catName(v.r.sku.category) === c);
      if (!group.length) continue;
      const total = short ? fmt(sum(group, "bring")) + " box" + (sum(group, "bring") === 1 ? "" : "es") + " to bring from 6K4"
        : fmt(sum(group, "moveBoxes")) + " box" + (sum(group, "moveBoxes") === 1 ? "" : "es") + " to transfer to 6K4";
      body += '<tr class="var-group"><td colspan="' + head.length + '"><i class="cat-dot" style="background:' +
        categoryColor(group[0].r.sku.category) + '"></i><b>' + esc(c) + '</b><span class="sub"> · ' + group.length +
        " SKU" + (group.length === 1 ? "" : "s") + (varTab === "none" ? "" : " · " + total) + "</span></td></tr>" +
        group.map(line).join("");
    }
    const empty = { short: "short", over: "over", none: "short with nothing in 6K4" }[varTab];
    el.varTable.innerHTML = "<thead><tr>" + head.map((h) => "<th>" + h + "</th>").join("") + "</tr></thead><tbody>" +
      (body || '<tr><td colspan="' + head.length + '" class="sub">No SKU ' + empty +
        (el.varSearch.value.trim() ? ' matching “' + esc(el.varSearch.value.trim()) + '”' : "") +
        (cat ? " in " + esc(cat) : "") + ".</td></tr>") + "</tbody>";
  }

  function openVariance() {
    const keep = el.varCat.value;
    el.varCat.innerHTML = '<option value="">All categories</option>' +
      categoryOrder().map((c) => '<option value="' + esc(c) + '"' + (c === keep ? " selected" : "") + ">" + esc(c) + "</option>").join("");
    el.varModal.hidden = false;
    renderVariance();
  }

  function closeVariance() { el.varModal.hidden = true; }

  // A short word in the note line, then back to what it said.
  let varNoteTimer = null;
  function varSay(text) {
    clearTimeout(varNoteTimer);
    el.varNote.dataset.held = "1";
    el.varNote.textContent = text;
    el.varNote.classList.add("bad-text");
    varNoteTimer = setTimeout(function () { delete el.varNote.dataset.held; renderVariance(); }, 4000);
  }

  // The SKU's shelf, over the report: its boxes in 3D, which way up each
  // stands, and what else shares the shelf. Its other shelves are a click
  // away there; closing goes back to the report.
  function showShelf(r) {
    if (!r.spots.length) { varSay(r.sku.sku + " is not on any 4KB shelf yet."); return; }
    state.focus = r.index;
    select(r.spots[0].label, false);
  }

  el.varBtn.addEventListener("click", function () { if (state.data) openVariance(); });
  el.varClose.addEventListener("click", closeVariance);
  el.varModal.addEventListener("click", function (e) { if (e.target === el.varModal) closeVariance(); });
  el.varCat.addEventListener("change", renderVariance);
  el.varSearch.addEventListener("input", renderVariance);
  el.varTabs.forEach((b) => b.addEventListener("click", function () { varTab = b.dataset.var; renderVariance(); }));
  el.varTable.addEventListener("click", function (e) {
    const copy = e.target.closest("button[data-copy]");
    if (copy) { copyButton(copy); return; }
    const tr = e.target.closest("tr[data-var-sku]");
    if (tr) showShelf(state.alloc.results[Number(tr.dataset.varSku)]);
  });
  el.varExport.addEventListener("click", function () {
    if (!Excel.available()) { alert("The spreadsheet library did not load, so the report cannot be written."); return; }
    Excel.variance(variances(el.varCat.value || null), state.rules.days);
  });

  document.addEventListener("themechange", function () { if (state.data) renderDetail(); });

  // --- sold per day, live from the Google Sheet --------------------------------

  // Read every minute while the page is in view, and at once when it comes
  // back into view. A number that changed is used straight away and saved,
  // so the list still has it if the sheet cannot be reached later.
  const SOLD_EVERY = 60 * 1000;
  let soldTimer = null;
  let soldBusy = false;

  function soldStatus(text, bad) {
    el.soldSync.innerHTML = text;
    el.soldSync.classList.toggle("bad-text", !!bad);
  }

  async function syncSold() {
    if (soldBusy || !state.data || document.hidden) return;
    soldBusy = true;
    try {
      const sold = await SoldSheet.read();
      const changed = [];
      let matched = 0;
      for (const s of state.data.skus) {
        // null: the SKU is in the sheet but column D is empty, so it is
        // emptied here too. undefined: not in the sheet, left as it is.
        const v = sold.get(String(s.sku).trim().toLowerCase());
        if (v === undefined) continue;
        matched++;
        if (v !== (s.soldPerDay === undefined ? null : s.soldPerDay)) {
          s.soldPerDay = v;
          changed.push(s);
        }
      }
      if (changed.length) {
        refresh();
        for (const s of changed) {
          if (s.id) DB.imports.updateSku(s.id, { soldPerDay: s.soldPerDay }).catch((e) => console.error(e));
        }
      }
      const when = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      const missing = state.data.skus.length - matched;
      soldStatus('Sold/Day live from <a href="' + SoldSheet.url + '" target="_blank" rel="noopener">Google Sheet</a>' +
        " \u00b7 checked " + when +
        (changed.length ? " \u00b7 " + changed.length + " updated" : "") +
        (missing ? " \u00b7 " + missing + " SKU" + (missing === 1 ? "" : "s") + " not in the sheet" : ""));
    } catch (e) {
      console.error(e);
      soldStatus('Could not read the <a href="' + SoldSheet.url + '" target="_blank" rel="noopener">Google Sheet</a> (' +
        esc(e.message) + ") \u2014 showing the last saved Sold/Day.", true);
    } finally {
      soldBusy = false;
    }
  }

  function startSoldSync() {
    syncSold();
    clearInterval(soldTimer);
    soldTimer = setInterval(syncSold, SOLD_EVERY);
    document.addEventListener("visibilitychange", function () { if (!document.hidden) syncSold(); });
  }

  // --- 4KB Qty from JSTERP --------------------------------------------------------

  // The numbers themselves arrive as SKU changes (see below); this only says
  // how fresh they are. The Chrome extension on whichever laptop's turn it is
  // writes them every 30 seconds and leaves a note in rack_sync each time. Two minutes without
  // one and the feed is taken to have stopped; ten, or a failed run, and the
  // line becomes a red alert.
  const STOCK_FEED = "jsterp-4kb";
  const STOCK_STALE = 2 * 60 * 1000;
  const STOCK_DOWN = 10 * 60 * 1000;
  const STOCK_POLL = 20 * 1000;
  let stockNote = null, stockSeen = 0;

  function ago(ms) {
    const sec = Math.max(0, Math.round(ms / 1000));
    if (sec < 60) return sec + " s ago";
    const min = Math.round(sec / 60);
    if (min < 60) return min + " min ago";
    const h = Math.round(min / 60);
    return h < 48 ? h + " h ago" : Math.round(h / 24) + " days ago";
  }

  function renderStockSync() {
    const setup = ' <a href="#" data-jst-setup>Set up</a>';
    const n = stockNote;
    if (!n || !n.synced_at) {
      el.stockSync.innerHTML = "4KB Qty is not coming from JSTERP yet." + setup;
      el.stockSync.classList.add("bad-text", "stock-down");
      return;
    }
    const age = Date.now() - (stockSeen || new Date(n.synced_at).getTime());
    const info = n.info || {};
    let text;
    if (!n.ok) {
      text = "4KB Qty is not updating: " + esc(n.message || "unknown") + setup;
    } else if (age > STOCK_STALE) {
      text = "4KB Qty last updated " + ago(age) + " \u2014 no laptop with the sync extension has Chrome open." + setup;
    } else {
      text = "4KB Qty live from JSTERP \u00b7 updated " + ago(age) +
        (info.skus !== undefined ? " \u00b7 " + fmt(info.skus) + " SKUs in 4KB" : "") +
        (info.notInPlannerCount ? " \u00b7 " + info.notInPlannerCount + " not in this list" : "");
    }
    el.stockSync.innerHTML = text;
    el.stockSync.classList.toggle("bad-text", !n.ok || age > STOCK_STALE);
    el.stockSync.classList.toggle("stock-down", !n.ok || age > STOCK_DOWN);
    renderStock6(n, age);
  }

  // 6K4 rides along with 4KB: live when the last good run brought it too.
  function renderStock6(n, age) {
    const z = n && n.ok && n.info && n.info.zones ? n.info.zones["6k4"] : null;
    let text;
    let bad = false;
    if (!n || !n.synced_at || !n.ok || age > STOCK_STALE) {
      text = "6K4 Qty is not updating either: it comes with the 4KB sync.";
      bad = true;
    } else if (z) {
      text = "6K4 Qty live from JSTERP \u00b7 updated " + ago(age) + " \u00b7 " + fmt(z.skus) + " SKUs in 6K4";
    } else {
      text = "6K4 Qty is not syncing: " + esc((n.info && n.info.deviceName) || "the syncing laptop") +
        " needs extension " + Accounts.EXT_VERSION + " (Accounts page).";
      bad = true;
    }
    el.stock6Sync.innerHTML = text;
    el.stock6Sync.classList.toggle("bad-text", bad);
  }

  // Age counts from when this page saw a note change, so a PC whose clock
  // runs ahead or behind still reads true. Before the first change there is
  // only the note's own time to go on.
  function takeStockNote(note) {
    if (stockNote && note && note.synced_at !== stockNote.synced_at) stockSeen = Date.now();
    stockNote = note;
  }

  async function loadStockNote() {
    try {
      const was = stockNote && stockNote.synced_at;
      takeStockNote(await DB.syncs.get(STOCK_FEED));
      // A live connection can die without saying so, so the numbers follow
      // the note as well.
      const info = (stockNote && stockNote.info) || {};
      if (state.data && was && stockNote.synced_at !== was && info.changed) wantLive("skus");
    } catch (e) {
      console.error(e);
    }
    renderStockSync();
  }

  // The note is read here as well as pushed: a laptop that slept, or a
  // network that blocks the live connection, gets no push and no word of it.
  function startStockSync() {
    if (!DB.configured()) return;
    loadStockNote();
    setInterval(renderStockSync, 10 * 1000);
    setInterval(loadStockNote, STOCK_POLL);
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) return;
      loadStockNote();
      if (state.data) wantLive("skus");
    });
  }

  el.stockSync.addEventListener("click", function (e) {
    if (!e.target.closest("[data-jst-setup]")) return;
    e.preventDefault();
    el.jstDialog.showModal();
  });

  // --- changes made by others, as they happen ----------------------------------

  // Every open page hears about a change to a SKU, a shelf choice or the days
  // of stock the moment it is saved, by anybody, and redraws with it. Changes
  // arriving together are taken in one go. What is being typed in a box is
  // never overwritten. If the live connection drops, the page checks every
  // 20 seconds instead until it is back.
  const LIVE_POLL = 20 * 1000;
  let liveTimer = null, pollTimer = null;
  const liveWant = new Set();

  function liveStatus(kind) {
    const text = {
      live: "Live \u2014 changes made by others appear here at once",
      connecting: "Connecting for live changes\u2026",
      off: "Live changes are off \u2014 checking for others' changes every 20 seconds",
    }[kind];
    el.liveSync.hidden = !text;
    el.liveSync.textContent = text || "";
    el.liveSync.className = "sub live-sync " + kind;
    clearInterval(pollTimer);
    if (kind === "off" && DB.configured()) {
      pollTimer = setInterval(function () { wantLive("skus"); wantLive("shelves"); }, LIVE_POLL);
    }
  }

  function wantLive(what) {
    liveWant.add(what);
    clearTimeout(liveTimer);
    liveTimer = setTimeout(applyLive, 250);
  }

  function onLive(table, p) {
    if (!state.data) return;
    const id = state.data.import && state.data.import.id;
    const row = p.new && Object.keys(p.new).length ? p.new : p.old || {};
    if (table === DB.tables.imports) {
      if (!id) wantLive("all");
      else if (row.id === id) wantLive("skus");
    } else if (table === DB.tables.shelves) {
      if (!row.import_id || row.import_id === id) wantLive("shelves");
    } else if (table === DB.tables.skus) {
      if (!row.import_id || row.import_id === id) wantLive("skus");
    } else if (table === DB.tables.sync) {
      if (row.name === STOCK_FEED && p.new && p.new.name) {
        takeStockNote(p.new);
        renderStockSync();
      }
    }
  }

  // Bring the list in line with the database: SKUs changed in place, new ones
  // added, deleted ones taken out. True when the table has to be redrawn
  // (SKUs added or gone, or a name, tier or category changed).
  function mergeSkus(fresh) {
    const byId = new Map(state.data.skus.map((s) => [String(s.id), s]));
    const seen = new Set();
    let redraw = false;
    for (const f of fresh) {
      const key = String(f.id);
      seen.add(key);
      const s = byId.get(key);
      if (!s) { state.data.skus.push(f); redraw = true; continue; }
      if (s.sku !== f.sku || s.tier !== f.tier || s.category !== f.category) redraw = true;
      Object.assign(s, f);
    }
    const before = state.data.skus.length;
    state.data.skus = state.data.skus.filter((s) => seen.has(String(s.id)));
    return redraw || state.data.skus.length !== before;
  }

  async function applyLive() {
    const want = new Set(liveWant);
    liveWant.clear();
    try {
      if (want.has("all") || !state.data.import) {
        const data = await DB.imports.latest();
        if (data && data.import) data.shelves = await DB.shelves.list(data.import.id);
        load(data);
        return;
      }
      let redraw = false;
      if (want.has("skus")) {
        const data = await DB.imports.latest();
        if (!data || data.import.id !== state.data.import.id) { wantLive("all"); return; }
        const picking = state.picking !== null ? state.data.skus[state.picking] : null;
        redraw = mergeSkus(data.skus);
        if (picking) {
          state.picking = state.data.skus.indexOf(picking);
          if (state.picking < 0) closePicker();
        }
        // The days of stock, set by somebody else.
        state.data.import.rules = data.import.rules || {};
        const days = Object.assign({}, Allocate.DEFAULT_RULES, state.data.import.rules).days;
        if (days !== state.rules.days) {
          state.rules = Object.assign({}, state.rules, { days: days });
          if (document.activeElement !== el.ruleDays) el.ruleDays.value = days;
          redraw = true;
        }
      }
      if (want.has("shelves")) state.data.shelves = await DB.shelves.list(state.data.import.id);
      if (redraw) {
        buildColors();
        recompute();
        if (state.picking !== null) renderPicker();
      } else {
        refresh();
      }
    } catch (e) {
      console.error(e);
    }
  }

  function startLive() {
    if (!DB.configured()) return;
    liveStatus("connecting");
    DB.live(onLive, liveStatus);
  }

  // --- start -----------------------------------------------------------------

  async function start() {
    try {
      const data = await DB.imports.latest();
      if (data && data.import) data.shelves = await DB.shelves.list(data.import.id);
      load(data);
      startSoldSync();
      startStockSync();
      startLive();
    } catch (e) {
      console.error(e);
      el.empty.hidden = false;
      el.dash.hidden = true;
      el.empty.querySelector("p").textContent = e.message;
    }
  }

  return {
    load: load,
    start: start,
    rules: () => Object.assign({}, state.rules),
    hasData: () => !!state.data,
    current: () => state.data,
    shown: function () { if (state.view) state.view.redraw(); },
  };
})();
