/*
 * home-screen.js
 * Draws the start screen: the book title, the progress ring and counts,
 * the day streak, "Your recent results" and "Where you stand".
 */
(function setUpHomeScreen(quiz) {
  "use strict";

  const { findElement, createElement, countWithWord, formatOneDecimal } =
    quiz.helpers;

  /** Length of the progress ring's circle (2 * pi * radius 42) */
  const RING_CIRCUMFERENCE = 263.9;
  const VERDICT_NAMES = { excellent: "Excellent", pass: "Pass", fail: "Fail" };

  /** Fill in the parts that only change when a new book is loaded. */
  function showBookDetails() {
    const book = quiz.book;
    const questionCount = book.allQuestions().length;
    const unitCount = book.unitIds.length;
    const unitsText = countWithWord(unitCount,
      book.labels.unit.toLowerCase(), book.labels.units);
    findElement("book-title").textContent = book.data.book;
    findElement("unit-picker-label").textContent = book.labels.unit;
    findElement("book-summary").textContent =
      countWithWord(questionCount, "question") + " across " + unitsText +
      ". Recall first, then check.";
    fillUnitPicker();
  }

  /** The chapter drop-down: "Whole book" and then every chapter. */
  function fillUnitPicker() {
    const picker = findElement("unit-picker");
    picker.textContent = "";
    picker.appendChild(new Option(quiz.book.labels.whole, "all"));
    quiz.book.unitIds.forEach(function addUnit(unitId) {
      const title = quiz.book.unitTitles[unitId];
      const text = unitId + (title ? ": " + title : "");
      picker.appendChild(new Option(text, unitId));
    });
  }

  /** Redraw everything that depends on the reader's progress. */
  function refresh() {
    showProgressOverview();
    showTodaySummary();
    showDayStreak();
    quiz.settings.updateReadySummary();
    showWhereYouStand();
    showRecentResults();
  }

  // ---------------------------------------------------------- overview

  /** The ring (percent solid) and the Solid / Learning / Not seen counts */
  function showProgressOverview() {
    const questions = quiz.book.allQuestions();
    const solidCount = countWhere(questions, quiz.memory.isSolid);
    const learningCount = countWhere(questions, quiz.memory.isLearning);
    const notSeenCount = questions.length - solidCount - learningCount;
    const percentSolid = questions.length
      ? Math.round((100 * solidCount) / questions.length)
      : 0;

    findElement("progress-ring-arc").style.strokeDashoffset =
      String(RING_CIRCUMFERENCE * (1 - percentSolid / 100));
    findElement("progress-ring-text").textContent = percentSolid + "%";

    const tally = findElement("progress-tally");
    tally.textContent = "";
    [
      { label: "Solid", count: solidCount },
      { label: "Learning", count: learningCount },
      { label: "Not seen", count: notSeenCount },
    ].forEach(function addCount(entry) {
      const box = createElement("div");
      box.appendChild(createElement("b", null, String(entry.count)));
      box.appendChild(createElement("span", null, entry.label));
      tally.appendChild(box);
    });
  }

  /** "Today you answered 4. 2 to revisit." */
  function showTodaySummary() {
    const questions = quiz.book.allQuestions();
    const waitingCount = countWhere(questions, quiz.memory.isWaitingForReview);
    const waitingText = waitingCount
      ? waitingCount + " to revisit."
      : "Nothing waiting to revisit.";
    findElement("today-summary").textContent =
      "Today you answered " + quiz.memory.countAnsweredToday() + ". " +
      waitingText;
  }

  /**
   * How many questions pass a test about their id.
   * @param {object[]} questions
   * @param {function(string): boolean} test
   * @returns {number}
   */
  function countWhere(questions, test) {
    return questions.filter(function passes(question) {
      return test(question.id);
    }).length;
  }

  /** "3 days in a row" */
  function showDayStreak() {
    const streakElement = findElement("day-streak");
    const days = quiz.memory.currentDayStreak();
    streakElement.textContent = "";
    streakElement.appendChild(
      createElement("b", null, countWithWord(days, "day")));
    streakElement.appendChild(document.createTextNode(" in a row"));
  }

  // ---------------------------------------------------------- recent

  /** The last five results, newest first. Hidden when there are none. */
  function showRecentResults() {
    const panel = findElement("recent-results");
    const results = quiz.progress.saved.recentResults;
    panel.textContent = "";
    if (results.length === 0) {
      panel.classList.add("hidden");
      return;
    }
    panel.classList.remove("hidden");
    panel.appendChild(createElement("h2", null, "Your recent results"));
    results.forEach(function addResultRow(result) {
      panel.appendChild(createRecentResultRow(result));
    });
  }

  /**
   * One row: verdict chip, what was practised and when, and the score.
   * @param {object} result  see progress-storage.js
   * @returns {HTMLElement}
   */
  function createRecentResultRow(result) {
    const row = createElement("div", "history-row");
    row.appendChild(createElement("span", "verdict-chip " + result.verdict,
      VERDICT_NAMES[result.verdict]));

    const when = createElement("div", "history-when");
    when.appendChild(createElement("b", null, describeSession(result)));
    when.appendChild(document.createTextNode(
      formatDateAndTime(new Date(result.finishedAt))));
    row.appendChild(when);

    const score = createElement("div", "history-score",
      formatOneDecimal(result.percent) + "%");
    score.appendChild(createElement("small", null,
      formatOneDecimal(result.marks) + " of " + result.questionCount +
      " marks"));
    row.appendChild(score);
    return row;
  }

  /**
   * e.g. "Whole book, 15 min session, 30s each"
   * @param {object} result
   * @returns {string}
   */
  function describeSession(result) {
    let text = result.scopeName;
    if (result.sessionMinutes) {
      text += ", " + result.sessionMinutes + " min session";
    }
    if (result.secondsPerQuestion) {
      text += ", " + result.secondsPerQuestion + "s each";
    }
    return text;
  }

  /**
   * e.g. "5 Oct, 14:30" (in the reader's own date style)
   * @param {Date} date
   * @returns {string}
   */
  function formatDateAndTime(date) {
    const day = date.toLocaleDateString(undefined,
      { day: "numeric", month: "short" });
    const time = date.toLocaleTimeString(undefined,
      { hour: "2-digit", minute: "2-digit" });
    return day + ", " + time;
  }

  // ---------------------------------------------------------- gaps

  /** Progress per chapter, opening up to progress per topic. */
  function showWhereYouStand() {
    const panel = findElement("where-you-stand");
    const labels = quiz.book.labels;
    panel.textContent = "";
    panel.appendChild(createElement("h2", null, "Where you stand"));
    const hasAnsweredAny =
      Object.keys(quiz.progress.saved.questions).length > 0;
    if (!hasAnsweredAny) {
      panel.appendChild(createElement("p", "empty-note",
        "Nothing yet. Start a session and your " + labels.units +
        " and topics will fill in here, with the weak ones marked."));
    }
    quiz.book.unitIds.forEach(function addUnit(unitId) {
      panel.appendChild(createUnitProgress(unitId));
    });
    panel.appendChild(createElement("p", "note",
      "Solid means answered right several times with growing gaps. " +
      "Open a " + labels.unit.toLowerCase() + " to see its topics. " +
      "Topics in red are ones you have missed."));
  }

  /**
   * A chapter row (click to open) with its topics inside.
   * @param {string} unitId
   * @returns {HTMLElement}
   */
  function createUnitProgress(unitId) {
    const questions = quiz.book.questionsInUnit(unitId);
    const percentSolid = percentSolidOf(questions);
    const details = createElement("details", "unit-progress");
    const summary = createElement("summary");
    const name = createElement("div", "unit-name");
    name.appendChild(createElement("b", null, unitId));
    name.appendChild(createElement("span", null,
      quiz.book.unitTitles[unitId]));
    summary.appendChild(name);
    summary.appendChild(createProgressBar(percentSolid));
    summary.appendChild(createElement("div", "percent", percentSolid + "%"));
    details.appendChild(summary);
    details.appendChild(createTopicList(questions));
    return details;
  }

  /**
   * One row per topic in a chapter, weak topics in red.
   * @param {object[]} questions  the chapter's questions
   * @returns {HTMLElement}
   */
  function createTopicList(questions) {
    const list = createElement("ul", "topic-list");
    groupBySection(questions).forEach(function addTopic(topic) {
      const missCount = topic.questions.reduce(
        function addMisses(total, question) {
          return total + quiz.memory.timesMissed(question.id);
        }, 0);
      const percentSolid = percentSolidOf(topic.questions);
      const item = createElement("li");
      const missedNote = missCount ? " (missed " + missCount + "x)" : "";
      item.appendChild(createElement("span", missCount ? "is-weak" : null,
        topic.section + missedNote));
      item.appendChild(createProgressBar(percentSolid));
      item.appendChild(
        createElement("div", "percent", percentSolid + "%"));
      list.appendChild(item);
    });
    return list;
  }

  /**
   * Group questions by their "section" (topic), keeping book order.
   * @param {object[]} questions
   * @returns {{section: string, questions: object[]}[]}
   */
  function groupBySection(questions) {
    const topics = [];
    questions.forEach(function addToTopic(question) {
      let topic = topics.find(function sameSection(existing) {
        return existing.section === question.section;
      });
      if (!topic) {
        topic = { section: question.section, questions: [] };
        topics.push(topic);
      }
      topic.questions.push(question);
    });
    return topics;
  }

  /**
   * How much of a set of questions is solid.
   * @param {object[]} questions
   * @returns {number}  whole percent of questions that are solid
   */
  function percentSolidOf(questions) {
    const solidCount = countWhere(questions, quiz.memory.isSolid);
    return Math.round((100 * solidCount) / questions.length);
  }

  /**
   * A thin bar filled to a percentage.
   * @param {number} percent
   * @returns {HTMLElement}
   */
  function createProgressBar(percent) {
    const bar = createElement("div", "progress-bar");
    const fill = createElement("i");
    fill.style.width = percent + "%";
    bar.appendChild(fill);
    return bar;
  }

  quiz.homeScreen = { showBookDetails, refresh };
})((window.RecallQuiz = window.RecallQuiz || {}));
