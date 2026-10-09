/*
 * home-layout.js
 * How the home screen is laid out when it opens, and the controls that
 * fold things away:
 *   - "What do you want to do?" and "Where you stand" can each be folded
 *     (click the heading) and start open or folded;
 *   - "Where you stand" has Expand all / Collapse all;
 *   - chapters start as "next one only", all open or all closed, and
 *     topics and ideas start open or closed;
 *   - the Settings panel (header button) sets these starting choices.
 *
 * The starting choices are kept in this browser and, when cloud sync is
 * on, in the account, so every device opens the same way. Folding by
 * hand never changes the saved choices.
 *
 * Events: "recallquiz:layout-changed" (the reader chose; cloud sync
 * listens) and "recallquiz:layout-applied" (the screen should redraw;
 * also fired when a newer choice arrives from the account).
 */
(function setUpHomeLayout(quiz) {
  "use strict";

  const { findElement, createElement, createButton } = quiz.helpers;
  const STORAGE_KEY = "recall-quiz-home-layout";

  /** The allowed values for each choice; the first one is the default. */
  const OPTIONS = {
    setup: ["open", "closed"],
    stand: ["open", "closed"],
    chapters: ["next", "open", "closed"],
    inner: ["closed", "open"],
  };

  const choice = readSavedChoice();
  /** Whether each panel is folded right now (starts from the choice) */
  const folded = {};
  resetFolded();

  // ------------------------------------------------------------ storage

  /** @returns {{setup, stand, chapters, inner, at: number}} */
  function readSavedChoice() {
    let saved = {};
    try {
      saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY)) || {};
    } catch (problem) {
      saved = {};
    }
    return sanitize(saved);
  }

  /**
   * Keep only allowed values; anything else falls back to the default.
   * @param {object} raw
   * @returns {{setup, stand, chapters, inner, at: number}}
   */
  function sanitize(raw) {
    const clean = {
      at: Number.isFinite(raw.at) && raw.at > 0 ? raw.at : 0,
    };
    Object.keys(OPTIONS).forEach(function pick(name) {
      clean[name] = OPTIONS[name].indexOf(raw[name]) >= 0 ?
        raw[name] : OPTIONS[name][0];
    });
    return clean;
  }

  function saveChoice() {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(choice));
    } catch (problem) {
      // Storage may be blocked; the choice still works until the page closes.
    }
  }

  function resetFolded() {
    folded.setup = choice.setup === "closed";
    folded.stand = choice.stand === "closed";
  }

  // ---------------------------------------------------- reading choices

  /** @returns {"next"|"open"|"closed"} how chapters start */
  function chaptersStart() {
    return choice.chapters;
  }

  /** @returns {boolean} whether topics and ideas start open */
  function innerStartsOpen() {
    return choice.inner === "open";
  }

  // ------------------------------------------------------------ folding

  /**
   * Make the first heading of a panel a button that folds the panel.
   * Safe to call again after the panel is redrawn.
   * @param {HTMLElement} panel
   * @param {"setup"|"stand"} key
   */
  function makeFoldable(panel, key) {
    const heading = panel.querySelector("h2");
    if (!heading || heading.querySelector(".panel-toggle")) {
      return;
    }
    const button = createElement("button", "panel-toggle");
    button.type = "button";
    button.appendChild(createElement("span", null, heading.textContent));
    button.appendChild(createElement("i", "chevron"));
    heading.textContent = "";
    heading.appendChild(button);
    button.addEventListener("click", function toggle() {
      folded[key] = !folded[key];
      showFolded(panel, key);
    });
    showFolded(panel, key);
  }

  /** Show or hide a panel's body to match its folded state. */
  function showFolded(panel, key) {
    panel.classList.toggle("is-collapsed", folded[key]);
    const button = panel.querySelector(".panel-toggle");
    if (button) {
      button.setAttribute("aria-expanded", String(!folded[key]));
    }
  }

  /**
   * Open or close every chapter, topic and idea inside a panel.
   * @param {HTMLElement} panel
   * @param {boolean} open
   */
  function setAllOpen(panel, open) {
    panel.querySelectorAll("details").forEach(function set(details) {
      details.open = open;
    });
  }

  /**
   * The "Expand all" and "Collapse all" buttons for a panel.
   * @param {HTMLElement} panel
   * @returns {HTMLElement}
   */
  function createExpandControls(panel) {
    const row = createElement("div", "expand-controls");
    row.appendChild(createButton("Expand all", "", function expand() {
      setAllOpen(panel, true);
    }));
    row.appendChild(createButton("Collapse all", "", function collapse() {
      setAllOpen(panel, false);
    }));
    return row;
  }

  // ------------------------------------------------------ settings panel

  /** Connect the Settings button and the choice buttons. */
  function setUpSettingsPanel() {
    const panel = findElement("settings-panel");
    const button = findElement("settings-button");
    if (!panel || !button) {
      return;
    }
    button.addEventListener("click", function togglePanel() {
      const isOpen = !panel.classList.toggle("hidden");
      button.setAttribute("aria-expanded", String(isOpen));
    });
    panel.querySelectorAll("[data-layout]").forEach(
      function connect(group) {
        const name = group.getAttribute("data-layout");
        group.querySelectorAll("button").forEach(function wire(option) {
          option.addEventListener("click", function pick() {
            choice[name] = option.getAttribute("data-value");
            choice.at = Date.now();
            saveChoice();
            resetFolded();
            showChoices();
            document.dispatchEvent(
              new CustomEvent("recallquiz:layout-changed"));
            document.dispatchEvent(
              new CustomEvent("recallquiz:layout-applied"));
          });
        });
      });
    showChoices();
    makeFoldable(findElement("session-setup"), "setup");
  }

  /** Mark the buttons that match the saved choices. */
  function showChoices() {
    document.querySelectorAll("#settings-panel [data-layout]").forEach(
      function mark(group) {
        const current = choice[group.getAttribute("data-layout")];
        group.querySelectorAll("button").forEach(function set(option) {
          option.setAttribute("aria-pressed",
            String(option.getAttribute("data-value") === current));
        });
      });
    showFolded(findElement("session-setup"), "setup");
  }

  // ---------------------------------------------------------- account

  /**
   * Use a choice from the account if it is newer than this browser's.
   * @param {{s, w, c, i, a: number}} remote
   * @returns {boolean} whether the account's choice was used
   */
  function useRemote(remote) {
    if (!remote || !(remote.a > choice.at)) {
      return false;
    }
    Object.assign(choice, sanitize({
      setup: remote.s, stand: remote.w, chapters: remote.c,
      inner: remote.i, at: remote.a,
    }));
    saveChoice();
    resetFolded();
    showChoices();
    document.dispatchEvent(new CustomEvent("recallquiz:layout-applied"));
    return true;
  }

  /** @returns {{s, w, c, i, a: number}} the choice in its saved shape */
  function readForAccount() {
    return {
      s: choice.setup, w: choice.stand, c: choice.chapters,
      i: choice.inner, a: choice.at,
    };
  }

  quiz.layout = {
    chaptersStart, innerStartsOpen, makeFoldable, createExpandControls,
    setAllOpen, readForAccount, useRemote,
    showStandFolded: function showStandFolded(panel) {
      makeFoldable(panel, "stand");
      showFolded(panel, "stand");
    },
  };

  document.addEventListener("DOMContentLoaded", setUpSettingsPanel);
})((window.RecallQuiz = window.RecallQuiz || {}));
