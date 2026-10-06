#!/usr/bin/env python3
"""Browser tests for the quiz. Run from the project folder:

    python3 tests/run_tests.py

Needs Playwright once:  pip install playwright && playwright install chromium

The script starts a small web server, opens the page in a headless
browser and checks that every question type, the confidence check, the
timed session, saved progress, book labels and themes all work. It
prints PASS or FAIL for each check and exits with 1 if anything failed.

Every question is checked for correct fields. In the browser, a large
bank is sampled (a few questions of each type); add --all to answer
every question right and wrong (slow: about a second per question).
"""

import json
import re
import subprocess
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "tools"))
from merge_question_bank import question_problems  # noqa: E402

SITE_FOLDER = Path(__file__).resolve().parent.parent
PORT = 8765
PAGE_URL = f"http://localhost:{PORT}/index.html"
BOOK = json.loads((SITE_FOLDER / "questions.json").read_text())

ANSWER_EVERY_QUESTION = "--all" in sys.argv
SAMPLE_PER_KIND = 3
failures = []


def check(description, condition, detail=""):
    """Print one test result and remember failures."""
    if condition:
        print(f"  PASS  {description}")
    else:
        print(f"  FAIL  {description}  ({detail})")
        failures.append(description)


# ------------------------------------------------------------- answering


def answer_question(page, question, answer_wrongly):
    """Answer one question on screen, right or wrong on purpose."""
    kind = question["kind"]
    if kind == "tf":
        right_key = 1 if question["answer"] else 2
        page.keyboard.press(str(3 - right_key if answer_wrongly
                                else right_key))
    elif kind == "mcq":
        right_key = question["answer"] + 1
        wrong_key = 1 if right_key != 1 else 2
        page.keyboard.press(str(wrong_key if answer_wrongly else right_key))
    elif kind == "multi":
        if answer_wrongly:
            ticks = [index for index in range(len(question["options"]))
                     if index not in question["answers"]][:1]
        else:
            ticks = question["answers"]
        for index in ticks:
            page.keyboard.press(str(index + 1))
        page.keyboard.press("Enter")
    elif kind == "fill":
        typed = "banana" if answer_wrongly else question["accept"][0]
        page.fill(".fill-input", typed)
        page.keyboard.press("Enter")
        if answer_wrongly:
            page.click(".self-rating .miss")
    elif kind == "order":
        items = question["items"]
        for text in (list(reversed(items)) if answer_wrongly else items):
            page.click(f'.order-pool .order-item:text-is("{text}")')
        page.click("text=Check order")
    elif kind == "match":
        pairs = question["pairs"]
        partners = pairs[::-1] if answer_wrongly else pairs
        for (left, _), (_, right) in zip(pairs, partners):
            page.click(f'.match-column:nth-child(1) '
                       f'.match-item:text-is("{left}")')
            page.click(f'.match-column:nth-child(2) '
                       f'.match-item:text-is("{right}")')
        page.click("text=Check matches")
    elif kind == "sort":
        for item in question["items"]:
            group = 1 - item["g"] if answer_wrongly else item["g"]
            page.click(f'.sort-pool .sort-chip:text-is("{item["t"]}")')
            page.click(f".sort-group:nth-child({group + 1}) "
                       ".sort-group-head")
        page.click("text=Check groups")
    elif kind == "recall":
        page.keyboard.press("Space")
        page.keyboard.press("1" if answer_wrongly else "3")


def open_page(browser, questions=None, book=None, width=430):
    """Open the quiz, optionally with a made-up questions.json."""
    page = browser.new_page(viewport={"width": width, "height": 900})
    page.errors = []
    page.on("pageerror", lambda error: page.errors.append(str(error)))
    page.on("dialog", lambda dialog: dialog.accept())
    page.route("**/fonts.googleapis.com/**", lambda route: route.abort())
    if questions is not None or book is not None:
        served = dict(book or BOOK)
        if questions is not None:
            served["questions"] = questions
        page.route("**/questions.json",
                   lambda route: route.fulfill(json=served))
    page.goto(PAGE_URL)
    page.wait_for_selector("#book-title:not(:text-is('Recall Quiz'))")
    return page


def start_session(page, confidence=False, timed=False):
    """Pick "Everything", all questions, and press Start."""
    page.click("#question-filter-choice button[data-value='all']")
    page.fill("#question-count-input", "")
    if confidence:
        page.click("#confidence-choice button[data-value='on']")
    if timed:
        page.click("#session-length-choice button[data-value='time']")
    page.click("#start-button")


# ------------------------------------------------------------- tests


