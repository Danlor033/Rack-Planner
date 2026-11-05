// The Accounts page: who can sign in to Rack Planner and as what, whether
// signing in is required, and the laptops whose Chrome keeps the 4KB Qty in
// step with JSTERP.
const Accounts = (function () {
  "use strict";

  // The extension's version in extension/manifest.json, which is also the one
  // in extension-pack.js (tools/pack_extension.py checks they agree).
  const EXT_VERSION = "1.1.0";
  // A laptop that has not checked in for this long is taken to be off.
  const OFFLINE = 2 * 60 * 1000;
  const REFRESH = 15 * 1000;

  const $ = (id) => document.getElementById(id);
  const el = {
    boot: $("acctBoot"), bootForm: $("bootForm"), bootError: $("bootError"),
    people: $("acctPeople"), peopleTable: $("peopleTable"), peopleNote: $("peopleNote"), personAdd: $("personAdd"),
    access: $("acctAccess"), accessText: $("accessText"), accessBtn: $("accessBtn"),
    laptops: $("laptopTable"), laptopSum: $("laptopSum"), download: $("extDownload"),
    note: $("acctNote"),
    dialog: $("acctDialog"), dForm: $("acctForm"), dTitle: $("acctFormTitle"), dBody: $("acctFormBody"),
    dError: $("acctFormError"), dSave: $("acctFormSave"), dCancel: $("acctFormCancel"),
    aDialog: $("accessDialog"), aTitle: $("accessTitle"), aBody: $("accessBody"), aError: $("accessError"),
    aYes: $("accessYes"), aNo: $("accessNo"),
  };

  let people = [];
  let laptops = [];
  let timer = null;
  // The server's clock minus this PC's: laptops' times are the server's, and a
  // PC whose clock is a minute out would call a laptop offline that is not.
  let skew = 0;
  const now = () => Date.now() + skew;

  const esc = (s) => String(s === null || s === undefined ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  function ago(iso) {
    if (!iso) return "never";
    const sec = Math.max(0, Math.round((now() - new Date(iso).getTime()) / 1000));
    if (sec < 60) return sec + " s ago";
    const min = Math.round(sec / 60);
    if (min < 60) return min + " min ago";
    const h = Math.round(min / 60);
    return h < 48 ? h + " h ago" : Math.round(h / 24) + " days ago";
  }

  function say(text, bad) {
    el.note.textContent = text || "";
    el.note.hidden = !text;
    el.note.classList.toggle("bad-text", !!bad);
  }

  // --- a small form in a window, for adding a person or a new password ----------

  let formDone = null;
  function form(title, fields, saveText, onSave) {
    el.dTitle.textContent = title;
    el.dBody.innerHTML = fields.map(function (f) {
      const input = f.options
        ? '<select name="' + f.name + '">' + f.options.map((o) =>
          '<option value="' + o[0] + '"' + (o[0] === f.value ? " selected" : "") + ">" + esc(o[1]) + "</option>").join("") + "</select>"
        : '<input name="' + f.name + '" type="' + (f.type || "text") + '" autocomplete="' + (f.auto || "off") + '"' +
          (f.value ? ' value="' + esc(f.value) + '"' : "") + (f.required ? " required" : "") + " />";
      return '<label class="field"><span>' + esc(f.label) + "</span>" + input +
        (f.hint ? '<small class="sub">' + esc(f.hint) + "</small>" : "") + "</label>";
    }).join("");
    el.dSave.textContent = saveText;
    el.dSave.disabled = false;
    el.dError.hidden = true;
    formDone = onSave;
    el.dialog.showModal();
    const first = el.dBody.querySelector("input, select");
    if (first) first.focus();
  }

  el.dCancel.addEventListener("click", function () { el.dialog.close(); });
  el.dForm.addEventListener("submit", async function (e) {
    e.preventDefault();
    const values = {};
    new FormData(el.dForm).forEach((v, k) => { values[k] = typeof v === "string" ? v.trim() : v; });
    el.dSave.disabled = true;
    el.dError.hidden = true;
    try {
      await formDone(values);
      el.dialog.close();
    } catch (ex) {
      el.dError.textContent = ex.message;
      el.dError.hidden = false;
      el.dSave.disabled = false;
    }
  });

  // --- the first admin ----------------------------------------------------------------

  el.bootForm.addEventListener("submit", async function (e) {
    e.preventDefault();
    const f = new FormData(el.bootForm);
    const email = String(f.get("email")).trim();
    const password = String(f.get("password"));
    el.bootError.hidden = true;
    try {
      if (password !== String(f.get("password2"))) throw new Error("The two passwords are not the same.");
      await DB.accounts.call("bootstrap", { name: String(f.get("name")).trim(), email: email, password: password });
      const { error } = await DB.client().auth.signInWithPassword({ email: email, password: password });
      if (error) throw error;
      location.reload();
    } catch (ex) {
      el.bootError.textContent = ex.message;
      el.bootError.hidden = false;
    }
  });

  // --- people ---------------------------------------------------------------------------

  const ROLE_OPTIONS = [["admin", "Admin — everything, and accounts"], ["editor", "Editor — change SKUs and shelves"],
    ["viewer", "Viewer — look only"]];

  async function loadPeople() {
    if (!Auth.isAdmin()) { people = []; return; }
    people = (await DB.accounts.call("list")).accounts;
  }

  function renderPeople() {
    el.people.hidden = !Auth.isAdmin();
    if (el.people.hidden) return;
    const me = Auth.userId();
    el.peopleTable.innerHTML = "<thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Last sign-in</th><th></th></tr></thead><tbody>" +
      people.map(function (p) {
        const self = p.user_id === me;
        return '<tr class="' + (p.disabled ? "off" : "") + '">' +
          "<td><b>" + esc(p.name || "") + "</b>" + (self ? ' <span class="tag">you</span>' : "") +
          (p.disabled ? ' <span class="tag bad">disabled</span>' : "") + "</td>" +
          "<td>" + esc(p.email) + "</td>" +
          '<td><select data-role="' + p.user_id + '"' + (self ? ' disabled title="Another admin can change your role"' : "") + ">" +
          ROLE_OPTIONS.map((o) => '<option value="' + o[0] + '"' + (o[0] === p.role ? " selected" : "") + ">" + Auth.ROLE_NAMES[o[0]] + "</option>").join("") +
          "</select></td>" +
          '<td class="sub">' + ago(p.last_sign_in_at) + "</td>" +
          '<td class="acts"><button type="button" class="ghost small" data-pw="' + p.user_id + '">New password</button>' +
          (self ? "" : '<button type="button" class="ghost small" data-disable="' + p.user_id + '">' + (p.disabled ? "Enable" : "Disable") + "</button>" +
            '<button type="button" class="ghost small danger" data-remove="' + p.user_id + '">Remove</button>') + "</td></tr>";
      }).join("") + "</tbody>";
    el.peopleNote.textContent = people.length + " account" + (people.length === 1 ? "" : "s") + ". " +
      "Each person signs in with their email and the password you give them, and can change it under their name, top right.";
  }

  el.personAdd.addEventListener("click", function () {
    form("Add a person", [
      { name: "name", label: "Name", required: true },
      { name: "email", label: "Email", type: "email", required: true },
      { name: "role", label: "Role", options: ROLE_OPTIONS, value: "editor" },
      { name: "password", label: "Password to start with", type: "text", required: true,
        hint: "At least 8 characters. Tell them, and they can change it after signing in." },
    ], "Add", async function (v) {
      await DB.accounts.call("create", v);
      await refresh();
      say(v.name + " can now sign in with " + v.email + ".");
    });
  });

  el.peopleTable.addEventListener("change", async function (e) {
    const sel = e.target.closest("select[data-role]");
    if (!sel) return;
    try {
      await DB.accounts.call("update", { user_id: sel.dataset.role, role: sel.value });
      say("Role changed.");
    } catch (ex) {
      say(ex.message, true);
    }
    await refresh();
  });

  el.peopleTable.addEventListener("click", async function (e) {
    const btn = e.target.closest("button");
    if (!btn) return;
    const id = btn.dataset.pw || btn.dataset.disable || btn.dataset.remove;
    const p = people.find((x) => x.user_id === id);
    if (!p) return;
    try {
      if (btn.dataset.pw) {
        form("New password for " + (p.name || p.email), [
          { name: "password", label: "New password", type: "text", required: true, hint: "At least 8 characters." },
        ], "Save", async function (v) {
          await DB.accounts.call("set_password", { user_id: id, password: v.password });
          say("Password changed for " + (p.name || p.email) + ".");
        });
        return;
      }
      if (btn.dataset.disable) {
        await DB.accounts.call("update", { user_id: id, disabled: !p.disabled });
        say((p.name || p.email) + (p.disabled ? " can sign in again." : " can no longer sign in."));
      } else {
        if (!confirm("Remove " + (p.name || p.email) + "'s account? They will not be able to sign in.")) return;
        await DB.accounts.call("delete", { user_id: id });
        say((p.name || p.email) + " was removed.");
      }
      await refresh();
    } catch (ex) {
      say(ex.message, true);
    }
  });

  // --- require sign-in ---------------------------------------------------------------

  function renderAccess() {
    el.access.hidden = !Auth.isAdmin();
    if (el.access.hidden) return;
    const on = Auth.required();
    el.accessText.innerHTML = on
      ? "<b>Sign-in is required.</b> Only people with an account can open Rack Planner. Laptops sync only once approved below."
      : "<b>Rack Planner is open to anyone with the link</b>, as it always was: signing in is optional, and anyone can change things. " +
        "Turn this on once everybody who needs it has an account.";
    el.accessBtn.textContent = on ? "Let anyone open it again" : "Require sign-in";
    el.accessBtn.className = on ? "ghost" : "primary";
  }

  // What turning sign-in on or off will do, in a window over the page, with
  // anything that will stop working spelled out before anyone says yes.
  function accessBody(on) {
    if (!on) {
      return "<p>Anyone with the link will be able to open Rack Planner again <b>and change things</b>, " +
        "without signing in. Accounts stay as they are.</p>" +
        '<p class="sub">Laptops sync whether or not they are approved.</p>';
    }
    const count = (r) => people.filter((p) => p.role === r && !p.disabled).length;
    const waiting = laptops.filter((d) => !d.approved);
    const approved = laptops.length - waiting.length;
    let html = "<p>Only people with an account will be able to open Rack Planner, on every PC and on the " +
      "online copy. Anyone else sees only the sign-in window.</p>" +
      '<ul class="ask-list">' +
      "<li><b>" + count("admin") + "</b> admin, <b>" + count("editor") + "</b> editor, <b>" + count("viewer") +
      "</b> viewer account" + (people.length === 1 ? "" : "s") + " can sign in.</li>" +
      "<li><b>" + approved + "</b> of " + laptops.length + " sync laptop" + (laptops.length === 1 ? "" : "s") +
      " approved.</li></ul>";
    if (waiting.length) {
      html += '<p class="access-warn">' + (approved ? "" : "<b>The 4KB Qty will stop updating.</b> ") +
        "These laptops are not approved and will stop syncing: <b>" + waiting.map((d) => esc(d.name)).join(", ") +
        "</b>. Approve them first if they should keep going.</p>";
    }
    html += '<p class="sub">Anyone with the page open is asked to sign in on their next refresh.</p>';
    return html;
  }

  el.accessBtn.addEventListener("click", function () {
    const on = !Auth.required();
    el.aTitle.textContent = on ? "Require sign-in?" : "Let anyone open Rack Planner?";
    el.aBody.innerHTML = accessBody(on);
    el.aYes.textContent = on ? "Require sign-in" : "Let anyone open it";
    el.aError.hidden = true;
    el.aYes.disabled = false;
    el.aDialog.showModal();
    el.aNo.focus();
  });
  el.aNo.addEventListener("click", function () { el.aDialog.close(); });
  el.aDialog.addEventListener("click", function (e) {
    if (e.target === el.aDialog) el.aDialog.close();
  });
  el.aYes.addEventListener("click", async function () {
    el.aYes.disabled = true;
    try {
      await DB.settings.setRequireSignIn(!Auth.required());
      location.reload();
    } catch (ex) {
      el.aError.textContent = ex.message;
      el.aError.hidden = false;
      el.aYes.disabled = false;
    }
  });

  // --- sync laptops ----------------------------------------------------------------------

  function laptopState(d) {
    const seen = d.last_seen ? now() - new Date(d.last_seen).getTime() : Infinity;
    if (seen > OFFLINE) return ["off", "Offline", "Chrome is closed, or the laptop is off or asleep"];
    if (d.paused) return ["off", "Paused", "Paused here; it checks in but does not sync"];
    if (d.mode === "pending") return ["warn", "Waiting for approval", "Sign-in is required, so it syncs only once approved"];
    if (d.jst_ok === false) return ["bad", "JSTERP signed out", d.jst_message || "Sign in to JSTERP in this laptop's Chrome"];
    const synced = d.last_sync_at ? now() - new Date(d.last_sync_at).getTime() : Infinity;
    if (d.mode === "sync" && synced < 90 * 1000) return ["good", "Syncing", "This one is reading JSTERP every 30 seconds"];
    if (d.mode === "standby") return ["info", "Standby", "Signed in to JSTERP; takes over within a minute if the syncing laptop stops"];
    return ["warn", "Starting", ""];
  }

  function older(v) {
    const a = String(v || "0").split(".").map(Number);
    const b = EXT_VERSION.split(".").map(Number);
    for (let i = 0; i < 3; i++) if ((a[i] || 0) !== b[i]) return (a[i] || 0) < b[i];
    return false;
  }

  function renderLaptops() {
    const manage = Auth.isAdmin() || !Auth.required();
    el.laptops.innerHTML = "<thead><tr><th>Laptop</th><th>JSTERP account</th><th>Status</th><th>Last check-in</th>" +
      "<th>Last sync</th><th>Extension</th><th></th></tr></thead><tbody>" +
      (laptops.length ? laptops.map(function (d) {
        const st = laptopState(d);
        return "<tr>" +
          "<td>" + (manage ? '<input class="cell-in name-in" data-rename="' + d.id + '" value="' + esc(d.name) + '" title="Rename" />' : "<b>" + esc(d.name) + "</b>") +
          (d.platform ? '<small class="sub block">' + esc(d.platform) + "</small>" : "") + "</td>" +
          "<td>" + (d.jst_user ? esc(d.jst_user) : '<span class="sub">—</span>') + "</td>" +
          '<td><span class="state ' + st[0] + '" title="' + esc(st[2]) + '">' + st[1] + "</span>" +
          (d.approved ? "" : ' <span class="tag" title="Needed once sign-in is required">not approved</span>') + "</td>" +
          '<td class="sub">' + ago(d.last_seen) + "</td>" +
          '<td class="sub">' + ago(d.last_sync_at) + (d.last_sync_at && d.last_changed ? " · " + d.last_changed + " changed" : "") + "</td>" +
          "<td>" + esc(d.version || "?") + (older(d.version) ? ' <span class="tag warn" title="Download the new one below, replace the files, and reload it in chrome://extensions">update</span>' : "") + "</td>" +
          '<td class="acts">' + (manage
            ? (d.approved ? "" : '<button type="button" class="primary small" data-approve="' + d.id + '">Approve</button>') +
              '<button type="button" class="ghost small" data-pause="' + d.id + '">' + (d.paused ? "Resume" : "Pause") + "</button>" +
              '<button type="button" class="ghost small danger" data-forget="' + d.id + '">Remove</button>'
            : "") + "</td></tr>";
      }).join("") : '<tr><td colspan="7" class="sub">No laptop has the extension yet.</td></tr>') + "</tbody>";

    const ready = laptops.filter((d) => ["good", "info"].indexOf(laptopState(d)[0]) >= 0);
    const syncing = laptops.find((d) => laptopState(d)[0] === "good");
    el.laptopSum.innerHTML = !laptops.length ? "Install the extension on a laptop to start."
      : (syncing ? "<b>" + esc(syncing.name) + "</b> is syncing. " : "<b>No laptop is syncing right now.</b> ") +
        ready.length + " of " + laptops.length + " laptop" + (laptops.length === 1 ? "" : "s") + " ready. " +
        "One syncs at a time; if it stops, another that is ready takes over within a minute.";
    el.laptopSum.classList.toggle("bad-text", !!laptops.length && !syncing);
  }

  el.laptops.addEventListener("change", async function (e) {
    const input = e.target.closest("input[data-rename]");
    if (!input) return;
    const name = input.value.trim();
    if (!name) { renderLaptops(); return; }
    try {
      await DB.devices.update(input.dataset.rename, { name: name });
      say("Renamed to " + name + ".");
    } catch (ex) {
      say(ex.message, true);
    }
    await refresh();
  });

  el.laptops.addEventListener("click", async function (e) {
    const btn = e.target.closest("button");
    if (!btn) return;
    const id = btn.dataset.approve || btn.dataset.pause || btn.dataset.forget;
    const d = laptops.find((x) => x.id === id);
    if (!d) return;
    try {
      if (btn.dataset.approve) await DB.devices.update(id, { approved: true });
      else if (btn.dataset.pause) await DB.devices.update(id, { paused: !d.paused });
      else {
        if (!confirm("Remove " + d.name + " from the list? If its Chrome still has the extension it comes back as a new laptop, not approved.")) return;
        await DB.devices.remove(id);
      }
      say("");
      await refresh();
    } catch (ex) {
      say(ex.message, true);
    }
  });

  // --- the extension, as a zip ---------------------------------------------------------

  // The extension's files come from extension-pack.js, made by
  // tools/pack_extension.py: the online copy only serves files at the top of
  // the folder, so the extension folder itself cannot be fetched.
  function loadPack() {
    if (window.EXTENSION_PACK) return Promise.resolve(window.EXTENSION_PACK);
    return new Promise(function (resolve, reject) {
      const s = document.createElement("script");
      s.src = "extension-pack.js?v=" + EXT_VERSION;
      s.onload = () => (window.EXTENSION_PACK ? resolve(window.EXTENSION_PACK) : reject(new Error("The extension file is empty.")));
      s.onerror = () => reject(new Error("Could not load the extension."));
      document.head.appendChild(s);
    });
  }

  const CRC = (function () {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  // A zip with every file stored as it is, inside one folder.
  function zip(folder, files) {
    const enc = new TextEncoder();
    const parts = [];
    const central = [];
    let offset = 0;
    for (const f of files) {
      const name = enc.encode(folder + "/" + f.name);
      const crc = crc32(f.data);
      const local = new DataView(new ArrayBuffer(30));
      // 33: 1 January 1980, the earliest date a zip can hold.
      local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(12, 33, true);
      local.setUint32(14, crc, true); local.setUint32(18, f.data.length, true); local.setUint32(22, f.data.length, true);
      local.setUint16(26, name.length, true);
      parts.push(local, name, f.data);
      const dir = new DataView(new ArrayBuffer(46));
      dir.setUint32(0, 0x02014b50, true); dir.setUint16(4, 20, true); dir.setUint16(6, 20, true); dir.setUint16(14, 33, true);
      dir.setUint32(16, crc, true); dir.setUint32(20, f.data.length, true); dir.setUint32(24, f.data.length, true);
      dir.setUint16(28, name.length, true); dir.setUint32(42, offset, true);
      central.push(dir, name);
      offset += 30 + name.length + f.data.length;
    }
    const size = central.reduce((n, p) => n + p.byteLength, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, size, true); end.setUint32(16, offset, true);
    return new Blob(parts.concat(central, [end]), { type: "application/zip" });
  }

  el.download.addEventListener("click", async function () {
    try {
      const pack = await loadPack();
      const files = Object.keys(pack.files).sort().map((name) => ({
        name: name, data: Uint8Array.from(atob(pack.files[name]), (ch) => ch.charCodeAt(0)),
      }));
      const a = document.createElement("a");
      a.href = URL.createObjectURL(zip("rack-planner-4kb-sync", files));
      a.download = "rack-planner-4kb-sync-" + pack.version + ".zip";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    } catch (ex) {
      say(ex.message, true);
    }
  });

  // --- the page --------------------------------------------------------------------------

  async function refresh() {
    try {
      const asked = Date.now();
      const got = await Promise.all([DB.devices.list(), loadPeople(), DB.rpc("rack_now")]);
      laptops = got[0];
      skew = new Date(got[2]).getTime() - (asked + Date.now()) / 2;
    } catch (ex) {
      say(ex.message, true);
    }
    el.boot.hidden = Auth.hasAdmin();
    renderPeople();
    renderAccess();
    renderLaptops();
  }

  // Called by Pages when the page is opened or left.
  function shown(on) {
    clearInterval(timer);
    if (!on) return;
    refresh();
    timer = setInterval(function () { if (!document.hidden) refresh(); }, REFRESH);
  }

  return { shown: shown, EXT_VERSION: EXT_VERSION };
})();
