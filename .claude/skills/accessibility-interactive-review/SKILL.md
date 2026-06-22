---
name: accessibility-interactive-review
description: >
  Interactively tests the accessibility of Firefox UI by navigating with the keyboard,
  inspecting the accessibility tree, comparing with screenshots, and checking focus behavior.
  A companion to accessibility-frontend-review (which reviews code); this skill interacts
  with live UI to find issues that cannot be spotted from code alone.
  Use when the user asks to test or check accessibility of any Firefox UI element, panel,
  toolbar button, dialog, or menu — even if they don't mention focus, screen readers, or
  specific accessibility concepts. This skill endeavors to cover the full range of
  accessibility concerns including keyboard navigation, focus management, labelling,
  roles, and semantics.
---

# Accessibility Interactive Review

You drive a live Firefox instance via the firefox-devtools MCP and a privileged JS layer to
test accessibility interactively. You spawn subagents for context-heavy review work and
compile their findings into a single report.

---

## Step 1: Clarify the target

Ask the user:
1. Which part of the Firefox UI do they want to check? (e.g. "the toolbar", "the site info popup", "the settings page", "the tab bar")
2. If it's not clear how to reach it: should Firefox be on a specific page first? Does it require a particular state?

Do not proceed until you have at least (1).

---

## Step 2: Set up Firefox

### 2a. Check Firefox is running with privileged access

Call `mcp__firefox-devtools__get_firefox_info`. If `MOZ_REMOTE_ALLOW_SYSTEM_ACCESS=1` is not
in the environment, restart Firefox with that env var set, preserving the existing binary path.

### 2b. Select the privileged context

Call `mcp__firefox-devtools__list_privileged_contexts`. Select the context for
`chrome://browser/content/browser.xhtml` using `mcp__firefox-devtools__select_privileged_context`.

### 2c. Inject the utility script

Read `injection.js` from this skill's directory and pass its full content to
`mcp__firefox-devtools__evaluate_privileged_script`. Confirm the result is `"_a11y injected"`.

---

## Step 3: Navigate to the target UI with the keyboard

Reach the target element using keyboard navigation, mirroring what a keyboard or assistive
technology user would actually do. This confirms the element is reachable and verifies the
navigation path.

### CRITICAL: Key events are asynchronous

`sendNativeKeyEvent` posts to the OS event queue. Always send a key in one
`evaluate_privileged_script` call, then check focus in a **separate** call.

Check focus after each key press:
```js
_a11y.dumpFocus()
```

### Toolbar keyboard navigation

The Firefox main toolbar is divided into tab stop groups, with the address bar text box in the middle of several groups of toolbar buttons.
Tab and Shift+Tab move to the next and previous group respectively, always positioning you on the first button in the group.
Right and left arrow keys move within a group, but do not move between groups or wrap around.
Toolbar buttons do not have a tab index — toolbar keyboard navigation is handled specially — so do not assume a toolbar button is not keyboard focusable because it lacks a tab index.
F6 cycles focus through major chrome regions (content, toolbar, notification bars) and may need multiple presses.

When searching for a specific toolbar button, follow this algorithm:

1. Focus the address bar.
2. Press Tab or Shift+Tab once to land on a toolbar group.
3. Press Right Arrow repeatedly, checking focus after each press, to visit every button in the current group. Do this even if you think the target is in a different direction. You cannot know the button's position without exploring.
4. Only after the current group is fully explored (Right Arrow no longer moves focus or you have visited every button) should you press Tab or Shift+Tab to move to the next or previous group.
5. Repeat from step 3 until the target button is found.

If focus doesn't land where expected after reasonable effort, that may itself be an
accessibility issue — note it and try an alternative route.

### Activating elements

- **Space** and **Enter** should both activate buttons — test both.
- After activation, verify the UI opened using this sequence:

  **1. Focus check** (did focus move somewhere new?):
  ```js
  _a11y.dumpFocus()
  _a11y.dumpFocusAncestry()
  ```
  If focus moved into the expected UI (visible from the ancestry chain), activation succeeded.
  If focus did not move, the panel may still have opened without managing focus — that is itself
  an accessibility bug, but confirm visually before recording it as such.

  **2. Screenshot** — take whenever focus did not move, or the focus evidence is ambiguous.
  Take a full desktop screenshot saved to file and spawn a minimal subagent to verify:
  - Save screenshot: use the OS-appropriate tool (`screencapture -x`, `scrot`, or PowerShell
    `CopyFromScreen`) to save to `artifacts/verify-N.png`. Ensure Firefox is foreground first.
  - Spawn a subagent with: the file path, and the single question "Does this screenshot show
    [name of UI] open? Answer yes or no and briefly describe what you see."
  - If the screenshot confirms the UI opened but focus did not move inside it, that is a focus
    management bug — record it as a finding and continue.
  - If the screenshot confirms the UI did not open, activation failed — investigate why before
    continuing.

