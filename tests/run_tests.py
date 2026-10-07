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
import tempfile
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


def sync_config_script(provider="none", save_delay_seconds=20, **settings):
    """The text of a js/sync/sync-config.js for one provider."""
    config = {"provider": provider, "saveDelaySeconds": save_delay_seconds,
              provider: settings}
    return "window.RecallQuizSyncConfig = " + json.dumps(config) + ";"


def open_page(browser, questions=None, book=None, width=430,
              sync_config=None, before_load=None):
    """Open the quiz, optionally with a made-up questions.json.

    Cloud sync is off unless sync_config (the text of a sync-config.js)
    is given, so the tests never reach a real database. before_load is
    JavaScript run before the page's own scripts."""
    page = browser.new_page(viewport={"width": width, "height": 900})
    page.errors = []
    page.on("pageerror", lambda error: page.errors.append(str(error)))
    page.on("dialog", lambda dialog: dialog.accept())
    page.route("**/fonts.googleapis.com/**", lambda route: route.abort())
    config_text = sync_config or sync_config_script("none")
    page.route("**/js/sync/sync-config.js", lambda route: route.fulfill(
        body=config_text, content_type="text/javascript"))
    if before_load:
        page.add_init_script(before_load)
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


def test_sanskrit_answers(browser):
    """Devanagari, IAST and plain Roman spellings count as the same."""
    print("Sanskrit and Devanagari answers in fill-in questions")
    question = {
        "id": "t-fill", "unit": "Chapter 1", "section": "Words",
        "kind": "fill", "q": "The Sanskrit word for duty is ____.",
        "accept": ["धर्म", "dharma"], "explain": "x"}
    cases = [
        ("धर्म", True), ("dharma", True), ("Dharma", True),
        ("dharmā", True), ("dhārma", True), ("karma", False),
        ("कर्म", False), ("yoga", False)]
    for typed, should_match in cases:
        page = open_page(browser, questions=[question])
        start_session(page)
        page.fill(".fill-input", typed)
        page.keyboard.press("Enter")
        page.wait_for_selector(".fill-input.is-correct, "
                               ".fill-input.is-incorrect")
        matched = page.eval_on_selector(
            ".fill-input", "e => e.classList.contains('is-correct')")
        verdict = "accepted" if should_match else "not accepted"
        check(f"typing {typed} is {verdict}",
              matched == should_match and not page.errors,
              "; ".join(page.errors))
        page.close()
    other = dict(question, accept=["संस्कृतम्", "saṃskṛtam"])
    for typed, should_match in [("samskritam", True), ("संस्कृतम्", True),
                                ("sanskaram", False)]:
        page = open_page(browser, questions=[other])
        start_session(page)
        page.fill(".fill-input", typed)
        page.keyboard.press("Enter")
        page.wait_for_selector(".fill-input.is-correct, "
                               ".fill-input.is-incorrect")
        matched = page.eval_on_selector(
            ".fill-input", "e => e.classList.contains('is-correct')")
        check(f"typing {typed} for saṃskṛtam is "
              f"{'accepted' if should_match else 'not accepted'}",
              matched == should_match, "")
        page.close()


def test_formulas(browser):
    """Formulas show as typeset maths; prices stay plain text."""
    print("Formulas")
    math_question = {
        "id": "t-math", "unit": "Chapter 1", "section": "Algebra",
        "kind": "mcq",
        "q": "What is \\(x^2 + 1\\) when \\(x = 3\\)?",
        "options": ["\\(10\\)", "\\(7\\)", "\\(9\\)", "\\(4\\)"],
        "answer": 0, "explain": "Since \\(3^2 = 9\\), the sum is 10."}
    page = open_page(browser, questions=[math_question])
    start_session(page)
    page.wait_for_selector("#question-card .katex")
    shown = page.locator("#question-card .katex").count()
    check("the question and options show typeset maths", shown >= 5,
          f"{shown} formulas")
    raw = page.inner_text("#question-card")
    check("the raw \\( marks are gone", "\\(" not in raw, raw[:80])
    page.keyboard.press("1")
    page.wait_for_selector("#question-card .verdict")
    check("the explanation formula is typeset too",
          page.locator("#question-card .explanation .katex, "
                       "#question-card .feedback .katex").count() >= 1
          or page.locator("#question-card .katex").count() > shown,
          "no new formula in feedback")
    check("no page errors", not page.errors, "; ".join(page.errors))
    page.close()

    price_question = {
        "id": "t-price", "unit": "Chapter 1", "section": "Money",
        "kind": "tf", "q": "True or false: $5 plus $10 is $15.",
        "answer": True, "explain": "Costs $15 in total."}
    requests = []
    page = browser.new_page(viewport={"width": 430, "height": 900})
    page.on("request", lambda request: requests.append(request.url))
    page.route("**/fonts.googleapis.com/**", lambda route: route.abort())
    served = dict(BOOK, questions=[price_question])
    page.route("**/questions.json", lambda route: route.fulfill(json=served))
    page.goto(PAGE_URL)
    page.wait_for_selector("#book-title:not(:text-is('Recall Quiz'))")
    start_session(page)
    page.wait_for_selector("#question-card")
    text = page.inner_text("#question-card")
    check("dollar prices stay as text", "$5 plus $10 is $15" in text, text[:90])
    check("a book without formulas never loads the maths library",
          not any("vendor/katex" in url for url in requests), "")
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


