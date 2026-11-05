// The toolbar button: which laptop this is, how the last round went, and a
// way to run one now.
"use strict";

const MODES = { sync: "syncing", standby: "standby", pending: "waiting for approval", paused: "paused" };

const dot = document.getElementById("dot");
const who = document.getElementById("who");
const text = document.getElementById("text");
const when = document.getElementById("when");
const now = document.getElementById("now");

async function render() {
  const { last, me } = await chrome.storage.local.get(["last", "me"]);
  who.textContent = me ? me.name + " · " + (MODES[me.mode] || me.mode) : "";
  if (!last) return;
  dot.className = last.ok ? "ok" : "bad";
  text.textContent = last.text;
  when.textContent = new Date(last.at).toLocaleTimeString() + " · every 30 seconds";
}

now.addEventListener("click", async function () {
  now.disabled = true;
  await chrome.runtime.sendMessage("sync-now");
  await render();
  now.disabled = false;
});

chrome.storage.onChanged.addListener(render);
render();
