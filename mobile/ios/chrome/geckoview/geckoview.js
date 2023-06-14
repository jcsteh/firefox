/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

ChromeUtils.defineESModuleGetters(this, {
  E10SUtils: "resource://gre/modules/E10SUtils.sys.mjs",
});

function createBrowser() {
  const browser = (window.browser = document.createXULElement("browser"));
  // Identify this `<browser>` element uniquely to Marionette, devtools, etc.
  // Use the JSM global to create the permanentKey, so that if the
  // permanentKey is held by something after this window closes, it
  // doesn't keep the window alive. See also Bug 1501789.
  browser.permanentKey = new (Cu.getGlobalForObject(Services).Object)();

  browser.setAttribute("nodefaultsrc", "true");
  browser.setAttribute("type", "content");
  browser.setAttribute("primary", "true");
  browser.setAttribute("flex", "1");
  browser.setAttribute("maychangeremoteness", "true");
  browser.setAttribute("remote", "true");
  browser.setAttribute("remoteType", E10SUtils.DEFAULT_REMOTE_TYPE);
  browser.setAttribute("messagemanagergroup", "browsers");

  // The browser starts up as inactive for a tab by default.
  // See: https://bugzilla.mozilla.org/show_bug.cgi?id=1815015
  browser.setAttribute("initiallyactive", "false");

  // This is only needed for mochitests, so that they honor the
  // prefers-color-scheme.content-override pref. GeckoView doesn't set this
  // pref to anything other than the default value otherwise.
  browser.setAttribute(
    "style",
    "color-scheme: env(-moz-content-preferred-color-scheme)"
  );

  return browser;
}

function startup() {
  const browser = createBrowser();

  window.document.documentElement.appendChild(browser);

  browser.preserveLayers(true);

  browser.fixupAndLoadURIString("http://example.edu", {
    triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
  });
}

startup();

