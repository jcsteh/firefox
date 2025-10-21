/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

ChromeUtils.defineESModuleGetters(this, {
  AppConstants: "resource://gre/modules/AppConstants.sys.mjs",
  CustomKeys: "resource:///modules/CustomKeys.sys.mjs",
  ShortcutUtils: "resource://gre/modules/ShortcutUtils.sys.mjs",
});

const table = document.getElementById("table");
const topWin = window.browsingContext.topChromeWindow;

// Get keyboard shortcuts in the form: { categoryTitle: { keyId: keyTitle } }
// If categoryTitle or keyTitle begins with "customkeys-", it is a Fluent id.
function getKeys() {
  // Make Dev Tools populate the Browser Tools menu so we can gather those
  // shortcuts here.
  Services.obs.notifyObservers(topWin, "customkeys-ui-showing");

  const keys = {};
  // Gather as many keys as we can from the menu bar menus.
  const mainMenuBar = topWin.document.getElementById("main-menubar");
  for (const item of mainMenuBar.querySelectorAll("menuitem[key]")) {
    const menu = item.closest("menu");
    if (menu.id == "historyUndoMenu" || menu.id == "historyUndoWindowMenu") {
      // The reopen last tab/window commands have the label of the actual
      // tab/window they will reopen. We handle those specially later.
      continue;
    }
    if (!keys[menu.label]) {
      keys[menu.label] = {};
    }
    keys[menu.label][item.getAttribute("key")] = item.label;
  }

  // Add some shortcuts that aren't available in menus.
  const historyCat = topWin.document.getElementById("history-menu").label;
  Object.assign(keys[historyCat], {
    key_restoreLastClosedTabOrWindowOrSession: "customkeys-history-reopen-tab",
    key_undoCloseWindow: "customkeys-history-reopen-window",
  });
  const toolsCat = topWin.document.getElementById("browserToolsMenu").label;
  Object.assign(keys[toolsCat], {
    key_toggleToolboxF12: "customkeys-dev-tools",
    key_inspector: "customkeys-dev-inspector",
    key_webconsole: "customkeys-dev-webconsole",
    key_jsdebugger: "customkeys-dev-debugger",
    key_netmonitor: "customkeys-dev-network",
    key_styleeditor: "customkeys-dev-style",
    key_performance: "customkeys-dev-performance",
    key_storage: "customkeys-dev-storage",
    key_dom: "customkeys-dev-dom",
    key_accessibility: "customkeys-dev-accessibility",
    key_profilerStartStop: "customkeys-dev-profiler-toggle",
    key_profilerStartStopAlternate: "customkeys-dev-profiler-toggle",
    key_profilerCapture: "customkeys-dev-profiler-capture",
    key_profilerCaptureAlternate: "customkeys-dev-profiler-capture",
  });
  keys["customkeys-category-navigation"] = {
    goBackKb: "customkeys-nav-back",
    goForwardKb: "customkeys-nav-forward",
    goHome: "customkeys-nav-home",
    key_reload: "customkeys-nav-reload",
    key_reload2: "customkeys-nav-reload",
    key_reload_skip_cache: "customkeys-nav-reload-skip-cache",
    key_reload_skip_cache2: "customkeys-nav-reload-skip-cache",
    key_stop: "customkeys-nav-stop",
  };

  return keys;
}

function setTextContent(element, content) {
  if (content.startsWith("customkeys-")) {
    element.setAttribute("data-l10n-id", content);
  } else {
    element.textContent = content;
  }
}

function buildTable() {
  const keys = getKeys();
  for (const category in keys) {
    const tbody = document.createElement("tbody");
    table.append(tbody);
    let row = document.createElement("tr");
    row.className = "category";
    tbody.append(row);
    let cell = document.createElement("td");
    row.append(cell);
    cell.setAttribute("colspan", 5);
    const heading = document.createElement("h1");
    setTextContent(heading, category);
    cell.append(heading);
    const categoryKeys = keys[category];
    for (const keyId in categoryKeys) {
      const keyEl = topWin.document.getElementById(keyId);
      if (!keyEl) {
        continue;
      }
      row = document.createElement("tr");
      row.className = "key";
      tbody.append(row);
      row.setAttribute("data-id", keyId);
      cell = document.createElement("th");
      setTextContent(cell, categoryKeys[keyId]);
      row.append(cell);
      cell = document.createElement("td");
      const shortcut = ShortcutUtils.prettifyShortcut(keyEl);
      cell.textContent = shortcut;
      row.append(cell);
      cell = document.createElement("td");
      let button = document.createElement("button");
      button.className = "change";
      button.setAttribute("data-l10n-id", "customkeys-change");
      cell.append(button);
      let label = document.createElement("label");
      label.className = "newLabel";
      let span = document.createElement("span");
      span.setAttribute("data-l10n-id", "customkeys-new-key");
      label.append(span);
      let input = document.createElement("input");
      input.className = "new";
      label.append(input);
      cell.append(label);
      row.append(cell);
      cell = document.createElement("td");
      button = document.createElement("button");
      button.className = "clear";
      button.setAttribute("data-l10n-id", "customkeys-clear");
      row.classList.toggle("assigned", !!shortcut);
      cell.append(button);
      row.append(cell);
      cell = document.createElement("td");
      button = document.createElement("button");
      button.className = "reset";
      button.setAttribute("data-l10n-id", "customkeys-reset");
      row.classList.toggle("customized", !!CustomKeys.getDefaultKey(keyId));
      cell.append(button);
      row.append(cell);
    }
  }
}

