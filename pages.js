// Which page is showing. The address keeps it (#racks, #calc, #accounts), so
// a bookmark or a refresh lands where you were. Nothing loads until Auth says
// the page may open.
const Pages = (function () {
  "use strict";

  const NAMES = ["racks", "calc", "accounts"];

  function show(name) {
    if (NAMES.indexOf(name) < 0 || (name === "accounts" && !Auth.canManage())) name = "racks";
    NAMES.forEach(function (n) {
      document.getElementById("page-" + n).hidden = n !== name;
    });
    document.querySelectorAll(".nav-btn").forEach((b) => b.classList.toggle("on", b.dataset.page === name));
    if (location.hash !== "#" + name) history.replaceState(null, "", "#" + name);
    if (name === "racks") Dashboard.shown();
    Accounts.shown(name === "accounts");
  }

  document.querySelectorAll(".nav-btn").forEach((b) => b.addEventListener("click", () => show(b.dataset.page)));
  document.querySelectorAll("[data-goto]").forEach((b) => b.addEventListener("click", () => show(b.dataset.goto)));
  window.addEventListener("hashchange", () => show(location.hash.slice(1)));

  Auth.start().then(function () {
    show(location.hash.slice(1) || "racks");
    Dashboard.start();
  });

  return { show: show };
})();
