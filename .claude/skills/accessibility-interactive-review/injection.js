(function () {
  const svc = Cc["@mozilla.org/accessibilityService;1"].getService(Ci.nsIAccessibilityService);
  const wu = window.windowUtils;
  const SHIFT = wu.NATIVE_MODIFIER_SHIFT_LEFT;

  window._a11y = {
    sendKey(vk, mod, char) {
      wu.sendNativeKeyEvent(0, vk, mod || 0, char || "", "", null);
    },
    pressF6() { this.sendKey(KeyEvent.DOM_VK_F6); },
    pressTab() { this.sendKey(KeyEvent.DOM_VK_TAB); },
    pressShiftTab() { this.sendKey(KeyEvent.DOM_VK_TAB, SHIFT); },
    pressSpace() { this.sendKey(KeyEvent.DOM_VK_SPACE, 0, " "); },
    pressEnter() { this.sendKey(KeyEvent.DOM_VK_RETURN); },
    pressEscape() { this.sendKey(KeyEvent.DOM_VK_ESCAPE); },
    pressArrowLeft() { this.sendKey(KeyEvent.DOM_VK_LEFT); },
    pressArrowRight() { this.sendKey(KeyEvent.DOM_VK_RIGHT); },
    pressArrowUp() { this.sendKey(KeyEvent.DOM_VK_UP); },
    pressArrowDown() { this.sendKey(KeyEvent.DOM_VK_DOWN); },

    serializeAcc(acc) {
      if (!acc) return null;
      const stateObj = {}, extStateObj = {};
      acc.getState(stateObj, extStateObj);
      const state = stateObj.value;
      const extState = extStateObj.value;
      const S = Ci.nsIAccessibleStates;
      const node = { role: acc.computedARIARole, name: acc.name };
      if (acc.description) node.description = acc.description;
      if (state & S.STATE_CHECKABLE) node.checked = !!(state & S.STATE_CHECKED);
      if (extState & S.EXT_STATE_EXPANDABLE) node.expanded = !!(state & S.STATE_EXPANDED);
      if (state & S.STATE_SELECTABLE) node.selected = !!(state & S.STATE_SELECTED);
      if (acc.role === Ci.nsIAccessibleRole.ROLE_TOGGLE_BUTTON) node.pressed = !!(state & S.STATE_PRESSED);
      if (state & S.STATE_HASPOPUP) node.hasPopup = true;
      return node;
    },
    serializeAccSubtree(acc, maxDepth) {
      if (!acc || maxDepth === 0) return null;
      const node = this.serializeAcc(acc);
      const kids = acc.children;
      const children = [];
      for (let i = 0; i < kids.length; i++) {
        children.push(this.serializeAccSubtree(kids.queryElementAt(i, Ci.nsIAccessible), (maxDepth || 10) - 1));
      }
      if (children.length) node.children = children;
      return node;
    },
    isPanelOpen(id) {
      const panel = document.getElementById(id);
      return panel ? panel.state === "open" : false;
    },
    dumpSubtree(id, depth) {
      const el = document.getElementById(id);
      if (!el) return JSON.stringify(null);
      return JSON.stringify(this.serializeAccSubtree(svc.getAccessibleFor(el), depth || 10));
    },
    dumpContentDoc(depth) {
      const acc = svc.getAccessibleFor(gBrowser.selectedBrowser);
      if (!acc) return JSON.stringify(null);
      return JSON.stringify(this.serializeAccSubtree(acc, depth || 10));
    },
    dumpFocus(containerId) {
      const acc = svc.getAccessibleFor(document).focusedChild;
      const result = this.serializeAcc(acc) || {};
      if (acc) {
        try { result.domTag = acc.attributes.getStringProperty("tag"); } catch(e) {}
        if (acc.id) result.domId = acc.id;
      }
      if (containerId) result.inContainer = !!(document.getElementById(containerId)?.contains(acc?.DOMNode));
      return JSON.stringify(result);
    },
  };

  return "_a11y injected";
})()
