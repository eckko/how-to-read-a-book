/*
 * theme-picker.js
 * Light, dark or system mode, and the theme picker.
 *
 * This file is loaded in <head>, so the saved theme is applied before
 * the page is drawn (no flash of the wrong colours). The tiles are built
 * once the page has loaded.
 *
 * How themes are switched: the <html> element gets three attributes,
 *   data-theme="lego"      which theme
 *   data-mode="system"     what the reader chose: light, dark or system
 *   data-scheme="dark"     what is actually showing: light or dark
 * and css/themes.css has a block of colours for each theme and scheme.
 *
 * The list of themes comes from js/themes-list.js, which
 * tools/build_themes.py generates.
 */
(function setUpThemePicker() {
  "use strict";

  /** One saved choice for every book on this site */
  const STORAGE_KEY = "recall-quiz:theme";
  const DEFAULT_THEME = "classic";
  const DEFAULT_MODE = "system";

  const pageRoot = document.documentElement;
  const themes = window.QUIZ_THEMES || [[DEFAULT_THEME, "Classic"]];
  const darkModeQuery = window.matchMedia
    ? window.matchMedia("(prefers-color-scheme: dark)")
    : null;

  /** The reader's choice: theme id and light / dark / system */
  const choice = readSavedChoice();

  /** @returns {{themeId: string, mode: string}} */
  function readSavedChoice() {
    const saved = { themeId: DEFAULT_THEME, mode: DEFAULT_MODE };
    try {
      // Stored as {t: themeId, m: mode} to stay compatible with old saves.
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      saved.themeId = stored.t || saved.themeId;
      saved.mode = stored.m || saved.mode;
    } catch (storageError) {
      // Storage blocked: use the defaults.
    }
    if (!themes.some(isTheme(saved.themeId))) {
      saved.themeId = DEFAULT_THEME;
    }
    return saved;
  }

  /** @param {string} themeId  @returns {function(Array): boolean} */
  function isTheme(themeId) {
    return function matchesId(theme) {
      return theme[0] === themeId;
    };
  }

  /** Remember the choice in this browser (for every book on the site). */
  function saveChoice() {
    try {
      const stored = { t: choice.themeId, m: choice.mode };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
    } catch (storageError) {
      // Storage blocked: the choice lasts until the tab is closed.
    }
  }

  /** @returns {boolean} true if the page should be dark right now */
  function shouldBeDark() {
    if (choice.mode === "system") {
      return Boolean(darkModeQuery && darkModeQuery.matches);
    }
    return choice.mode === "dark";
  }

  /** Switch the page to the chosen theme and mode, and save it. */
  function applyChoice() {
    pageRoot.setAttribute("data-theme", choice.themeId);
    pageRoot.setAttribute("data-mode", choice.mode);
    pageRoot.setAttribute("data-scheme", shouldBeDark() ? "dark" : "light");
    saveChoice();
    markPressedButtons();
  }

  /** Show which mode button and which tile are chosen. */
  function markPressedButtons() {
    document.querySelectorAll("#theme-mode-choice button").forEach(
      function markModeButton(button) {
        const mode = button.getAttribute("data-theme-mode");
        button.setAttribute("aria-pressed", String(mode === choice.mode));
      });
    document.querySelectorAll("#theme-tiles .theme-tile").forEach(
      function markTile(tile) {
        const themeId = tile.getAttribute("data-theme-id");
        tile.setAttribute("aria-pressed", String(themeId === choice.themeId));
      });
  }

  /** Load the fonts the themes use (one request to Google Fonts). */
  function loadThemeFonts() {
    if (!window.QUIZ_THEME_FONTS_URL) {
      return;
    }
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = window.QUIZ_THEME_FONTS_URL;
    document.head.appendChild(link);
  }

  /**
   * A preview tile: mascot, three colour dots, a button and the name.
   * The colours come from css/themes.css, by data-theme-id.
   * @param {string} themeId
   * @param {string} themeName
   * @returns {HTMLButtonElement}
   */
  function createThemeTile(themeId, themeName) {
    const tile = document.createElement("button");
    tile.type = "button";
    tile.className = "theme-tile";
    tile.setAttribute("data-theme-id", themeId);
    tile.appendChild(createPart("div", "tile-mascot"));
    const swatches = createPart("div", "tile-swatches");
    swatches.appendChild(createPart("i"));
    swatches.appendChild(createPart("i"));
    swatches.appendChild(createPart("i"));
    tile.appendChild(swatches);
    tile.appendChild(createPart("div", "tile-button", "Go"));
    tile.appendChild(createPart("div", "tile-name", themeName));
    tile.addEventListener("click", function chooseTheme() {
      choice.themeId = themeId;
      applyChoice();
    });
    return tile;
  }

  /**
   * Create one part of a tile (theme-picker.js loads before helpers.js,
   * so it has its own small element maker).
   * @param {string} tagName
   * @param {string} [className]
   * @param {string} [text]
   * @returns {HTMLElement}
   */
  function createPart(tagName, className, text) {
    const element = document.createElement(tagName);
    if (className) {
      element.className = className;
    }
    if (text) {
      element.textContent = text;
    }
    return element;
  }

  /**
   * Call a function when the device switches between light and dark.
   * (Safari before version 14 only has the older addListener.)
   * @param {Function} onChange
   */
  function listenForSystemModeChanges(onChange) {
    if (darkModeQuery.addEventListener) {
      darkModeQuery.addEventListener("change", onChange);
    } else {
      darkModeQuery.addListener(onChange);
    }
  }

  /** Build the tiles and connect the buttons. Runs once the page loads. */
  function setUpPicker() {
    const tileArea = document.getElementById("theme-tiles");
    const panel = document.getElementById("theme-panel");
    const themeButton = document.getElementById("theme-button");
    if (!tileArea || !themeButton) {
      return;
    }
    themes.forEach(function addTile(theme) {
      tileArea.appendChild(createThemeTile(theme[0], theme[1]));
    });
    document.querySelectorAll("#theme-mode-choice button").forEach(
      function connectModeButton(button) {
        button.addEventListener("click", function chooseMode() {
          choice.mode = button.getAttribute("data-theme-mode");
          applyChoice();
        });
      });
    themeButton.addEventListener("click", function togglePanel() {
      const isOpen = !panel.classList.toggle("hidden");
      themeButton.setAttribute("aria-expanded", String(isOpen));
    });
    if (darkModeQuery) {
      listenForSystemModeChanges(function followSystem() {
        if (choice.mode === "system") {
          applyChoice();
        }
      });
    }
    applyChoice();
  }

  applyChoice();          // before the page is drawn
  loadThemeFonts();
  document.addEventListener("DOMContentLoaded", setUpPicker);
})();
