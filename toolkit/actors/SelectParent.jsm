/* vim: set ts=2 sw=2 sts=2 et tw=80: */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
"use strict";

var EXPORTED_SYMBOLS = ["SelectParent", "SelectParentHelper"];

const { AppConstants } = ChromeUtils.import(
  "resource://gre/modules/AppConstants.jsm"
);
const { Services } = ChromeUtils.import("resource://gre/modules/Services.jsm");
const { setTimeout } = ChromeUtils.import("resource://gre/modules/Timer.jsm");

// Maximum number of rows to display in the select dropdown.
const MAX_ROWS = 20;

// A buffer of items to add above and below what is actually visible, so we don't
// display empty space on scroll with APZ.
const VIEWPORT_BUFFER = 40;

// Minimum elements required to show select search
const SEARCH_MINIMUM_ELEMENTS = 40;

// How long to blink the selected menu item on non-Windows
const BLINK_DELAY = 67;

// Indices in the added stylesheet for custom stylings to insert rules
const MENU_NOT_ACTIVE_RULE_INDEX = 0;
const MENU_ACTIVE_RULE_INDEX = 1;

// How many items we have to scroll up/down to trigger updating what we populate in
// populdateChildren.
const SCROLL_UPDATE_THRESHOLD = 4;

// The properties that we should respect only when the item is not active.
const PROPERTIES_RESET_WHEN_ACTIVE = [
  "color",
  "background-color",
  "text-shadow",
];

// Duplicated in SelectChild.jsm
// Please keep these lists in sync.
const SUPPORTED_PROPERTIES = [
  "direction",
  "color",
  "background-color",
  "text-shadow",
  "font-family",
  "font-weight",
  "font-size",
  "font-style",
];

const customStylingEnabled = Services.prefs.getBoolPref(
  "dom.forms.select.customstyling"
);