def test_every_question_is_well_formed():
    """Every question has the fields its type needs (no browser)."""
    print("Every question in questions.json has the right fields")
    questions = BOOK["questions"]
    broken = [f"{question.get('id')}: {'; '.join(problems)}"
              for question in questions
              for problems in [question_problems(question)] if problems]
    ids = [question.get("id") for question in questions]
    repeated = sorted({qid for qid in ids if ids.count(qid) > 1}) \
        if len(ids) != len(set(ids)) else []
    check(f"all {len(questions)} questions are well formed", not broken,
          "; ".join(broken[:5]))
    check("question ids are unique", not repeated, ", ".join(repeated[:5]))


def questions_to_answer():
    """All questions for a small bank or with --all; else a sample.

    The sample takes a few questions of each type, spread across the
    book, so every type is tried without taking an hour.
    """
    questions = BOOK["questions"]
    if ANSWER_EVERY_QUESTION or len(questions) <= 8 * SAMPLE_PER_KIND:
        return questions
    sample = []
    kinds = sorted({question["kind"] for question in questions})
    for kind in kinds:
        of_kind = [question for question in questions
                   if question["kind"] == kind]
        step = max(1, len(of_kind) // SAMPLE_PER_KIND)
        sample.extend(of_kind[::step][:SAMPLE_PER_KIND])
    return sample


def test_every_question_type(browser):
    """Each question, right gives 1 mark and wrong gives 0."""
    questions = questions_to_answer()
    print(f"{len(questions)} of {len(BOOK['questions'])} questions, "
          "answered right and wrong")
    for question in questions:
        for answer_wrongly in (False, True):
            page = open_page(browser, questions=[question])
            start_session(page)
            answer_question(page, question, answer_wrongly)
            if question["kind"] != "recall":
                page.wait_for_selector("#question-card .verdict")
                page.keyboard.press("Enter")
            marks = page.inner_text(".result-marks")
            expected = "Marks: 0 out of 1" if answer_wrongly \
                else "Marks: 1 out of 1"
            how = "wrong" if answer_wrongly else "right"
            check(f"{question['id']} ({question['kind']}) answered {how}",
                  marks == expected and not page.errors,
                  marks if marks != expected else "; ".join(page.errors))
            page.close()


def test_confidence_check(browser):
    """Answers wait for a confidence level; certain misses are flagged."""
    print("Confidence check")
    question = next(q for q in BOOK["questions"] if q["kind"] == "tf")
    page = open_page(browser, questions=[question])
    start_session(page, confidence=True)
    is_locked = page.eval_on_selector(
        ".confidence-row ~ div", "area => area.matches('.is-locked')")
    check("answers are locked until a confidence level is picked",
          is_locked)
    page.click(".confidence-row .pill-button:has-text('Certain')")
    answer_question(page, question, answer_wrongly=True)
    page.wait_for_selector("#question-card .confident-miss")
    page.keyboard.press("Enter")
    check("a certain-but-wrong answer is flagged on the results",
          page.is_visible(".result .confident-miss"))
    page.close()


def test_timed_session(browser):
    """A timed session shows the clock in the pill and on the card."""
    print("Timed session")
    page = open_page(browser)
    start_session(page, timed=True)
    pill = page.inner_text("#session-pill")
    check("the pill shows the time left", pill.startswith("Time left"),
          pill)
    check("the card shows a session clock",
          page.is_visible("#question-card .session-clock"))
    page.close()


def test_question_timer_runs_out(browser):
    """An unanswered question is marked when its timer runs out."""
    print("Timer per question")
    question = next(q for q in BOOK["questions"] if q["kind"] == "mcq")
    page = open_page(browser, questions=[question])
    page.clock.install()
    page.click("#question-timer-choice button[data-value='15']")
    start_session(page)
    page.clock.run_for(16000)
    verdict = page.inner_text("#question-card .verdict")
    check("an unanswered question is marked when time runs out",
          verdict == "Time's up.", verdict)
    page.close()


def test_old_progress_is_upgraded(browser):
    """Version-1 saved progress is read and re-saved as version 2."""
    print("Saved progress from the older version")
    first_id = BOOK["questions"][0]["id"]
    old_progress = {
        "items": {first_id: {"box": 1, "seen": 2, "missed": 1,
                             "due": 0, "last": 0}},
        "days": [],
        "history": [{"t": 1759660000000, "pct": 75, "marks": 3,
                     "total": 4, "v": "pass", "scope": "Whole book",
                     "limit": 0, "mins": 0}],
    }
    page = open_page(browser)
    page.evaluate(
        "([key, value]) => localStorage.setItem(key, value)",
        [f"recall-quiz:{BOOK['id']}", json.dumps(old_progress)])
    page.reload()
    page.wait_for_selector("#recent-results .history-row")
    history_score = page.inner_text("#recent-results .history-score")
    learning = page.inner_text("#progress-tally div:nth-child(2) b")
    check("old results appear in Your recent results",
          history_score.startswith("75%"), history_score)
    check("old question progress counts as Learning", learning == "1",
          learning)
    saved = json.loads(page.evaluate(
        f"localStorage.getItem('recall-quiz:{BOOK['id']}')"))
    check("it is saved again in the new format",
          saved.get("version") == 2 and first_id in saved["questions"])
    page.close()


def test_backup_without_version_keeps_progress(browser):
    """A version-2 backup that lost its version field is not wiped."""
    print("Loading a backup")
    first_id = BOOK["questions"][0]["id"]
    backup = {"questions": {first_id: {
        "memoryLevel": 3, "timesSeen": 3, "timesMissed": 0,
        "nextReview": 0, "lastAnswered": 0, "confidentMisses": 0}},
        "daysPracticed": [], "recentResults": []}
    page = open_page(browser)
    page.set_input_files("#progress-file-input", files=[{
        "name": "backup.json", "mimeType": "application/json",
        "buffer": json.dumps(backup).encode()}])
    page.wait_for_function(
        "document.querySelector('#progress-tally b').textContent === '1'")
    solid = page.inner_text("#progress-tally div:nth-child(1) b")
    check("a backup without a version field is loaded, not wiped",
          solid == "1", solid)
    page.close()


def test_book_labels(browser):
    """labels in questions.json change the words on the page."""
    print("Book labels from questions.json")
    book = dict(BOOK)
    book["labels"] = {"unit": "Lesson", "units": "lessons",
                      "topic": "Section", "whole": "Whole course"}
    page = open_page(browser, book=book)
    check("the chapter picker says Lesson",
          page.inner_text("#unit-picker-label") == "Lesson")
    # "1 lesson" for a one-chapter book, "3 lessons" otherwise.
    check("the summary counts lessons",
          "lesson" in page.inner_text("#book-summary"))
    start_session(page)
    chip = page.inner_text(".unit-chip")
    check("the question shows the Lesson label", chip.startswith("Lesson"),
          chip)
    page.close()


def test_themes(browser):
    """Every theme folder is in the picker and choices are remembered."""
    print("Themes")
    theme_folders = [folder for folder in (SITE_FOLDER / "themes").iterdir()
                     if (folder / "theme.json").exists()]
    page = open_page(browser)
    page.click("#theme-button")
    tile_count = page.locator(".theme-tile").count()
    check("every theme folder has a tile in the picker",
          tile_count == len(theme_folders),
          f"{tile_count} tiles, {len(theme_folders)} folders")
    page.click(".theme-tile[data-theme-id='lego']")
    page.click("#theme-mode-choice button[data-theme-mode='dark']")
    root = page.evaluate("""() => [
        document.documentElement.dataset.theme,
        document.documentElement.dataset.scheme]""")
    check("choosing Lego and Dark switches the page",
          root == ["lego", "dark"], str(root))
    page.reload()
    root = page.evaluate("() => document.documentElement.dataset.theme")
    check("the choice is remembered after a reload", root == "lego")
    page.close()


def test_phone_width(browser):
    """Nothing scrolls sideways at phone width."""
    print("Phone width (375px)")
    page = open_page(browser, width=375)
    scrolls_sideways = page.evaluate(
        "() => document.documentElement.scrollWidth > innerWidth")
    check("the home screen does not scroll sideways",
          not scrolls_sideways)
    page.close()


def test_every_linked_file_exists():
    """Every script, stylesheet and theme file index.html points to
    must exist, so an incomplete upload is caught before publishing."""
    html = (SITE_FOLDER / "index.html").read_text()
    links = re.findall(r'(?:src|href)="([^"#:]+\.(?:js|css|json|svg))"', html)
    missing = [name for name in links if not (SITE_FOLDER / name).exists()]
    check("every file linked from index.html exists", not missing,
          f"missing: {missing}")
    check("helpers.js loads before the other app scripts",
          html.index("js/helpers.js") < html.index("js/book.js"))


def main():
    """Start a web server, run every test, and report."""
    server = subprocess.Popen(
        [sys.executable, "-m", "http.server", str(PORT)],
        cwd=SITE_FOLDER, stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL)
    time.sleep(1)
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch()
            test_every_linked_file_exists()
            test_every_question_is_well_formed()
            test_every_question_type(browser)
            test_confidence_check(browser)
            test_timed_session(browser)
            test_question_timer_runs_out(browser)
            test_old_progress_is_upgraded(browser)
            test_backup_without_version_keeps_progress(browser)
            test_book_labels(browser)
            test_themes(browser)
            test_phone_width(browser)
            browser.close()
    finally:
        server.kill()
    print()
    if failures:
        print(f"{len(failures)} check(s) failed.")
        sys.exit(1)
    print("All checks passed.")


if __name__ == "__main__":
    main()
