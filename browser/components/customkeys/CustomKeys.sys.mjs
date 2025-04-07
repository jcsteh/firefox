/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { JSONFile } from "resource://gre/modules/JSONFile.sys.mjs";

// All the attributes for a <key> element that might specify the key to press.
// We include data-l10n-id because keys are often specified using Fluent. Note
// that we deliberately remove data-l10n-id when a key is customized because
// otherwise, Fluent would overwrite the customization.
const ATTRS = ["data-l10n-id", "key", "keycode", "modifiers"];

// The original keys for any shortcuts that have been customized. This is used
// to identify whether a shortcut has been customized, as well as to reset a
// shortcut.
const original = {};
// All the browser windows we are handling. Maps from a window to our
// MutationObserver for that window.
const windows = new Map();

// The configuration is an Object with the form:
// { "someKeyId": { modifiers: "mod1,mod2", key: "someKey" }}
// If `key` is a single character, the `key` attribute of the `<key>` element is
// used. Otherwise, the `keycode` attribute of the `<key>` element is used.
const config = new JSONFile({
  path: PathUtils.join(PathUtils.profileDir, "customKeys.json"),
});

function applyToKeyEl(window, keyId, keysets) {
  const keyEl = window.document.getElementById(keyId);
  if (!keyEl || keyEl.tagName != "key") {
    return;
  }
  if (!original[keyId]) {
    // Save the original key in case the user wants to reset.
    const orig = (original[keyId] = {});
    for (const attr of ATTRS) {
      const val = keyEl.getAttribute(attr);
      if (val) {
        orig[attr] = val;
      }
    }
  }
  for (const attr of ATTRS) {
    keyEl.removeAttribute(attr);
  }
  const { modifiers, key } = config.data[keyId];
  keyEl.setAttribute("modifiers", modifiers);
  const attr = key.length <= 1 ? "key" : "keycode";
  keyEl.setAttribute(attr, key);
  keysets.add(keyEl.parentElement);
}

function resetKeyEl(window, keyId, keysets) {
  const keyEl = window.document.getElementById(keyId);
  if (!keyEl) {
    return;
  }
  const orig = original[keyId];
  for (const attr of ATTRS) {
    keyEl.removeAttribute(attr);
    const val = orig[attr];
    if (val !== undefined) {
      keyEl.setAttribute(attr, val);
    }
  }
  keysets.add(keyEl.parentElement);
}

async function applyToNewWindow(window) {
  await config.load();
  const keysets = new Set();
  for (const keyId in config.data) {
    applyToKeyEl(window, keyId, keysets);
  }
  refreshKeysets(window, keysets);
  observe(window);
}

function refreshKeysets(window, keysets) {
  if (keysets.size == 0) {
    return;
  }
  const observer = windows.get(window);
  if (observer) {
    // We don't want our MutationObserver to process this.
    observer.disconnect();
  }
  // Gecko doesn't watch for changes to key elements. It only sets up a key
  // element when its keyset is bound to the tree. See:
  // https://searchfox.org/mozilla-central/rev/7857ea04d142f2abc0d777085f9e54526c7cedf9/dom/xul/nsXULElement.cpp#587
  // Therefore, remove and re-add any modified keysets to apply the changes.
  for (const keyset of keysets) {
    const parent = keyset.parentElement;
    keyset.remove();
    parent.append(keyset);
  }
  if (observer) {
    observe(window);
  }
}

function observe(window) {
  let observer = windows.get(window);
  if (!observer) {
    // A keyset can be added dynamically. For example, DevTools does this during
    // delayed startup. Note that key elements cannot be added dynamically. We
    // know this because Gecko doesn't watch for changes to key elements. It
    // only sets up a key element when its keyset is bound to the tree. See:
    // https://searchfox.org/mozilla-central/rev/7857ea04d142f2abc0d777085f9e54526c7cedf9/dom/xul/nsXULElement.cpp#587
    observer = new window.MutationObserver(mutations => {
      const keysets = new Set();
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.tagName != "keyset") {
            continue;
          }
          for (const key of node.children) {
            if (key.tagName != "key" || !config.data[key.id]) {
              continue;
            }
            applyToKeyEl(window, key.id, keysets);
          }
        }
      }
      refreshKeysets(window, keysets);
    });
    windows.set(window, observer);
  }
  for (const node of [window.document, window.document.body]) {
    observer.observe(node, { childList: true });
  }
  return observer;
}

export const CustomKeys = {
  /**
   * Customize a keyboard shortcut.
   *
   * @param {string} id The id of the key element.
   * @param {string} modifiers The modifiers for the key (e.g. "accel,shift"), "" to clear the key.
   * @param {string} key The key itself (e.g. "Y"), "" to clear the key.
   */
  changeKey(id, modifiers, key) {
    const { existingModifiers, existingKey } = config.data[id] || {};
    if (modifiers == existingModifiers && key == existingKey) {
      return; // No change.
    }
    const [defaultModifiers, defaultKey] = this.getDefaultKey(id) || [
      null,
      null,
    ];
    if (modifiers == defaultModifiers && key == defaultKey) {
      this.resetKey(id);
      return;
    }
    config.data[id] = { modifiers, key };
    for (const window of windows.keys()) {
      const keysets = new Set();
      applyToKeyEl(window, id, keysets);
      refreshKeysets(window, keysets);
    }
    config.saveSoon();
  },

  /**
   * Reset a keyboard shortcut to its defalt.
   *
   * @param {string} id The id of the key element.
   */
  resetKey(id) {
    if (!config.data[id]) {
      return; // No change.
    }
    delete config.data[id];
    for (const window of windows.keys()) {
      const keysets = new Set();
      resetKeyEl(window, id, keysets);
      refreshKeysets(window, keysets);
    }
    delete original[id];
    config.saveSoon();
  },

  /**
   * Reset all keyboard shortcuts to their defaults.
   */
  resetAll() {
    config.data = {};
    for (const window of windows.keys()) {
      const keysets = new Set();
      for (const id in original) {
        resetKeyEl(window, id, keysets);
      }
      refreshKeysets(window, keysets);
    }
    for (const id of Object.keys(original)) {
      delete original[id];
    }
    config.saveSoon();
  },

  initWindow(window) {
    applyToNewWindow(window);
  },

  uninitWindow(window) {
    windows.get(window).disconnect();
    windows.delete(window);
  },

  /**
   * Return the default key for this shortcut in the form [modifiers, key]. If
   * this shortcut isn't customized, return null.
   *
   * @param {string} keyId The id of the key element.
   */
  getDefaultKey(keyId) {
    const origKey = original[keyId];
    if (!origKey) {
      return null;
    }
    return [origKey.modifiers || "", origKey.keycode || origKey.key];
  },
};

Object.freeze(CustomKeys);
