// Who is using Rack Planner, and what they may do.
//
// Until an admin turns on "Require sign-in" (Accounts page) anyone with the
// link can use it, as before, and signing in is optional. Once it is on, the
// page shows nothing but the sign-in window until someone with an account
// signs in. Roles: admin (everything, including accounts), editor (change
// SKUs, shelves and rules), viewer (look only). The database enforces the
// same rules; this only keeps the page from offering what would be refused.
const Auth = (function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const ROLE_NAMES = { admin: "Admin", editor: "Editor", viewer: "Viewer" };

  let session = null;
  let account = null;
  let required = false;
  let hasAdmin = true;

  function role() {
    return account && !account.disabled ? account.role : null;
  }

  function canEdit() {
    const r = role();
    return r ? r !== "viewer" : !required;
  }

  // The Accounts page: admins, and anyone at all while there is no admin
  // yet, so the first one can be made.
  function canManage() {
    return role() === "admin" || !hasAdmin;
  }

  function name() {
    return (account && account.name) || (session && session.user.email) || "";
  }

  // --- the sign-in window -------------------------------------------------------

  function openSignIn(locked) {
    const d = $("authDialog");
    $("authCancel").hidden = !!locked;
    $("authLocked").hidden = !locked;
    $("authError").hidden = true;
    d.dataset.locked = locked ? "1" : "";
    if (!d.open) d.showModal();
    $("authEmail").focus();
  }

  $("authDialog").addEventListener("cancel", function (e) {
    if (this.dataset.locked) e.preventDefault();
  });
  $("authCancel").addEventListener("click", function () { $("authDialog").close(); });

  $("authForm").addEventListener("submit", async function (e) {
    e.preventDefault();
    const err = $("authError");
    const btn = $("authSubmit");
    err.hidden = true;
    btn.disabled = true;
    try {
      const c = DB.client();
      const { data, error } = await c.auth.signInWithPassword({
        email: $("authEmail").value.trim(), password: $("authPassword").value,
      });
      if (error) throw new Error(error.message === "Invalid login credentials" ? "Wrong email or password." : error.message);
      const mine = await DB.accounts.mine(data.user.id);
      if (!mine || mine.disabled) {
        await c.auth.signOut();
        throw new Error(mine ? "This account is disabled. Ask an admin." : "This sign-in has no Rack Planner account. Ask an admin.");
      }
      // Everything on the page was loaded as somebody else: start again.
      location.reload();
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
      btn.disabled = false;
    }
  });

  // --- the account button in the top bar -----------------------------------------

  function renderButton() {
    const btn = $("acctBtn");
    btn.hidden = !DB.configured();
    if (role()) {
      btn.textContent = name();
      btn.title = name() + " · " + ROLE_NAMES[role()];
    } else {
      btn.textContent = "Sign in";
      btn.title = "Sign in to Rack Planner";
    }
    $("acctNav").hidden = !canManage();
    document.body.classList.toggle("read-only", !canEdit());
    document.body.classList.toggle("is-admin", role() === "admin");
    $("ruleDays").readOnly = !canEdit();
    if (!canEdit()) $("skuStatus").textContent = "Read only — your account can look, not change anything";
  }

  $("acctBtn").addEventListener("click", function () {
    if (!role()) { openSignIn(false); return; }
    $("meName").textContent = name();
    $("meEmail").textContent = session.user.email;
    $("meRole").textContent = ROLE_NAMES[role()];
    $("mePwError").hidden = true;
    $("mePwDone").hidden = true;
    $("meForm").reset();
    $("meDialog").showModal();
  });
  $("meClose").addEventListener("click", function () { $("meDialog").close(); });

  $("meSignOut").addEventListener("click", async function () {
    await DB.client().auth.signOut();
    location.reload();
  });

  $("meForm").addEventListener("submit", async function (e) {
    e.preventDefault();
    const err = $("mePwError");
    const done = $("mePwDone");
    err.hidden = true;
    done.hidden = true;
    const pw = $("mePw").value;
    if (pw.length < 8) { err.textContent = "The password needs at least 8 characters."; err.hidden = false; return; }
    if (pw !== $("mePw2").value) { err.textContent = "The two passwords are not the same."; err.hidden = false; return; }
    const { error } = await DB.client().auth.updateUser({ password: pw });
    if (error) { err.textContent = error.message; err.hidden = false; return; }
    $("meForm").reset();
    done.hidden = false;
  });

  // --- start ------------------------------------------------------------------------

  // Resolves once the page may load; never, while it is locked and nobody
  // has signed in (signing in reloads the page).
  async function start() {
    if (!DB.configured() || !DB.client()) { renderButton(); return; }
    try {
      const got = await DB.client().auth.getSession();
      session = got.data.session;
      const answers = await Promise.all([DB.settings.requireSignIn(), DB.accounts.hasAdmin()]);
      required = answers[0];
      hasAdmin = answers[1];
      if (session) account = await DB.accounts.mine(session.user.id);
    } catch (e) {
      console.error(e);
    }
    renderButton();
    if (required && !role()) {
      document.body.classList.add("locked");
      openSignIn(true);
      return new Promise(function () {});
    }
  }

  return {
    start: start,
    role: role,
    canEdit: canEdit,
    canManage: canManage,
    isAdmin: () => role() === "admin",
    required: () => required,
    hasAdmin: () => hasAdmin,
    userId: () => (session ? session.user.id : null),
    signIn: () => openSignIn(false),
    ROLE_NAMES: ROLE_NAMES,
  };
})();
