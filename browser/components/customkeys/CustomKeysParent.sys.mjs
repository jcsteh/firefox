/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { CustomKeys } from "resource:///modules/CustomKeys.sys.mjs";
import { ShortcutUtils } from "resource://gre/modules/ShortcutUtils.sys.mjs";

/**
 * Actor implementation for about:keyboard.
 */
export class CustomKeysParent extends JSWindowActorParent {
  getKeyData(id) {
    const keyEl =
      this.browsingContext.topChromeWindow.document.getElementById(id);
    if (!keyEl) {
      return null;
    }
    return {
      shortcut: ShortcutUtils.prettifyShortcut(keyEl),
      isCustomized: !!CustomKeys.getDefaultKey(id),
    };
  }

  // Get keyboard shortcuts in the form:
  // { <categoryTitle>: { <keyId>: { title: <title>, shortcut: <String>, isCustomized: <Boolean> } }
  // If categoryTitle or keyTitle begins with "customkeys-", it is a Fluent id.
  getKeys() {
    const topWin = this.browsingContext.topChromeWindow;

    const add = (category, id, title) => {
      const data = this.getKeyData(id);
      if (data) {
        data.title = title;
        category[id] = data;
      }
    };

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
      add(keys[menu.label], item.getAttribute("key"), item.label);
    }

    // Add some shortcuts that aren't available in menus.
    const historyCat = topWin.document.getElementById("history-menu").label;
    let cat = keys[historyCat];
    add(
      cat,
      "key_restoreLastClosedTabOrWindowOrSession",
      "customkeys-history-reopen-tab"
    );
    add(cat, "key_undoCloseWindow", "customkeys-history-reopen-window");
    const toolsCat = topWin.document.getElementById("browserToolsMenu").label;
    cat = keys[toolsCat];
    add(cat, "key_toggleToolboxF12", "customkeys-dev-tools");
    add(cat, "key_inspector", "customkeys-dev-inspector");
    add(cat, "key_webconsole", "customkeys-dev-webconsole");
    add(cat, "key_jsdebugger", "customkeys-dev-debugger");
    add(cat, "key_netmonitor", "customkeys-dev-network");
    add(cat, "key_styleeditor", "customkeys-dev-style");
    add(cat, "key_performance", "customkeys-dev-performance");
    add(cat, "key_storage", "customkeys-dev-storage");
    add(cat, "key_dom", "customkeys-dev-dom");
    add(cat, "key_accessibility", "customkeys-dev-accessibility");
    add(cat, "key_profilerStartStop", "customkeys-dev-profiler-toggle");
    add(
      cat,
      "key_profilerStartStopAlternate",
      "customkeys-dev-profiler-toggle"
    );
    add(cat, "key_profilerCapture", "customkeys-dev-profiler-capture");
    add(cat, "key_profilerCaptureAlternate", "customkeys-dev-profiler-capture");
    cat = keys["customkeys-category-navigation"] = {};
    add(cat, "goBackKb", "customkeys-nav-back");
    add(cat, "goForwardKb", "customkeys-nav-forward");
    add(cat, "goHome", "customkeys-nav-home");
    add(cat, "key_reload", "customkeys-nav-reload");
    add(cat, "key_reload2", "customkeys-nav-reload");
    add(cat, "key_reload_skip_cache", "customkeys-nav-reload-skip-cache");
    add(cat, "key_reload_skip_cache2", "customkeys-nav-reload-skip-cache");
    add(cat, "key_stop", "customkeys-nav-stop");

    return keys;
  }

  prettifyShortcut(modifiers, key) {
    // ShortcutUtils.prettifyShortcut needs a key element, but we don't have
    // that here. Make a temporary one.
    const keyEl =
      this.browsingContext.topChromeWindow.document.createXULElement("key");
    keyEl.setAttribute("modifiers", modifiers);
    keyEl.setAttribute(key.length == 1 ? "key" : "keycode", key);
    return ShortcutUtils.prettifyShortcut(keyEl);
  }

  async receiveMessage(message) {
    switch (message.name) {
      case "CustomKeys:ChangeKey": {
        const [id, modifiers, key] = message.data;
        CustomKeys.changeKey(id, modifiers, key);
        return this.getKeyData(id);
      }
      case "CustomKeys:GetDefaultKey": {
        return CustomKeys.getDefaultKey(message.data);
      }
      case "CustomKeys:GetKeyAttribute": {
        return ShortcutUtils.getKeyAttribute(message.data);
      }
      case "CustomKeys:GetKeys": {
        return this.getKeys();
      }
      case "CustomKeys:GetModifierString": {
        return ShortcutUtils.getModifierString(message.data);
      }
      case "CustomKeys:GetModifiersAttribute": {
        return ShortcutUtils.getModifiersAttribute(message.data);
      }
      case "CustomKeys:PrettifyShortcut": {
        return this.prettifyShortcut(...message.data);
      }
      case "CustomKeys:ResetAll": {
        return CustomKeys.resetAll();
      }
      case "CustomKeys:ResetKey": {
        CustomKeys.resetKey(message.data);
        return this.getKeyData(message.data);
      }
    }
    return null;
  }
}
