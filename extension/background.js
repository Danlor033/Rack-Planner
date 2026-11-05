// 4KB Qty from JSTERP, every 30 seconds, with no tab open.
//
// This runs in Chrome itself, using the JSTERP sign-in of the Chrome it is
// installed in, for as long as that Chrome is open. Several laptops can have
// it. Every 30 seconds each one checks in with Rack Planner, which answers
// whose turn it is: one laptop reads Warehouse > Zone Inventory -- owner
// Shigetsu, Main Warehouse, start position 4KB, then the other zones Rack
// Planner names (6K4 storage) -- and sends the quantities;
// the others only make sure they are still signed in to JSTERP, ready to take
// over within a minute if it stops. Each laptop is on Rack Planner's
// Accounts page, where an admin can rename, approve or pause it.
"use strict";

const SUPABASE_URL = "https://zvzeojcdjafzqunzladl.supabase.co";
const SUPABASE_KEY = "sb_publishable_ycQbkzbjsiDtitEhZIjvMQ_fGdch1Qp";
const STOCK_URL = "https://asia.jsterp.com/wms/Pack/GetPackItemsPages";
const JST_HOME = "https://asia.jsterp.com/";
const SIGN_IN_URL = "https://asia-web.jsterp.com/";
const ALARM = "sync";
const EVERY_MINUTES = 0.5;

// The Zone Inventory filters, as JSTERP sends them: owner Shigetsu
// (LinkCoIds / LinkWarehouseIds), warehouse area Main, start position 4KB,
// stock above zero only.
const FILTER = {
  SkuIds: [], ItemIds: [], LinkWarehouseIds: ["3948"], LinkCoIds: [12697134],
  WarehouseId: 3938, BinTypes: [], AreaTypes: ["Main"], ShowZeroType: "AllNoZero",
  Keywords: [], PackItemIds: [], BinStart: "4KB",
};

class SignedOut extends Error {}

// The other zones come from Rack Planner at each check-in, as
// { key, bin, binTypes, areas }: 6K4 storage, for now. Changing one there
// needs no new extension.
function zoneFilter(zone) {
  return Object.assign({}, FILTER, {
    BinStart: zone.bin,
    BinTypes: Array.isArray(zone.binTypes) ? zone.binTypes : [],
    AreaTypes: Array.isArray(zone.areas) && zone.areas.length ? zone.areas : FILTER.AreaTypes,
  });
}

// --- JSTERP -------------------------------------------------------------------

async function stockPage(page, size, filter) {
  const res = await fetch(STOCK_URL, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ RequestModel: filter || FILTER, DataPage: { pageSize: size, pageIndex: page } }),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) { /* the sign-in page, not data */ }
  if (!res.ok || !json || !Array.isArray(json.Data)) {
    throw new SignedOut("JSTERP did not send the stock list -- signed out? Sign in to JSTERP in this Chrome.");
  }
  return json;
}

// Every row of one filtered list, all pages, added up per SKU.
async function readZone(filter) {
  const rows = [];
  for (let page = 1; page < 50; page++) {
    const json = await stockPage(page, 1000, filter);
    rows.push.apply(rows, json.Data);
    if (!json.DataPage || json.DataPage.IsLast || !json.Data.length) break;
  }
  // Start position already narrows it; this keeps anything else out should
  // JSTERP ever read it as "from here onwards".
  const start = String(filter.BinStart).toUpperCase();
  const qty = {};
  for (const r of rows) {
    if (String(r.Bin || "").toUpperCase().indexOf(start) !== 0) continue;
    const sku = String(r.SkuId || "").trim().toLowerCase();
    if (!sku) continue;
    qty[sku] = (qty[sku] || 0) + (Number(r.Qty) || 0);
  }
  return { qty: qty, rows: rows.length };
}

// 4KB, then each other zone. 4KB has to come back; a zone that fails only
// keeps its old numbers, and says so.
async function readStock(zones) {
  const stock = await readZone(FILTER);
  // Nobody runs 4KB down to nothing: an empty list is a fault at JSTERP, and
  // taking it at its word would zero every SKU in Rack Planner.
  if (!stock.rows) throw new Error("JSTERP sent an empty stock list, so 4KB Qty was left as it is.");
  stock.zones = {};
  stock.zoneErrors = [];
  for (const zone of zones || []) {
    try {
      stock.zones[zone.key] = (await readZone(zoneFilter(zone))).qty;
    } catch (e) {
      if (e instanceof SignedOut) throw e;
      stock.zoneErrors.push(zone.bin + ": " + e.message);
    }
  }
  return stock;
}

// Waiting laptops ask for one row: enough to know the sign-in still works,
// and to keep it from running out.
async function checkSignedIn() {
  await stockPage(1, 1);
}

// Who this Chrome is signed in to JSTERP as, from JSTERP's own cookies.
// Null in a Chrome that loaded this before the cookies permission was added:
// it reads its new code from the folder without reloading the manifest.
async function jstUser() {
  if (!chrome.cookies) return null;
  const get = (name) => chrome.cookies.get({ url: JST_HOME, name: name }).then((c) => (c ? decodeURIComponent(c.value) : ""));
  const [name, login] = await Promise.all([get("u_name"), get("u_login_id")]);
  return name && login && name !== login ? name + " (" + login + ")" : name || login || null;
}

