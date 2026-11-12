/* Harvest Slide — Graphics Kit (art-kit.js)
 *
 * Canvas-based, dependency-free farm renderer in a smooth AMAZE-like
 * language. Original art, drawn entirely in code — no external images,
 * no copied assets.
 *
 * Phase 4 look: the field is ONE continuous soil surface inside a rounded
 * frame (no per-tile blocks, bevels or grid gaps). The plowed trail is a
 * smooth painted band with rounded caps and rounded turns drawn as one
 * flowing shape. Fences join into continuous wooden wall runs, rocks are
 * smooth shaded boulders, mud is a glossy puddle, crops and bales sit ON
 * the surface. Usage (game side):
 *
 *   HarvestArt.prerenderAll(192);          // once at boot
 *   HarvestArt.drawFieldBase(ctx, x, y, w, h, tile);   // soil surface
 *   HarvestArt.drawTrailLayer(ctx, field, isFull, partial); // paint band
 *   HarvestArt.drawFenceCells(ctx, cells, tile);       // joined walls
 *   HarvestArt.drawRockCells(ctx, cells, tile);        // boulders
 *   HarvestArt.drawMudPuddle(ctx, x, y, s, plowed);    // glossy puddle
 *   HarvestArt.drawTile(ctx, 'corn', x, y, s);         // sits on surface
 *   HarvestArt.drawTractor(ctx, x, y, s, { tilt, squash });
 *   HarvestArt.drawFieldLight(ctx, x, y, w, h);        // top-down light
 *   HarvestArt.spawnDust(px, py, 6); ... update/draw particles each frame
 *
 * Phone-first: small sprites are pre-rendered once to offscreen canvases,
 * then blitted with drawImage. Surfaces and unions draw live (cheap rects).
 */
