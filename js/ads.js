/* Harvest Slide ad breaks.
 *
 * Cadence (Adrian's direction, mirror AMAZE): the first break fires after
 * completing Level 3, then every 4 levels after that (7, 11, 15, ...).
 * Breaks happen ONLY between levels — on the win flow, before the next
 * level starts. Never mid-level, never on retry, never on levels 1-2.
 *
 * Game integration: exactly one call site. When the player presses "Next"
 * on the win card, the game asks AdBreak.shouldShow(completedLevelNumber)
 * and, if true, calls AdBreak.show(resume) instead of loading the next
 * field immediately. AdBreak.show runs the break, then calls resume.
 *
 * WEB BUILD (now): show() displays a styled placeholder break — a
 * cross-promo card for Adrian's Sunny Farm Valley with a ~5s countdown,
 * then a close button. Impressions are counted in localStorage so the
 * cadence is testable.
 *
 * TODO (iOS/Capacitor wrap): swap the body of show() for a real AdMob
 * interstitial from Adrian's own AdMob account using NEW Harvest Slide ad
 * units. Never reuse Sunny Farm Valley's ad units, and never modify the
 * Sunny Farm project. Keep the shouldShow() cadence and the show(onDone)
 * call site unchanged so the swap is one function body.
 */
(function (root) {
  "use strict";

  var LS_KEY = "harvest-slide-ads";
  var COUNTDOWN_MS = 5000;

  function load() {
    var fresh = { impressions: 0, lastLevel: 0 };
    try {
      var raw = root.localStorage.getItem(LS_KEY);
      if (!raw) return fresh;
      var data = JSON.parse(raw);
      return {
        impressions: Math.max(0, data.impressions | 0),
        lastLevel: Math.max(0, Math.min(99, data.lastLevel | 0)),
      };
    } catch (err) {
      return fresh;
    }
  }

  function save(state) {
    try {
      root.localStorage.setItem(LS_KEY, JSON.stringify(state));
    } catch (err) {
      /* storage unavailable: cadence guard degrades to in-memory only */
    }
  }

  /* True when a win on 1-based levelNumber earns a break: 3, 7, 11, ... */
  function dueFor(levelNumber) {
    if (levelNumber < 3) return false;
    return (levelNumber - 3) % 4 === 0;
  }

  /* True when the break should actually show now. The lastLevel guard stops
     a second break in a row when the player replays a level quickly. */
  function shouldShow(levelNumber) {
    if (!dueFor(levelNumber)) return false;
    var state = load();
    if (state.lastLevel === levelNumber) return false;
    return true;
  }

  function markShown(levelNumber) {
    var state = load();
    state.impressions += 1;
    state.lastLevel = levelNumber;
    save(state);
  }

  function el(id) {
    return document.getElementById(id);
  }

  /* TODO (iOS/Capacitor wrap): replace this placeholder body with the real
     AdMob interstitial (new Harvest Slide ad units only). Keep calling
     onDone() exactly once when the break finishes or fails, so the game
     always resumes. */
  function show(onDone) {
    var done = false;
    function finish() {
      if (done) return;
      done = true;
      try {
        document.body.classList.remove("ad-open");
      } catch (err) {
        /* ignore */
      }
      closeSheet();
      if (typeof onDone === "function") onDone();
    }

    var overlay = el("adbreak");
    var count = el("ad-count");
    var close = el("ad-close");
    if (!overlay || !count || !close) {
      finish();
      return;
    }

    var left = Math.ceil(COUNTDOWN_MS / 1000);
    close.disabled = true;
    close.textContent = "Close";
    count.textContent = "Reward in " + left + "s";
    overlay.classList.add("open");
    overlay.setAttribute("aria-hidden", "false");
    try {
      document.body.classList.add("ad-open");
    } catch (err) {
      /* ignore */
    }

    var timer = setInterval(function () {
      left -= 1;
      if (left <= 0) {
        clearInterval(timer);
        count.textContent = "Thanks for supporting Harvest Slide";
        close.disabled = false;
        close.focus();
      } else {
        count.textContent = "Reward in " + left + "s";
      }
    }, 1000);

    close.onclick = function () {
      clearInterval(timer);
      finish();
    };
    // A tap outside the card never dismisses early; only Close resumes.
    overlay.onclick = function (e) {
      if (e.target === overlay) {
        /* let the countdown finish — no early dismiss */
      }
    };

    function closeSheet() {
      clearInterval(timer);
      overlay.classList.remove("open");
      overlay.setAttribute("aria-hidden", "true");
    }

    // Safety net: never trap the player on a broken break.
    setTimeout(function () {
      if (!done) {
        close.disabled = false;
        count.textContent = "Thanks for supporting Harvest Slide";
      }
    }, COUNTDOWN_MS + 4000);
  }

  root.AdBreak = {
    dueFor: dueFor,
    shouldShow: shouldShow,
    markShown: markShown,
    show: show,
    COUNTDOWN_MS: COUNTDOWN_MS,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