// --- Rack Planner (Supabase) -----------------------------------------------------

async function rpc(name, args) {
  const res = await fetch(SUPABASE_URL + "/rest/v1/rpc/" + name, {
    method: "POST",
    headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  const text = await res.text();
  if (!res.ok) {
    let message = text;
    try { message = JSON.parse(text).message || text; } catch (e) { /* plain text */ }
    throw new Error(String(message).slice(0, 160));
  }
  return text ? JSON.parse(text) : null;
}

// This laptop's key to Rack Planner, made the first time it runs. Rack
// Planner keeps only a hash of it.
async function secret() {
  const { secret } = await chrome.storage.local.get("secret");
  if (secret) return secret;
  const made = crypto.randomUUID() + crypto.randomUUID();
  await chrome.storage.local.set({ secret: made });
  return made;
}

function platform() {
  const ua = navigator.userAgentData;
  const os = ua && ua.platform ? ua.platform : navigator.platform;
  const brand = ua && ua.brands ? ua.brands.find((b) => /Chrome|Edge/.test(b.brand)) : null;
  return os + (brand ? " · " + brand.brand + " " + brand.version : "");
}

// --- what the toolbar button shows ---------------------------------------------

async function show(ok, text) {
  await chrome.storage.local.set({ last: { ok: ok, text: text, at: Date.now() } });
  await chrome.action.setBadgeText({ text: ok ? "" : "!" });
  await chrome.action.setBadgeBackgroundColor({ color: "#d64545" });
}

// Once when the sign-in goes, not every 30 seconds after it.
async function warnSignedOut(message) {
  const { warned } = await chrome.storage.local.get("warned");
  if (warned) return;
  await chrome.storage.local.set({ warned: true });
  chrome.notifications.create(ALARM, {
    type: "basic", iconUrl: "icon128.png",
    title: "Rack Planner 4KB sync stopped", message: message + " Click to sign in.",
    requireInteraction: true,
  });
}

chrome.notifications.onClicked.addListener(function () {
  chrome.tabs.create({ url: SIGN_IN_URL });
});

// --- one round --------------------------------------------------------------------

let busy = false;

async function round() {
  if (busy) return;
  busy = true;
  try {
    const key = await secret();
    // How JSTERP went last round travels with this check-in.
    const { jst } = await chrome.storage.local.get("jst");
    const turn = await rpc("jst_checkin", {
      p_secret: key, p_version: chrome.runtime.getManifest().version, p_platform: platform(),
      p_jst_user: await jstUser(), p_ok: jst ? jst.ok : null, p_message: jst ? jst.message || null : null,
    });
    await chrome.storage.local.set({ me: turn });
    if (turn.mode === "paused") {
      await show(true, "Paused on Rack Planner's Accounts page.");
      return;
    }

    let stock = null;
    try {
      if (turn.mode === "sync") stock = await readStock(turn.zones);
      else await checkSignedIn();
      await chrome.storage.local.set({ jst: { ok: true } });
      await chrome.storage.local.remove("warned");
    } catch (e) {
      await chrome.storage.local.set({ jst: { ok: false, message: e.message } });
      if (e instanceof SignedOut) await warnSignedOut(e.message);
      await show(false, e.message);
      return;
    }

    if (turn.mode === "sync") {
      const info = await rpc("jst_sync", { p_secret: key, p_stock: stock.qty, p_rows: stock.rows, p_zones: stock.zones });
      const z = (info.zones || {})["6k4"];
      await show(!stock.zoneErrors.length, "Syncing · " + info.skus + " SKUs, " + Number(info.units).toLocaleString() + " pcs in 4KB · " +
        (z ? Number(z.units).toLocaleString() + " pcs in 6K4 · " : "") +
        (info.changed ? info.changed + " updated" : "no change") +
        (info.notInPlannerCount ? " · " + info.notInPlannerCount + " not in Rack Planner" : "") +
        (stock.zoneErrors.length ? " · not read: " + stock.zoneErrors.join("; ") : ""));
    } else if (turn.mode === "standby") {
      await show(true, "Standby: another laptop is syncing. Signed in to JSTERP and ready to take over.");
    } else {
      await show(true, "Waiting for an admin to approve this laptop on Rack Planner's Accounts page.");
    }
  } catch (e) {
    console.error(e);
    await show(false, "Rack Planner: " + e.message);
  } finally {
    busy = false;
  }
}

// --- the timer --------------------------------------------------------------------

// An alarm wakes this worker even after Chrome has put it to sleep. Chrome
// keeps alarms across restarts, but one lost is a sync that silently stops,
// so every start checks.
async function keepTime() {
  if (!(await chrome.alarms.get(ALARM))) {
    await chrome.alarms.create(ALARM, { periodInMinutes: EVERY_MINUTES });
  }
}

chrome.alarms.onAlarm.addListener(function (alarm) {
  if (alarm.name === ALARM) round();
});
chrome.runtime.onInstalled.addListener(function () { keepTime(); round(); });
chrome.runtime.onStartup.addListener(function () { keepTime(); round(); });
chrome.runtime.onMessage.addListener(function (message, sender, reply) {
  if (message !== "sync-now") return false;
  round().then(function () { reply(true); });
  return true;
});
keepTime();