---

## Step 4: Gather evidence (repeat for each UI state)

Test multiple states: the element at rest, after keyboard focus arrives, after activation
(panel open, dialog shown, etc.), and after dismissal (Escape pressed, panel closed).

For each state, gather:

### 4a. Screenshot

Save the screenshot to a file in `artifacts/` — do not let image data enter this context.

For regular UI:
```
mcp__firefox-devtools__screenshot_page  saveTo: "artifacts/screenshot-N.png"
```

For popup panels (which don't appear in `screenshot_page`), use OS-level tools to capture
the full desktop, saving directly to file:
- **macOS**: `screencapture -x artifacts/screenshot-N.png`
- **Linux**: `scrot artifacts/screenshot-N.png` or `import artifacts/screenshot-N.png`
- **Windows**: use PowerShell with `System.Drawing.CopyFromScreen` saving to the file path

Ensure Firefox is the foreground window before capturing. Confirm the panel is open via
focus evidence or a prior verification screenshot before capturing the evidence screenshot.

Only record the file path. Do not read or describe the image — the subagent will read it.

### 4b. Accessibility tree dump

Save the tree to a file to avoid large JSON in this context:
```js
// In evaluate_privileged_script:
_a11y.dumpSubtree("root-element-id", 10)
// Then write the result string to artifacts/tree-N.json
```

Scope to the specific subtree of interest (e.g. just the open panel, not the whole toolbar).

### 4c. Focus state

```js
_a11y.dumpFocus()
// When you need to verify the focus context (e.g. after activation):
_a11y.dumpFocusAncestry()
```

Record inline (it's small): what key was pressed, what `dumpFocus` returned, and whether
the result seems correct. When the ancestry is relevant, note the closest meaningful ancestor
(role + name) from `dumpFocusAncestry`.

---

## Step 5: Spawn review subagents

Spawn one subagent per distinct UI state tested (e.g. one for the element at rest, one for
the panel after it opens). Each returns a list of findings. You will compile them in Step 6.

Use this prompt for each subagent, filling in the actual data:

```
## UI state being reviewed
[NAME AND DESCRIBE THE STATE — e.g. "The site information panel, open after pressing Space on the lock icon"]

## Screenshot
[FILE PATH — e.g. artifacts/screenshot-1.png. Read this file to view the screenshot.]

## Accessibility tree
[FILE PATH — e.g. artifacts/tree-1.json. Read this file to get the tree dump.]

## Navigation log
[FOR EACH KEY PRESSED: describe in plain English what happened — e.g. "Tab: focus moved to the
Submit button" or "Space: the panel opened but focus stayed on the trigger button outside the
panel". Do not include raw tool output, JSON, or internal method names. Translate observations
into what a user or tester would describe.]

## Your task

### Step 1: Load review resources in parallel
Read `.claude/skills/accessibility-frontend-review/references/runsheet.md`

### Step 2: Visual analysis
Read the screenshot. Examine it for issues that the accessibility tree cannot reveal:
- **Contrast**: Does any text, icon, or control appear low-contrast against its background? Flag anything that looks marginal, even without computing an exact ratio.
- **Focus indicators**: Is a visible focus ring or highlight present on the currently focused element? Is it clearly visible, or is it low-contrast or absent?
- **Colour alone**: Is any information (error state, required field, chart data, status) conveyed using colour with no other visual distinction such as a pattern, icon, shape, or label?
- **Text sizing**: Does any text look unusually small?
- **Images and icons**: Are there images or icons that appear to convey meaning? Note them so you can cross-reference with the tree.

### Step 3: Tree vs. visual comparison
Read the tree file. For each visually distinct element in the screenshot:
- Is it present in the tree?
- Does its role match its appearance and interaction model?
- Does its name clearly describe what it does and its current state?
- Are visual states (checked, expanded, selected, pressed, disabled) reflected in the tree?
- Do any images or icons identified in Step 2 lack a name in the tree?

Note: do not flag unlabelled or unnamed child nodes that sit inside a role with "children
presentational" behaviour per the ARIA spec. The following roles make all their descendants
presentational, so individual children neither need names nor need to be explicitly hidden:
`button`, `checkbox`, `img`, `link`, `menuitem`, `menuitemcheckbox`, `menuitemradio`, `option`,
`progressbar`, `radio`, `separator`, `slider`, `switch`, `tab`.

### Step 4: Navigation evidence
Review the navigation log. For each focus observation, consider:
- Did focus land in the right place?
- If a panel or dialog opened, did focus move into it?
- If a panel was dismissed, did focus return to the trigger?
- Is the focused element correctly described in the tree?

This is one input among several. Do not weight keyboard and focus disproportionately relative to other runsheet categories.

### Step 5: Full runsheet pass
Work through every applicable category in the runsheet, giving each equal consideration.
Assign a severity based on the severity ratings described below.
If an issue type is explicitly covered by an example in the severity ratings below, assign that severity; do not alter the severity based on reasoning outside this guidance.
Record each issue using the output format below.

#### Severity ratings
- s1: Accessibility of the entire product is broken. Examples include a critical piece of the browser's functionality like the URLbar not working. These bugs represent catastrophic failures and should be rare.
- s2: Feature completely unavailable/inaccessible; i.e. a person with a disability cannot independently use it. These bugs should absolutely block a feature from shipping to our stable release audience. Examples include:
    *  Lack of keyboard support
    * Missing labels for screen reader users on icon buttons/links
    * Missing semantic indication of toggle state
    * Insufficient contrast
    * Missing focus indicators
    * Missing controls in HCM (due to no background images) that make a feature not discoverable/actionable by users with low vision
    * UI does not adapt to HCM at all, or adapts in a way that makes it unusable such as having a foreground and background color that are the same
    * UI that disappears or becomes otherwise inaccessible with large zoom factors (200% and 400%)
    * Touch targets below WCAG recommendations (interactive target areas are smaller than 24x24 CSS px on desktop or smaller than 35 dp on mobile)
- s3: Feature available but difficult to use. These bugs should be fixed and may or may not block a feature from shipping to our stable release audience and will be evaluated for blocking status on a case by case basis. Examples include:
    * inconsiderate tab order
    * Missing alt text for non-text content
    * Visually hidden but not accessibility hidden content
    * Inconsistent heading levels
    * Dialogs that should be role=document
    * Missing semantic indication of other states such as expanded and has popup
    * Missing dialog labels
    * Duplication of semantic state in the label; e.g. the label includes the word "on" when the control also has a semantic checked or pressed state
    * Difficult to see or partially covered focus indicators
    * UI adapts to HCM and is visible but may not use semantic colors correctly for some themes (e.g. it is using a `ButtonText` system color on `Canvas` background), which may result in low visibility
    * UI that is cut off, obscured, truncated or causes two-dimensional scroll with large zoom factors
    * Touch targets under mobile platform recommendations (interactive target areas are between 24x24 and 44x44 CSS px on desktop or between 35-41 dp on mobile)
- s4: Feature available with minor defects. These bugs do not block a feature from shipping to our release audience. Examples include:
    * Minor overlapping of the control borders while on HCM
    * UI that adapts to HCM and is visible but may have minor defects such as incorrect border sizing or a focus ring that slightly overlaps other controls but doesn't render them unusable
    * Interactive target areas that are between 42-48 dp on mobile
    * Use of alertdialog role where dialog is more appropriate
    * Technically compliant with WCAG patterns, but could be improved to be more delightful and efficient to use

### Output
Return a structured list of findings. For each issue:

**[Runsheet category]** · [Severity]
**What you see:** [Plain description of the element — e.g. "the lock icon button in the address bar"]
**Element:** [DOM tag and id if known]
**Problem:** [Specific technical issue]
**Impact:** [Effect on keyboard or screen reader users]
**Fix:** [Concrete suggestion]

If no issues found, say so clearly. Flag S2+ issues as requiring attention before shipping.
```

---

## Step 6: Compile and present the report

Wait for all subagents. Combine their findings into a single report using the format from
`.claude/skills/accessibility-frontend-review/SKILL.md`. Deduplicate issues that appear in
multiple states.

If issues were found, ask the user whether to file bugs — use the `bug-filing` skill.