# ------------------------------------------------------------ cloud sync

EXAMPLE_STORE_KEY = f"recall-quiz-example-store:example-user/{BOOK['id']}"
OWNER_KEY = f"recall-quiz-sync-owner:{BOOK['id']}"
LOCAL_KEY = f"recall-quiz:{BOOK['id']}"


def progress_record(level, answered_at):
    """A saved record for one question."""
    return {"memoryLevel": level, "timesSeen": 1, "timesMissed": 0,
            "nextReview": 0, "lastAnswered": answered_at,
            "confidentMisses": 0}


def progress_with(records):
    """Version 2 progress holding the given question records."""
    return {"version": 2, "questions": records, "daysPracticed": [],
            "recentResults": []}


def read_json(page, storage, key):
    """Parse a JSON value from localStorage or sessionStorage."""
    text = page.evaluate(f"{storage}.getItem({json.dumps(key)})")
    return json.loads(text) if text else None


def wait_for_sync_status(page, status, seconds=10):
    """Wait until the sync bar shows a state (saved, signed-out, ...)."""
    page.wait_for_selector(f'#cloud-sync-bar[data-status="{status}"]',
                           timeout=seconds * 1000)


def answer_in_code(page, question_id, result="got"):
    """Record an answer the way a finished question does."""
    page.evaluate("([id, result]) => "
                  "RecallQuiz.memory.recordAnswer(id, result, false)",
                  [question_id, result])


def test_sync_off(browser):
    """With provider "none" there is no sync bar and no errors."""
    print("Cloud sync turned off")
    page = open_page(browser)
    check("the sync bar stays hidden",
          page.is_hidden("#cloud-sync-bar"))
    check("no script errors", not page.errors, page.errors)
    page.close()


def test_sync_sign_in_merges(browser):
    """Signing in combines this browser's and the account's progress."""
    print("Cloud sync: signing in merges both copies")
    ids = [question["id"] for question in BOOK["questions"][:3]]
    account = progress_with({ids[0]: progress_record(4, 2000000000000),
                             ids[2]: progress_record(2, 1700000000000)})
    page = open_page(
        browser, sync_config=sync_config_script("example-in-browser"),
        before_load=f"sessionStorage.setItem({json.dumps(EXAMPLE_STORE_KEY)}"
                    f", {json.dumps(json.dumps(account))});")
    wait_for_sync_status(page, "signed-out")
    check("the bar offers sign-in",
          "Sign in with a test account" in page.inner_text(
              "#cloud-sync-bar"))
    answer_in_code(page, ids[0])
    answer_in_code(page, ids[1])
    page.click("#cloud-sync-bar button")
    wait_for_sync_status(page, "saved")
    local = read_json(page, "localStorage", LOCAL_KEY)["questions"]
    stored = read_json(page, "sessionStorage", EXAMPLE_STORE_KEY)
    check("the newer account record wins",
          local[ids[0]]["memoryLevel"] == 4, local.get(ids[0]))
    check("this browser's answers are kept", ids[1] in local)
    check("account-only answers arrive here", ids[2] in local)
    check("the account now holds all three",
          set(ids) <= set(stored["questions"]), list(stored["questions"]))
    check("this browser is marked as the account's",
          page.evaluate(f"localStorage.getItem('{OWNER_KEY}')") ==
          "example-user")
    check("the home screen counts the merged progress",
          page.inner_text("#progress-tally div:nth-child(2) b") != "0")
    check("no script errors", not page.errors, page.errors)
    page.close()


