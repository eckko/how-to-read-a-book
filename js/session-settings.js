/*
 * session-settings.js
 * The "What do you want to practise?" panel: which chapter, which
 * questions, how long, the optional timer and confidence check. Works
 * out which questions a session will use and says how many are ready.
 */
(function setUpSessionSettings(quiz) {
  "use strict";

  const { findElement, shuffledCopy, readWholeNumber, countWithWord } =
    quiz.helpers;

  const DEFAULT_SESSION_MINUTES = 15;

  /** The current choices. Changed by the buttons on the panel. */
  const current = {
    /** "due" (due and new), "gaps" (missed and still weak) or "all" */
    questionFilter: "due",
    /** "questions" (a number of questions) or "time" (minutes) */
    lengthMode: "questions",
    /** 0 for no timer, otherwise 15, 30 or 60 */
    secondsPerQuestion: 0,
    /** Ask "How sure are you?" before each answer */
    askConfidence: false,
  };

  // ---------------------------------------------------------- questions

  /** @returns {string} the chapter id picked, or "all" */
  function chosenUnit() {
    return findElement("unit-picker").value;
  }

  /** @returns {string} e.g. "Whole book" or "Chapter 9", for history */
  function scopeName() {
    const unit = chosenUnit();
    return unit === "all" ? quiz.book.labels.whole : unit;
  }

  /** @returns {object[]} the questions that match the current choices */
  function questionsMatchingSettings() {
    const unit = chosenUnit();
    return quiz.book.allQuestions().filter(function matches(question) {
      const inChosenUnit = unit === "all" || question.unit === unit;
      return inChosenUnit && passesQuestionFilter(question);
    });
  }

  /**
   * True if a question fits "Due and new", "My gaps" or "Everything".
   * @param {object} question
   * @returns {boolean}
   */
  function passesQuestionFilter(question) {
    if (current.questionFilter === "due") {
      return quiz.memory.isDueOrNew(question.id);
    }
    if (current.questionFilter === "gaps") {
      return quiz.memory.isGap(question.id);
    }
    return true;
  }

  /** @returns {number} questions asked for; 0 means all of them */
  function chosenQuestionCount() {
    return readWholeNumber("question-count-input", 0);
  }

  /** @returns {number} minutes for a timed session (at least 1) */
  function sessionMinutes() {
    return Math.max(1,
      readWholeNumber("minutes-input", DEFAULT_SESSION_MINUTES));
  }

  /** @returns {object[]} the shuffled questions for a new session */
  function chooseQuestionsForSession() {
    let questions = shuffledCopy(questionsMatchingSettings());
    const count = chosenQuestionCount();
    if (current.lengthMode === "questions" && count) {
      questions = questions.slice(0, count);
    }
    return questions;
  }

  // ---------------------------------------------------------- summary

  /** The line under Start: how many questions are ready. */
  function updateReadySummary() {
    findElement("ready-summary").textContent = readySummaryText();
  }

  /** @returns {string} */
  function readySummaryText() {
    const readyCount = questionsMatchingSettings().length;
    if (readyCount === 0) {
      return nothingReadyText();
    }
    const questionsAre = readyCount === 1
      ? "1 question is"
      : readyCount + " questions are";
    if (current.lengthMode === "time") {
      return questionsAre + " ready. The session ends after " +
        countWithWord(sessionMinutes(), "minute") +
        " or when you run out of questions.";
    }
    const count = chosenQuestionCount();
    if (count) {
      return "Up to " + Math.min(count, readyCount) + " of " + readyCount +
        " ready questions will be asked.";
    }
    return questionsAre + " ready with these settings.";
  }

  /** @returns {string} why nothing is ready, and what to try */
  function nothingReadyText() {
    if (current.questionFilter === "gaps") {
      return "No gaps yet. Answer a few questions and any you miss " +
        "will appear here.";
    }
    if (current.questionFilter === "due") {
      return "Nothing is due here right now. Try Everything to " +
        "practise ahead.";
    }
    return "No questions in this " + quiz.book.labels.unit.toLowerCase() +
      " yet.";
  }

  // ---------------------------------------------------------- controls

  /**
   * Make a row of buttons behave like radio buttons.
   * @param {string} groupId
   * @param {function(string): void} onChoose  gets the data-value
   */
  function setUpChoiceGroup(groupId, onChoose) {
    const group = findElement(groupId);
    group.addEventListener("click", function chooseButton(event) {
      const chosen = event.target.closest("button");
      if (!chosen) {
        return;
      }
      Array.from(group.children).forEach(function markPressed(button) {
        button.setAttribute("aria-pressed", String(button === chosen));
      });
      onChoose(chosen.getAttribute("data-value"));
      updateReadySummary();
    });
  }

  /** Quick-pick buttons (5, 10, 25 ...) fill in their input box. */
  function setUpQuickPickButtons() {
    document.querySelectorAll("[data-fills]").forEach(
      function setUpQuickPick(button) {
        button.addEventListener("click", function fillInput() {
          const input = findElement(button.getAttribute("data-fills"));
          input.value = button.getAttribute("data-fill-value");
          updateReadySummary();
        });
      });
  }

  /** Show the number box for the chosen session length. */
  function showLengthRowFor(lengthMode) {
    findElement("length-by-questions")
      .classList.toggle("hidden", lengthMode !== "questions");
    findElement("length-by-time")
      .classList.toggle("hidden", lengthMode !== "time");
  }

  setUpChoiceGroup("question-filter-choice", function setFilter(value) {
    current.questionFilter = value;
  });
  setUpChoiceGroup("session-length-choice", function setLength(value) {
    current.lengthMode = value;
    showLengthRowFor(value);
  });
  setUpChoiceGroup("question-timer-choice", function setTimer(value) {
    current.secondsPerQuestion = parseInt(value, 10);
  });
  setUpChoiceGroup("confidence-choice", function setConfidence(value) {
    current.askConfidence = value === "on";
  });
  setUpQuickPickButtons();
  ["question-count-input", "minutes-input"].forEach(function watch(id) {
    findElement(id).addEventListener("input", updateReadySummary);
  });
  findElement("unit-picker").addEventListener("change", updateReadySummary);

  quiz.settings = {
    current,
    scopeName,
    sessionMinutes,
    chooseQuestionsForSession,
    updateReadySummary,
  };
})((window.RecallQuiz = window.RecallQuiz || {}));