var SelectParentHelper = {
  /**
   * `populate` takes the `menulist` element and a list of `items` and generates
   * a popup list of options.
   *
   * If `customStylingEnabled` is set to `true`, the function will also
   * style the select and its popup trying to prevent the text
   * and background to end up in the same color.
   *
   * All `ua*` variables represent the color values for the default colors
   * for their respective form elements used by the user agent.
   * The `select*` variables represent the color values defined for the
   * particular <select> element.
   *
   * The `customoptionstyling` attribute controls the application of
   * `-moz-appearance` on the elements and is disabled if the element is
   * defining its own background-color.
   *
   * @param {Element}        menulist
   * @param {Array<Element>} items
   * @param {Number}         estimatedOptionCount
   * @param {Array<Object>}  uniqueItemStyles
   * @param {Number}         selectedIndex
   * @param {Number}         zoom
   * @param {Object}         uaStyle
   * @param {Object}         selectStyle
   * @param {Number}         baseIndex
   *
   * FIXME(emilio): injecting a stylesheet is a somewhat inefficient way to do
   * this, can we use more style attributes?
   *
   * FIXME(emilio, bug 1530709): At the very least we should use CSSOM to avoid
   * trusting the IPC message too much.
   */
  populate(
    menulist,
    items,
    estimatedOptionCount,
    uniqueItemStyles,
    selectedIndex,
    zoom,
    uaStyle,
    selectStyle,
    baseIndex = -1
  ) {
    let doc = menulist.ownerDocument;

    // Clear the current contents of the popup
    menulist.menupopup.textContent = "";

    // Add a wrapper for our divs, which will have its height set to what we
    // estimate the total height of all of our menu items to be. We will add those
    // items as they approach becoming visible, but we want to make sure the user
    // has the illusion of scrolling freely through the whole list.
    let scrollWrapper = doc.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "div"
    );
    scrollWrapper.classList.add("menupopup-scrollwrapper");
    menulist.menupopup.appendChild(scrollWrapper);

    let stylesheet = menulist.querySelector("#ContentSelectDropdownStylesheet");
    if (stylesheet) {
      stylesheet.remove();
    }

    let sheet;
    if (customStylingEnabled) {
      stylesheet = doc.createElementNS("http://www.w3.org/1999/xhtml", "style");
      stylesheet.setAttribute("id", "ContentSelectDropdownStylesheet");
      stylesheet.hidden = true;
      stylesheet = menulist.appendChild(stylesheet);
      sheet = stylesheet.sheet;
    } else {
      selectStyle = uaStyle;
    }

    let selectBackgroundSet = false;

    if (selectStyle["background-color"] == "rgba(0, 0, 0, 0)") {
      selectStyle["background-color"] = uaStyle["background-color"];
    }

    if (selectStyle.color == selectStyle["background-color"]) {
      selectStyle.color = uaStyle.color;
    }

    if (customStylingEnabled) {
      if (selectStyle["text-shadow"] != "none") {
        sheet.insertRule(
          `#ContentSelectDropdown > menupopup > div > [_moz-menuactive="true"] {
          text-shadow: none;
        }`,
          0
        );
      }

      let addedRule = false;
      for (let property of SUPPORTED_PROPERTIES) {
        if (property == "direction") {
          continue;
        } // Handled above, or before.
        if (
          !selectStyle[property] ||
          selectStyle[property] == uaStyle[property]
        ) {
          continue;
        }
        if (!addedRule) {
          sheet.insertRule("#ContentSelectDropdown > menupopup {}", 0);
          addedRule = true;
        }
        let styleString =
          property == "font-size"
            ? zoom * parseFloat(selectStyle["font-size"], 10) + "px"
            : selectStyle[property];
        sheet.cssRules[0].style[property] = styleString;
      }
      // Some webpages set the <select> backgroundColor to transparent,
      // but they don't intend to change the popup to transparent.
      // So we remove the backgroundColor and turn it into an image instead.
      if (
        customStylingEnabled &&
        selectStyle["background-color"] != uaStyle["background-color"]
      ) {
        // We intentionally use the parsed color to prevent color
        // values like `url(..)` being injected into the
        // `background-image` property.
        let parsedColor = sheet.cssRules[0].style["background-color"];
        sheet.cssRules[0].style["background-color"] = "";
        sheet.cssRules[0].style[
          "background-image"
        ] = `linear-gradient(${parsedColor}, ${parsedColor})`;
        selectBackgroundSet = true;
      }
      if (addedRule) {
        sheet.insertRule(
          `#ContentSelectDropdown > menupopup > div > :not([_moz-menuactive="true"]) {
            color: inherit;
        }`,
          0
        );
      }
    }

    // We only set the `customoptionstyling` if the background has been
    // manually set. This prevents the overlap between moz-appearance and
    // background-color. `color` and `text-shadow` do not interfere with it.
    if (selectBackgroundSet) {
      menulist.menupopup.setAttribute("customoptionstyling", "true");
    } else {
      menulist.menupopup.removeAttribute("customoptionstyling");
    }

    this._currentZoom = zoom;
    this._currentMenulist = menulist;
    this._uniqueItemStyles = uniqueItemStyles;
    this._selectStyle = selectStyle;
    this._sheet = sheet;

    if (customStylingEnabled) {
      this.addUniqueItemStyles();
    }

    this._itemHeights = this.getItemHeights(
      estimatedOptionCount >= SEARCH_MINIMUM_ELEMENTS
    );
    let { optionData, selected } = this.buildOptionData(items, selectedIndex);
    if (optionData.length && optionData[0].isSearchbox) {
      this._totalOptionsCount = estimatedOptionCount + 1;
    } else {
      this._totalOptionsCount = estimatedOptionCount;
    }
    this._optionData = optionData;
    this._filteredOptionData = optionData.filter(o => !o.hidden);
    this._shownItems = [];
    this._recycleableItems = [];
    this._selectedIndex = selectedIndex;
    this._selected = selected;
    this._selectBackgroundSet = selectBackgroundSet;

    this.populateChildren(baseIndex != -1 ? baseIndex : this._selected);
  },

  open(browser, menulist, rect, isOpenedViaTouch, selectParentActor) {
    this._open = true;
    // We need to keep track of whether we've just opened the window in order
    // to not immediately close it on likely incoming mouseup event.
    this._justOpened = true;
    this._actor = selectParentActor;
    menulist.hidden = false;
    this._currentBrowser = browser;
    this._closedWithEnter = false;
    this._selectRect = rect;
    this._registerListeners(browser, menulist.menupopup);

    let win = browser.ownerGlobal;
    let menupopup = menulist.menupopup;

    // Include the padding and border on the popup.
    let cs = win.getComputedStyle(menupopup);
    let bpHeight =
      parseFloat(cs.borderTopWidth) +
      parseFloat(cs.borderBottomWidth) +
      parseFloat(cs.paddingTop) +
      parseFloat(cs.paddingBottom);
    // Set the item height to the default style for an <option> in our list.
    let itemHeight = this._itemHeights.false[0];
    let maxHeight = MAX_ROWS * itemHeight + bpHeight;
    menupopup.style.maxHeight = maxHeight + "px";

    menupopup.classList.toggle("isOpenedViaTouch", isOpenedViaTouch);

    if (browser.getAttribute("selectmenuconstrained") != "false") {
      let constraintRect = browser.getBoundingClientRect();
      constraintRect = new win.DOMRect(
        constraintRect.left + win.mozInnerScreenX,
        constraintRect.top + win.mozInnerScreenY,
        constraintRect.width,
        constraintRect.height
      );
      menupopup.setConstraintRect(constraintRect);
    } else {
      menupopup.setConstraintRect(new win.DOMRect(0, 0, 0, 0));
    }
    menupopup.openPopupAtScreenRect(
      AppConstants.platform == "macosx" ? "selection" : "after_start",
      rect.left,
      rect.top,
      rect.width,
      rect.height,
      false,
      false
    );

    let selectedItem = menulist.selectedItem;
    if (selectedItem) {
      let itemOffset = selectedItem.offsetTop;
      let itemHeight = selectedItem.getBoundingClientRect().height;
      if (
        menupopup.scrollBox.scrollPosition + maxHeight <
        itemOffset + itemHeight
      ) {
        selectedItem.scrollIntoView();
      }
    }
  },

  hide(menulist, browser) {
    if (this._currentBrowser == browser) {
      menulist.menupopup.hidePopup();
    }
  },

  /**
   * Sets _moz-menuactive on the provided item, and clears it from the last
   * active item.
   *
   * @param {Object}         item
   */
  setActiveItem(item) {
    if (this._activeItem) {
      this._activeItem.removeAttribute("_moz-menuactive");
    }
    if (item) {
      item.setAttribute("_moz-menuactive", true);
      this._currentMenulist.menupopup.setAttribute(
        "aria-activedescendant",
        item.id
      );
    }
    this._activeItem = item;
    this._pendingActiveItem = null;
  },

  /**
   * Gets the first fully visible option based on our current scroll position.
   * This helps us to know where to start populating items in populateChildren.
   *
   * @param {Number}         scrollPosition
   */
  getScrolledToIndex(scrollPosition) {
    let options = this._optionData;
    for (let i = 0; i < options.length; i++) {
      if (options[i].top > scrollPosition) {
        return i;
      }
    }

    // NOTE: we shouldn't get here, but just give a sensible default if we do.
    return 0;
  },

  /**
   * The user has selected an item. This will update the visual state and
   * notify the content process.
   */
  handleSelect() {
    let item = this._currentMenulist.selectedItem;

    // This is a bit of look and feel logic. On platforms other than Windows,
    // selecting an item from a dropdown menu at the cursor (like in a context
    // menu) will flash the selected item briefly before closing the dropdown.
    if (AppConstants.platform == "win") {
      this._actor.sendAsyncMessage("Forms:SelectDropDownItem", {
        value: parseInt(item.getAttribute("value")),
        closedWithEnter: this._closedWithEnter,
      });
      this._currentMenulist.menupopup.hidePopup();
    } else {
      this._itemSelectionInProgress = true;
      item.removeAttribute("_moz-menuactive");
      setTimeout(() => {
        item.setAttribute("_moz-menuactive", true);
        setTimeout(() => {
          this._itemSelectionInProgress = false;
          this._actor.sendAsyncMessage("Forms:SelectDropDownItem", {
            value: parseInt(item.getAttribute("value")),
            closedWithEnter: this._closedWithEnter,
          });
          this._currentMenulist.menupopup.hidePopup();
        }, BLINK_DELAY);
      }, BLINK_DELAY);
    }
  },

  handleEvent(event) {
    if (this._itemSelectionInProgress) {
      return;
    }
    switch (event.type) {
      case "mouseup":
        function inRect(rect, x, y) {
          return (
            x >= rect.left &&
            x <= rect.left + rect.width &&
            y >= rect.top &&
            y <= rect.top + rect.height
          );
        }

        let x = event.screenX,
          y = event.screenY;
        let onAnchor =
          !inRect(this._currentMenulist.menupopup.getOuterScreenRect(), x, y) &&
          inRect(this._selectRect, x, y) &&
          this._currentMenulist.menupopup.state == "open";
        this._actor.sendAsyncMessage("Forms:MouseUp", { onAnchor });

        if (
          !this._justOpened &&
          !onAnchor &&
          event.target.classList.contains("menuitem")
        ) {
          this._currentMenulist.selectedItem = event.target;
          this.handleSelect();
        }
        break;

      case "mousedown":
        this._justOpened = false;
        break;

      case "mouseover":
        if (event.target.classList.contains("menuitem")) {
          if (this._mouseMovedSinceScroll) {
            this.setActiveItem(event.target);
          } else {
            this._pendingActiveItem = event.target;
          }
        }
        this._actor.sendAsyncMessage("Forms:MouseOver", {});
        break;

      case "mouseout":
        if (AppConstants.platform != "win") {
          this.setActiveItem(null);
        }
        this._actor.sendAsyncMessage("Forms:MouseOut", {});
        break;

      case "mousemove":
        this._mouseMovedSinceScroll = true;
        if (this._pendingActiveItem) {
          this.setActiveItem(this._pendingActiveItem);
        }
        break;

      case "keydown":
        switch (event.keyCode) {
          case event.DOM_VK_RETURN: {
            if (this._activeItem) {
              this._closedWithEnter = true;
              this._currentMenulist.selectedItem = this._activeItem;
              this.handleSelect();
            }
            break;
          }
          case event.DOM_VK_UP: {
            if (this._activeItem) {
              let sibling = this._activeItem.previousElementSibling;
              while (sibling) {
                if (sibling.classList.contains("menuitem")) {
                  this.setActiveItem(sibling);
                  break;
                } else if (sibling.classList.contains("menucaption")) {
                  sibling = sibling.previousElementSibling;
                } else {
                  break;
                }
              }
            }
            break;
          }
          case event.DOM_VK_DOWN: {
            if (this._activeItem) {
              let sibling = this._activeItem.nextElementSibling;
              while (sibling) {
                if (sibling.classList.contains("menuitem")) {
                  this.setActiveItem(sibling);
                  break;
                } else if (sibling.classList.contains("menucaption")) {
                  sibling = sibling.nextElementSibling;
                } else {
                  break;
                }
              }
            }
            break;
          }
          case event.DOM_VK_HOME: {
            let list = this.getScrollWrapper();
            if (list && list.firstElementChild) {
              this.setActiveItem(list.firstElementChild);
            }
            break;
          }
          case event.DOM_VK_END: {
            let list = this.getScrollWrapper();
            if (list && list.lastElementChild) {
              this.setActiveItem(list.lastElementChild);
            }
            break;
          }
        }
        break;

      case "command":
        if (event.target.hasAttribute("value")) {
          this._actor.sendAsyncMessage("Forms:SelectDropDownItem", {
            value: event.target.value,
            closedWithEnter: this._closedWithEnter,
          });
        }
        break;

      case "fullscreen":
        if (this._currentMenulist) {
          this._currentMenulist.menupopup.hidePopup();
        }
        break;

      case "scroll":
        if (this._currentMenulist) {
          this._mouseMovedSinceScroll = false;

          let scrollPosition = this._currentMenulist.menupopup.scrollBox
            .scrollPosition;
          let index = this.getScrolledToIndex(scrollPosition);
          if (Math.abs(this._lastBaseIndex - index) < SCROLL_UPDATE_THRESHOLD) {
            break;
          }
          this.populateChildren(index);
        }
        break;

      case "popuphidden":
        this._actor.sendAsyncMessage("Forms:DismissedDropDown", {});
        let popup = event.target;
        this._unregisterListeners(this._currentBrowser, popup);
        popup.parentNode.hidden = true;
        this._open = false;
        this._currentBrowser = null;
        this._currentMenulist = null;
        this._selectRect = null;
        this._optionData = null;
        this._shownItems = null;
        this._recycleableItems = null;
        this._totalListHeight = 0;
        this._currentZoom = 1;
        this._actor = null;
        this._activeItem = null;
        this._pendingActiveItem = null;
        this._filteredOptionData = null;
        this._optionData = null;
        this._sheet = null;
        this._selectStyle = null;
        this._itemHeights = null;
        this._uniqueItemStyles = null;
        break;
    }
  },

  receiveMessage(browser, msg) {
    if (this._currentBrowser != browser) {
      return;
    }

    if (msg.name == "Forms:UpdateDropDown") {
      let scrollBox = this._currentMenulist.menupopup.scrollBox.scrollbox;
      let scrollTop = scrollBox.scrollTop;
      let scrolledToIndex = this.getScrolledToIndex(scrollTop);

      this.populate(
        this._currentMenulist,
        msg.data.options,
        msg.data.options.length,
        msg.data.uniqueStyles,
        msg.data.selectedIndex,
        this._currentZoom,
        msg.data.defaultStyle,
        msg.data.style,
        scrolledToIndex
      );

      // Restore scroll position to what it was prior to the update.
      scrollBox.scrollTop = scrollTop;
    } else if (msg.name == "Forms:ShowDropDownContinue") {
      this._uniqueItemStyles = this._uniqueItemStyles.concat(
        msg.data.uniqueStyles
      );

      if (customStylingEnabled) {
        this.addUniqueItemStyles();
      }
      this._itemHeights = this.getItemHeights(false, this._itemHeights);
      let { optionData } = this.buildOptionData(
        msg.data.options,
        this._selectedIndex,
        this._optionData
      );
      this._optionData = optionData;
      this._filteredOptionData = optionData.filter(o => !o.hidden);
      if (msg.data.isDone) {
        this._totalOptionsCount = this._optionData.length;
      }

      this.populateChildren(this._selected);
    } else if (msg.name == "Forms:BlurDropDown-Ping") {
      this._actor.sendAsyncMessage("Forms:BlurDropDown-Pong", {});
    }
  },

  _registerListeners(browser, popup) {
    popup.addEventListener("command", this);
    popup.addEventListener("scroll", this);
    popup.addEventListener("popuphidden", this);
    popup.addEventListener("mousemove", this);
    popup.addEventListener("mouseover", this);
    popup.addEventListener("mouseout", this);
    browser.ownerGlobal.addEventListener("mouseup", this, true);
    browser.ownerGlobal.addEventListener("mousedown", this, true);
    browser.ownerGlobal.addEventListener("keydown", this, true);
    browser.ownerGlobal.addEventListener("fullscreen", this, true);
  },

  _unregisterListeners(browser, popup) {
    popup.removeEventListener("command", this);
    popup.removeEventListener("scroll", this);
    popup.removeEventListener("popuphidden", this);
    popup.removeEventListener("mousemove", this);
    popup.removeEventListener("mouseover", this);
    popup.removeEventListener("mouseout", this);
    browser.ownerGlobal.removeEventListener("mouseup", this, true);
    browser.ownerGlobal.removeEventListener("mousedown", this, true);
    browser.ownerGlobal.removeEventListener("keydown", this, true);
    browser.ownerGlobal.removeEventListener("fullscreen", this, true);
  },

  getScrollWrapper() {
    return this._currentMenulist.menupopup.firstElementChild;
  },

  /**
   * Iterate through the option array provided by the child process and produce
   * a list of option data which we can quickly reference in populateChildren.
   * this is what we will hold onto even as we construct and destroy child
   * as the user scrolls.
   *
   * @param {Object}         options
   * @param {Number}         selectedIndex
   * @param {Array}          existing
   */
  buildOptionData(options, selectedIndex, existing = []) {
    let optionData = existing;
    let selected = 0;
    let disabledParents = new Set();

    if (
      Services.prefs.getBoolPref("dom.forms.selectSearch") &&
      options.length >= SEARCH_MINIMUM_ELEMENTS &&
      !optionData.length
    ) {
      optionData.push({ isSearchbox: true });
    }

    for (let i = 0; i < options.length; i++) {
      let option = options[i];
      let isOptGroup = !!option.isOptGroup;
      let id = "ContentSelectDropdownOption" + i;

      let isDisabled =
        option.disabled || disabledParents.has(option.parentIndex);
      if (isDisabled && isOptGroup) {
        disabledParents.add(i);
      }

      if (option.parentIndex != -1) {
        optionData[option.parentIndex].ariaOwns += id + " ";
      }

      if (option.index == selectedIndex) {
        selected = i;
      }

      optionData.push({
        id,
        selected: option.index == selectedIndex,
        hidden: false,
        index: option.index,
        parentIndex: option.parentIndex,
        isOptGroup,
        isDisabled,
        ariaOwns: "",
        styleIndex: option.styleIndex,
        textContent: option.textContent,
        tooltip: option.tooltip,
      });
    }

    return {
      optionData,
      selected,
    };
  },

  /**
   * Adds all of the custom styles we haven't already added yet to our stylesheet.
   */
  addUniqueItemStyles() {
    let sheet = this._sheet;
    let uniqueItemStyles = this._uniqueItemStyles;
    let selectStyle = this._selectStyle;
    let zoom = this._currentZoom;

    for (let i = 0; i < uniqueItemStyles.length; i++) {
      if (uniqueItemStyles[i].addedToSheet) {
        continue;
      }

      let addedRules = false;
      let style = uniqueItemStyles[i];

      if (style["background-color"] == "rgba(0, 0, 0, 0)") {
        style["background-color"] = selectStyle["background-color"];
      }

      if (style.color == style["background-color"]) {
        style.color = selectStyle.color;
      }

      for (const property of SUPPORTED_PROPERTIES) {
        if (property == "direction") {
          continue;
        }
        if (!style[property] || style[property] == selectStyle[property]) {
          continue;
        }
        if (!addedRules) {
          sheet.insertRule(
            `#ContentSelectDropdown > menupopup > div > .styleIndex${i}:not([_moz-menuactive="true"]) {
          }`,
            MENU_NOT_ACTIVE_RULE_INDEX
          );
          sheet.insertRule(
            `#ContentSelectDropdown > menupopup > div > .styleIndex${i}[_moz-menuactive="true"] {
          }`,
            MENU_ACTIVE_RULE_INDEX
          );
          addedRules = true;
        }

        let styleString =
          property == "font-size"
            ? zoom * parseFloat(style["font-size"], 10) + "px"
            : style[property];
        if (PROPERTIES_RESET_WHEN_ACTIVE.includes(property)) {
          sheet.cssRules[MENU_NOT_ACTIVE_RULE_INDEX].style[
            property
          ] = styleString;
        } else {
          sheet.cssRules[MENU_NOT_ACTIVE_RULE_INDEX].style[
            property
          ] = styleString;
          sheet.cssRules[MENU_ACTIVE_RULE_INDEX].style[property] = styleString;
        }
      }

      if (addedRules) {
        if (
          style["text-shadow"] != "none" &&
          style["text-shadow"] != selectStyle["text-shadow"]
        ) {
          // Need to explicitly disable the possibly inherited
          // text-shadow rule when _moz-menuactive=true since
          // _moz-menuactive=true disables custom option styling.
          sheet.insertRule(
            `#ContentSelectDropdown > menupopup > div > .styleIndex${i}[_moz-menuactive="true"] {
            text-shadow: none;
          }`,
            0
          );
        }
      }

      uniqueItemStyles[i].addedToSheet = true;
    }
  },

  /**
   * Calculate the heights of all distinct styles for items present in the
   * select element. We can then use this to generate the "top" values for
   * the individual elements, allowing us to only actually construct and
   * hold onto potentially visible elements.
   *
   * @param {Boolean}         includeSearch
   * @param {Object}          existing
   */
  getItemHeights(includeSearch, existing = {}) {
    let menulist = this._currentMenulist;
    let uniqueItemStyles = this._uniqueItemStyles;

    // Here we get an item height for every unique style for our dropdown. On
    // a per-item basis, this is relatively expensive, but since the list of
    // unique styles should generally be rather small, this should be performant
    // for nearly every use case.
    let result = existing;
    menulist.hidden = false;
    let element = this.getScrollWrapper();
    for (let isOptGroup of [false, true]) {
      if (!result[isOptGroup]) {
        result[isOptGroup] = {};
      }
      for (let i = 0; i < uniqueItemStyles.length; i++) {
        if (result[isOptGroup][i]) {
          continue;
        }
        let item = element.ownerDocument.createElementNS(
          "http://www.w3.org/1999/xhtml",
          "div"
        );
        item.textContent = "A";
        item.classList.add(isOptGroup ? "menucaption" : "menuitem");
        item.classList.add("styleIndex" + i);
        element.appendChild(item);
        result[isOptGroup][i] = item.getBoundingClientRect().height;
        element.removeChild(item);
      }
    }

    if (
      Services.prefs.getBoolPref("dom.forms.selectSearch") &&
      includeSearch &&
      !result.searchbox
    ) {
      let item = element.ownerDocument.createXULElement("search-textbox");
      item.className = "contentSelectDropdown-searchbox";
      element.appendChild(item);

      let cs = element.ownerGlobal.getComputedStyle(item);
      let margin = parseFloat(cs.marginTop) + parseFloat(cs.marginBottom);
      result.searchbox = item.getBoundingClientRect().height + margin;
      element.removeChild(item);
    }
    menulist.hidden = !this._open;
    return result;
  },

  /**
   * `populateChildren` creates all elements for the popup menu
   * based on the list of <option> elements from the <select> element.
   *
   * It attempts to intelligently add per-item CSS rules if the single
   * item values differ from the parent menu values and attempting to avoid
   * ending up with the same color of text and background.
   *
   * It will only actually populate a range of items based on the provided
   * baseIndex parameter. It builds out items above and below that index to
   * fill out a scrollable buffer of items.
   *
   * @param {Number}         baseIndex
   */
  populateChildren(baseIndex) {
    this._lastBaseIndex = baseIndex;
    let menulist = this._currentMenulist;
    let doc = menulist.ownerDocument;
    let element = this.getScrollWrapper();
    let options = this._filteredOptionData;
    let numUnknownOptions = this._totalOptionsCount - this._optionData.length;

    let startIndex = Math.max(0, baseIndex - VIEWPORT_BUFFER);
    let endIndex = Math.min(
      options.length,
      baseIndex + MAX_ROWS + VIEWPORT_BUFFER
    );

    let menulistSelectedItem = menulist.selectedItem;
    for (let i = 0; i < this._shownItems.length; i++) {
      if (
        !this._shownItems[i] ||
        options[i].isSearchbox ||
        menulistSelectedItem == this._shownItems[i] ||
        this._activeItem == this._shownItems[i]
      ) {
        continue;
      }
      if (i < startIndex || i >= endIndex) {
        this._recycleableItems.push(this._shownItems[i]);
        delete this._shownItems[i];
      }
    }

    let currentY = 0;
    for (let i = 0; i < options.length; i++) {
      let option = options[i];
      option.top = currentY;
      if (option.isSearchbox) {
        currentY += this._itemHeights.searchbox;
      } else {
        currentY += this._itemHeights[option.isOptGroup][option.styleIndex];
      }
      if (i < startIndex || i >= endIndex || this._shownItems[i]) {
        continue;
      }

      if (option.isSearchbox) {
        // Add a search text field as the first element of the dropdown
        let searchbox = doc.createXULElement("search-textbox");
        this._shownItems[i] = searchbox;
        searchbox.className = "contentSelectDropdown-searchbox";
        searchbox.addEventListener("input", this.onSearchInput.bind(this));
        searchbox.inputField.addEventListener(
          "focus",
          this.onSearchFocus.bind(this)
        );
        searchbox.inputField.addEventListener("blur", this.onSearchBlur);

        // Handle special keys for exiting search
        searchbox.addEventListener(
          "keydown",
          event => {
            this.onSearchKeydown(event, menulist);
          },
          true
        );
        element.appendChild(searchbox);
        continue;
      }

      let item = this._recycleableItems.pop();
      if (!item) {
        item = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
      }
      this._shownItems[i] = item;

      item.id = option.id;
      item.className = "";
      item.classList.add(option.isOptGroup ? "menucaption" : "menuitem");
      item.classList.add("styleIndex" + option.styleIndex);

      let style = this._uniqueItemStyles[option.styleIndex];

      item.style.direction = style.direction;
      item.style.position = "fixed";
      item.style.top = option.top + "px";
      item.textContent = option.textContent;
      item.title = option.tooltip;

      item.setAttribute("role", option.isOptGroup ? "group" : "option");

      let optionBackgroundSet =
        style["background-color"] != this._selectStyle["background-color"];

      if (
        customStylingEnabled &&
        (optionBackgroundSet || this._selectBackgroundSet)
      ) {
        item.setAttribute("customoptionstyling", "true");
      } else {
        item.removeAttribute("customoptionstyling");
      }

      if (option.parentIndex != -1) {
        // In the menupopup, the optgroup is a sibling of its contained options.
        // For accessibility, we want to preserve the hierarchy such that the
        // options are inside the optgroup. We do this using aria-owns on the
        // parent.
        item.setAttribute("aria-level", "2");
      } else {
        item.removeAttribute("aria-level");
      }

      if (option.isDisabled) {
        item.setAttribute("disabled", "true");
      } else {
        item.removeAttribute("disabled");
      }

      element.appendChild(item);

      if (!option.isOptGroup) {
        if (option.selected) {
          // We expect the parent element of the popup to be a <xul:menulist> that
          // has the popuponly attribute set to "true". This is necessary in order
          // for a <xul:menupopup> to act like a proper <html:select> dropdown, as
          // the <xul:menulist> does things like remember state and set the
          // _moz-menuactive attribute on the selected <xul:menuitem>.
          menulist.selectedItem = item;

          this.setActiveItem(item);
        }

        item.setAttribute("value", option.index);

        if (option.parentIndex != -1) {
          item.classList.add("contentSelectDropdown-ingroup");
        }
      } else {
        item.removeAttribute("value");
      }

      if (option.ariaOwns) {
        item.setAttribute("aria-owns", option.ariaOwns);
      } else {
        item.removeAttribute("aria-owns");
      }
    }

    this._totalListHeight = currentY;
    if (numUnknownOptions > 0) {
      this._totalListHeight += Math.ceil(
        (currentY / options.length) * numUnknownOptions
      );
    }
    element.style.height = this._totalListHeight + "px";
  },

  onSearchKeydown(event, menulist) {
    if (event.defaultPrevented) {
      return;
    }

    let searchbox = event.currentTarget;
    switch (event.key) {
      case "Escape":
        searchbox.parentElement.parentElement.hidePopup();
        break;
      case "ArrowDown":
      case "Enter":
      case "Tab":
        searchbox.blur();
        if (
          searchbox.nextElementSibling.localName == "menuitem" &&
          !searchbox.nextElementSibling.hidden
        ) {
          menulist.activeChild = searchbox.nextElementSibling;
        } else {
          let currentOption = searchbox.nextElementSibling;
          while (
            currentOption &&
            (currentOption.localName != "menuitem" || currentOption.hidden)
          ) {
            currentOption = currentOption.nextElementSibling;
          }
          if (currentOption) {
            menulist.activeChild = currentOption;
          } else {
            searchbox.focus();
          }
        }
        break;
      default:
        return;
    }
    event.preventDefault();
  },

  onSearchInput(event) {
    let searchObj = event.currentTarget;

    // Get input from search field, set to all lower case for comparison
    let input = searchObj.value.toLowerCase();

    // Flag used to detect any group headers with no visible options.
    // These group headers should be hidden.
    let allHidden = true;
    // Keep a reference to the previous group header (menucaption) to go back
    // and set to hidden if all options within are hidden.
    let prevCaption = null;
    let prevItem = null;

    let options = this._optionData;
    for (let option of options) {
      if (option.isSearchbox) {
        continue;
      }

      if (!input) {
        option.hidden = false;
      } else if (option.isOptGroup) {
        if (prevCaption != null) {
          prevCaption.hidden = allHidden;
        }
        prevCaption = option;
        allHidden = true;
      } else {
        if (
          option.parentIndex == -1 &&
          prevItem &&
          prevItem.parentIndex != -1
        ) {
          if (prevCaption != null) {
            prevCaption.hidden = allHidden;
          }
          prevCaption = null;
          allHidden = true;
        }
        if (
          option.textContent.includes(input) ||
          option.tooltip.includes(input)
        ) {
          option.hidden = false;
          allHidden = false;
        } else {
          option.hidden = true;
        }
        prevItem = option;
      }
      if (prevCaption != null) {
        prevCaption.hidden = allHidden;
      }
    }

    this._filteredOptionData = options.filter(o => !o.hidden);

    for (let i = 0; i < this._shownItems.length; i++) {
      let item = this._shownItems[i];
      if (item && item.localName != "search-textbox") {
        this.getScrollWrapper().removeChild(item);
        delete this._shownItems[i];
      }
    }
    this.populateChildren(0);
  },

  onSearchFocus(event) {
    let searchObj = event.currentTarget;
    let menupopup = searchObj.closest("menupopup");
    menupopup.parentElement.activeChild = null;
    menupopup.setAttribute("ignorekeys", "true");
    this._actor.sendAsyncMessage("Forms:SearchFocused", {});
  },

  onSearchBlur(event) {
    let searchObj = event.currentTarget;
    let menupopup = searchObj.closest("menupopup");
    menupopup.setAttribute("ignorekeys", "false");
  },
};