def test_sync_saves_while_practising(browser):
    """Answers reach the account after a pause and at session end."""
    print("Cloud sync: saving while practising")
    question = next(q for q in BOOK["questions"] if q["kind"] == "tf")
    signed_in = "sessionStorage.setItem('recall-quiz-example-account'," \
                " 'example-user');"
    page = open_page(browser, questions=[question] + BOOK["questions"][1:3],
                     sync_config=sync_config_script(
                         "example-in-browser", save_delay_seconds=1),
                     before_load=signed_in)
    wait_for_sync_status(page, "saved")
    second_id = BOOK["questions"][1]["id"]
    answer_in_code(page, second_id)
    page.wait_for_timeout(1800)
    stored = read_json(page, "sessionStorage", EXAMPLE_STORE_KEY)
    check("an answer is saved after the pause",
          second_id in stored["questions"])
    page.close()

    page = open_page(browser, questions=[question],
                     sync_config=sync_config_script(
                         "example-in-browser", save_delay_seconds=600),
                     before_load=signed_in)
    wait_for_sync_status(page, "saved")
    start_session(page)
    answer_question(page, question, answer_wrongly=False)
    page.keyboard.press("Enter")
    page.wait_for_selector(".result-hero")
    page.wait_for_timeout(300)
    stored = read_json(page, "sessionStorage", EXAMPLE_STORE_KEY)
    check("a finished session is saved straight away",
          question["id"] in stored["questions"]
          and len(stored["recentResults"]) == 1)
    page.close()


def test_sync_reset_and_sign_out(browser):
    """Reset reaches the account; sign-out clears only this browser."""
    print("Cloud sync: reset and sign out")
    first_id = BOOK["questions"][0]["id"]
    account = progress_with({first_id: progress_record(3, 1700000000000)})
    page = open_page(
        browser, sync_config=sync_config_script("example-in-browser"),
        before_load="sessionStorage.setItem('recall-quiz-example-account',"
                    " 'example-user'); sessionStorage.setItem("
                    f"{json.dumps(EXAMPLE_STORE_KEY)}, "
                    f"{json.dumps(json.dumps(account))});")
    wait_for_sync_status(page, "saved")
    page.click("#reset-progress-button")
    page.evaluate("RecallQuiz.cloudSync.saveNow()")
    wait_for_sync_status(page, "saved")
    stored = read_json(page, "sessionStorage", EXAMPLE_STORE_KEY)
    check("a reset empties the account copy too",
          not stored["questions"] and stored.get("resetAt"), stored)

    answer_in_code(page, first_id)
    page.evaluate("RecallQuiz.cloudSync.saveNow()")
    wait_for_sync_status(page, "saved")
    page.click("#cloud-sync-bar button:has-text('Sign out')")
    wait_for_sync_status(page, "signed-out")
    local = read_json(page, "localStorage", LOCAL_KEY)
    stored = read_json(page, "sessionStorage", EXAMPLE_STORE_KEY)
    check("signing out clears this browser", not local["questions"])
    check("the account keeps the progress", first_id in stored["questions"])
    page.click("#cloud-sync-bar button")
    wait_for_sync_status(page, "saved")
    local = read_json(page, "localStorage", LOCAL_KEY)
    check("signing in again brings it back", first_id in local["questions"])
    check("no script errors", not page.errors, page.errors)
    page.close()


def test_sync_ignores_another_readers_progress(browser):
    """Progress left by a different account is not mixed into yours."""
    print("Cloud sync: someone else's progress on this device")
    first_id = BOOK["questions"][0]["id"]
    left_behind = progress_with({first_id: progress_record(4, 1700000000000)})
    page = open_page(
        browser, sync_config=sync_config_script("example-in-browser"),
        before_load=f"localStorage.setItem('{OWNER_KEY}', 'someone-else');"
                    f"localStorage.setItem({json.dumps(LOCAL_KEY)}, "
                    f"{json.dumps(json.dumps(left_behind))});")
    wait_for_sync_status(page, "signed-out")
    page.click("#cloud-sync-bar button")
    wait_for_sync_status(page, "saved")
    local = read_json(page, "localStorage", LOCAL_KEY)
    check("the other reader's answers are dropped",
          first_id not in local["questions"], local)
    page.close()


