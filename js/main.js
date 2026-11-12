(function () {
  "use strict";

  const engine = HarvestEngine;
  const levels = HARVEST_LEVELS;
  const audio = HarvestAudio;
  const art = window.HarvestArt || null;
  const SAVE_KEY = "harvest-slide-v2";
  const coarse = window.matchMedia("(pointer: coarse)").matches;

  const el = {
    name: document.getElementById("level-name"),
    num: document.getElementById("level-num"),
    moves: document.getElementById("move-count"),
    par: document.getElementById("par-label"),
    plow: document.getElementById("plow-count"),
    coins: document.getElementById("coin-count"),
    best: document.getElementById("best-stars"),
    board: document.getElementById("board"),
    wrap: document.getElementById("board-wrap"),
    sound: document.getElementById("btn-sound"),
    restart: document.getElementById("btn-restart"),
    levels: document.getElementById("btn-levels"),
    overlay: document.getElementById("overlay"),
    modal: document.getElementById("modal"),
    grid: document.getElementById("modal-grid"),
    winTitle: document.getElementById("win-title"),
    winStars: document.getElementById("win-stars"),
    winStarsText: document.getElementById("win-stars-text"),
    winDetail: document.getElementById("win-detail"),
    winMoves: document.getElementById("win-moves"),
    next: document.getElementById("btn-next"),
    replay: document.getElementById("btn-replay"),
    close: document.getElementById("btn-modal-close"),
    waves: document.getElementById("speaker-waves"),
    slash: document.getElementById("speaker-off"),
  };

  const ctx = el.board.getContext("2d");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let save = loadSave();
  let levelIndex = 0;
  let level = null;
  let state = null;
  let moves = 0;
  let facing = "right";
  let runCoins = 0;
  let won = false;
  let anim = null;
  let shake = 0;
  let timeSec = 0;
  let lastNow = 0;
  let raf = 0;
  let audioUnlocked = false;
  let pointer = null;
  let queued = null;
  let shownPct = "";

  const view = { w: 300, h: 300, dpr: 1, tile: 32, ox: 0, oy: 0 };

  function loadSave() {
    const fresh = { stars: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], coins: 0, last: 0 };
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return fresh;
      const data = JSON.parse(raw);
      const stars = fresh.stars.slice();
      if (Array.isArray(data.stars)) {
        for (let i = 0; i < 12; i++) {
          const n = data.stars[i] | 0;
          if (n >= 1 && n <= 3) stars[i] = n;
        }
      }
      return {
        stars: stars,
        coins: Math.max(0, data.coins | 0),
        last: Math.max(0, Math.min(11, data.last | 0)),
      };
    } catch (err) {
      return fresh;
    }
  }

  function writeSave() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (err) { /* ignore */ }
  }

  function gesture() {
    if (audioUnlocked) return;
    audioUnlocked = true;
    harvestSoundOn = true;
    audio.unlock();
    paintSound();
  }

  function paintSound() {
    const on = harvestSoundOn && audioUnlocked;
    el.sound.setAttribute("aria-pressed", on ? "true" : "false");
    el.sound.setAttribute("aria-label", on ? "Turn sound off" : "Turn sound on");
    el.waves.style.display = on ? "" : "none";
    el.slash.style.display = on ? "none" : "";
  }

  function starMarkup(count, cls) {
    let html = "";
    for (let i = 0; i < 3; i++) html += starSVG(i < count, cls);
    return html;
  }

  function starSVG(on, cls) {
    const fill = on ? "#f5c518" : "transparent";
    const stroke = on ? "#8a5a10" : "#a87840";
    const klass = "star" + (on ? " on" : "") + (cls ? " " + cls : "");
    return '<svg viewBox="0 0 24 24" class="' + klass + '" aria-hidden="true"><path fill="' + fill + '" stroke="' + stroke + '" stroke-width="1.7" stroke-linejoin="round" d="M12 2.4l2.8 5.7 6.3.9-4.6 4.4 1.1 6.3L12 16.7 6.4 19.7l1.1-6.3L2.9 9l6.3-.9z"/></svg>';
  }

  function cropShown(i) {
    if (!state.harvested[i]) return true;
    if (!anim || anim.kind !== "slide") return false;
    for (let h = 0; h < anim.harvests.length; h++) {
      if (anim.harvests[h].index === i) return anim.dist < anim.harvests[h].dist - 0.04;
    }
    return false;
  }

  /* Null until the plow should read. A tile painted earlier is full.
     A tile painted by the slide in progress stays dirt until the
     tractor reaches it, with a wet leading edge on the way in. */
  function trailLook(r, c) {
    const idx = level.plowAt[r][c];
    if (idx < 0 || !state.plowed[idx]) return null;
    if (!anim || anim.kind !== "slide" || anim.fresh[idx] === undefined) return { full: true };
    const at = anim.fresh[idx];
    const d = anim.dist;
    if (d >= at) return { full: true };
    if (Math.floor(d) + 1 === at && d > Math.floor(d)) {
      return { full: false, frac: d - Math.floor(d) };
    }
    return null;
  }

  function plowShown() {
    let n = 0;
    for (let i = 0; i < level.plowable.length; i++) {
      const cell = level.plowable[i];
      if (trailLook(cell.r, cell.c)) n += 1;
    }
    return n;
  }

  function percentText() {
    const total = level.plowable.length;
    const done = plowShown();
    if (!total || done >= total) return "100%";
    return Math.floor((done * 100) / total) + "%";
  }

  function updateHud() {
    const def = levels[levelIndex];
    el.name.textContent = def.name;
    el.num.textContent = String(levelIndex + 1);
    el.moves.textContent = String(moves);
    el.par.textContent = "par " + def.par;
    el.coins.textContent = String(save.coins + runCoins);
    el.best.innerHTML = starMarkup(save.stars[levelIndex] || 0);
    shownPct = "";
    paintPlow();
  }

  function paintPlow() {
    const text = percentText();
    if (text === shownPct) return;
    shownPct = text;
    el.plow.textContent = text;
    const how = coarse ? "Swipe to plow." : "Swipe, arrows, or WASD to plow.";
    el.board.setAttribute("aria-label", "Field " + (levelIndex + 1) + ", " + text + " plowed. " + how);
  }

  function loadLevel(index) {
    audio.cancel();
    levelIndex = (index + levels.length) % levels.length;
    level = engine.parseLevel(levels[levelIndex]);
    state = engine.initialState(level);
    moves = 0;
    runCoins = 0;
    won = false;
    anim = null;
    if (art) art.particles.length = 0;
    shake = 0;
    facing = startingFace();
    queued = null;
    closeSheet(el.overlay);
    closeSheet(el.modal);
    save.last = levelIndex;
    writeSave();
    updateHud();
    requestDraw();
  }

  function startingFace() {
    const order = ["right", "down", "left", "up"];
    for (let i = 0; i < order.length; i++) {
      const dir = engine.DIRS[order[i]];
      const r = state.tractor.r + dir.r;
      const c = state.tractor.c + dir.c;
      if (r < 0 || c < 0 || r >= level.grid.length || c >= level.grid[0].length) continue;
      const ch = level.grid[r][c];
      if (ch !== "#" && ch !== "B") return order[i];
    }
    return "right";
  }

  function openSheet(node) {
    node.classList.add("open");
    node.setAttribute("aria-hidden", "false");
  }

  function closeSheet(node) {
    node.classList.remove("open");
    node.setAttribute("aria-hidden", "true");
  }

  function openFields() {
    gesture();
    el.grid.innerHTML = "";
    for (let i = 0; i < levels.length; i++) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "field" + (i === levelIndex ? " here" : "");
      btn.dataset.level = String(i);
      const stars = save.stars[i] || 0;
      btn.innerHTML =
        '<span class="field-num">' + (i + 1) + "</span>" +
        '<span class="field-name">' + levels[i].name + "</span>" +
        '<span class="field-stars">' + starMarkup(stars) + "</span>" +
        '<span class="field-par">par ' + levels[i].par + "</span>";
      btn.setAttribute("aria-label", "Field " + (i + 1) + " " + levels[i].name + ", " + stars + " stars, par " + levels[i].par);
      btn.addEventListener("click", function () {
        gesture();
        loadLevel(i);
      });
      el.grid.appendChild(btn);
    }
    openSheet(el.modal);
    el.close.focus();
  }

  function showWin() {
    if (won) return;
    won = true;
    const stars = engine.starsFor(moves, level.par);
    const banked = runCoins;
    if (stars > (save.stars[levelIndex] || 0)) save.stars[levelIndex] = stars;
    save.coins += banked;
    runCoins = 0;
    save.last = levelIndex;
    writeSave();
    el.winTitle.textContent = levelIndex === levels.length - 1 ? "Every field is plowed" : "Field plowed";
    el.winStars.innerHTML = starMarkup(stars);
    el.winStarsText.textContent = stars + (stars === 1 ? " star" : " stars");
    el.winDetail.textContent = stars === 3 ? "Perfect run." : stars === 2 ? "Close to par." : "The field is covered.";
    let line = moves + " moves, par " + level.par + ".";
    if (banked) line += " +" + banked + (banked === 1 ? " coin." : " coins.");
    el.winMoves.textContent = line;
    el.next.textContent = levelIndex === levels.length - 1 ? "First field" : "Next field";
    openSheet(el.overlay);
    updateHud();
    el.next.focus();
  }

  function tryMove(dir) {
    gesture();
    if (el.modal.classList.contains("open") || el.overlay.classList.contains("open") || won) return;
    if (anim && anim.kind === "slide") {
      queued = dir;
      return;
    }
    beginMove(dir);
  }

  function beginMove(dir) {
    const fromT = { r: state.tractor.r, c: state.tractor.c };
    const before = state.plowed.slice();
    const result = engine.applyMove(level, state, dir);
    facing = dir;
    if (!result) {
      anim = { kind: "bonk", t0: performance.now(), dur: reduceMotion ? 1 : 150, dir: dir };
      audio.knock();
      shake = 2.5;
      updateHud();
      requestDraw();
      return;
    }
    moves += 1;
    anim = makeAnim(fromT, result, before);
    state = result.state;
    updateHud();
    requestDraw();
  }

  function makeAnim(fromT, result, beforePlowed) {
    const path = [{ r: fromT.r, c: fromT.c }];
    const harvests = [];
    let push = null;
    for (let i = 0; i < result.events.length; i++) {
      const ev = result.events[i];
      if (ev.type === "step" || ev.type === "push") path.push({ r: ev.r, c: ev.c });
      if (ev.type === "push") push = { index: ev.baleIndex, path: ev.balePath };
      if (ev.type === "harvest") harvests.push({ index: ev.cropIndex, r: ev.r, c: ev.c, dist: path.length - 1 });
    }
    const fresh = {};
    for (let i = 1; i < path.length; i++) {
      const idx = level.plowAt[path[i].r][path[i].c];
      if (idx >= 0 && !beforePlowed[idx]) fresh[idx] = i;
    }
    let stop = "wall";
    for (let i = 0; i < result.events.length; i++) {
      if (result.events[i].type === "stop") stop = result.events[i].reason;
    }
    const tiles = Math.max(1, path.length - 1, push ? push.path.length - 1 : 0);
    return {
      kind: "slide",
      t0: performance.now(),
      dur: reduceMotion ? 16 : Math.min(680, 160 + tiles * 78),
      path: path,
      harvests: harvests,
      fresh: fresh,
      push: push,
      stop: stop,
      won: result.won,
      dist: 0,
      t: 0,
      dustCell: 0,
      pushPlayed: false,
    };
  }

  function requestDraw() {
    if (!raf) raf = requestAnimationFrame(tick);
  }

  function tick(now) {
    raf = 0;
    const more = update(now);
    draw();
    if (more) requestDraw();
  }

  function update(now) {
    if (!lastNow) lastNow = now;
    const dt = Math.min(0.05, (now - lastNow) / 1000);
    lastNow = now;
    timeSec = now / 1000;
    let alive = shake > 0 || (art ? art.particles.length > 0 : false);

    if (shake > 0) {
      shake *= Math.pow(0.04, dt);
      if (shake < 0.25) shake = 0;
    }

    if (anim && anim.kind === "slide") {
      alive = true;
      const t = Math.min(1, (now - anim.t0) / anim.dur);
      const maxDist = anim.path.length - 1;
      const dist = (1 - Math.pow(1 - t, 4)) * maxDist;
      anim.t = t;
      anim.dist = dist;
      paintPlow();
      const cell = Math.floor(dist);
      if (cell > anim.dustCell) {
        anim.dustCell = cell;
        const at = pointAt(anim.path, dist);
        const px = posOf(at.r, at.c);
        dustAt(px.x, px.y, 5);
      }
      if (anim.push && !anim.pushPlayed && baleU(dist, maxDist) > 0.08) {
        anim.pushPlayed = true;
        audio.bale();
        shake = 2;
      }
      for (let i = 0; i < anim.harvests.length; i++) {
        const h = anim.harvests[i];
        if (!h.fired && dist >= h.dist - 0.02) {
          h.fired = true;
          runCoins += 1;
          const px = posOf(h.r, h.c);
          popAt(px.x, px.y);
          audio.harvest();
          el.coins.textContent = String(save.coins + runCoins);
        }
      }
      if (t >= 1) {
        const end = anim.path[anim.path.length - 1];
        const px = posOf(end.r, end.c);
        const reason = anim.stop;
        const winNow = anim.won;
        if (winNow) {
          confettiAt(px.x, px.y);
          audio.win();
          shake = 8;
        } else if (reason === "mud") {
          dustAt(px.x, px.y, 8);
          audio.mud();
        } else if (reason === "push") {
          dustAt(px.x, px.y, 7);
        } else {
          dustAt(px.x, px.y, 8);
          audio.knock();
          shake = 3;
        }
        const follow = queued;
        queued = null;
        anim = null;
        paintPlow();
        if (winNow) showWin();
        else if (follow) beginMove(follow);
      }
    } else if (anim && anim.kind === "bonk") {
      alive = true;
      if (now - anim.t0 >= anim.dur) anim = null;
    }

    if (art) art.updateParticles(dt);
    return alive || !!anim;
  }

  function dustAt(x, y, n) {
    if (reduceMotion || !art) return;
    art.spawnDust(x, y, n);
  }

  function popAt(x, y) {
    if (reduceMotion || !art) return;
    art.spawnHarvest(x, y);
  }

  function confettiAt(x, y) {
    if (reduceMotion || !art) return;
    art.spawnConfetti(x, y, 78);
  }

  function fit() {
    if (!level) return;
    const rect = el.wrap.getBoundingClientRect();
    const cssW = Math.max(1, rect.width);
    const cssH = Math.max(1, rect.height);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    view.w = cssW;
    view.h = cssH;
    view.dpr = dpr;
    el.board.width = Math.max(1, Math.round(cssW * dpr));
    el.board.height = Math.max(1, Math.round(cssH * dpr));
    const cols = level.grid[0].length;
    const rows = level.grid.length;
    const tile = Math.max(8, Math.floor(Math.min(cssW / cols, cssH / rows)));
    view.tile = tile;
    view.ox = Math.floor((cssW - tile * cols) / 2);
    // Hang the field from the top of the play area. Short boards used to
    // float in a wood band above and below; the leftover space stays below.
    view.oy = 0;
    requestDraw();
  }

  function posOf(r, c) {
    return {
      x: view.ox + (c + 0.5) * view.tile,
      y: view.oy + (r + 0.5) * view.tile,
    };
  }

  function pointAt(path, dist) {
    const max = path.length - 1;
    if (max <= 0) return { r: path[0].r, c: path[0].c };
    const d = Math.max(0, Math.min(max, dist));
    if (d >= max) return { r: path[max].r, c: path[max].c };
    const i = Math.floor(d);
    const f = d - i;
    return {
      r: path[i].r + (path[i + 1].r - path[i].r) * f,
      c: path[i].c + (path[i + 1].c - path[i].c) * f,
    };
  }

  function baleU(dist, maxDist) {
    if (maxDist <= 0) return 1;
    return Math.max(0, Math.min(1, dist - (maxDist - 1)));
  }

  const CROP_TYPES = ["corn", "wheat", "pumpkin"];
  const FACE_ANGLE = { right: 0, down: Math.PI / 2, left: Math.PI, up: -Math.PI / 2 };

  function cellXY(r, c) {
    return { x: view.ox + c * view.tile, y: view.oy + r * view.tile };
  }

  function drawMudMark(x, y, s) {
    const pal = art.PALETTE;
    ctx.save();
    ctx.fillStyle = pal.mudDark;
    ctx.beginPath();
    ctx.ellipse(x + s * 0.5, y + s * 0.62, s * 0.18, s * 0.1, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = pal.mudGloss;
    ctx.beginPath();
    ctx.ellipse(x + s * 0.44, y + s * 0.56, s * 0.07, s * 0.035, -0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function paintCell(r, c) {
    const t = view.tile;
    const p = cellXY(r, c);
    const grid = level.grid;
    const ch = grid[r][c];
    if (ch === "#") {
      const edge = r === 0 || c === 0 || r === grid.length - 1 || c === grid[0].length - 1;
      art.drawTile(ctx, edge ? "fence" : "rock", p.x, p.y, t);
      return;
    }
    if (ch === "B") {
      art.drawBarn(ctx, p.x, p.y, t, timeSec);
      return;
    }
    const look = trailLook(r, c);
    if (look && look.full) {
      art.drawTile(ctx, "trail", p.x, p.y, t);
      if (ch === "M") drawMudMark(p.x, p.y, t);
      return;
    }
    if (look && !look.full) {
      const vertical = facing === "up" || facing === "down";
      art.drawTrail(ctx, p.x, p.y, t, look.frac, facing, vertical);
      return;
    }
    if (ch === "M") art.drawTile(ctx, "mud", p.x, p.y, t);
    else art.drawTile(ctx, "dirt", p.x, p.y, t);
  }

  function tractorXY() {
    let r = state.tractor.r;
    let c = state.tractor.c;
    let squash = 0;
    let tilt = 0;
    if (anim && anim.kind === "slide") {
      const at = pointAt(anim.path, anim.dist);
      r = at.r;
      c = at.c;
      tilt = 0.04;
      if (anim.t > 0.8) squash = Math.sin(((anim.t - 0.8) / 0.2) * Math.PI);
    } else if (anim && anim.kind === "bonk") {
      const k = Math.sin((1 - (performance.now() - anim.t0) / anim.dur) * Math.PI);
      const dir = engine.DIRS[anim.dir];
      r += dir.r * k * 0.16;
      c += dir.c * k * 0.16;
    }
    const p = cellXY(r, c);
    return { x: p.x, y: p.y, squash: squash, tilt: tilt };
  }

  function draw() {
    if (!art) return;
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    ctx.clearRect(0, 0, view.w, view.h);
    ctx.save();
    if (shake > 0.2) {
      ctx.translate((Math.random() - 0.5) * shake * 2, (Math.random() - 0.5) * shake * 2);
    }
    const grid = level.grid;
    for (let r = 0; r < grid.length; r++) {
      for (let c = 0; c < grid[r].length; c++) paintCell(r, c);
    }
    for (let i = 0; i < level.crops.length; i++) {
      if (!cropShown(i)) continue;
      const p = cellXY(level.crops[i].r, level.crops[i].c);
      art.drawTile(ctx, CROP_TYPES[(levelIndex + i) % 3], p.x, p.y, view.tile);
    }
    for (let i = 0; i < state.bales.length; i++) {
      let r = state.bales[i].r;
      let c = state.bales[i].c;
      if (anim && anim.kind === "slide" && anim.push && anim.push.index === i) {
        const u = baleU(anim.dist, anim.path.length - 1);
        const along = pointAt(anim.push.path, u * (anim.push.path.length - 1));
        r = along.r;
        c = along.c;
      }
      const p = cellXY(r, c);
      const t = view.tile;
      ctx.save();
      ctx.beginPath();
      ctx.arc(p.x + t / 2, p.y + t * 0.52, t * 0.4, 0, Math.PI * 2);
      ctx.clip();
      art.drawTile(ctx, "hay", p.x, p.y, t);
      ctx.restore();
    }
    const tp = tractorXY();
    art.drawTractor(ctx, tp.x, tp.y, view.tile, {
      angle: FACE_ANGLE[facing] || 0,
      tilt: tp.tilt,
      squash: tp.squash,
    });
    art.drawParticles(ctx);
    ctx.restore();
  }

  function onKey(e) {
    const map = {
      ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right",
      w: "up", a: "left", s: "down", d: "right",
      W: "up", A: "left", S: "down", D: "right",
    };
    if (map[e.key]) {
      if (!el.modal.classList.contains("open")) e.preventDefault();
      tryMove(map[e.key]);
      return;
    }
    if (e.key === "r" || e.key === "R") {
      e.preventDefault();
      loadLevel(levelIndex);
    } else if (e.key === "Escape") {
      closeSheet(el.modal);
    }
  }

  function boot() {
    if (art) art.prerenderAll(192);
    paintSound();
    el.restart.addEventListener("click", function () { gesture(); loadLevel(levelIndex); });
    el.levels.addEventListener("click", openFields);
    el.close.addEventListener("click", function () { closeSheet(el.modal); el.levels.focus(); });
    el.replay.addEventListener("click", function () { gesture(); loadLevel(levelIndex); });
    el.next.addEventListener("click", function () {
      gesture();
      const completed = levelIndex + 1;
      const ads = window.AdBreak || null;
      if (ads && ads.shouldShow(completed)) {
        ads.markShown(completed);
        closeSheet(el.overlay);
        ads.show(function () {
          loadLevel(levelIndex + 1);
        });
        return;
      }
      loadLevel(levelIndex + 1);
    });
    el.sound.addEventListener("click", function () {
      const first = !audioUnlocked;
      gesture();
      if (!first) {
        harvestSoundOn = !harvestSoundOn;
        paintSound();
      }
    });
    const pads = document.querySelectorAll("[data-dir]");
    for (let i = 0; i < pads.length; i++) {
      pads[i].addEventListener("click", function () { tryMove(this.dataset.dir); });
    }
    el.board.addEventListener("pointerdown", function (e) {
      if (e.button !== undefined && e.button !== 0) return;
      pointer = { x: e.clientX, y: e.clientY, id: e.pointerId };
      el.board.setPointerCapture(e.pointerId);
    });
    el.board.addEventListener("pointerup", function (e) {
      if (!pointer || pointer.id !== e.pointerId) return;
      const dx = e.clientX - pointer.x;
      const dy = e.clientY - pointer.y;
      pointer = null;
      if (Math.hypot(dx, dy) < 22) return;
      if (Math.abs(dx) > Math.abs(dy)) tryMove(dx > 0 ? "right" : "left");
      else tryMove(dy > 0 ? "down" : "up");
    });
    el.board.addEventListener("pointercancel", function () { pointer = null; });
    el.board.addEventListener("contextmenu", function (e) { e.preventDefault(); });
    document.addEventListener("keydown", onKey);
    if (typeof ResizeObserver === "function") {
      new ResizeObserver(function () { fit(); }).observe(el.wrap);
    } else {
      window.addEventListener("resize", fit);
    }
    window.addEventListener("resize", fit);

    let index = save.last || 0;
    const query = new URLSearchParams(location.search).get("level");
    const picked = parseInt(query || "", 10);
    if (picked >= 1 && picked <= levels.length) index = picked - 1;
    loadLevel(index);
    fit();
  }

  boot();
})();
