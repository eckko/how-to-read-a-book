/*
 * results-screen.js
 * The end of a session: the percentage, the verdict, what to reread,
 * and a record in "Your recent results".
 *
 * Marks: right = 1, partly right = 0.5, missed = 0.
 * Verdict: Excellent is over 90% with more than 15 questions answered,
 * Pass is 60% or more, Fail is under 60%.
 */
(function setUpResultsScreen(quiz) {
  "use strict";

  const {
    findElement,
    createElement,
    createButton,
    countWithWord,
    formatOneDecimal,
    prefersReducedMotion,
  } = quiz.helpers;

  const EXCELLENT_ABOVE_PERCENT = 90;
  const EXCELLENT_NEEDS_MORE_THAN = 15;   // questions in one session
  const PASS_FROM_PERCENT = 60;
  const RECENT_RESULTS_KEPT = 5;
  const COUNT_UP_DURATION_MS = 900;
  const CONFETTI_FOR_EXCELLENT = 60;
  const CONFETTI_FOR_PASS = 32;
  const CONFETTI_DELAY_MS = 250;   // let the results card appear first

  const VERDICT_NAMES = { excellent: "Excellent", pass: "Pass", fail: "Fail" };
  const RULES_TEXT =
    "Excellent: over " + EXCELLENT_ABOVE_PERCENT + "% with more than " +
    EXCELLENT_NEEDS_MORE_THAN + " questions. Pass: " + PASS_FROM_PERCENT +
    "% or more. Fail: under " + PASS_FROM_PERCENT +
    "%. A partly-right answer earns half a mark.";

  /**
   * Excellent, pass or fail for a percentage.
   * @param {number} percent
   * @param {number} questionCount
   * @returns {"excellent"|"pass"|"fail"}
   */
  function verdictFor(percent, questionCount) {
    if (percent > EXCELLENT_ABOVE_PERCENT &&
        questionCount > EXCELLENT_NEEDS_MORE_THAN) {
      return "excellent";
    }
    return percent >= PASS_FROM_PERCENT ? "pass" : "fail";
  }

  /**
   * The encouraging line under the score.
   * @param {string} verdict
   * @param {number} percent
   * @param {number} questionCount
   * @returns {string}
   */
  function messageFor(verdict, percent, questionCount) {
    if (verdict === "excellent") {
      return "Outstanding recall. " +
        "This is what the book looks like when it sticks.";
    }
    if (verdict === "fail") {
      return "Not yet. Reread the topics below, then try again.";
    }
    const missedExcellentOnCount = percent > EXCELLENT_ABOVE_PERCENT &&
      questionCount <= EXCELLENT_NEEDS_MORE_THAN;
    if (missedExcellentOnCount) {
      return "Over " + EXCELLENT_ABOVE_PERCENT + "%. Answer " +
        (EXCELLENT_NEEDS_MORE_THAN + 1) +
        " or more questions in one session to earn Excellent.";
    }
    return "You passed. Keep going to make it stick.";
  }

  /** End the session and show how it went. */
  function showResults() {
    quiz.timers.stopQuestionTimer();
    quiz.timers.stopSessionClock();
    const session = quiz.session.state;
    session.keyHandler = null;
    const cardElement = openCardForResults();
    const score = session.score;
    const questionCount = score.got + score.part + score.miss;

    if (questionCount === 0) {
      cardElement.appendChild(createNothingAnsweredResult());
      return;
    }
    const marks = score.got + 0.5 * score.part;
    const percent = (100 * marks) / questionCount;
    const verdict = verdictFor(percent, questionCount);
    saveToRecentResults(percent, marks, questionCount, verdict);
    const hero = createHero(verdict, percent, marks, questionCount);
    cardElement.appendChild(createResult(verdict, hero.element));
    countUpTo(hero.scoreNumber, percent);
    celebrateIfPassed(verdict, hero.element);
  }

  /**
   * Everything on the results screen below and including the hero card.
   * @param {string} verdict
   * @param {HTMLElement} heroElement
   * @returns {HTMLElement}
   */
  function createResult(verdict, heroElement) {
    const session = quiz.session.state;
    const result = createElement("div", "result result-" + verdict);
    result.appendChild(heroElement);
    result.appendChild(createElement("p", "result-rules", RULES_TEXT));
    result.appendChild(createScoreTally(session.score));
    if (session.askConfidence && session.confidentMissCount) {
      result.appendChild(createConfidentMissNote(session.confidentMissCount));
    }
    if (session.missedQuestions.length) {
      appendQuestionsToReread(result, session.missedQuestions);
    }
    result.appendChild(createResultButtons());
    return result;
  }

  /**
   * Confetti for a pass, more for excellent, none for a fail.
   * @param {string} verdict
   * @param {HTMLElement} heroElement
   */
  function celebrateIfPassed(verdict, heroElement) {
    if (verdict === "fail") {
      return;
    }
    const pieces =
      verdict === "excellent" ? CONFETTI_FOR_EXCELLENT : CONFETTI_FOR_PASS;
    setTimeout(function celebrateResult() {
      quiz.celebrate(heroElement, pieces);
    }, CONFETTI_DELAY_MS);
  }

  /** @returns {HTMLElement} the question card, emptied for results */
  function openCardForResults() {
    const cardElement = findElement("question-card");
    cardElement.classList.remove("hidden");
    cardElement.textContent = "";
    window.scrollTo({ top: 0 });
    return cardElement;
  }

  /** @returns {HTMLElement} shown when time ran out before any answer */
  function createNothingAnsweredResult() {
    const result = createElement("div", "result");
    result.appendChild(createElement("h2", null,
      "Time ran out before you answered anything."));
    result.appendChild(createElement("p", "note",
      "This attempt was not recorded."));
    const actions = createElement("div", "actions is-centered");
    actions.appendChild(createButton("Back to start", "button primary",
      quiz.session.returnHome));
    result.appendChild(actions);
    return result;
  }

  /**
   * Add this session to "Your recent results" (newest first, five kept).
   * @param {number} percent
   * @param {number} marks
   * @param {number} questionCount
   * @param {string} verdict
   */
  function saveToRecentResults(percent, marks, questionCount, verdict) {
    const session = quiz.session.state;
    const saved = quiz.progress.saved;
    saved.recentResults.unshift({
      finishedAt: Date.now(),
      percent,
      marks,
      questionCount,
      verdict,
      scopeName: quiz.settings.scopeName(),
      secondsPerQuestion: session.secondsPerQuestion,
      sessionMinutes: session.isTimed ? session.sessionMinutes : 0,
    });
    saved.recentResults = saved.recentResults.slice(0, RECENT_RESULTS_KEPT);
    quiz.progress.saveProgress();
    // Optional add-ons (such as cloud sync) save at the end of a session.
    document.dispatchEvent(new CustomEvent("recallquiz:session-finished"));
  }

  /**
   * The coloured card with the verdict, the percentage and the marks.
   * @param {string} verdict
   * @param {number} percent
   * @param {number} marks
   * @param {number} questionCount
   * @returns {{element: HTMLElement, scoreNumber: Text}}
   */
  function createHero(verdict, percent, marks, questionCount) {
    const session = quiz.session.state;
    const hero = createElement("div", "result-hero pop-in");
    hero.appendChild(
      createElement("span", "result-badge", VERDICT_NAMES[verdict]));

    const scoreLine = createElement("div", "result-score");
    const scoreNumber = document.createTextNode("0");
    scoreLine.appendChild(scoreNumber);
    scoreLine.appendChild(createElement("small", null, "%"));
    hero.appendChild(scoreLine);

    hero.appendChild(createElement("div", "result-marks",
      "Marks: " + formatOneDecimal(marks) + " out of " + questionCount));
    if (session.isTimed) {
      hero.appendChild(createElement("div", "result-detail",
        countWithWord(questionCount, "question") + " answered in a " +
        session.sessionMinutes + " minute session"));
    }
    hero.appendChild(createElement("p", "result-message",
      messageFor(verdict, percent, questionCount)));
    return { element: hero, scoreNumber };
  }

  /**
   * Got it / Partly / Missed counts.
   * @param {{got: number, part: number, miss: number}} score
   * @returns {HTMLElement}
   */
  function createScoreTally(score) {
    const tally = createElement("div", "score-tally");
    [
      { key: "got", label: "Got it" },
      { key: "part", label: "Partly" },
      { key: "miss", label: "Missed" },
    ].forEach(function addCount(entry) {
      const box = createElement("div", "score-" + entry.key);
      box.appendChild(createElement("b", null, String(score[entry.key])));
      box.appendChild(createElement("span", null, entry.label));
      tally.appendChild(box);
    });
    return tally;
  }

  /**
   * "2 confident misses: you were certain and wrong..."
   * @param {number} count
   * @returns {HTMLElement}
   */
  function createConfidentMissNote(count) {
    return createElement("p", "confident-miss",
      countWithWord(count, "confident miss", "confident misses") +
      ": you were certain and wrong. These are the best things to reread.");
  }

  /**
   * The list of missed questions, each with where to reread it.
   * @param {HTMLElement} result
   * @param {object[]} missedQuestions
   */
  function appendQuestionsToReread(result, missedQuestions) {
    result.appendChild(createElement("p", "note revisit-heading",
      "Reread these before the next session. They will come back sooner."));
    const list = createElement("ul", "revisit-list");
    missedQuestions.forEach(function addMissedQuestion(question) {
      const item = createElement("li", null, question.q);
      item.appendChild(createElement("span", null,
        quiz.book.unitFullName(question) + ". " +
        quiz.book.labels.topic + ": " + question.section));
      list.appendChild(item);
    });
    result.appendChild(list);
  }

  /** @returns {HTMLElement} "Practise again" and "Back to start" */
  function createResultButtons() {
    const actions = createElement("div", "actions is-centered");
    actions.appendChild(createButton("Practise again", "button primary",
      function practiseAgain() {
        quiz.session.returnHome();
        quiz.session.startSession();
      }));
    actions.appendChild(createButton("Back to start", "button",
      quiz.session.returnHome));
    return actions;
  }

  /**
   * Count the percentage up from 0 for a bit of drama.
   * @param {Text} scoreNumber  the text node to update
   * @param {number} percent
   */
  function countUpTo(scoreNumber, percent) {
    const target = Math.round(percent * 10) / 10;
    if (prefersReducedMotion()) {
      scoreNumber.nodeValue = formatOneDecimal(target);
      return;
    }
    let startTime = null;
    /** Draw one animation frame of the count-up. */
    function step(timestamp) {
      if (startTime === null) {
        startTime = timestamp;
      }
      const progress =
        Math.min((timestamp - startTime) / COUNT_UP_DURATION_MS, 1);
      const easedProgress = 1 - Math.pow(1 - progress, 3);
      scoreNumber.nodeValue = formatOneDecimal(target * easedProgress);
      if (progress < 1) {
        requestAnimationFrame(step);
      }
    }
    step(performance.now());
  }

  quiz.resultsScreen = { showResults };
})((window.RecallQuiz = window.RecallQuiz || {}));
