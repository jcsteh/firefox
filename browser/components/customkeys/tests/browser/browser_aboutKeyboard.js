/* Any copyright is dedicated to the Public Domain.
 * http://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

const { PromptTestUtils } = ChromeUtils.importESModule(
  "resource://testing-common/PromptTestUtils.sys.mjs"
);

/**
 * Test the about:keyboard UI.
 */

registerCleanupFunction(() => {
  CustomKeys.resetAll();
});

function addAboutKbTask(task) {
  const wrapped = function () {
    return BrowserTestUtils.withNewTab("about:keyboard", tab => {
      return task(tab.contentDocument, tab.contentWindow);
    });
  };
  // Propagate the name of the task function to our wrapper function so it shows up in test run output.
  Object.defineProperty(wrapped, "name", { value: task.name });
  add_task(wrapped);
}

// Test initial loading of about:keyboard.
addAboutKbTask(async function testInit(doc) {
  Assert.greater(
    doc.querySelectorAll("tbody").length,
    5,
    "At least 5 categories"
  );
  const numKeys = doc.querySelectorAll(".key").length;
  Assert.greater(numKeys, 50, "At least 50 keys");
  is(
    doc.querySelectorAll("tbody[hidden], tr[hidden]").length,
    0,
    "No hidden categories or keys"
  );
  is(
    doc.querySelectorAll(".customized").length,
    0,
    "No shortcuts are customized"
  );
  // Currently, we don't have any unassigned shortcuts. That will probably
  // change in future, at which point this next assertion will need to be
  // reconsidered.
  is(
    doc.querySelectorAll(".assigned").length,
    numKeys,
    "All keys are assigned"
  );
  is(doc.querySelectorAll(".editing").length, 0, "No keys are being edited");
});

// Test searching.
addAboutKbTask(async function testSearch(doc, win) {
  is(
    doc.querySelectorAll("tbody[hidden], tr[hidden]").length,
    0,
    "No hidden categories or keys"
  );
  const search = doc.getElementById("search");
  search.focus();

  info("Searching for zzz");
  let handled = BrowserTestUtils.waitForEvent(search, "input");
  EventUtils.sendString("zzz", win);
  await handled;
  is(
    doc.querySelectorAll("tbody:not([hidden]), .key:not([hidden])").length,
    0,
    "No visible categories or keys"
  );

  info("Clearing search");
  handled = BrowserTestUtils.waitForEvent(search, "input");
  EventUtils.synthesizeKey("KEY_Escape", {}, win);
  await handled;
  is(
    doc.querySelectorAll("tbody[hidden], tr[hidden]").length,
    0,
    "No hidden categories or keys"
  );

  info("Searching for download");
  handled = BrowserTestUtils.waitForEvent(search, "input");
  EventUtils.sendString("download", win);
  await handled;
  let visibleKeys = doc.querySelectorAll(".key:not([hidden])");
  is(visibleKeys.length, 1, "1 visible key");
  is(
    visibleKeys[0].dataset.id,
    "key_openDownloads",
    "Visible key is key_openDownloads"
  );
  let visibleCategories = doc.querySelectorAll("tbody:not([hidden])");
  is(visibleCategories.length, 1, "1 visible category");
  is(
    visibleKeys[0].closest("tbody"),
    visibleCategories[0],
    "Visible key is inside visible category"
  );
  ok(
    !visibleCategories[0].querySelector(".category").hidden,
    "Category header is visible"
  );

  info("Clearing search");
  handled = BrowserTestUtils.waitForEvent(search, "input");
  EventUtils.synthesizeKey("KEY_Escape", {}, win);
  await handled;
  is(
    doc.querySelectorAll("tbody[hidden], tr[hidden]").length,
    0,
    "No hidden categories or keys"
  );

  info("Searching for history");
  handled = BrowserTestUtils.waitForEvent(search, "input");
  EventUtils.sendString("history", win);
  await handled;
  // This gives us results from both the Sidebars and History categories.
  visibleKeys = doc.querySelectorAll(".key:not([hidden])");
  is(visibleKeys.length, 3, "3 visible keys");
  visibleCategories = doc.querySelectorAll("tbody:not([hidden])");
  is(visibleCategories.length, 2, "2 visible categories");
});

