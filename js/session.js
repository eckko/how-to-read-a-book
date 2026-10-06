/*
 * session.js
 * Runs a practice session: picks the questions, shows them one at a
 * time, and hands over to the results screen at the end.
 *
 * Each question type draws into a "card" object (see
 * createQuestionCard below). That object is the only thing a question
 * type needs to know about the session.
 */
(function setUpSession(quiz) {
  "use strict";

  const { findElement, createElement, createButton } = quiz.helpers;

  /** Everything about the session in progress */
  const state = {
    /** The questions for this session, in the order they are asked */
    questions: [],
    /** Index of the question on screen */
    currentIndex: 0,
    /** How many answers were right, partly right and missed */
    score: { got: 0, part: 0, miss: 0 },
    /** Questions missed this session, for the results screen */
    missedQuestions: [],
    /** Times the reader said "Certain" and was wrong */
    confidentMissCount: 0,

    /** Settings copied when the session starts */
    isTimed: false,
    sessionMinutes: 0,
    secondsPerQuestion: 0,
    askConfidence: false,

    /** True once the current question has been answered */
    currentQuestionAnswered: false,
    /** Set when the session clock ran out while feedback was showing */
    timeRanOut: false,
    /** The confidence level picked for this question (1 to 3) */
    confidenceLevel: null,
    /** True while the answer area waits for a confidence level */
    isAnswerAreaLocked: false,
    /** What the keyboard does on this question (set by question types) */
    keyHandler: null,
  };

  // ---------------------------------------------------------- start

  /** Start a session with the settings on the home screen. */
  function startSession() {
    const questions = quiz.settings.chooseQuestionsForSession();
    if (questions.length === 0) {
      quiz.settings.updateReadySummary();
      return;
    }
    resetState(questions);
    quiz.timers.stopSessionClock();
    document.body.classList.add("in-session");
    if (state.isTimed) {
      quiz.timers.startSessionClock(state.sessionMinutes, onSessionTimeUp);
    }
    findElement("home-screen").classList.add("hidden");
    findElement("where-you-stand").classList.add("hidden");
    findElement("theme-panel").classList.add("hidden");
    // The Start button is now hidden but may still have keyboard focus,
    // which would swallow the first Enter. Let the page have it instead.
    document.activeElement.blur();
    showCurrentQuestion();
  }

  /**
   * Fresh state for a new session.
   * @param {object[]} questions
   */
  function resetState(questions) {
    const settings = quiz.settings.current;
    state.questions = questions;
    state.currentIndex = 0;
    state.score = { got: 0, part: 0, miss: 0 };
    state.missedQuestions = [];
    state.confidentMissCount = 0;
    state.isTimed = settings.lengthMode === "time";
    state.sessionMinutes = quiz.settings.sessionMinutes();
    state.secondsPerQuestion = settings.secondsPerQuestion;
    state.askConfidence = settings.askConfidence;
    state.timeRanOut = false;
  }

  /**
   * The session clock ran out. If the reader is looking at feedback,
   * let them finish reading; the results come after "Next".
   */
  function onSessionTimeUp() {
    if (state.currentQuestionAnswered) {
      state.timeRanOut = true;
    } else {
      quiz.resultsScreen.showResults();
    }
  }

  // ---------------------------------------------------------- questions

  /** Show the question at state.currentIndex, or the results. */
  function showCurrentQuestion() {
    if (state.currentIndex >= state.questions.length) {
      quiz.resultsScreen.showResults();
      return;
    }
    quiz.timers.stopQuestionTimer();
    state.currentQuestionAnswered = false;
    const question = state.questions[state.currentIndex];
    const cardElement = openQuestionCard();

    cardElement.appendChild(state.isTimed
      ? quiz.timers.createSessionClockBar(state.currentIndex + 1)
      : createProgressSegments());
    if (state.secondsPerQuestion) {
      cardElement.appendChild(
        quiz.timers.createQuestionTimer(state.secondsPerQuestion));
    }
    cardElement.appendChild(createQuestionMeta(question));
    cardElement.appendChild(createQuestionText(question));
    if (!state.isTimed) {
      quiz.timers.showQuestionsLeft(
        state.questions.length - state.currentIndex, state.questions.length);
    }

    const answerArea = createElement("div");
    if (state.askConfidence) {
      cardElement.appendChild(
        quiz.answerFeedback.createConfidenceRow(answerArea));
    } else {
      state.confidenceLevel = null;
      state.isAnswerAreaLocked = false;
    }
    cardElement.appendChild(answerArea);
    const keyHint = createElement("p", "key-hint");
    cardElement.appendChild(keyHint);

    state.keyHandler = null;
    const card = createQuestionCard(question, answerArea, keyHint);
    quiz.questionTypes.show(question, card);
    cardElement.appendChild(createEndSessionButton());
  }

  /** Move on: the next question, or the results if time ran out. */
  function goToNextQuestion() {
    if (state.timeRanOut) {
      quiz.resultsScreen.showResults();
      return;
    }
    state.currentIndex += 1;
    showCurrentQuestion();
  }

  /**
   * Everything a question type can use. Question types get only this
   * object, so they stay independent of how the session works.
   * @param {object} question
   * @param {HTMLElement} answerArea  where the type draws its controls
   * @param {HTMLElement} keyHintElement  the "Keys: ..." line
   * @returns {object}
   */
  function createQuestionCard(question, answerArea, keyHintElement) {
    return {
      /** Where the question type draws its buttons and boxes */
      answerArea,

      /** @param {string} text  e.g. "Keys: 1 to 4 to answer" */
      setKeyHint(text) {
        keyHintElement.textContent = text;
      },

      /** @param {Function|null} handler  receives each keydown event */
      setKeyHandler(handler) {
        state.keyHandler = handler;
      },

      /** @param {Function} handler  called when the question timer ends */
      setTimeUpHandler(handler) {
        quiz.timers.setQuestionTimeUpHandler(handler);
      },

      /** Stop the question timer early (e.g. while the reader rates). */
      stopTimer() {
        quiz.timers.stopQuestionTimer();
      },

      /** @returns {boolean} true until a confidence level is picked */
      isWaitingForConfidence() {
        return state.isAnswerAreaLocked;
      },

      /**
       * The reader has answered: record it and show the feedback.
       * @param {"got"|"part"|"miss"} result
       * @param {{timedOut?: boolean, extraContent?: HTMLElement}} [options]
       */
      showResult(result, options) {
        quiz.answerFeedback.showAnswerFeedback(question, this, result,
          options);
      },

      /**
       * Record a self-rating and go straight on (used by recall, which
       * has already shown the answer).
       * @param {"got"|"part"|"miss"} result
       */
      saveSelfRating(result) {
        quiz.answerFeedback.recordResult(question, result);
        goToNextQuestion();
      },
    };
  }

  // ---------------------------------------------------------- drawing

  /** @returns {HTMLElement} the empty question card, scrolled to top */
  function openQuestionCard() {
    const cardElement = findElement("question-card");
    cardElement.classList.remove("hidden");
    cardElement.textContent = "";
    window.scrollTo({ top: 0 });
    return cardElement;
  }

  /** @returns {HTMLElement} one segment per question in the session */
  function createProgressSegments() {
    const progress = createElement("div", "question-progress");
    state.questions.forEach(function addSegment(question, index) {
      let className = "";
      if (index < state.currentIndex) {
        className = "is-done";
      } else if (index === state.currentIndex) {
        className = "is-current";
      }
      progress.appendChild(createElement("i", className));
    });
    return progress;
  }

  /**
   * Chapter, topic and question type above the question.
   * @param {object} question
   * @returns {HTMLElement}
   */
  function createQuestionMeta(question) {
    const meta = createElement("div", "question-meta");
    const heading = createElement("div", "unit-heading");
    heading.appendChild(createElement("span", "unit-chip",
      quiz.book.unitShortName(question)));
    if (question.unitTitle) {
      heading.appendChild(
        createElement("span", "unit-title", question.unitTitle));
    }
    meta.appendChild(heading);

    const topic = createElement("div", "topic-line");
    topic.appendChild(
      document.createTextNode(quiz.book.labels.topic + ": "));
    topic.appendChild(createElement("mark", null, question.section));
    meta.appendChild(topic);

    meta.appendChild(createElement("span", "question-kind",
      quiz.questionTypes.labelFor(question)));
    return meta;
  }

  /**
   * The question itself, with its highlighter stripe.
   * @param {object} question
   * @returns {HTMLElement}
   */
  function createQuestionText(question) {
    const wrap = createElement("div", "question-wrap");
    wrap.appendChild(createElement("span", "question-text", question.q));
    return wrap;
  }

  /** @returns {HTMLButtonElement} "End session", back to the home screen */
  function createEndSessionButton() {
    return createButton("End session", "button end-session-button",
      function endSession() {
        // Only ask before throwing away a session on its first question.
        const isPastFirstQuestion = state.currentIndex > 0;
        if (isPastFirstQuestion || confirm("Leave this session?")) {
          state.keyHandler = null;
          returnHome();
        }
      });
  }

  // ---------------------------------------------------------- leaving

  /** Stop everything and go back to the home screen. */
  function returnHome() {
    document.body.classList.remove("in-session");
    quiz.timers.stopSessionClock();
    quiz.timers.stopQuestionTimer();
    state.keyHandler = null;
    findElement("question-card").classList.add("hidden");
    findElement("home-screen").classList.remove("hidden");
    findElement("where-you-stand").classList.remove("hidden");
    quiz.homeScreen.refresh();
    window.scrollTo({ top: 0 });
  }

  // ---------------------------------------------------------- keyboard

  /**
   * Send key presses to the current question type.
   * @param {KeyboardEvent} event
   */
  function handleKeyPress(event) {
    const hasModifier = event.metaKey || event.ctrlKey || event.altKey;
    if (!state.keyHandler || state.isAnswerAreaLocked || hasModifier) {
      return;
    }
    const isEnterOrSpace = event.key === "Enter" || event.key === " ";
    // A focused button already acts on Enter and Space by itself.
    if (isEnterOrSpace && event.target.tagName === "BUTTON") {
      return;
    }
    // Without this, the same key press would also "click" any button
    // that receives focus while the handler runs (such as Next).
    if (isEnterOrSpace) {
      event.preventDefault();
    }
    state.keyHandler(event);
  }

  findElement("start-button").addEventListener("click", startSession);
  document.addEventListener("keydown", handleKeyPress);

  quiz.session = {
    state,
    startSession,
    goToNextQuestion,
    returnHome,
  };
})((window.RecallQuiz = window.RecallQuiz || {}));
