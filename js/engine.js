/* Harvest Slide rules (phase 3 — paint the field).
   The tractor slides in a straight line until a wall, a mud tile, or a bale.
   Every dirt tile it enters or crosses becomes plowed, including mud.
   # fence/rock and B barn block the slide on the tile before them.
   B is decoration: it is not a goal and it is not plowable.
   C is a crop sitting on dirt. Entering it plows the tile and banks a coin
   on the eventual win. Crops are not a win condition.
   M stops the slide on that tile and plows it. The tractor can leave next move.
   H is a hay bale. Hitting one pushes it until the bale hits a fence, rock,
   mud, barn, other bale, or the field edge. The bale does not plow or harvest.
   The tractor stops where the bale started, and that tile plows when entered.
   A bale that cannot move is a wall. One bale per shove (no chains).
   A move that does not change the tractor's tile does not count.
   The start tile begins plowed. Win: every dirt tile (dirt, crop, mud) is plowed.
*/
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.HarvestEngine = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const DIRS = {
    up: { r: -1, c: 0 },
    down: { r: 1, c: 0 },
    left: { r: 0, c: -1 },
    right: { r: 0, c: 1 },
  };

  const DIR_NAMES = ["up", "down", "left", "right"];

  function parseLevel(def) {
    const grid = def.rows.map((row) => row.split(""));
    const height = grid.length;
    const width = grid[0] ? grid[0].length : 0;
    if (!height || !width) throw new Error(def.name + ": empty map");
    for (let r = 0; r < height; r++) {
      if (grid[r].length !== width) {
        throw new Error(def.name + ": row " + r + " is jagged");
      }
    }

    let tractor = null;
    const bales = [];
    const crops = [];
    let barns = 0;

    for (let r = 0; r < height; r++) {
      for (let c = 0; c < width; c++) {
        const ch = grid[r][c];
        if (ch === "T") {
          if (tractor) throw new Error(def.name + ": two tractors");
          tractor = { r: r, c: c };
          grid[r][c] = ".";
        } else if (ch === "H") {
          bales.push({ r: r, c: c });
          grid[r][c] = ".";
        } else if (ch === "C") {
          crops.push({ r: r, c: c });
        } else if (ch === "B") {
          barns += 1;
        } else if (ch !== "." && ch !== "#" && ch !== "M") {
          throw new Error(def.name + ": bad tile '" + ch + "'");
        }
      }
    }

    if (!tractor) throw new Error(def.name + ": missing tractor");

    const plowAt = [];
    const plowable = [];
    for (let r = 0; r < height; r++) {
      plowAt.push([]);
      for (let c = 0; c < width; c++) {
        const ch = grid[r][c];
        if (ch === "." || ch === "C" || ch === "M") {
          plowAt[r].push(plowable.length);
          plowable.push({ r: r, c: c });
        } else {
          plowAt[r].push(-1);
        }
      }
    }

    if (!plowable.length) throw new Error(def.name + ": nothing to plow");
    if (plowAt[tractor.r][tractor.c] < 0) {
      throw new Error(def.name + ": tractor is not on dirt");
    }

    return {
      name: def.name,
      par: def.par,
      grid: grid,
      tractor: tractor,
      bales: bales,
      crops: crops,
      barns: barns,
      plowable: plowable,
      plowAt: plowAt,
    };
  }

  function initialState(level) {
    const plowed = level.plowable.map(function () { return false; });
    plowed[level.plowAt[level.tractor.r][level.tractor.c]] = true;
    return {
      tractor: { r: level.tractor.r, c: level.tractor.c },
      bales: level.bales.map(function (b) { return { r: b.r, c: b.c }; }),
      harvested: level.crops.map(function () { return false; }),
      plowed: plowed,
    };
  }

  function inBounds(level, r, c) {
    return r >= 0 && c >= 0 && r < level.grid.length && c < level.grid[0].length;
  }

  function plowCell(level, plowed, r, c) {
    const idx = level.plowAt[r][c];
    if (idx >= 0) plowed[idx] = true;
  }

  function cropAt(level, harvested, r, c) {
    for (let i = 0; i < level.crops.length; i++) {
      const crop = level.crops[i];
      if (!harvested[i] && crop.r === r && crop.c === c) return i;
    }
    return -1;
  }

  function baleCanEnter(level, bales, index, r, c) {
    if (!inBounds(level, r, c)) return false;
    const ch = level.grid[r][c];
    if (ch !== "." && ch !== "C") return false;
    for (let i = 0; i < bales.length; i++) {
      if (i !== index && bales[i].r === r && bales[i].c === c) return false;
    }
    return true;
  }

  function slideBaleTo(level, bales, index, dir) {
    let r = bales[index].r;
    let c = bales[index].c;
    const startR = r;
    const startC = c;
    while (true) {
      const nr = r + dir.r;
      const nc = c + dir.c;
      if (!baleCanEnter(level, bales, index, nr, nc)) break;
      r = nr;
      c = nc;
    }
    if (r === startR && c === startC) return null;
    return { r: r, c: c };
  }

  function balePath(from, dest, dir) {
    const path = [{ r: from.r, c: from.c }];
    let r = from.r;
    let c = from.c;
    while (r !== dest.r || c !== dest.c) {
      r += dir.r;
      c += dir.c;
      path.push({ r: r, c: c });
    }
    return path;
  }

  function isWin(level, state) {
    for (let i = 0; i < state.plowed.length; i++) {
      if (!state.plowed[i]) return false;
    }
    return true;
  }

  function applyMove(level, state, dirName) {
    const dir = DIRS[dirName];
    if (!dir) return null;

    let r = state.tractor.r;
    let c = state.tractor.c;
    const bales = state.bales.map(function (b) { return { r: b.r, c: b.c }; });
    const harvested = state.harvested.slice();
    const plowed = state.plowed.slice();
    const events = [];
    let moved = false;

    while (true) {
      const nr = r + dir.r;
      const nc = c + dir.c;
      if (!inBounds(level, nr, nc) || level.grid[nr][nc] === "#" || level.grid[nr][nc] === "B") {
        events.push({ type: "stop", reason: "wall" });
        break;
      }

      const baleIndex = bales.findIndex(function (b) { return b.r === nr && b.c === nc; });
      if (baleIndex !== -1) {
        const dest = slideBaleTo(level, bales, baleIndex, dir);
        if (!dest) {
          events.push({ type: "stop", reason: "bale" });
          break;
        }
        const path = balePath(bales[baleIndex], dest, dir);
        bales[baleIndex] = { r: dest.r, c: dest.c };
        r = nr;
        c = nc;
        moved = true;
        plowCell(level, plowed, r, c);
        events.push({
          type: "push",
          baleIndex: baleIndex,
          r: r,
          c: c,
          balePath: path,
        });
        const under = cropAt(level, harvested, r, c);
        if (under !== -1) {
          harvested[under] = true;
          events.push({ type: "harvest", cropIndex: under, r: r, c: c });
        }
        events.push({ type: "stop", reason: "push" });
        break;
      }

      r = nr;
      c = nc;
      moved = true;
      plowCell(level, plowed, r, c);
      events.push({ type: "step", r: r, c: c });
      const grown = cropAt(level, harvested, r, c);
      if (grown !== -1) {
        harvested[grown] = true;
        events.push({ type: "harvest", cropIndex: grown, r: r, c: c });
      }
      if (level.grid[r][c] === "M") {
        events.push({ type: "stop", reason: "mud" });
        break;
      }
    }

    if (!moved) return null;

    const next = {
      tractor: { r: r, c: c },
      bales: bales,
      harvested: harvested,
      plowed: plowed,
    };
    const cropsLeft = harvested.reduce(function (n, done) { return n + (done ? 0 : 1); }, 0);
    return { state: next, events: events, won: isWin(level, next), cropsLeft: cropsLeft };
  }

  function starsFor(moves, par) {
    if (moves <= par) return 3;
    if (moves <= par + 2) return 2;
    return 1;
  }

  function plowedCount(state) {
    let n = 0;
    for (let i = 0; i < state.plowed.length; i++) if (state.plowed[i]) n += 1;
    return n;
  }

  function cropsLeft(state) {
    return state.harvested.reduce(function (n, done) { return n + (done ? 0 : 1); }, 0);
  }

  return {
    DIRS: DIRS,
    DIR_NAMES: DIR_NAMES,
    parseLevel: parseLevel,
    initialState: initialState,
    applyMove: applyMove,
    isWin: isWin,
    starsFor: starsFor,
    plowedCount: plowedCount,
    cropsLeft: cropsLeft,
  };
});