class SelectParent extends JSWindowActorParent {
  receiveMessage(message) {
    let topBrowsingContext = this.manager.browsingContext.top;
    let browser = topBrowsingContext.embedderElement;
    switch (message.name) {
      case "Forms:ShowDropDownBegin": {
        if (browser.outerBrowser) {
          // We are in RDM mode
          browser = browser.outerBrowser;
        }

        if (!browser.hasAttribute("selectmenulist")) {
          return;
        }

        let document = browser.ownerDocument;
        let menulist = document.getElementById(
          browser.getAttribute("selectmenulist")
        );

        if (!this._menulist) {
          // Cache the menulist to have access to it
          // when the document is gone (eg: Tab closed)
          this._menulist = menulist;
        }

        let data = message.data;
        menulist.menupopup.style.direction = data.style.direction;

        let useFullZoom =
          !browser.isRemoteBrowser ||
          Services.prefs.getBoolPref("browser.zoom.full") ||
          browser.isSyntheticDocument;
        let zoom = useFullZoom ? browser._fullZoom : browser._textZoom;

        SelectParentHelper.populate(
          menulist,
          data.options,
          data.estimatedOptionCount,
          data.uniqueStyles,
          data.selectedIndex,
          zoom,
          data.defaultStyle,
          data.style
        );
        SelectParentHelper.open(
          browser,
          menulist,
          data.rect,
          data.isOpenedViaTouch,
          this
        );
        break;
      }

      case "Forms:HideDropDown": {
        if (browser.outerBrowser) {
          // We are in RDM mode
          browser = browser.outerBrowser;
        }

        SelectParentHelper.hide(this._menulist, browser);
        break;
      }

      default:
        SelectParentHelper.receiveMessage(browser, message);
    }
  }
}
