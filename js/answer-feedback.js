/*
 * answer-feedback.js
 * What happens after any question is answered: record the result, show
 * "Correct." (or not), the explanation and where to reread, then offer
 * the Next button. Also the optional "How sure are you?" row.
 */
(function setUpAnswerFeedback(quiz) {
  "use strict";

  const { createElement, createButton, createParagraph } = quiz.helpers;

  const VERDICT_TEXT = {
    got: "Correct.",
    part: "Partly right.",
    miss: "Not this one.",
  };
  const VERDICT_CLASS = {
    got: "is-correct",
    part: "is-partly",
    miss: "is-incorrect",
  };
  const CONFIDENCE_LEVELS = [
    { level: 1, label: "Guessing" },
    { level: 2, label: "Fairly sure" },
    { level: 3, label: "Certain" },
  ];
  const CERTAIN = 3;
  const CONFETTI_FOR_RIGHT_ANSWER = 18;

  /** @returns {object} the running session (see js/session.js) */
  function session() {
    return quiz.session.state;
  }

  // ---------------------------------------------------------- results

  /**
   * True if the reader said "Certain" and still got it wrong.
   * @param {"got"|"part"|"miss"} result
   * @returns {boolean}
   */
  function isConfidentMiss(result) {
    const current = session();
    return current.askConfidence && current.confidenceLevel === CERTAIN &&
      result === "miss";
  }

  /**
   * Count the result in this session and in the reader's saved progress.
   * @param {object} question
   * @param {"got"|"part"|"miss"} result
   */
  function recordResult(question, result) {
    const current = session();
    current.currentQuestionAnswered = true;
    current.score[result] += 1;
    if (result === "miss") {
      current.missedQuestions.push(question);
    }
    const wasConfidentMiss = isConfidentMiss(result);
    if (wasConfidentMiss) {
      current.confidentMissCount += 1;
    }
    quiz.memory.recordAnswer(question.id, result, wasConfidentMiss);
  }

  /**
   * Record the answer and show the feedback under it.
   * @param {object} question
   * @param {object} card  see createQuestionCard in js/session.js
   * @param {"got"|"part"|"miss"} result
   * @param {{timedOut?: boolean, extraContent?: HTMLElement}} [options]
   *   timedOut: the timer ran out before an answer
   *   extraContent: shown above the explanation, e.g. the right order
   */
  function showAnswerFeedback(question, card, result, options) {
    const settings = options || {};
    quiz.timers.stopQuestionTimer();
    unlockAnswerArea(card.answerArea);
    recordResult(question, result);

    const feedback = createElement("div", "reveal-in");
    feedback.appendChild(createVerdict(result, settings.timedOut));
    if (settings.extraContent) {
      feedback.appendChild(settings.extraContent);
    }
    if (question.explain) {
      feedback.appendChild(
        createElement("div", "explanation", question.explain));
    }
    if (isConfidentMiss(result)) {
      feedback.appendChild(createElement("p", "confident-miss",
        "You were certain, so this is a confident miss. " +
        "It is worth rereading."));
    }
    feedback.appendChild(createRereadHint(question));
    const nextButton = createNextButton();
    const actions = createElement("div", "actions");
    actions.appendChild(nextButton);
    feedback.appendChild(actions);
    card.answerArea.appendChild(feedback);
    nextButton.focus();

    card.setKeyHint("Keys: Enter for next");
    card.setKeyHandler(function goOnWithEnter(event) {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        quiz.session.goToNextQuestion();
      }
    });
    if (result === "got") {
      quiz.celebrate(feedback, CONFETTI_FOR_RIGHT_ANSWER);
    }
  }

  /**
   * "Correct.", "Partly right.", "Not this one." or "Time's up."
   * @param {"got"|"part"|"miss"} result
   * @param {boolean} timedOut
   * @returns {HTMLElement}
   */
  function createVerdict(result, timedOut) {
    const text = timedOut ? "Time's up." : VERDICT_TEXT[result];
    return createElement("p", "verdict " + VERDICT_CLASS[result], text);
  }

  /**
   * "To go deeper, reread Chapter 9, Title, topic Section."
   * @param {object} question
   * @returns {HTMLElement}
   */
  function createRereadHint(question) {
    return createParagraph("reread-hint", [
      "To go deeper, reread ",
      { bold: quiz.book.unitFullName(question) },
      ", topic ",
      { bold: question.section },
      ".",
    ]);
  }

  /** @returns {HTMLButtonElement} "Next question" or "See results" */
  function createNextButton() {
    const current = session();
    const isLastQuestion =
      current.currentIndex + 1 >= current.questions.length;
    const label = isLastQuestion ? "See results" : "Next question";
    return createButton(label, "button primary",
      quiz.session.goToNextQuestion);
  }

  // ---------------------------------------------------------- confidence

  /**
   * The "How sure are you?" row. Until the reader picks one, the answer
   * area is greyed out and ignores taps and keys.
   * @param {HTMLElement} answerArea
   * @returns {HTMLElement}
   */
  function createConfidenceRow(answerArea) {
    const row = createElement("div", "confidence-row");
    row.appendChild(createElement("span", null, "How sure are you?"));
    CONFIDENCE_LEVELS.forEach(function addLevelButton(choice) {
      const button = createButton(choice.label, "pill-button",
        function chooseLevel() {
          session().confidenceLevel = choice.level;
          unlockAnswerArea(answerArea);
          button.blur();   // so Enter goes to the answer, not this button
          markChosenButton(row, button);
        });
      row.appendChild(button);
    });
    session().confidenceLevel = null;
    lockAnswerArea(answerArea);
    return row;
  }

  /**
   * Highlight one button in a row and clear the others.
   * @param {HTMLElement} row
   * @param {HTMLElement} chosenButton
   */
  function markChosenButton(row, chosenButton) {
    row.querySelectorAll("button").forEach(function markButton(button) {
      button.classList.toggle("is-on", button === chosenButton);
    });
  }

  /**
   * Grey out the answer area until a confidence level is picked.
   * @param {HTMLElement} answerArea
   */
  function lockAnswerArea(answerArea) {
    session().isAnswerAreaLocked = true;
    answerArea.classList.add("is-locked");
  }

  /**
   * Let the reader answer again.
   * @param {HTMLElement} answerArea
   */
  function unlockAnswerArea(answerArea) {
    session().isAnswerAreaLocked = false;
    answerArea.classList.remove("is-locked");
  }

  quiz.answerFeedback = {
    showAnswerFeedback,
    recordResult,
    createRereadHint,
    createConfidenceRow,
  };
})((window.RecallQuiz = window.RecallQuiz || {}));
