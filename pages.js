// Which page is showing. The address keeps it (#racks for the 4KB racks,
// #racks-6k4, #variance, #calc, #accounts), so a bookmark or a refresh lands where you
// were. Both racks share one page, which switches zone. Nothing loads until
// Auth says the page may open.
const Pages = (function () {
  "use strict";

  // Each name, and the page it shows.
  const PAGES = { "racks": "racks", "racks-6k4": "racks", "variance": "racks", "calc": "calc", "accounts": "accounts" };
  const ZONE = { "racks": "4kb", "racks-6k4": "6k4", "variance": "4kb" };

  function show(name) {
    if (!PAGES[name] || (name === "accounts" && !Auth.canManage())) name = "racks";
    ["racks", "calc", "accounts"].forEach(function (n) {
      document.getElementById("page-" + n).hidden = n !== PAGES[name];
    });
    document.querySelectorAll(".nav-btn").forEach((b) => b.classList.toggle("on", b.dataset.page === name));
    if (location.hash !== "#" + name) history.replaceState(null, "", "#" + name);
    if (ZONE[name]) {
      Dashboard.setZone(ZONE[name]);
      Dashboard.shown();
    }
    // The Variance report is 4KB's page with the report over it.
    Dashboard.variancePage(name === "variance");
    Accounts.shown(name === "accounts");
  }

  document.querySelectorAll(".nav-btn").forEach((b) => b.addEventListener("click", () => show(b.dataset.page)));
  document.querySelectorAll("[data-goto]").forEach((b) => b.addEventListener("click", () => show(b.dataset.goto)));
  window.addEventListener("hashchange", () => show(location.hash.slice(1)));

  Auth.start().then(function () {
    show(location.hash.slice(1) || "racks");
    Dashboard.start();
    // Opened already reads it; otherwise have it ready for when it is.
    if (document.getElementById("page-accounts").hidden) Accounts.prefetch();
  });

  return { show: show };
})();
