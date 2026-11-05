// Spreadsheets in and out: reading a SKU sheet (.xls or .xlsx), handing out
// a blank template, and writing the put-away list. SheetJS does the file
// formats; this decides which column is which.
const Excel = (function () {
  "use strict";

  // What the sheet is expected to hold. `names` are header spellings that
  // count as an exact match once case, spaces and punctuation are stripped.
  const FIELDS = [
    { key: "tier", label: "Tier", names: ["tier"] },
    { key: "category", label: "Category", names: ["category", "cat"] },
    { key: "sku", label: "SKU", names: ["sku", "skucode", "itemcode", "item"], required: true },
    { key: "soldPerDay", label: "Sold per day", names: ["soldperday", "salesperday", "dailysales"], number: true },
    { key: "quantity", label: "Quantity", names: ["quantity", "qty"], number: true },
    { key: "length", label: "Length", names: ["length", "lengthcm", "l", "lcm"], number: true, required: true },
    { key: "width", label: "Width", names: ["width", "widthcm", "w", "wcm"], number: true, required: true },
    { key: "height", label: "Height", names: ["height", "heightcm", "h", "hcm"], number: true, required: true },
    { key: "qtyPerBox", label: "Qty per box", names: ["qtyperbox", "quantityperbox", "pcsperbox", "pcsbox", "qtybox", "perbox"], number: true },
  ];

  const norm = (v) => String(v === null || v === undefined ? "" : v).toLowerCase().replace(/[^a-z0-9]/g, "");

  // Columns an older sheet may still have that are now worked out instead:
  // needed qty is sold per day x days, and boxes are needed qty / qty per box.
  // They are recognised only so they are never mistaken for something else.
  const DERIVED = { neededQty: "Needed qty", totalBoxes: "Total number of boxes" };

  // A header nobody spelled exactly as expected. The order matters: "Qty per
  // box", "Needed qty" and "Total number of boxes" all contain words that
  // would otherwise read as plain Quantity.
  function looseMatch(n) {
    if (n.includes("perbox") || (n.includes("box") && n.includes("qty") && !n.includes("total") && !n.includes("needed"))) return "qtyPerBox";
    if (n.includes("needed")) return "neededQty";
    if (n.includes("box") && (n.includes("total") || n.includes("numberof") || n.startsWith("no"))) return "totalBoxes";
    if (n.includes("sold") || n.includes("sales")) return "soldPerDay";
    if (n.startsWith("length")) return "length";
    if (n.startsWith("width")) return "width";
    if (n.startsWith("height")) return "height";
    if (n.includes("categ")) return "category";
    if (n.includes("tier")) return "tier";
    if (n.includes("sku")) return "sku";
    if (n.startsWith("quantity") || n === "qty") return "quantity";
    return null;
  }

  // Which column holds which field, for one candidate header row.
  function mapHeader(cells) {
    const map = {};
    const taken = new Set();
    // Exact spellings first, so a loose guess never steals a column that
    // something else names precisely.
    cells.forEach(function (cell, col) {
      const n = norm(cell);
      if (!n) return;
      const f = FIELDS.find((f) => f.names.includes(n));
      if (f && map[f.key] === undefined) { map[f.key] = col; taken.add(col); }
    });
    cells.forEach(function (cell, col) {
      if (taken.has(col)) return;
      const n = norm(cell);
      if (!n) return;
      const key = looseMatch(n);
      if (key && map[key] === undefined) { map[key] = col; taken.add(col); }
    });
    return map;
  }

  function toNumber(v) {
    if (v === null || v === undefined || v === "") return null;
    if (typeof v === "number") return isFinite(v) ? v : null;
    const n = parseFloat(String(v).replace(/,/g, "").trim());
    return isFinite(n) ? n : null;
  }

  function toText(v) {
    if (v === null || v === undefined) return "";
    if (typeof v === "number") return String(v);
    return String(v).trim();
  }

  // Read a workbook. Picks the sheet and header row that match the most
  // expected columns, so a title row or two above the headers is fine.
  function parse(buffer, fileName) {
    const book = XLSX.read(buffer, { type: "array" });
    let best = null;

    for (const sheetName of book.SheetNames) {
      const rows = XLSX.utils.sheet_to_json(book.Sheets[sheetName], { header: 1, raw: true, defval: null, blankrows: true });
      for (let r = 0; r < Math.min(rows.length, 15); r++) {
        const map = mapHeader(rows[r] || []);
        const score = Object.keys(map).length;
        if (score >= 3 && (!best || score > best.score)) {
          best = { sheetName: sheetName, headerRow: r, map: map, score: score, rows: rows };
        }
      }
    }

    if (!best) {
      return { ok: false, error: "No sheet in " + fileName + " has headers like Tier, SKU, Length, Width, Height." };
    }

    const missing = FIELDS.filter((f) => best.map[f.key] === undefined);
    const missingRequired = missing.filter((f) => f.required);
    if (missingRequired.length) {
      return {
        ok: false,
        error: "Could not find a column for " + missingRequired.map((f) => f.label).join(", ") + ".",
        sheetName: best.sheetName, map: best.map, missing: missing,
      };
    }

    const skus = [];
    const notes = [];
    const headerRow = best.rows[best.headerRow] || [];
    const ignored = Object.keys(DERIVED).filter((k) => best.map[k] !== undefined)
      .map((k) => toText(headerRow[best.map[k]]) || DERIVED[k]);
    for (let r = best.headerRow + 1; r < best.rows.length; r++) {
      const cells = best.rows[r] || [];
      const line = r + 1; // as Excel numbers it
      if (!cells.some((c) => c !== null && c !== "")) continue;

      const s = {};
      for (const f of FIELDS) {
        const col = best.map[f.key];
        const raw = col === undefined ? null : cells[col];
        s[f.key] = f.number ? toNumber(raw) : toText(raw);
      }
      if (!s.sku) {
        notes.push({ line: line, text: "no SKU, row skipped" });
        continue;
      }
      if (!(s.length > 0 && s.width > 0 && s.height > 0)) {
        notes.push({ line: line, sku: s.sku, text: "box size incomplete, cannot be placed" });
      }
      if (s.soldPerDay > 0 && !(s.qtyPerBox > 0)) {
        notes.push({ line: line, sku: s.sku, text: "sells " + s.soldPerDay + " a day but has no Qty per box, so its boxes cannot be counted" });
      }
      s.line = line;
      skus.push(s);
    }

    const seen = new Map();
    for (const s of skus) seen.set(s.sku, (seen.get(s.sku) || 0) + 1);
    for (const [sku, n] of seen) {
      if (n > 1) notes.push({ sku: sku, text: "appears " + n + " times; each row is placed separately" });
    }

    return {
      ok: true,
      fileName: fileName,
      sheetName: best.sheetName,
      headerRow: best.headerRow + 1,
      map: best.map,
      headers: (best.rows[best.headerRow] || []).map(toText),
      missing: missing,
      skus: skus,
      notes: notes,
      ignored: ignored,
    };
  }

  function widths(aoa) {
    const cols = [];
    for (const row of aoa) {
      row.forEach(function (v, i) {
        const len = String(v === null || v === undefined ? "" : v).length;
        cols[i] = Math.min(48, Math.max(cols[i] || 6, len + 2));
      });
    }
    return cols.map((w) => ({ wch: w }));
  }

  function sheet(aoa) {
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = widths(aoa);
    return ws;
  }

  // A blank sheet with the expected headers and two rows to show the shape.
  function template() {
    const aoa = [
      FIELDS.map((f) => f.label),
      ["Tier 1", "Wallet", "SKU-0001", 40, 1200, 60, 46.8, 42, 195],
      ["Tier 2", "Bag Small", "SKU-0002", 8, 300, 59, 46.5, 41, 30],
    ];
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet(aoa), "SKUs");
    XLSX.writeFile(book, "rack-import-template.xlsx");
  }

  function size(s) {
    return [s.length, s.width, s.height].map((n) => (n === null || n === undefined ? "?" : n)).join(" x ");
  }

  // Everything the floor needs: shelf by shelf in walking order, and SKU by
  // SKU with every shelf it went to.
  function putAway(skus, allocation, importInfo) {
    const shelves = [...allocation.locations.values()]
      .sort((a, b) => a.row - b.row || a.col - b.col || a.layer - b.layer);

    const byShelf = [["Location", "Row", "Column", "Layer", "SKU", "Category", "Tier", "Boxes", "Qty", "Box size (cm)", "Shelf fill %"]];
    for (const rec of shelves) {
      for (const sec of rec.sections) {
        const s = skus[sec.sku];
        const qty = s.qtyPerBox > 0 ? sec.qty : "";
        byShelf.push([rec.label, rec.row, rec.col, rec.layer, s.sku, s.category, s.tier,
          sec.boxes, qty, size(s), Math.round(rec.fill * 100)]);
      }
    }

    const WHY = {
      "too-big": "Box larger than a shelf",
      "no-size": "Box size missing",
      "no-location": "No location picked",
      "short": "Needs more shelves",
      "none-needed": "No boxes needed",
      "no-count": "No Qty per box",
    };
    // The SKU's numbers as they stand after any edits on the dashboard, so the
    // sheet can go straight back into the master list.
    const days = allocation.rules.days;
    const bySku = [["Tier", "Category", "SKU", "Sold per day", "Quantity", "Length", "Width", "Height", "Qty per box",
      "Needed qty (" + days + " days)", "Boxes needed", "Boxes placed", "Not placed", "Boxes per full shelf", "Locations", "Note"]];
    // In list order.
    const ordered = allocation.results.slice().sort((a, b) => a.order - b.order);
    for (const r of ordered) {
      const s = r.sku;
      bySku.push([s.tier, s.category, s.sku, s.soldPerDay, s.quantity, s.length, s.width, s.height, s.qtyPerBox,
        r.needed, r.problem === "no-count" ? "" : r.wanted, r.placed, r.unplaced, r.perShelf || "",
        r.spots.map((p) => p.label + " (" + p.boxes + ")").join(", "), r.problem ? WHY[r.problem] : ""]);
    }

    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet(byShelf), "Put-away");
    XLSX.utils.book_append_sheet(book, sheet(bySku), "By SKU");
    const day = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(book, "rack-putaway-" + day + ".xlsx");
  }

  // The variance report: SKUs short in 4KB and what 6K4 can send, those
  // short with nothing in 6K4, and SKUs over and the boxes to transfer to 6K4. `v` from the dashboard's variances().
  function variance(v, days) {
    const blank = (n) => (n === null || n === undefined ? "" : n);
    const need = (r) => Math.round(r.needed * 100) / 100;
    const short = [["SKU", "Category", "Tier", "4KB Qty", "Needed (" + days + " days)", "Short", "Qty per box",
      "Short (boxes)", "6K4 Qty", "6K4 boxes", "Bring from 6K4 (boxes)", "What to do"]];
    for (const x of v.short) {
      const s = x.r.sku;
      short.push([s.sku, s.category, s.tier, blank(s.quantity), need(x.r), -x.diff, blank(x.perBox),
        blank(x.gapBoxes), blank(x.q6), blank(x.boxes6), blank(x.bring), x.note]);
    }
    const none = [short[0].slice()];
    for (const x of v.none) {
      const s = x.r.sku;
      none.push([s.sku, s.category, s.tier, blank(s.quantity), need(x.r), -x.diff, blank(x.perBox),
        blank(x.gapBoxes), blank(x.q6), blank(x.boxes6), "", x.note]);
    }
    const over = [["SKU", "Category", "Tier", "4KB Qty", "Needed (" + days + " days)", "Over", "Qty per box",
      "Transfer to 6K4 (boxes)", "Qty to transfer", "What to do"]];
    for (const x of v.over) {
      const s = x.r.sku;
      over.push([s.sku, s.category, s.tier, blank(s.quantity), need(x.r), x.diff, blank(x.perBox),
        blank(x.moveBoxes), x.moveBoxes ? x.moveQty : "", x.note]);
    }
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet(short), "Short in 4KB");
    XLSX.utils.book_append_sheet(book, sheet(none), "No stock in 6K4");
    XLSX.utils.book_append_sheet(book, sheet(over), "Over in 4KB");
    const day = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(book, "4kb-variance-" + day + ".xlsx");
  }

  return {
    variance: variance,
    available: () => typeof XLSX !== "undefined",
    FIELDS: FIELDS,
    parse: parse,
    template: template,
    putAway: putAway,
  };
})();