function prettifyShortcut(modifiers, key) {
  // ShortcutUtils.prettifyShortcut needs a key element, but we don't have
  // that here. Make a temporary one.
  const keyEl = document.createXULElement("key");
  keyEl.setAttribute("modifiers", modifiers);
  keyEl.setAttribute(key.length == 1 ? "key" : "keycode", key);
  return ShortcutUtils.prettifyShortcut(keyEl);
}

function updateKey(row) {
  const keyEl = topWin.document.getElementById(row.dataset.id);
  const shortcut = ShortcutUtils.prettifyShortcut(keyEl);
  row.children[1].textContent = shortcut;
  row.classList.toggle("customized", !!CustomKeys.getDefaultKey(keyEl.id));
  row.classList.toggle("assigned", !!shortcut);
}

// Returns false if the assignment should be cancelled.
async function maybeHandleConflict(keyId, modifiers, key) {
  const newShortcut = prettifyShortcut(modifiers, key);
  for (const row of table.querySelectorAll(".key")) {
    if (newShortcut != row.children[1].textContent) {
      continue; // Not a conflict.
    }
    const conflictId = row.dataset.id;
    if (conflictId == keyId) {
      // We're trying to assign this key to the shortcut it is already
      // assigned to. We don't need to do anything.
      return false;
    }
    const conflictDesc = row.children[0].textContent;
    if (
      window.confirm(
        await document.l10n.formatValue("customkeys-conflict-confirm", {
          conflict: conflictDesc,
        })
      )
    ) {
      // Clear the conflicting key.
      CustomKeys.changeKey(conflictId, "", "");
      updateKey(row);
      return true;
    }
    return false;
  }
  return true;
}

async function onAction(event) {
  const row = event.target.closest("tr");
  const keyId = row.dataset.id;
  if (event.target.className == "reset") {
    Glean.browserCustomkeys.actions.reset.add();
    const [modifiers, key] = CustomKeys.getDefaultKey(keyId);
    if (await maybeHandleConflict(keyId, modifiers, key)) {
      CustomKeys.resetKey(keyId);
      updateKey(row);
    }
  } else if (event.target.className == "change") {
    Glean.browserCustomkeys.actions.change.add();
    // The "editing" class will cause the Change button to be replaced by a
    // labelled input for the new key.
    row.classList.add("editing");
    row.querySelector(".new").focus();
  } else if (event.target.className == "clear") {
    Glean.browserCustomkeys.actions.clear.add();
    CustomKeys.changeKey(keyId, "", "");
    updateKey(row);
  }
}

async function onKey(event) {
  if (event.target.className != "new") {
    return;
  }
  const row = event.target.closest("tr");
  const keyId = row.dataset.id;
  event.preventDefault();
  event.stopPropagation();
  let modifiers = [];
  const isMac = AppConstants.platform == "macosx";
  if (event.altKey) {
    modifiers.push("Alt");
  }
  if (event.ctrlKey) {
    modifiers.push(isMac ? "MacCtrl" : "Ctrl");
  }
  if (isMac && event.metaKey) {
    modifiers.push("Command");
  }
  if (event.shiftKey) {
    modifiers.push("Shift");
  }
  modifiers = ShortcutUtils.getModifiersAttribute(modifiers);
  if (
    event.key == "Alt" ||
    event.key == "Control" ||
    event.key == "Meta" ||
    event.key == "Shift"
  ) {
    // This is a modifier. Display it, but don't assign yet. We assign when the
    // main key is pressed (below).
    event.target.value = ShortcutUtils.getModifierString(modifiers);
    // Select the input's text so screen readers will report it.
    event.target.select();
    return;
  }
  let key;
  if (event.key.length == 1) {
    key = event.key.toUpperCase();
  } else {
    [, key] = ShortcutUtils.getKeyAttribute(event.key);
  }
  if (await maybeHandleConflict(keyId, modifiers, key)) {
    CustomKeys.changeKey(keyId, modifiers, key);
    updateKey(row);
  }
  row.classList.remove("editing");
  row.querySelector(".change").focus();
}

function onFocusLost(event) {
  if (event.target.className == "new") {
    // If the input loses focus, cancel editing of the key.
    const row = event.target.closest("tr");
    row.classList.remove("editing");
    // Clear any modifiers that were displayed, ready for the next edit.
    event.target.value = "";
  }
}

function onSearchInput(event) {
  const query = event.target.value.toLowerCase();
  for (const row of table.querySelectorAll(".key")) {
    row.hidden =
      query && !row.children[0].textContent.toLowerCase().includes(query);
  }
  for (const tbody of table.tBodies) {
    // Show a category only if it has at least 1 shown key.
    tbody.hidden = !tbody.querySelector(".key:not([hidden])");
  }
}

async function onResetAll() {
  Glean.browserCustomkeys.actions.reset_all.add();
  if (
    !window.confirm(
      await document.l10n.formatValue("customkeys-reset-all-confirm")
    )
  ) {
    return;
  }
  CustomKeys.resetAll();
  for (const row of table.querySelectorAll(".key")) {
    updateKey(row);
  }
}

buildTable();
table.addEventListener("click", onAction);
table.addEventListener("keydown", onKey);
table.addEventListener("focusout", onFocusLost);
document.getElementById("search").addEventListener("input", onSearchInput);
document.getElementById("resetAll").addEventListener("click", onResetAll);
Glean.browserCustomkeys.opened.add();