FAKE_FIREBASE_SETUP = """
window.fakeFirebase = { user: null, listeners: [], docs: {}, writes: 0 };
"""
FAKE_FIREBASE_MODULES = {
    "firebase-app.js": """
export function initializeApp(settings) {
  window.fakeFirebase.settings = settings; return {};
}""",
    "firebase-auth.js": """
const fake = window.fakeFirebase;
function tell() { fake.listeners.forEach(listener => listener(fake.user)); }
export function getAuth() { return {}; }
export function onAuthStateChanged(auth, listener) {
  fake.listeners.push(listener); listener(fake.user);
}
export function getRedirectResult() { return Promise.resolve(null); }
export class GoogleAuthProvider {}
export function signInWithPopup() {
  fake.user = { uid: "u1", displayName: "Test Reader", email: "t@x" };
  tell(); return Promise.resolve({ user: fake.user });
}
export function signInWithRedirect() { return signInWithPopup(); }
export function signOut() {
  fake.user = null; tell(); return Promise.resolve();
}
""",
    "firebase-firestore.js": """
const fake = window.fakeFirebase;
export function getFirestore() { return {}; }
export function doc(db, ...parts) { return parts.join("/"); }
export function getDoc(path) {
  const data = fake.docs[path];
  return Promise.resolve({ exists: () => Boolean(data), data: () => data });
}
export function setDoc(path, data) {
  if (fake.neverAnswer) { return new Promise(() => {}); }
  fake.docs[path] = data; fake.writes += 1; return Promise.resolve();
}
export function serverTimestamp() { return "server-time"; }
""",
}


def serve_fake_firebase(route):
    """Answer a request for the Firebase SDK with a small fake."""
    name = route.request.url.rsplit("/", 1)[-1]
    route.fulfill(body=FAKE_FIREBASE_MODULES[name],
                  content_type="text/javascript",
                  headers={"Access-Control-Allow-Origin": "*"})


def test_firebase_adapter(browser):
    """The Firebase adapter signs in and writes users/{uid}/books/{id}."""
    print("Cloud sync: Firebase adapter (with a fake Firebase SDK)")
    config = sync_config_script("firebase", sdkVersion="12.19.0",
                                apiKey="test-key", projectId="test")
    page = open_page(browser, sync_config=config,
                     before_load=FAKE_FIREBASE_SETUP)
    page.route("**/www.gstatic.com/firebasejs/**", serve_fake_firebase)
    page.reload()
    page.wait_for_selector("#book-title:not(:text-is('Recall Quiz'))")
    wait_for_sync_status(page, "signed-out")
    check("the button says Sign in with Google",
          page.inner_text("#cloud-sync-bar button") ==
          "Sign in with Google")
    first_id = BOOK["questions"][0]["id"]
    answer_in_code(page, first_id)
    page.click("#cloud-sync-bar button")
    wait_for_sync_status(page, "saved")
    path = "users/u1/books/" + page.evaluate(
        f"encodeURIComponent({json.dumps(BOOK['id'])})")
    saved = page.evaluate(f"window.fakeFirebase.docs[{json.dumps(path)}]")
    check("progress is written to users/{uid}/books/{book id}",
          bool(saved), page.evaluate("Object.keys(window.fakeFirebase.docs)"))
    if saved:
        check("only progress and a timestamp are stored",
              sorted(saved) == ["progress", "updatedAt"], list(saved))
        check("the questions themselves are not stored",
              first_id in json.loads(saved["progress"])["questions"]
              and "options" not in saved["progress"])
    check("the bar names the signed-in reader",
          "Test Reader" in page.inner_text("#cloud-sync-bar"))
    check("sdkVersion is not passed to Firebase",
          "sdkVersion" not in page.evaluate("window.fakeFirebase.settings"))
    check("no script errors", not page.errors, page.errors)
    page.close()


def test_sync_when_database_is_unreachable(browser):
    """If the database cannot be reached the quiz still works."""
    print("Cloud sync: database unreachable")
    page = open_page(browser, sync_config=sync_config_script(
        "firebase", sdkVersion="12.19.0"))
    page.route("**/www.gstatic.com/**", lambda route: route.abort())
    page.reload()
    page.wait_for_selector("#book-title:not(:text-is('Recall Quiz'))")
    wait_for_sync_status(page, "error")
    question_count = page.inner_text("#book-summary")
    check("the quiz still loads", "question" in question_count)
    page.unroute("**/www.gstatic.com/**")
    page.route("**/www.gstatic.com/firebasejs/**", serve_fake_firebase)
    page.add_init_script(FAKE_FIREBASE_SETUP)
    page.click("#cloud-sync-bar button:has-text('Try again')")
    wait_for_sync_status(page, "signed-out")
    check("Try again reconnects once the database is back", True)
    check("no script errors", not page.errors, page.errors)
    page.close()