// Test a simple change.
addAboutKbTask(async function testChange(doc, win) {
  const downloadsRow = doc.querySelector('.key[data-id="key_openDownloads"]');
  ok(
    !downloadsRow.classList.contains("customized"),
    "key_openDownloads is not customized"
  );
  is(
    downloadsRow.children[1].textContent,
    downloadsDisplay,
    "Key is the default key"
  );
  info("Clicking Change for key_openDownloads");
  const input = downloadsRow.querySelector(".new");
  let focused = BrowserTestUtils.waitForEvent(input, "focus");
  const change = downloadsRow.querySelector(".change");
  change.click();
  await focused;
  ok(true, "New key input got focus");
  info(`Pressing ${unusedModifiersDisplay}`);
  let keyHandled = BrowserTestUtils.waitForEvent(input, "keydown");
  EventUtils.synthesizeKey(...unusedModifiersArgs, win);
  await keyHandled;
  is(
    input.value,
    unusedModifiersDisplay,
    "Input shows modifiers as they're pressed"
  );
  info(`Pressing ${unusedDisplay}`);
  focused = BrowserTestUtils.waitForEvent(change, "focus");
  EventUtils.synthesizeKey(unusedKey, unusedOptions, win);
  await focused;
  ok(true, "Change button got focus");
  ok(
    downloadsRow.classList.contains("customized"),
    "key_openDownloads is customized"
  );
  is(
    downloadsRow.children[1].textContent,
    unusedDisplay,
    "Key is the customized key"
  );
  // We deliberately let the result of this test leak into the next one.
});

// Test resetting a key. This also tests that the change from the previous test
// is reflected when the page is reloaded.
addAboutKbTask(async function testReset(doc) {
  const downloadsRow = doc.querySelector('.key[data-id="key_openDownloads"]');
  ok(
    downloadsRow.classList.contains("customized"),
    "key_openDownloads is customized"
  );
  is(
    downloadsRow.children[1].textContent,
    unusedDisplay,
    "Key is the customized key"
  );
  info("Clicking Reset for key_openDownloads");
  const reset = downloadsRow.querySelector(".reset");
  let clicked = BrowserTestUtils.waitForEvent(reset, "click");
  reset.click();
  await clicked;
  ok(
    !downloadsRow.classList.contains("customized"),
    "key_openDownloads is not customized"
  );
  is(
    downloadsRow.children[1].textContent,
    downloadsDisplay,
    "Key is the default key"
  );
});

// Test clearing a key.
addAboutKbTask(async function testClear(doc) {
  const downloadsRow = doc.querySelector('.key[data-id="key_openDownloads"]');
  ok(
    !downloadsRow.classList.contains("customized"),
    "key_openDownloads is not customized"
  );
  ok(
    downloadsRow.classList.contains("assigned"),
    "key_openDownloads is assigned"
  );
  info("Clicking Clear for key_openDownloads");
  const clear = downloadsRow.querySelector(".clear");
  let clicked = BrowserTestUtils.waitForEvent(clear, "click");
  clear.click();
  await clicked;
  ok(
    downloadsRow.classList.contains("customized"),
    "key_openDownloads is customized"
  );
  ok(
    !downloadsRow.classList.contains("assigned"),
    "key_openDownloads is not assigned"
  );
  is(downloadsRow.children[1].textContent, "", "Key is empty");
  // We deliberately let the result of this test leak into the next one.
});

// Test resetting all keys. This depends on the state set up by the previous
// test.
addAboutKbTask(async function testResetAll(doc) {
  const downloadsRow = doc.querySelector('.key[data-id="key_openDownloads"]');
  ok(
    downloadsRow.classList.contains("customized"),
    "key_openDownloads is customized"
  );
  ok(
    !downloadsRow.classList.contains("assigned"),
    "key_openDownloads is not assigned"
  );

  info("Clicking Reset all, then Cancel");
  let handled = PromptTestUtils.handleNextPrompt(
    window,
    { modalType: Services.prompt.MODAL_TYPE_CONTENT },
    { buttonNumClick: 1 }
  );
  const resetAll = doc.getElementById("resetAll");
  resetAll.click();
  await handled;
  ok(
    downloadsRow.classList.contains("customized"),
    "key_openDownloads is customized"
  );
  ok(
    !downloadsRow.classList.contains("assigned"),
    "key_openDownloads is not assigned"
  );

  info("Clicking Reset all, then OK");
  handled = PromptTestUtils.handleNextPrompt(
    window,
    { modalType: Services.prompt.MODAL_TYPE_CONTENT },
    { buttonNumClick: 0 }
  );
  resetAll.click();
  await handled;
  ok(
    !downloadsRow.classList.contains("customized"),
    "key_openDownloads is not customized"
  );
  ok(
    downloadsRow.classList.contains("assigned"),
    "key_openDownloads is assigned"
  );
});

