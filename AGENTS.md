# Notes for AI agents

This is a static, framework-free quiz site (HTML, CSS, vanilla JS) that
runs on GitHub Pages and from `file://`. There is no build step for the
app itself. The only generated files come from
`python3 tools/build_themes.py`.

Before changing anything, read in this order:

1. `ai-context/README.md`: which file to read for which task
2. `ai-context/architecture.md`: modules, shared state, load order, flow
3. `ai-context/coding-conventions.md`: the style every change must follow

Hard rules:

- Never hand-edit `css/themes.css` or `js/themes-list.js`. Edit the
  `themes/<id>/` folders and run `python3 tools/build_themes.py`.
- Never change a question's `id` in `questions.json` unless asked: saved
  progress is keyed by it.
- Keep the saved-progress format backward compatible (see
  `ai-context/data-formats.md`). If you change it, bump `version` and add
  an upgrade step in `js/progress-storage.js`.
- Keep lines under 80 characters, one job per function, and a doc comment
  on every function.
- To build a question bank from a book, follow "Build a question bank
  from a book file" in `ai-context/recipes.md` (the tools in `tools/`).
  Keep the working folder (`work/`) out of the published site.
- Run `python3 tests/run_tests.py` after every change. All checks must
  pass.
