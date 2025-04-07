/* Any copyright is dedicated to the Public Domain.
 * http://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

const isMac = AppConstants.platform == "macosx";
const isLinux = AppConstants.platform == "linux";

// The following constants specify the default key combinations for various
// commands. They must be updated if these change in future.
// key_gotoHistory
const historyDisplay = isMac ? "⇧⌘H" : "Ctrl+H";
const historyModifiers = isMac ? "accel,shift" : "accel";
const historyOptions = { accelKey: true, shiftKey: isMac };

// The following unused* constants specify a key combination which is unused by
// default. This will need to be updated if this key combination is assigned to
// something by default in future.
const unusedModifiers = "accel,shift";
const unusedOptions = { accelKey: true, shiftKey: true };
const unusedKey = isLinux ? "Q" : "Y";
const unusedModifiersDisplay = isMac ? "⇧⌘" : "Ctrl+Shift+";
const unusedDisplay = `${unusedModifiersDisplay}${unusedKey}`;