// Test a change which conflicts with another key.
addAboutKbTask(async function testConflictingChange(doc, win) {
  const downloadsRow = doc.querySelector('.key[data-id="key_openDownloads"]');
  ok(
    !downloadsRow.classList.contains("customized"),
    "key_openDownloads is not customized"
  );
  const historyRow = doc.querySelector('.key[data-id="key_gotoHistory"]');
  ok(
    !historyRow.classList.contains("customized"),
    "key_gotoHistory is not customized"
  );

  info("Clicking Change for key_openDownloads");
  const input = downloadsRow.querySelector(".new");
  let focused = BrowserTestUtils.waitForEvent(input, "focus");
  const change = downloadsRow.querySelector(".change");
  change.click();
  await focused;
  ok(true, "New key input got focus");
  info(`Pressing ${historyDisplay}, then clicking Cancel`);
  let handled = PromptTestUtils.handleNextPrompt(
    window,
    { modalType: Services.prompt.MODAL_TYPE_CONTENT },
    { buttonNumClick: 1 }
  );
  focused = BrowserTestUtils.waitForEvent(change, "focus");
  EventUtils.synthesizeKey("H", historyOptions, win);
  await handled;
  await focused;
  ok(true, "Change button got focus");
  ok(
    !downloadsRow.classList.contains("customized"),
    "key_openDownloads is not customized"
  );
  ok(
    !historyRow.classList.contains("customized"),
    "key_gotoHistory is not customized"
  );

  info("Clicking Change for key_openDownloads");
  focused = BrowserTestUtils.waitForEvent(input, "focus");
  change.click();
  await focused;
  ok(true, "New key input got focus");
  info(`Pressing ${historyDisplay}, then clicking OK`);
  handled = PromptTestUtils.handleNextPrompt(
    window,
    { modalType: Services.prompt.MODAL_TYPE_CONTENT },
    { buttonNumClick: 0 }
  );
  focused = BrowserTestUtils.waitForEvent(change, "focus");
  EventUtils.synthesizeKey("H", historyOptions, win);
  await handled;
  await focused;
  ok(true, "Change button got focus");
  ok(
    downloadsRow.classList.contains("customized"),
    "key_openDownloads is customized"
  );
  ok(
    downloadsRow.classList.contains("assigned"),
    "key_openDownloads is assigned"
  );
  is(
    downloadsRow.children[1].textContent,
    historyDisplay,
    "Key is the customized key"
  );
  ok(
    historyRow.classList.contains("customized"),
    "key_gotoHistory is customized"
  );
  ok(
    !historyRow.classList.contains("assigned"),
    "key_gotoHistory is not assigned"
  );
  is(historyRow.children[1].textContent, "", "Key is empty");
  // We deliberately let the result of this test leak into the next one.
});

// Test a reset which conflicts with another key. This depends on the state set
// up by the previous test.
addAboutKbTask(async function testConflictingReset(doc) {
  const downloadsRow = doc.querySelector('.key[data-id="key_openDownloads"]');
  ok(
    downloadsRow.classList.contains("customized"),
    "key_openDownloads is customized"
  );
  const historyRow = doc.querySelector('.key[data-id="key_gotoHistory"]');
  ok(
    historyRow.classList.contains("customized"),
    "key_gotoHistory is customized"
  );

  info("Clicking Reset for key_gotoHistory, then Cancel");
  let handled = PromptTestUtils.handleNextPrompt(
    window,
    { modalType: Services.prompt.MODAL_TYPE_CONTENT },
    { buttonNumClick: 1 }
  );
  const reset = historyRow.querySelector(".reset");
  reset.click();
  await handled;
  ok(
    downloadsRow.classList.contains("customized"),
    "key_openDownloads is customized"
  );
  ok(
    historyRow.classList.contains("customized"),
    "key_gotoHistory is customized"
  );

  info("Clicking Reset for key_gotoHistory, then OK");
  handled = PromptTestUtils.handleNextPrompt(
    window,
    { modalType: Services.prompt.MODAL_TYPE_CONTENT },
    { buttonNumClick: 0 }
  );
  reset.click();
  await handled;
  ok(
    downloadsRow.classList.contains("customized"),
    "key_openDownloads is customized"
  );
  ok(
    !downloadsRow.classList.contains("assigned"),
    "key_openDownloads is not assigned"
  );
  is(downloadsRow.children[1].textContent, "", "Key is empty");
  ok(
    !historyRow.classList.contains("customized"),
    "key_gotoHistory is not customized"
  );
  ok(historyRow.classList.contains("assigned"), "key_gotoHistory is assigned");
  is(
    historyRow.children[1].textContent,
    historyDisplay,
    "Key is the default key"
  );
});