(function (global) {
  'use strict';

  // ---------------------------------------------------------------- palette
  // Named constants — the whole kit reads from here. Tweak these to reskin.
  var PALETTE = {
    // field: one warm flat soil + flecks (no per-tile bevels anymore)
    soilTop:     '#B4713B',
    soilBottom:  '#9E5C2A',
    soilRim:     'rgba(74,38,12,0.55)',
    soilSpeck1:  '#8A5226',
    soilSpeck2:  '#DCA468',

    // plowed trail ("paint fill" signature): richer, darker, faint furrows
    trailTop:    '#8A5427',
    trailBottom: '#6E3F1B',
    furrowDark:  'rgba(52,28,9,0.45)',
    furrowLight: 'rgba(255,220,170,0.20)',

    // crops
    cornLeaf:    '#2F9E44',
    cornLeafDk:  '#1F7A33',
    cornGold:    '#FFC93C',
    cornGoldDk:  '#E09E00',
    wheatBase:   '#F2B705',
    wheatDark:   '#C78D02',
    wheatStalk:  '#9A6B00',
    pumpkinBase: '#F76707',
    pumpkinDark: '#C24E00',
    pumpkinLight:'#FFA94D',
    vineGreen:   '#2F9E44',

    // specials
    mudBase:     '#5D3A1E',
    mudDark:     '#3A2210',
    mudGloss:    'rgba(255,255,255,0.55)',
    hayBase:     '#E8B93E',
    hayDark:     '#B97F1F',
    hayBand:     '#9A6410',
    woodBase:    '#8B5A2B',
    woodDark:    '#5F3B17',
    woodLight:   '#A1763A',
    woodLine:    'rgba(70,40,14,0.35)',
    rockBase:    '#9AA3AD',
    rockDark:    '#646E78',
    rockLight:   '#E2E8EE',
    barnRed:     '#E03131',
    barnDark:    '#A61E1E',
    barnTrim:    '#FFFFFF',
    barnGlow:    'rgba(255,120,120,0.85)',

    // tractor (Adrian-orange — pops on brown)
    tractorBody: '#FF7A1A',
    tractorDark: '#C2570B',
    tractorCab:  '#BEE3F8',
    tractorCabDk:'#6aa9d6',
    tyreBase:    '#343A40',
    tyreHub:     '#FFD43B',

    // fx
    dust:        'rgba(214,186,150,0.9)',
    sparkle:     '#FFF3BF',
    confetti:    ['#FF6B6B', '#FFD43B', '#51CF66', '#4DABF7', '#B197FC', '#FF9226'],
    shadow:      'rgba(60,30,5,0.35)'
  };

  // Tile type ids the game uses.
  var TILE_TYPES = ['dirt', 'trail', 'corn', 'wheat', 'pumpkin',
                    'mud', 'hay', 'fence', 'rock', 'barn'];

  // ---------------------------------------------------------------- helpers
  function rr(ctx, x, y, w, h, r) {
    // Rounded-rect path. r clamps to half the smallest side.
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function circle(ctx, x, y, r) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
  }

  function ellipse(ctx, x, y, rx, ry) {
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  }

  // Deterministic pseudo-random from an int seed (stable flecks every run).
  function srand(seed) {
    var t = (seed * 1664525 + 1013904223) >>> 0;
    return function () {
      t = (t * 1664525 + 1013904223) >>> 0;
      return t / 4294967296;
    };
  }

  // ------------------------------------------------------- sprite prerender
  var SPRITES = {};      // key -> canvas
  var SPRITE_PX = 192;   // bake resolution; blitted scaled at draw time
  var NOISE = null;      // baked fleck tile for the soil surface

  function makeSprite(key, painter) {
    var c = document.createElement('canvas');
    c.width = SPRITE_PX;
    c.height = SPRITE_PX;
    painter(c.getContext('2d'), SPRITE_PX);
    SPRITES[key] = c;
    return c;
  }

  function bakeNoise() {
    var c = document.createElement('canvas');
    c.width = 128;
    c.height = 128;
    var g = c.getContext('2d');
    var rnd = srand(20261112);
    for (var i = 0; i < 210; i++) {
      var px = rnd() * 128, py = rnd() * 128;
      var pr = 0.5 + rnd() * 1.6;
      g.fillStyle = (i % 2) ? PALETTE.soilSpeck1 : PALETTE.soilSpeck2;
      g.globalAlpha = 0.16 + rnd() * 0.20;
      g.beginPath();
      g.arc(px, py, pr, 0, Math.PI * 2);
      g.fill();
    }
    // a few slightly larger dry clods for texture
    for (var j = 0; j < 26; j++) {
      var qx = rnd() * 128, qy = rnd() * 128;
      var qr = 1.8 + rnd() * 2.2;
      g.fillStyle = PALETTE.soilSpeck1;
      g.globalAlpha = 0.10 + rnd() * 0.10;
      g.beginPath();
      g.arc(qx, qy, qr, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
    NOISE = c;
  }

  // ------------------------------------------------- continuous soil field
  // One seamless surface: soft drop shadow, warm flat gradient, baked
  // fleck texture, soft inner shadow and a thin rim. No tiles, no gaps.
  function drawFieldBase(ctx, x, y, w, h, tile) {
    var r = Math.min(tile * 0.35, 16);
    // soft drop shadow under the whole field slab
    ctx.save();
    ctx.fillStyle = 'rgba(30,14,3,0.45)';
    rr(ctx, x + 2, y + 5, w, h, r);
    ctx.fill();
    ctx.restore();

    var g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, PALETTE.soilTop);
    g.addColorStop(1, PALETTE.soilBottom);
    ctx.fillStyle = g;
    rr(ctx, x, y, w, h, r);
    ctx.fill();

    // fleck texture tiled over the surface, clipped to the frame
    if (NOISE) {
      ctx.save();
      rr(ctx, x, y, w, h, r);
      ctx.clip();
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = ctx.createPattern(NOISE, 'repeat');
      ctx.fillRect(x, y, w, h);
      ctx.globalAlpha = 1;
      ctx.restore();
    }

    // soft inner shadow: darkened top and side edges (sunken-field read)
    ctx.save();
    rr(ctx, x, y, w, h, r);
    ctx.clip();
    var sh = Math.max(6, tile * 0.30);
    var ig = ctx.createLinearGradient(0, y, 0, y + sh);
    ig.addColorStop(0, 'rgba(50,24,6,0.30)');
    ig.addColorStop(1, 'rgba(50,24,6,0)');
    ctx.fillStyle = ig;
    ctx.fillRect(x, y, w, sh);
    var igL = ctx.createLinearGradient(x, 0, x + sh, 0);
    igL.addColorStop(0, 'rgba(50,24,6,0.22)');
    igL.addColorStop(1, 'rgba(50,24,6,0)');
    ctx.fillStyle = igL;
    ctx.fillRect(x, y, sh, h);
    var igR = ctx.createLinearGradient(x + w, 0, x + w - sh, 0);
    igR.addColorStop(0, 'rgba(50,24,6,0.22)');
    igR.addColorStop(1, 'rgba(50,24,6,0)');
    ctx.fillStyle = igR;
    ctx.fillRect(x + w - sh, y, sh, h);
    var igB = ctx.createLinearGradient(0, y + h, 0, y + h - sh * 0.6);
    igB.addColorStop(0, 'rgba(255,225,170,0.10)');
    igB.addColorStop(1, 'rgba(255,225,170,0)');
    ctx.fillStyle = igB;
    ctx.fillRect(x, y + h - sh * 0.6, w, sh * 0.6);
    ctx.restore();
  }

  // One soft top-down light wash over the whole board (AMAZE-style sun).
  function drawFieldLight(ctx, x, y, w, h, tile) {
    var r = Math.min(tile * 0.35, 16);
    ctx.save();
    rr(ctx, x, y, w, h, r);
    ctx.clip();
    var g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, 'rgba(255,242,214,0.14)');
    g.addColorStop(0.55, 'rgba(255,242,214,0.02)');
    g.addColorStop(1, 'rgba(60,22,0,0.10)');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
    // thin rim so the slab reads against the dark wood surround
    ctx.strokeStyle = PALETTE.soilRim;
    ctx.lineWidth = 2;
    rr(ctx, x + 1, y + 1, w - 2, h - 2, Math.max(1, r - 1));
    ctx.stroke();
    ctx.restore();
  }

  // ------------------------------------------- seamless union cell coverage
  // Cells are filled as exact full-bleed squares (guaranteed seamless),
  // then every grid vertex is inspected: convex outer corners get rounded
  // (soil-colored cut + paint-colored quarter disc) and concave inner
  // corners get a fillet disc. Straight edges need nothing.
  function eachVertex(rows, cols, fn) {
    for (var vr = 0; vr <= rows; vr++) {
      for (var vc = 0; vc <= cols; vc++) fn(vr, vc);
    }
  }

  function quadAt(isOn, rows, cols, vr, vc) {
    // occupancy of the 4 cells around vertex (vr, vc); out of bounds = off
    var tl = (vr > 0 && vc > 0) ? isOn(vr - 1, vc - 1) : false;
    var tr = (vr > 0 && vc < cols) ? isOn(vr - 1, vc) : false;
    var bl = (vr < rows && vc > 0) ? isOn(vr, vc - 1) : false;
    var br = (vr < rows && vc < cols) ? isOn(vr, vc) : false;
    return [tl, tr, bl, br];
  }

  function roundUnionCorners(ctx, ox, oy, t, rows, cols, isOn, paintGrad,
                             soilGrad, rad) {
    // paintGrad/soilGrad: fill styles (gradients in field space stay
    // seamless across cells). rad: corner radius in px.
    eachVertex(rows, cols, function (vr, vc) {
      var q = quadAt(isOn, rows, cols, vr, vc);
      var n = (q[0] ? 1 : 0) + (q[1] ? 1 : 0) + (q[2] ? 1 : 0) + (q[3] ? 1 : 0);
      if (n === 0 || n === 4) return;
      var vx = ox + vc * t, vy = oy + vr * t;
      if (n === 1) {
        // convex corner: erase the paint square in the ON cell's corner
        // back to soil, then roll a paint disc into it. The cut MUST sit
        // inside the ON cell's quadrant — anywhere else floats a stray
        // square outside the union.
        var idx = q[0] ? 0 : q[1] ? 1 : q[2] ? 2 : 3;
        var dx = (idx === 0 || idx === 2) ? -1 : 1;
        var dy = (idx === 0 || idx === 1) ? -1 : 1;
        ctx.fillStyle = soilGrad;
        ctx.fillRect((idx === 0 || idx === 2) ? vx - rad : vx,
                     (idx === 0 || idx === 1) ? vy - rad : vy, rad, rad);
        ctx.fillStyle = paintGrad;
        circle(ctx, vx + dx * rad, vy + dy * rad, rad);
        ctx.fill();
      } else if (n === 3) {
        // concave corner: fillet disc melts the inner step
        ctx.fillStyle = paintGrad;
        circle(ctx, vx, vy, rad);
        ctx.fill();
      } else {
        // two cells: straight run (adjacent) needs nothing; a diagonal
        // touch gets a small dab so no soil pinhole shows.
        var adj = (q[0] && q[1]) || (q[2] && q[3]) ||
                  (q[0] && q[2]) || (q[1] && q[3]);
        if (!adj) {
          ctx.fillStyle = paintGrad;
          circle(ctx, vx, vy, rad * 0.55);
          ctx.fill();
        }
      }
    });
  }

  // ------------------------------------------------------- the painted band
  // field: { x, y, tile, rows, cols }. isFull(r, c) -> bool for finished
  // cells. partial: { r, c, frac, dir } | null for the cell mid-sweep.
  function drawTrailLayer(ctx, field, isFull, partial) {
    var ox = field.x, oy = field.y, t = field.tile;
    var rows = field.rows, cols = field.cols;
    var paint = ctx.createLinearGradient(0, oy, 0, oy + rows * t);
    paint.addColorStop(0, PALETTE.trailTop);
    paint.addColorStop(1, PALETTE.trailBottom);
    var soil = ctx.createLinearGradient(0, oy, 0, oy + rows * t);
    soil.addColorStop(0, PALETTE.soilTop);
    soil.addColorStop(1, PALETTE.soilBottom);

    // soft fringe under the band so the edge melts into the soil.
    // One fill call: per-cell translucent fills would double-darken laps.
    ctx.save();
    ctx.fillStyle = 'rgba(46,22,6,0.28)';
    ctx.beginPath();
    for (var fr = 0; fr < rows; fr++) {
      for (var fc = 0; fc < cols; fc++) {
        if (!isFull(fr, fc)) continue;
        ctx.rect(ox + fc * t - 1, oy + fr * t - 1, t + 2, t + 2);
      }
    }
    ctx.fill();
    ctx.restore();

    // seamless band body
    ctx.fillStyle = paint;
    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        if (!isFull(r, c)) continue;
        ctx.fillRect(ox + c * t, oy + r * t, t, t);
      }
    }
    roundUnionCorners(ctx, ox, oy, t, rows, cols, isFull, paint, soil,
                      t * 0.24);

    // faint furrows running along the band (tilled-soil read), clipped
    // to the finished band + the partial sweep.
    ctx.save();
    ctx.beginPath();
    for (var cr = 0; cr < rows; cr++) {
      for (var cc = 0; cc < cols; cc++) {
        if (isFull(cr, cc)) ctx.rect(ox + cc * t, oy + cr * t, t, t);
      }
    }
    if (partial) {
      var pr = partialRect(ox, oy, t, partial);
      ctx.rect(pr.x, pr.y, pr.w, pr.h);
    }
    ctx.clip();
    ctx.lineWidth = Math.max(1, t * 0.028);
    for (var lr = 0; lr < rows; lr++) {
      for (var k = 0; k < 3; k++) {
        var fy = oy + lr * t + t * (0.25 + k * 0.25);
        ctx.strokeStyle = (k % 2) ? PALETTE.furrowLight : PALETTE.furrowDark;
        ctx.globalAlpha = 0.55;
        ctx.beginPath();
        ctx.moveTo(ox, fy);
        ctx.lineTo(ox + cols * t, fy);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    // the live sweep: partial cell + rounded wet leading cap
    if (partial && partial.frac > 0.001) drawPartialSweep(ctx, field, partial, paint);
  }

  function partialRect(ox, oy, t, p) {
    var x = ox + p.c * t, y = oy + p.r * t;
    var f = Math.max(0, Math.min(1, p.frac));
    if (p.dir === 'right') return { x: x, y: y, w: t * f, h: t };
    if (p.dir === 'left') return { x: x + t * (1 - f), y: y, w: t * f, h: t };
    if (p.dir === 'down') return { x: x, y: y, w: t, h: t * f };
    return { x: x, y: y + t * (1 - f), w: t, h: t * f }; // up
  }

  function drawPartialSweep(ctx, field, p, paint) {
    var t = field.tile;
    var pr = partialRect(field.x, field.y, t, p);
    ctx.fillStyle = paint;
    ctx.fillRect(pr.x, pr.y, pr.w, pr.h);
    // rounded wet cap + glossy lip at the leading edge
    var cx, cy, capR = t * 0.5;
    if (p.dir === 'right') { cx = pr.x + pr.w; cy = pr.y + t / 2; }
    else if (p.dir === 'left') { cx = pr.x; cy = pr.y + t / 2; }
    else if (p.dir === 'down') { cx = pr.x + t / 2; cy = pr.y + pr.h; }
    else { cx = pr.x + t / 2; cy = pr.y; }
    ctx.fillStyle = paint;
    circle(ctx, cx, cy, capR);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,235,200,0.30)';
    ellipse(ctx, cx, cy - capR * 0.35, capR * 0.30, capR * 0.16);
    ctx.fill();
  }

  // Standalone sweep painter (kept for API compat; the layer above is
  // what the game uses). Assumes soil is already beneath.
  function drawTrail(ctx, x, y, s, progress, dir) {
    progress = Math.max(0, Math.min(1, progress));
    if (progress <= 0.001) return;
    var paint = ctx.createLinearGradient(0, y, 0, y + s);
    paint.addColorStop(0, PALETTE.trailTop);
    paint.addColorStop(1, PALETTE.trailBottom);
    drawPartialSweep(ctx, { x: x, y: y, tile: s }, {
      r: 0, c: 0, frac: progress, dir: dir || 'right'
    }, paint);
  }

  // --------------------------------------- walls that join along their run
  // Fence cells merge into continuous low wooden walls: one soft shadow,
  // one top-lit wooden body with rounded outer corners, grain lines and
  // round posts only at run ends and junctions. cells: [{r,c}].
  function drawFenceCells(ctx, field, cells) {
    if (!cells.length) return;
    var ox = field.x, oy = field.y, t = field.tile;
    var on = cellSet(cells);
    var isOn = function (r, c) { return !!on[r + ',' + c]; };
    var wood = ctx.createLinearGradient(0, oy, 0, oy + field.rows * t);
    wood.addColorStop(0, PALETTE.woodLight);
    wood.addColorStop(0.45, PALETTE.woodBase);
    wood.addColorStop(1, PALETTE.woodDark);

    // gentle drop shadow of the whole run, offset down onto the soil.
    // One fill call so laps between cells never double-darken.
    ctx.save();
    ctx.fillStyle = PALETTE.shadow;
    ctx.beginPath();
    cells.forEach(function (cell) {
      ctx.rect(ox + cell.c * t, oy + cell.r * t + t * 0.07, t, t);
    });
    ctx.fill();
    ctx.restore();

    // joined wooden body
    ctx.fillStyle = wood;
    cells.forEach(function (cell) {
      ctx.fillRect(ox + cell.c * t, oy + cell.r * t, t, t);
    });
    var woodFlat = PALETTE.woodBase;
    roundUnionCorners(ctx, ox, oy, t, field.rows, field.cols, isOn,
                      wood, woodFlat, t * 0.30);

    // grain: plank lines follow the run's direction so long walls read
    // as joined timber, never as ladder rungs.
    ctx.save();
    ctx.beginPath();
    cells.forEach(function (cell) {
      ctx.rect(ox + cell.c * t, oy + cell.r * t, t, t);
    });
    ctx.clip();
    ctx.strokeStyle = PALETTE.woodLine;
    ctx.lineWidth = Math.max(1, t * 0.03);
    cells.forEach(function (cell) {
      var cx0 = ox + cell.c * t, cy0 = oy + cell.r * t;
      var horiz = isOn(cell.r, cell.c - 1) || isOn(cell.r, cell.c + 1);
      var vert = isOn(cell.r - 1, cell.c) || isOn(cell.r + 1, cell.c);
      if (horiz || (!horiz && !vert)) {
        ctx.beginPath();
        ctx.moveTo(cx0 - 1, cy0 + t * 0.36);
        ctx.lineTo(cx0 + t + 1, cy0 + t * 0.36);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(cx0 - 1, cy0 + t * 0.64);
        ctx.lineTo(cx0 + t + 1, cy0 + t * 0.64);
        ctx.stroke();
      }
      if (vert) {
        ctx.beginPath();
        ctx.moveTo(cx0 + t * 0.36, cy0 - 1);
        ctx.lineTo(cx0 + t * 0.36, cy0 + t + 1);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(cx0 + t * 0.64, cy0 - 1);
        ctx.lineTo(cx0 + t * 0.64, cy0 + t + 1);
        ctx.stroke();
      }
    });
    // top-light wash over the run
    var tg = ctx.createLinearGradient(0, oy, 0, oy + field.rows * t);
    tg.addColorStop(0, 'rgba(255,235,200,0.15)');
    tg.addColorStop(0.4, 'rgba(255,235,200,0)');
    ctx.fillStyle = tg;
    ctx.fillRect(ox, oy, field.cols * t, field.rows * t);
    ctx.restore();

    // round posts only at the run's outer corners and ends: every convex
    // union vertex gets one post tucked just inside the corner, so long
    // runs read as one joined wall instead of a ladder of squares.
    eachVertex(field.rows, field.cols, function (vr, vc) {
      var q = quadAt(isOn, field.rows, field.cols, vr, vc);
      var n = (q[0] ? 1 : 0) + (q[1] ? 1 : 0) + (q[2] ? 1 : 0) + (q[3] ? 1 : 0);
      if (n !== 1) return;
      var idx = q[0] ? 0 : q[1] ? 1 : q[2] ? 2 : 3;
      var dx = (idx === 0 || idx === 2) ? -1 : 1;
      var dy = (idx === 0 || idx === 1) ? -1 : 1;
      var px = ox + vc * t + dx * t * 0.20;
      var py = oy + vr * t + dy * t * 0.20;
      var pg = ctx.createLinearGradient(px - t * 0.09, 0, px + t * 0.09, 0);
      pg.addColorStop(0, PALETTE.woodDark);
      pg.addColorStop(0.5, PALETTE.woodBase);
      pg.addColorStop(1, PALETTE.woodLight);
      ctx.fillStyle = pg;
      circle(ctx, px, py, t * 0.13);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,240,210,0.5)';
      circle(ctx, px - t * 0.035, py - t * 0.04, t * 0.035);
      ctx.fill();
    });
  }

  // Rocks: smooth shaded boulders that melt into a ridge where they join.
  function drawRockCells(ctx, field, cells) {
    if (!cells.length) return;
    var ox = field.x, oy = field.y, t = field.tile;
    var on = cellSet(cells);
    var isOn = function (r, c) { return !!on[r + ',' + c]; };
    var stone = ctx.createLinearGradient(0, oy, 0, oy + field.rows * t);
    stone.addColorStop(0, PALETTE.rockLight);
    stone.addColorStop(0.5, PALETTE.rockBase);
    stone.addColorStop(1, PALETTE.rockDark);

    // pooled contact shadow under the whole ridge, one fill call.
    ctx.save();
    ctx.fillStyle = PALETTE.shadow;
    ctx.beginPath();
    cells.forEach(function (cell) {
      ctx.rect(ox + cell.c * t, oy + (cell.r + 0.72) * t, t, t * 0.28);
    });
    ctx.fill();
    ctx.restore();

    ctx.fillStyle = stone;
    cells.forEach(function (cell) {
      ctx.fillRect(ox + cell.c * t, oy + cell.r * t, t, t);
    });
    roundUnionCorners(ctx, ox, oy, t, field.rows, field.cols, isOn,
                      stone, stone, t * 0.34);

    // cool top light washing the whole ridge at once, so joined boulders
    // read as one smooth shaded mass, not separate blocks.
    ctx.save();
    ctx.beginPath();
    cells.forEach(function (cell) {
      ctx.rect(ox + cell.c * t, oy + cell.r * t, t, t);
    });
    ctx.clip();
    var sg = ctx.createLinearGradient(0, oy, 0, oy + field.rows * t);
    sg.addColorStop(0, 'rgba(255,255,255,0.30)');
    sg.addColorStop(0.45, 'rgba(255,255,255,0)');
    ctx.fillStyle = sg;
    ctx.fillRect(ox, oy, field.cols * t, field.rows * t);
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    cells.forEach(function (cell) {
      if (!isOn(cell.r, cell.c - 1) && !isOn(cell.r - 1, cell.c)) {
        ellipse(ctx, ox + (cell.c + 0.30) * t, oy + (cell.r + 0.22) * t,
                t * 0.13, t * 0.06);
        ctx.fill();
      }
    });
    ctx.restore();
  }

  function cellSet(cells) {
    var on = {};
    cells.forEach(function (cell) { on[cell.r + ',' + cell.c] = true; });
    return on;
  }

  // ------------------------------------------------- glossy puddle, no tile
  // An ellipse of wet mud blended into the surface (soft alpha rim) with
  // a sky-gloss highlight. Plowed puddles read darker, already tracked.
  function drawMudPuddle(ctx, x, y, s, plowed) {
    var cx = x + s / 2, cy = y + s * 0.54;
    ctx.save();
    var g = ctx.createRadialGradient(cx, cy, s * 0.04, cx, cy, s * 0.44);
    if (plowed) {
      g.addColorStop(0, '#4A2C12');
      g.addColorStop(0.7, 'rgba(74,44,18,0.95)');
    } else {
      g.addColorStop(0, PALETTE.mudBase);
      g.addColorStop(0.7, 'rgba(93,58,30,0.95)');
    }
    g.addColorStop(1, 'rgba(93,58,30,0)');
    ctx.fillStyle = g;
    ellipse(ctx, cx, cy, s * 0.44, s * 0.30);
    ctx.fill();
    // wet sheen
    var sheen = ctx.createRadialGradient(cx - s * 0.12, cy - s * 0.10, s * 0.01,
                                         cx - s * 0.12, cy - s * 0.10, s * 0.20);
    sheen.addColorStop(0, PALETTE.mudGloss);
    sheen.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = sheen;
    ellipse(ctx, cx - s * 0.12, cy - s * 0.10, s * 0.20, s * 0.11);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    circle(ctx, cx + s * 0.16, cy + s * 0.12, s * 0.022);
    ctx.fill();
    ctx.restore();
  }

  // -------------------------------------------- things that sit ON the soil
  // Crops, bales and the barn cast soft contact shadows straight onto the
  // surface — no tile backing under any of them.
  function contactShadow(ctx, s, cx, cy, rx, ry) {
    ctx.fillStyle = PALETTE.shadow;
    ellipse(ctx, cx, cy, rx, ry);
    ctx.fill();
  }

  function paintCorn(ctx, s) {
    var cx = s / 2;
    ctx.save();
    contactShadow(ctx, s, cx, s * 0.80, s * 0.22, s * 0.06);
    // stalks
    ctx.strokeStyle = PALETTE.cornLeafDk;
    ctx.lineCap = 'round';
    ctx.lineWidth = s * 0.045;
    ctx.beginPath(); ctx.moveTo(cx - s * 0.10, s * 0.78); ctx.lineTo(cx - s * 0.13, s * 0.40); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx + s * 0.10, s * 0.78); ctx.lineTo(cx + s * 0.13, s * 0.40); ctx.stroke();
    // leaves (chunky triangles)
    ctx.fillStyle = PALETTE.cornLeaf;
    var leaf = function (x, y, flip, len) {
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + flip * len, y - len * 0.25, x + flip * len * 1.15, y - len * 0.7);
      ctx.quadraticCurveTo(x + flip * len * 0.45, y - len * 0.35, x, y - len * 0.12);
      ctx.closePath(); ctx.fill();
    };
    leaf(cx - s * 0.12, s * 0.62, -1, s * 0.20);
    leaf(cx + s * 0.12, s * 0.62, 1, s * 0.20);
    leaf(cx - s * 0.12, s * 0.50, -1, s * 0.16);
    leaf(cx + s * 0.12, s * 0.50, 1, s * 0.16);
    // two gold cobs with gloss dot
    var cob = function (x, y, w, h) {
      ctx.fillStyle = PALETTE.cornGoldDk;
      ellipse(ctx, x + s * 0.012, y + s * 0.018, w, h); ctx.fill();
      var g = ctx.createLinearGradient(x - w, y - h, x + w, y + h);
      g.addColorStop(0, '#FFE27A');
      g.addColorStop(1, PALETTE.cornGold);
      ctx.fillStyle = g;
      ellipse(ctx, x, y, w, h); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      circle(ctx, x - w * 0.3, y - h * 0.35, w * 0.18); ctx.fill();
    };
    cob(cx - s * 0.11, s * 0.42, s * 0.075, s * 0.11);
    cob(cx + s * 0.11, s * 0.42, s * 0.075, s * 0.11);
    ctx.restore();
  }

  function paintWheat(ctx, s) {
    var cx = s / 2;
    ctx.save();
    contactShadow(ctx, s, cx, s * 0.82, s * 0.20, s * 0.055);
    ctx.lineCap = 'round';
    // sheaf of 5 stalks fanning out, each tipped with a grain head
    for (var i = -2; i <= 2; i++) {
      var bx = cx + i * s * 0.09;
      var tx = cx + i * s * 0.13, ty = s * (0.34 - Math.abs(i) * 0.015);
      ctx.strokeStyle = PALETTE.wheatStalk;
      ctx.lineWidth = s * 0.032;
      ctx.beginPath(); ctx.moveTo(bx, s * 0.80); ctx.lineTo(tx, ty + s * 0.10); ctx.stroke();
      // grain head: stacked chevrons
      ctx.fillStyle = i === 0 ? PALETTE.wheatBase : PALETTE.wheatDark;
      for (var k = 0; k < 3; k++) {
        var gy = ty + k * s * 0.045, gw = s * (0.075 - k * 0.014);
        ctx.beginPath();
        ctx.moveTo(tx - gw, gy); ctx.lineTo(tx, gy - s * 0.035); ctx.lineTo(tx + gw, gy);
        ctx.lineTo(tx, gy + s * 0.02);
        ctx.closePath(); ctx.fill();
      }
      ctx.fillStyle = PALETTE.wheatBase;
      circle(ctx, tx, ty - s * 0.045, s * 0.035); ctx.fill();
    }
    // gloss spark on the middle head
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    circle(ctx, cx - s * 0.012, s * 0.27, s * 0.018); ctx.fill();
    ctx.restore();
  }

  function paintPumpkin(ctx, s) {
    var cx = s / 2, cy = s * 0.55;
    ctx.save();
    contactShadow(ctx, s, cx, s * 0.74, s * 0.24, s * 0.06);
    // vine curl
    ctx.strokeStyle = PALETTE.vineGreen;
    ctx.lineCap = 'round';
    ctx.lineWidth = s * 0.035;
    ctx.beginPath();
    ctx.moveTo(cx + s * 0.16, cy + s * 0.14);
    ctx.quadraticCurveTo(cx + s * 0.30, cy + s * 0.10, cx + s * 0.26, cy - s * 0.02);
    ctx.stroke();
    ctx.fillStyle = PALETTE.vineGreen;
    ellipse(ctx, cx - s * 0.20, cy + s * 0.15, s * 0.05, s * 0.028); ctx.fill();
    // body: three overlapping lobes
    var lobe = function (dx, w, col) {
      var g = ctx.createLinearGradient(cx + dx - w, cy - s * 0.16, cx + dx + w, cy + s * 0.16);
      g.addColorStop(0, PALETTE.pumpkinLight);
      g.addColorStop(0.5, col);
      g.addColorStop(1, PALETTE.pumpkinDark);
      ctx.fillStyle = g;
      ellipse(ctx, cx + dx, cy, w, s * 0.155); ctx.fill();
    };
    lobe(-s * 0.11, s * 0.095, PALETTE.pumpkinBase);
    lobe(s * 0.11, s * 0.095, PALETTE.pumpkinBase);
    lobe(0, s * 0.115, PALETTE.pumpkinBase);
    // ribs
    ctx.strokeStyle = 'rgba(140,50,0,0.55)';
    ctx.lineWidth = s * 0.022;
    ctx.beginPath(); ctx.moveTo(cx - s * 0.055, cy - s * 0.13); ctx.quadraticCurveTo(cx - s * 0.075, cy, cx - s * 0.055, cy + s * 0.13); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx + s * 0.055, cy - s * 0.13); ctx.quadraticCurveTo(cx + s * 0.075, cy, cx + s * 0.055, cy + s * 0.13); ctx.stroke();
    // stem + gloss
    ctx.fillStyle = '#3E7A2E';
    rr(ctx, cx - s * 0.028, cy - s * 0.20, s * 0.056, s * 0.075, s * 0.02); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ellipse(ctx, cx - s * 0.06, cy - s * 0.06, s * 0.045, s * 0.028); ctx.fill();
    ctx.restore();
  }

  function paintHay(ctx, s) {
    var cx = s / 2, cy = s * 0.50, r = s * 0.27;
    ctx.save();
    // soft contact shadow on the soil
    contactShadow(ctx, s, cx, cy + r * 0.98, r * 1.0, r * 0.26);
    // bale side (golden cylinder face-on)
    var g = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
    g.addColorStop(0, '#F6D878');
    g.addColorStop(0.55, PALETTE.hayBase);
    g.addColorStop(1, PALETTE.hayDark);
    ctx.fillStyle = g;
    circle(ctx, cx, cy, r); ctx.fill();
    // spiral end
    ctx.strokeStyle = PALETTE.hayBand;
    ctx.lineCap = 'round';
    for (var i = 1; i <= 3; i++) {
      ctx.lineWidth = s * (0.030 - i * 0.005);
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.arc(cx, cy, r * (i / 3.4), 0.4, 0.4 + Math.PI * 1.75);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // straw flecks + twine band
    ctx.strokeStyle = PALETTE.hayBand;
    ctx.lineWidth = s * 0.028;
    ctx.beginPath(); ctx.moveTo(cx - r * 0.2, cy - r * 0.95); ctx.lineTo(cx - r * 0.2, cy + r * 0.95); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx + r * 0.2, cy - r * 0.95); ctx.lineTo(cx + r * 0.2, cy + r * 0.95); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ellipse(ctx, cx - r * 0.35, cy - r * 0.4, r * 0.28, r * 0.14); ctx.fill();
    ctx.restore();
  }

  function paintDirtFlat(ctx, s) {
    var g = ctx.createLinearGradient(0, 0, 0, s);
    g.addColorStop(0, PALETTE.soilTop);
    g.addColorStop(1, PALETTE.soilBottom);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  }

  function paintTrailFlat(ctx, s) {
    var g = ctx.createLinearGradient(0, 0, 0, s);
    g.addColorStop(0, PALETTE.trailTop);
    g.addColorStop(1, PALETTE.trailBottom);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    ctx.strokeStyle = PALETTE.furrowDark;
    ctx.lineWidth = Math.max(1, s * 0.028);
    ctx.globalAlpha = 0.55;
    for (var k = 0; k < 3; k++) {
      var fy = s * (0.25 + k * 0.25);
      ctx.beginPath(); ctx.moveTo(0, fy); ctx.lineTo(s, fy); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // Single smooth raised blocks (compat fallback; the game draws joined
  // runs via drawFenceCells/drawRockCells instead).
  function paintFenceBlock(ctx, s) {
    var g = ctx.createLinearGradient(0, 0, 0, s);
    g.addColorStop(0, PALETTE.woodLight);
    g.addColorStop(0.5, PALETTE.woodBase);
    g.addColorStop(1, PALETTE.woodDark);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  }

  function paintRockBlock(ctx, s) {
    var g = ctx.createLinearGradient(0, 0, 0, s);
    g.addColorStop(0, PALETTE.rockLight);
    g.addColorStop(0.5, PALETTE.rockBase);
    g.addColorStop(1, PALETTE.rockDark);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  }

  function paintBarn(ctx, s, t) {
    // Goal barn sitting on the soil. Pulsing glow is time-based, drawn live.
    t = (t === undefined) ? 0 : t;
    var pulse = 0.5 + 0.5 * Math.sin(t * 2.4);
    ctx.save();
    // warm glow wash behind the barn, breathing with `pulse`
    var glow = ctx.createRadialGradient(s / 2, s * 0.46, s * 0.05, s / 2, s * 0.46, s * 0.48);
    glow.addColorStop(0, 'rgba(255,150,120,' + (0.35 + pulse * 0.30).toFixed(3) + ')');
    glow.addColorStop(1, 'rgba(255,150,120,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, s, s);

    var bx = s * 0.5, bw = s * 0.52, top = s * 0.26, bot = s * 0.78;
    // soft contact shadow
    ctx.fillStyle = PALETTE.shadow;
    rr(ctx, bx - bw / 2 + s * 0.02, bot - s * 0.02, bw, s * 0.06, s * 0.03); ctx.fill();
    // red body
    var g = ctx.createLinearGradient(0, top, 0, bot);
    g.addColorStop(0, '#F05555');
    g.addColorStop(0.5, PALETTE.barnRed);
    g.addColorStop(1, PALETTE.barnDark);
    ctx.fillStyle = g;
    ctx.fillRect(bx - bw / 2, top + s * 0.10, bw, bot - top - s * 0.10);
    // gambrel-ish roof
    ctx.fillStyle = '#7A1515';
    ctx.beginPath();
    ctx.moveTo(bx - bw / 2 - s * 0.04, top + s * 0.12);
    ctx.lineTo(bx, top - s * 0.02);
    ctx.lineTo(bx + bw / 2 + s * 0.04, top + s * 0.12);
    ctx.lineTo(bx + bw / 2 - s * 0.02, top + s * 0.12);
    ctx.lineTo(bx, top + s * 0.045);
    ctx.lineTo(bx - bw / 2 + s * 0.02, top + s * 0.12);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillRect(bx - bw / 2 - s * 0.04, top + s * 0.105, bw + s * 0.08, s * 0.022);
    // white X door
    var dw = s * 0.20, dh = s * 0.26, dx = bx - dw / 2, dy = bot - dh;
    ctx.fillStyle = '#F8F9FA';
    ctx.fillRect(dx, dy, dw, dh);
    ctx.strokeStyle = '#C92A2A';
    ctx.lineWidth = s * 0.032;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(dx + s * 0.02, dy + s * 0.02); ctx.lineTo(dx + dw - s * 0.02, dy + dh - s * 0.02); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(dx + dw - s * 0.02, dy + s * 0.02); ctx.lineTo(dx + s * 0.02, dy + dh - s * 0.02); ctx.stroke();
    ctx.strokeStyle = PALETTE.barnDark;
    ctx.lineWidth = s * 0.02;
    ctx.strokeRect(dx, dy, dw, dh);
    // hayloft window
    ctx.fillStyle = '#F8F9FA';
    circle(ctx, bx, top + s * 0.20, s * 0.045); ctx.fill();
    ctx.strokeStyle = PALETTE.barnDark;
    ctx.lineWidth = s * 0.016;
    circle(ctx, bx, top + s * 0.20, s * 0.045); ctx.stroke();
    // goal sparkles riding the pulse
    ctx.fillStyle = 'rgba(255,255,255,' + (0.4 + pulse * 0.5).toFixed(3) + ')';
    var tw = s * (0.014 + pulse * 0.014);
    circle(ctx, bx - bw * 0.42, top + s * 0.06, tw); ctx.fill();
    circle(ctx, bx + bw * 0.40, top + s * 0.14, tw * 0.8); ctx.fill();
    ctx.restore();
  }

  // ------------------------------------------------------- tractor (live)
  // Top-down Adrian-orange tractor, drawn live (tilts, squashes and
  // rotates every frame while sliding). Rounder bodywork than phase 3,
  // softer shadow pooled beneath it.
  // opts: { angle (rad, 0 = facing right), tilt, squash (0..~0.25) }
  function drawTractor(ctx, x, y, s, opts) {
    opts = opts || {};
    var ang = opts.angle || 0;
    var squash = opts.squash || 0;
    var tilt = opts.tilt || 0;
    ctx.save();
    ctx.translate(x + s / 2, y + s / 2);
    ctx.rotate(ang + tilt);
    ctx.scale(1 + squash * 0.6, 1 - squash * 0.4);
    var u = s / 100; // unit: tractor designed on a 100x100 box

    // soft pooled shadow (stays unrotated-ish for readability)
    ctx.save();
    ctx.rotate(-(ang + tilt));
    ctx.fillStyle = 'rgba(60,30,5,0.30)';
    ellipse(ctx, u * 5, u * 9, u * 34, u * 26); ctx.fill();
    ctx.fillStyle = 'rgba(60,30,5,0.18)';
    ellipse(ctx, u * 5, u * 9, u * 40, u * 31); ctx.fill();
    ctx.restore();

    // rear wheels (big) + front wheels (small)
    var wheel = function (wx, wy, wr) {
      ctx.fillStyle = '#212529';
      circle(ctx, wx, wy, wr); ctx.fill();
      var g = ctx.createRadialGradient(wx - wr * 0.3, wy - wr * 0.3, wr * 0.1, wx, wy, wr);
      g.addColorStop(0, '#495057');
      g.addColorStop(1, PALETTE.tyreBase);
      ctx.fillStyle = g;
      circle(ctx, wx, wy, wr * 0.92); ctx.fill();
      // treads
      ctx.strokeStyle = '#868E96';
      ctx.lineWidth = u * 2.2;
      for (var i = 0; i < 8; i++) {
        var a = (i / 8) * Math.PI * 2 + 0.2;
        ctx.beginPath();
        ctx.moveTo(wx + Math.cos(a) * wr * 0.68, wy + Math.sin(a) * wr * 0.68);
        ctx.lineTo(wx + Math.cos(a) * wr * 0.9, wy + Math.sin(a) * wr * 0.9);
        ctx.stroke();
      }
      ctx.fillStyle = PALETTE.tyreHub;
      circle(ctx, wx, wy, wr * 0.34); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      circle(ctx, wx - wr * 0.1, wy - wr * 0.12, wr * 0.1); ctx.fill();
    };
    wheel(-u * 8, -u * 26, u * 15);
    wheel(-u * 8, u * 26, u * 15);
    wheel(u * 24, -u * 22, u * 9);
    wheel(u * 24, u * 22, u * 9);

    // chassis + hood (Adrian-orange) with a soft top gloss
    var g = ctx.createLinearGradient(0, -u * 20, 0, u * 20);
    g.addColorStop(0, '#FF9A3D');
    g.addColorStop(0.5, PALETTE.tractorBody);
    g.addColorStop(1, PALETTE.tractorDark);
    ctx.fillStyle = g;
    rr(ctx, -u * 26, -u * 17, u * 56, u * 34, u * 14); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    rr(ctx, -u * 19, -u * 13, u * 42, u * 10, u * 5); ctx.fill();

    // cab + glass
    ctx.fillStyle = PALETTE.tractorDark;
    rr(ctx, -u * 20, -u * 13, u * 20, u * 26, u * 8); ctx.fill();
    var gg = ctx.createLinearGradient(-u * 20, 0, u * 0, 0);
    gg.addColorStop(0, '#E7F5FF');
    gg.addColorStop(1, PALETTE.tractorCabDk);
    ctx.fillStyle = gg;
    rr(ctx, -u * 17, -u * 10, u * 14, u * 20, u * 6); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    rr(ctx, -u * 15, -u * 8, u * 5, u * 12, u * 2); ctx.fill();

    // exhaust stack + steering nub
    ctx.fillStyle = '#343A40';
    rr(ctx, u * 16, -u * 12, u * 6, u * 8, u * 3); ctx.fill();
    ctx.fillStyle = '#868E96';
    circle(ctx, u * 19, u * 12, u * 3); ctx.fill();
    ctx.restore();
  }

  // ------------------------------------------------------- particles
  var particles = [];

  function spawnDust(px, py, n, spread) {
    spread = spread || 26;
    for (var i = 0; i < (n || 6); i++) {
      var a = Math.random() * Math.PI * 2;
      var sp = 20 + Math.random() * 55;
      particles.push({
        kind: 'dust', x: px, y: py,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 25,
        life: 0, maxLife: 0.5 + Math.random() * 0.4,
        size: 4 + Math.random() * 7, grow: 14
      });
    }
  }

  function spawnHarvest(px, py, color) {
    // sparkle-pop: 10 stars + 1 expanding ring
    for (var i = 0; i < 10; i++) {
      var a = (i / 10) * Math.PI * 2 + Math.random() * 0.4;
      var sp = 60 + Math.random() * 90;
      particles.push({
        kind: 'spark', x: px, y: py,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: 0, maxLife: 0.45 + Math.random() * 0.25,
        size: 3 + Math.random() * 4, color: color || PALETTE.sparkle
      });
    }
    particles.push({ kind: 'ring', x: px, y: py, vx: 0, vy: 0,
                     life: 0, maxLife: 0.4, size: 6, grow: 130,
                     color: color || PALETTE.sparkle });
  }

  function spawnConfetti(px, py, n) {
    n = n || 80;
    var cols = PALETTE.confetti;
    for (var i = 0; i < n; i++) {
      var a = -Math.PI / 2 + (Math.random() - 0.5) * 1.8;
      var sp = 120 + Math.random() * 260;
      particles.push({
        kind: 'confetti', x: px, y: py,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: 0, maxLife: 1.1 + Math.random() * 0.9,
        size: 4 + Math.random() * 5,
        color: cols[(Math.random() * cols.length) | 0],
        rot: Math.random() * Math.PI * 2, vr: (Math.random() - 0.5) * 12,
        grav: 420
      });
    }
  }

  function updateParticles(dt) {
    for (var i = particles.length - 1; i >= 0; i--) {
      var p = particles[i];
      p.life += dt;
      if (p.life >= p.maxLife) { particles.splice(i, 1); continue; }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.grav) p.vy += p.grav * dt;
      if (p.kind === 'dust') { p.vx *= (1 - 2.2 * dt); p.vy *= (1 - 2.2 * dt); p.size += p.grow * dt; }
      if (p.kind === 'spark') { p.vx *= (1 - 3 * dt); p.vy *= (1 - 3 * dt); }
      if (p.kind === 'ring') p.size += p.grow * dt;
      if (p.kind === 'confetti') { p.rot += p.vr * dt; p.vx *= (1 - 0.8 * dt); }
    }
  }

  function star(ctx, x, y, r) {
    ctx.beginPath();
    for (var i = 0; i < 8; i++) {
      var a = (i / 8) * Math.PI * 2;
      var rad = (i % 2 === 0) ? r : r * 0.45;
      var sx = x + Math.cos(a) * rad, sy = y + Math.sin(a) * rad;
      if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
    }
    ctx.closePath();
  }

  function drawParticles(ctx) {
    for (var i = 0; i < particles.length; i++) {
      var p = particles[i];
      var k = 1 - p.life / p.maxLife; // 1 -> 0 fade
      if (p.kind === 'dust') {
        ctx.fillStyle = PALETTE.dust;
        ctx.globalAlpha = 0.55 * k;
        circle(ctx, p.x, p.y, p.size); ctx.fill();
      } else if (p.kind === 'spark') {
        ctx.globalAlpha = k;
        ctx.fillStyle = p.color;
        star(ctx, p.x, p.y, p.size * (0.5 + k)); ctx.fill();
      } else if (p.kind === 'ring') {
        ctx.globalAlpha = 0.8 * k;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 3 * k + 1;
        circle(ctx, p.x, p.y, p.size); ctx.stroke();
      } else if (p.kind === 'confetti') {
        ctx.globalAlpha = Math.min(1, k * 2);
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 5);
        ctx.restore();
      }
    }
    ctx.globalAlpha = 1;
  }

  // ------------------------------------------------------- public API
  var PAINTERS = {
    dirt: paintDirtFlat,
    trail: paintTrailFlat,
    corn: paintCorn,
    wheat: paintWheat,
    pumpkin: paintPumpkin,
    mud: function (ctx, s) { drawMudPuddle(ctx, 0, 0, s, false); },
    hay: paintHay,
    fence: paintFenceBlock,
    rock: paintRockBlock
    // barn excluded: animated, drawn live with drawBarn()
  };

  // Bake every static sprite to an offscreen canvas once. Call at boot
  // (and again only if you change resolution).
  function prerenderAll(px) {
    SPRITE_PX = px || 192;
    bakeNoise();
    for (var key in PAINTERS) {
      if (PAINTERS.hasOwnProperty(key)) {
        (function (k) { makeSprite(k, PAINTERS[k]); })(key);
      }
    }
  }

  function blit(ctx, key, x, y, s) {
    ctx.drawImage(SPRITES[key], x, y, s, s);
  }

  // Dispatcher: draws small surface-sitting sprites from the cache.
  // opts.harvestT (0..1): pop/scale bounce for a freshly harvested crop.
  function drawTile(ctx, type, x, y, s, opts) {
    opts = opts || {};
    if (type === 'barn') { drawBarnLive(ctx, x, y, s, opts.time || 0); return; }
    if (type === 'trail' && opts.edge !== undefined) {
      drawTrail(ctx, x, y, s, opts.edge, opts.dir || 'right');
      return;
    }
    if (!SPRITES[type]) return; // unknown type: skip, never throw in the loop
    if (opts.harvestT !== undefined &&
        (type === 'corn' || type === 'wheat' || type === 'pumpkin')) {
      var t = opts.harvestT; // 0 fresh -> 1 settled
      var pop = 1 + 0.45 * Math.sin(Math.min(1, t * 1.15) * Math.PI) * (1 - t * 0.4);
      var cx = x + s / 2, cy = y + s / 2;
      var ns = s * pop;
      ctx.save();
      ctx.globalAlpha = t < 0.25 ? (0.4 + t * 2.4) : 1;
      ctx.drawImage(SPRITES[type], cx - ns / 2, cy - ns / 2, ns, ns);
      ctx.restore();
      return;
    }
    blit(ctx, type, x, y, s);
  }

  // Barn draws at arbitrary size: render to a scratch canvas at bake
  // resolution, then blit. Keeps per-frame cost to one drawImage.
  var barnScratch = null;
  function drawBarnLive(ctx, x, y, s, time) {
    if (!barnScratch) {
      barnScratch = document.createElement('canvas');
      barnScratch.width = SPRITE_PX;
      barnScratch.height = SPRITE_PX;
    }
    var bctx = barnScratch.getContext('2d');
    bctx.clearRect(0, 0, SPRITE_PX, SPRITE_PX);
    paintBarn(bctx, SPRITE_PX, time || 0);
    ctx.drawImage(barnScratch, x, y, s, s);
  }

  var api = {
    PALETTE: PALETTE,
    TILE_TYPES: TILE_TYPES,
    prerenderAll: prerenderAll,
    drawTile: drawTile,
    drawTrail: drawTrail,
    drawBarn: drawBarnLive,
    drawTractor: drawTractor,
    drawFieldBase: drawFieldBase,
    drawFieldLight: drawFieldLight,
    drawTrailLayer: drawTrailLayer,
    drawFenceCells: drawFenceCells,
    drawRockCells: drawRockCells,
    drawMudPuddle: drawMudPuddle,
    particles: particles,
    spawnDust: spawnDust,
    spawnHarvest: spawnHarvest,
    spawnConfetti: spawnConfetti,
    updateParticles: updateParticles,
    drawParticles: drawParticles
  };

  global.HarvestArt = api;
})(typeof window !== 'undefined' ? window : this);