def test_sync_load_backup_after_reset(browser, scratch_folder):
    """Reset then Load puts the backup in the account (a rollback)."""
    print("Cloud sync: Reset then Load a backup")
    ids = [question["id"] for question in BOOK["questions"][:2]]
    account = progress_with({ids[0]: progress_record(3, 1700000000000)})
    backup_file = scratch_folder / "backup.json"
    backup_file.write_text(json.dumps(
        progress_with({ids[1]: progress_record(2, 1600000000000)})))
    page = open_page(
        browser, sync_config=sync_config_script("example-in-browser"),
        before_load="sessionStorage.setItem('recall-quiz-example-account',"
                    " 'example-user'); sessionStorage.setItem("
                    f"{json.dumps(EXAMPLE_STORE_KEY)}, "
                    f"{json.dumps(json.dumps(account))});")
    wait_for_sync_status(page, "saved")
    page.click("#reset-progress-button")
    page.evaluate("RecallQuiz.cloudSync.saveNow()")
    wait_for_sync_status(page, "saved")
    page.set_input_files("#progress-file-input", str(backup_file))
    page.wait_for_function("Object.keys(RecallQuiz.progress.saved"
                           ".questions).length > 0")
    page.evaluate("RecallQuiz.cloudSync.saveNow()")
    wait_for_sync_status(page, "saved")
    local = read_json(page, "localStorage", LOCAL_KEY)["questions"]
    stored = read_json(page, "sessionStorage", EXAMPLE_STORE_KEY)
    check("the backup is kept here", list(local) == [ids[1]], list(local))
    check("the backup replaces the account copy",
          list(stored["questions"]) == [ids[1]], list(stored["questions"]))
    page.close()


def test_two_tabs_keep_each_others_answers(browser):
    """Two open tabs of one book never overwrite each other."""
    print("Two tabs open at once")
    context = browser.new_context()
    pages = []
    for _ in range(2):
        page = context.new_page()
        page.route("**/fonts.googleapis.com/**", lambda route: route.abort())
        page.route("**/js/sync/sync-config.js", lambda route: route.fulfill(
            body=sync_config_script("none"),
            content_type="text/javascript"))
        page.goto(PAGE_URL)
        page.wait_for_selector("#book-title:not(:text-is('Recall Quiz'))")
        pages.append(page)
    ids = [question["id"] for question in BOOK["questions"][:2]]
    answer_in_code(pages[1], ids[0])
    pages[0].wait_for_timeout(300)
    answer_in_code(pages[0], ids[1])
    pages[1].wait_for_timeout(300)
    stored = read_json(pages[1], "localStorage", LOCAL_KEY)["questions"]
    check("answers from both tabs are kept",
          set(ids) <= set(stored), list(stored))
    context.close()


def test_sync_when_database_hangs(browser):
    """A database that never answers does not freeze sync or sign-out."""
    print("Cloud sync: database stops answering (15 second wait)")
    config = sync_config_script("firebase", sdkVersion="12.19.0")
    page = open_page(
        browser, sync_config=config, before_load=FAKE_FIREBASE_SETUP +
        "window.fakeFirebase.neverAnswer = true; window.fakeFirebase.user ="
        " { uid: 'u1', displayName: 'Test Reader', email: '' };")
    page.route("**/www.gstatic.com/firebasejs/**", serve_fake_firebase)
    page.reload()
    page.wait_for_selector("#book-title:not(:text-is('Recall Quiz'))")
    answer_in_code(page, BOOK["questions"][0]["id"])
    page.evaluate("RecallQuiz.cloudSync.saveNow()")
    wait_for_sync_status(page, "error", seconds=25)
    check("the error bar offers Sign out",
          page.is_visible("#cloud-sync-bar button:has-text('Sign out')"))
    page.click("#cloud-sync-bar button:has-text('Sign out')")
    wait_for_sync_status(page, "signed-out", seconds=25)
    check("signing out still works", True)
    check("no script errors", not page.errors, page.errors)
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
            test_sanskrit_answers(browser)
            test_formulas(browser)
            test_themes(browser)
            test_phone_width(browser)
            test_sync_off(browser)
            test_sync_sign_in_merges(browser)
            test_sync_saves_while_practising(browser)
            test_sync_reset_and_sign_out(browser)
            test_sync_ignores_another_readers_progress(browser)
            test_firebase_adapter(browser)
            test_sync_when_database_is_unreachable(browser)
            with tempfile.TemporaryDirectory() as scratch:
                test_sync_load_backup_after_reset(browser, Path(scratch))
            test_two_tabs_keep_each_others_answers(browser)
            test_sync_when_database_hangs(browser)
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
