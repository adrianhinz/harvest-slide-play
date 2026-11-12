/* Harvest Slide — Graphics Kit (art-kit.js)
 *
 * Canvas-based, dependency-free tile/object renderer in the glossy
 * "AMAZE-like" language, translated to a farm theme. Original art,
 * drawn entirely in code — no external images, no copied assets.
 *
 * Usage (game side):
 *   <script src="art-kit.js"></script>
 *   HarvestArt.prerenderAll(192);          // once at boot
 *   HarvestArt.drawTile(ctx, 'dirt', x, y, s);            // per cell
 *   HarvestArt.drawTrail(ctx, x, y, s, progress, 'right');// animated fill
 *   HarvestArt.drawTractor(ctx, x, y, s, { tilt, squash });
 *   HarvestArt.spawnDust(px, py, 6); ... update/draw particles each frame
 *
 * Phone-first: tiles are pre-rendered once to offscreen canvases at a
 * fixed resolution, then blitted with drawImage (fast on mobile).
 * Animated pieces (trail edge, barn glow, tractor, particles) draw live.
 */
(function (global) {
  'use strict';

  // ---------------------------------------------------------------- palette
  // Named constants — the whole kit reads from here. Tweak these to reskin.
  var PALETTE = {
    // field
    dirtLight:   '#CE9050',
    dirtBase:    '#A5662F',
    dirtDark:    '#77431A',
    dirtSpeck1:  '#8A5226',
    dirtSpeck2:  '#DCA468',
    gridLine:    '#FFFFFF',

    // plowed trail ("paint fill" signature)
    trailLight:  '#9A6132',
    trailBase:   '#7C4A21',
    trailDark:   '#57300F',
    furrowDark:  '#5A3212',
    furrowLight: '#A06A38',

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
    mudDark:     '#40260F',
    mudGloss:    'rgba(255,255,255,0.55)',
    hayBase:     '#E8B93E',
    hayDark:     '#B97F1F',
    hayBand:     '#9A6410',
    woodBase:    '#8B5A2B',
    woodDark:    '#5F3B17',
    woodLight:   '#B07C3E',
    rockBase:    '#ADB5BD',
    rockDark:    '#6C757D',
    rockLight:   '#DEE2E6',
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
    confetti:    ['#FF6B6B', '#FFD43B', '#51CF66', '#4DABF7', '#B197FC', '#FF922B'],
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

  // Deterministic pseudo-random from an int seed (stable speckles per tile).
  function srand(seed) {
    var t = (seed * 1664525 + 1013904223) >>> 0;
    return function () {
      t = (t * 1664525 + 1013904223) >>> 0;
      return t / 4294967296;
    };
  }

  // Glossy rounded-square foundation: vertical gradient + bottom shade +
  // top-edge highlight + soft drop shadow. Everything sits on this.
  function tileBase(ctx, s, cTop, cMid, cBot, opts) {
    opts = opts || {};
    var pad = s * 0.045;                 // gap so the grid reads clean/bright
    var x = pad, y = pad, w = s - pad * 2, h = s - pad * 2;
    var r = s * 0.20;

    // soft drop shadow (anything raised gets one)
    if (opts.shadow !== false) {
      ctx.save();
      ctx.fillStyle = PALETTE.shadow;
      rr(ctx, x + s * 0.02, y + s * 0.045, w, h, r);
      ctx.fill();
      ctx.restore();
    }

    var g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, cTop);
    g.addColorStop(0.45, cMid);
    g.addColorStop(1, cBot);
    ctx.fillStyle = g;
    rr(ctx, x, y, w, h, r);
    ctx.fill();

    // bottom inner shade (bevel) — painted BEFORE the top highlight
    ctx.save();
    rr(ctx, x, y, w, h, r);
    ctx.clip();
    var bg = ctx.createLinearGradient(0, y + h * 0.72, 0, y + h);
    bg.addColorStop(0, 'rgba(0,0,0,0)');
    bg.addColorStop(1, 'rgba(0,0,0,0.22)');
    ctx.fillStyle = bg;
    ctx.fillRect(x, y, w, h);

    // top-edge highlight strip (the AMAZE gloss cue)
    var hg = ctx.createLinearGradient(0, y, 0, y + h * 0.30);
    hg.addColorStop(0, 'rgba(255,255,255,0.55)');
    hg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = hg;
    ctx.fillRect(x + r * 0.7, y + h * 0.03, w - r * 1.4, h * 0.27);

    // thin bright rim just inside the top-left corner
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = Math.max(1, s * 0.012);
    ctx.beginPath();
    ctx.moveTo(x + r, y + s * 0.035);
    ctx.lineTo(x + w - r, y + s * 0.035);
    ctx.stroke();
    ctx.restore();

    return { x: x, y: y, w: w, h: h, r: r };
  }

  function speckles(ctx, box, seed, colors, n, rMin, rMax) {
    var rnd = srand(seed);
    for (var i = 0; i < n; i++) {
      var px = box.x + box.r * 0.4 + rnd() * (box.w - box.r * 0.8);
      var py = box.y + box.h * 0.28 + rnd() * (box.h * 0.66 - box.r * 0.4);
      var pr = box.w * (rMin + rnd() * (rMax - rMin));
      ctx.fillStyle = colors[i % colors.length];
      ctx.globalAlpha = 0.5;
      circle(ctx, px, py, pr);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // ------------------------------------------------------- sprite prerender
  var SPRITES = {};      // key -> canvas
  var SPRITE_PX = 192;   // bake resolution; blitted scaled at draw time

  function makeSprite(key, painter) {
    var c = document.createElement('canvas');
    c.width = SPRITE_PX;
    c.height = SPRITE_PX;
    painter(c.getContext('2d'), SPRITE_PX);
    SPRITES[key] = c;
    return c;
  }

  function blit(ctx, key, x, y, s) {
    ctx.drawImage(SPRITES[key], x, y, s, s);
  }

  // ---------------------------------------------------------------- painters
  function paintDirt(ctx, s, seed) {
    var box = tileBase(ctx, s, PALETTE.dirtLight, PALETTE.dirtBase, PALETTE.dirtDark);
    speckles(ctx, box, seed || 7, [PALETTE.dirtSpeck1, PALETTE.dirtSpeck2], 16, 0.008, 0.028);
  }

  function paintCropBase(ctx, s, seed) {
    // harvested-into dirt: crops sit on field soil so the set hangs together.
    var box = tileBase(ctx, s, PALETTE.dirtLight, PALETTE.dirtBase, PALETTE.dirtDark);
    speckles(ctx, box, seed || 11, [PALETTE.dirtSpeck1], 8, 0.008, 0.022);
    return box;
  }

  function paintCorn(ctx, s) {
    var box = paintCropBase(ctx, s, 21);
    var cx = s / 2;
    ctx.save();
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
    var box = paintCropBase(ctx, s, 33);
    var cx = s / 2;
    ctx.save();
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
    var box = paintCropBase(ctx, s, 55);
    var cx = s / 2, cy = s * 0.55;
    ctx.save();
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

  function paintMud(ctx, s) {
    var box = tileBase(ctx, s, '#7A4E28', PALETTE.mudBase, PALETTE.mudDark);
    ctx.save();
    rr(ctx, box.x, box.y, box.w, box.h, box.r);
    ctx.clip();
    // dark puddle patches
    ctx.fillStyle = 'rgba(30,17,5,0.45)';
    ellipse(ctx, s * 0.36, s * 0.60, s * 0.20, s * 0.12); ctx.fill();
    ellipse(ctx, s * 0.68, s * 0.42, s * 0.15, s * 0.10); ctx.fill();
    // wet gloss blob (the "you stop here" read) + small shine dots
    var g = ctx.createRadialGradient(s * 0.38, s * 0.34, s * 0.01, s * 0.38, s * 0.34, s * 0.20);
    g.addColorStop(0, PALETTE.mudGloss);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ellipse(ctx, s * 0.38, s * 0.34, s * 0.20, s * 0.11); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    circle(ctx, s * 0.66, s * 0.66, s * 0.025); ctx.fill();
    circle(ctx, s * 0.72, s * 0.60, s * 0.016); ctx.fill();
    ctx.restore();
  }

  function paintHay(ctx, s) {
    var box = tileBase(ctx, s, PALETTE.dirtLight, PALETTE.dirtBase, PALETTE.dirtDark);
    var cx = s / 2, cy = s * 0.52, r = s * 0.27;
    ctx.save();
    // soft shadow under the bale
    ctx.fillStyle = PALETTE.shadow;
    ellipse(ctx, cx, cy + r * 0.95, r * 1.02, r * 0.28); ctx.fill();
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

  function paintTrailFull(ctx, s) {
    // Deep tilled earth + furrow lines (horizontal; game rotates via opts).
    var box = tileBase(ctx, s, PALETTE.trailLight, PALETTE.trailBase, PALETTE.trailDark);
    ctx.save();
    rr(ctx, box.x, box.y, box.w, box.h, box.r);
    ctx.clip();
    ctx.lineCap = 'round';
    for (var i = 0; i < 4; i++) {
      var fy = box.y + box.h * (0.22 + i * 0.19);
      ctx.strokeStyle = PALETTE.furrowDark;
      ctx.lineWidth = s * 0.045;
      ctx.globalAlpha = 0.8;
      ctx.beginPath();
      ctx.moveTo(box.x + box.w * 0.10, fy);
      ctx.quadraticCurveTo(box.x + box.w * 0.5, fy + s * 0.03,
                           box.x + box.w * 0.90, fy);
      ctx.stroke();
      ctx.strokeStyle = PALETTE.furrowLight;
      ctx.lineWidth = s * 0.016;
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      ctx.moveTo(box.x + box.w * 0.10, fy - s * 0.032);
      ctx.quadraticCurveTo(box.x + box.w * 0.5, fy - s * 0.002,
                           box.x + box.w * 0.90, fy - s * 0.032);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  function paintFence(ctx, s) {
    var box = paintCropBase(ctx, s, 77);
    var cx = s / 2;
    ctx.save();
    ctx.fillStyle = PALETTE.shadow;
    rr(ctx, cx - s * 0.30, s * 0.80, s * 0.60, s * 0.05, s * 0.025); ctx.fill();
    // two posts
    var post = function (x) {
      var g = ctx.createLinearGradient(x - s * 0.05, 0, x + s * 0.05, 0);
      g.addColorStop(0, PALETTE.woodDark);
      g.addColorStop(0.45, PALETTE.woodBase);
      g.addColorStop(1, PALETTE.woodLight);
      ctx.fillStyle = g;
      rr(ctx, x - s * 0.05, s * 0.24, s * 0.10, s * 0.56, s * 0.03); ctx.fill();
      ctx.fillStyle = PALETTE.woodLight;
      circle(ctx, x, s * 0.25, s * 0.05); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      circle(ctx, x - s * 0.018, s * 0.235, s * 0.014); ctx.fill();
    };
    // two rails
    var rail = function (y) {
      var g = ctx.createLinearGradient(0, y - s * 0.045, 0, y + s * 0.045);
      g.addColorStop(0, PALETTE.woodLight);
      g.addColorStop(0.5, PALETTE.woodBase);
      g.addColorStop(1, PALETTE.woodDark);
      ctx.fillStyle = g;
      rr(ctx, cx - s * 0.32, y - s * 0.045, s * 0.64, s * 0.09, s * 0.04); ctx.fill();
    };
    rail(s * 0.40);
    rail(s * 0.62);
    post(cx - s * 0.22);
    post(cx + s * 0.22);
    ctx.restore();
  }

  function paintRock(ctx, s) {
    var box = paintCropBase(ctx, s, 99);
    var cx = s / 2, cy = s * 0.56;
    ctx.save();
    ctx.fillStyle = PALETTE.shadow;
    ellipse(ctx, cx, cy + s * 0.17, s * 0.26, s * 0.07); ctx.fill();
    // chunky beveled boulder: faceted polygon with light from top-left
    var g = ctx.createLinearGradient(cx - s * 0.25, cy - s * 0.20, cx + s * 0.25, cy + s * 0.20);
    g.addColorStop(0, PALETTE.rockLight);
    g.addColorStop(0.5, PALETTE.rockBase);
    g.addColorStop(1, PALETTE.rockDark);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.24, cy + s * 0.12);
    ctx.lineTo(cx - s * 0.18, cy - s * 0.10);
    ctx.lineTo(cx - s * 0.02, cy - s * 0.18);
    ctx.lineTo(cx + s * 0.18, cy - s * 0.08);
    ctx.lineTo(cx + s * 0.24, cy + s * 0.10);
    ctx.lineTo(cx + s * 0.10, cy + s * 0.17);
    ctx.lineTo(cx - s * 0.12, cy + s * 0.17);
    ctx.closePath(); ctx.fill();
    // facet cracks + gloss nick
    ctx.strokeStyle = 'rgba(70,80,90,0.7)';
    ctx.lineWidth = s * 0.018;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(cx - s * 0.02, cy - s * 0.18); ctx.lineTo(cx - s * 0.05, cy - s * 0.02); ctx.lineTo(cx + s * 0.10, cy + s * 0.05); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ellipse(ctx, cx - s * 0.11, cy - s * 0.09, s * 0.05, s * 0.028); ctx.fill();
    ctx.restore();
  }

  function paintBarn(ctx, s, t) {
    // Goal tile. Pulsing glow is time-based, so the barn draws LIVE
    // (not from the sprite cache) via drawBarn().
    t = (t === undefined) ? 0 : t;
    var pulse = 0.5 + 0.5 * Math.sin(t * 2.4);
    var box = tileBase(ctx, s, PALETTE.dirtLight, PALETTE.dirtBase, PALETTE.dirtDark,
                       { shadow: true });
    ctx.save();
    rr(ctx, box.x, box.y, box.w, box.h, box.r);
    ctx.clip();
    // warm glow wash behind the barn, breathing with `pulse`
    var glow = ctx.createRadialGradient(s / 2, s * 0.46, s * 0.05, s / 2, s * 0.46, s * 0.48);
    glow.addColorStop(0, 'rgba(255,150,120,' + (0.35 + pulse * 0.30).toFixed(3) + ')');
    glow.addColorStop(1, 'rgba(255,150,120,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(box.x, box.y, box.w, box.h);

    var bx = s * 0.5, bw = s * 0.52, top = s * 0.26, bot = s * 0.78;
    // shadow under barn
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
  // Top-down chunky tractor. Drawn live (not cached) because it tilts,
  // squashes and rotates every frame while sliding.
  // opts: { angle (rad, 0 = facing right), tilt, squash (0..~0.25), time }
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

    // soft shadow (offset down-right, stays unrotated-ish for readability)
    ctx.save();
    ctx.rotate(-(ang + tilt));
    ctx.fillStyle = PALETTE.shadow;
    ellipse(ctx, u * 5, u * 8, u * 34, u * 26); ctx.fill();
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

    // chassis + hood (Adrian-orange) with top gloss
    var g = ctx.createLinearGradient(0, -u * 20, 0, u * 20);
    g.addColorStop(0, '#FF9A3D');
    g.addColorStop(0.5, PALETTE.tractorBody);
    g.addColorStop(1, PALETTE.tractorDark);
    ctx.fillStyle = g;
    rr(ctx, -u * 26, -u * 17, u * 56, u * 34, u * 9); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    rr(ctx, -u * 20, -u * 14, u * 44, u * 9, u * 4); ctx.fill();

    // cab + glass
    ctx.fillStyle = PALETTE.tractorDark;
    rr(ctx, -u * 20, -u * 13, u * 20, u * 26, u * 5); ctx.fill();
    var gg = ctx.createLinearGradient(-u * 20, 0, u * 0, 0);
    gg.addColorStop(0, '#E7F5FF');
    gg.addColorStop(1, PALETTE.tractorCabDk);
    ctx.fillStyle = gg;
    rr(ctx, -u * 17, -u * 10, u * 14, u * 20, u * 4); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    rr(ctx, -u * 15, -u * 8, u * 5, u * 12, u * 2); ctx.fill();

    // exhaust stack + steering nub
    ctx.fillStyle = '#343A40';
    rr(ctx, u * 16, -u * 12, u * 6, u * 8, u * 2); ctx.fill();
    ctx.fillStyle = '#868E96';
    circle(ctx, u * 19, -u * 12, u * 3); ctx.fill();
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
    dirt: function (ctx, s) { paintDirt(ctx, s, 7); },
    trail: paintTrailFull,
    corn: paintCorn,
    wheat: paintWheat,
    pumpkin: paintPumpkin,
    mud: paintMud,
    hay: paintHay,
    fence: paintFence,
    rock: paintRock
    // barn excluded: animated, drawn live with drawBarn()
  };

  // Bake every static tile to an offscreen canvas once. Call at boot
  // (and again only if you change resolution).
  function prerenderAll(px) {
    SPRITE_PX = px || 192;
    for (var key in PAINTERS) {
      if (PAINTERS.hasOwnProperty(key)) {
        (function (k) { makeSprite(k, PAINTERS[k]); })(key);
      }
    }
  }

  // Dispatcher: draws any static tile from the cache.
  // opts.harvestT (0..1): pop/scale bounce for a freshly harvested crop.
  // opts.vertical: rotate furrows 90deg for vertical trail runs.
  function drawTile(ctx, type, x, y, s, opts) {
    opts = opts || {};
    if (type === 'barn') { drawBarnLive(ctx, x, y, s, opts.time || 0); return; }
    if (type === 'trail' && opts.edge !== undefined) {
      drawTrail(ctx, x, y, s, opts.edge, opts.dir || 'right', !!opts.vertical);
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
    if (opts.vertical && SPRITES[type + '_v']) {
      ctx.drawImage(SPRITES[type + '_v'], x, y, s, s);
      return;
    }
    blit(ctx, type, x, y, s);
  }

  // THE signature effect: sweeping tilled-earth fill with a live leading
  // edge. progress 0..1 across the tile, dir = travel direction.
  // Mid-slide the edge reads as a rounded wet-plow wave, not a hard clip.
  function drawTrail(ctx, x, y, s, progress, dir, vertical) {
    progress = Math.max(0, Math.min(1, progress));
    ctx.save();
    if (vertical) {
      ctx.translate(x + s / 2, y + s / 2);
      ctx.rotate(Math.PI / 2);
      ctx.translate(-s / 2, -s / 2);
      x = 0; y = 0;
    }
    // soil under the sweep so the edge never shows transparency
    blit(ctx, 'dirt', x, y, s);
    var pad = s * 0.045;
    var innerX = x + pad, innerW = s - pad * 2;
    var leadX = innerX + innerW * progress;
    ctx.save();
    ctx.beginPath();
    if (dir === 'left') {
      ctx.rect(leadX, y - 1, innerX + innerW - leadX, s + 2);
    } else if (dir === 'up' || dir === 'down') {
      // vertical sweeps reuse the horizontal painter on the rotated frame;
      // treat both as "from the left" in local space.
      ctx.rect(x - 1, y - 1, (leadX - x) + 1, s + 2);
      if (dir === 'up') ctx.rect(leadX, y - 1, innerX + innerW - leadX, s + 2);
    } else {
      ctx.rect(x - 1, y - 1, (leadX - x) + 1, s + 2);
    }
    ctx.clip();
    ctx.drawImage(SPRITES.trail, x, y, s, s);
    ctx.restore();
    // rounded wet leading edge + glossy lip highlight
    if (progress > 0.02 && progress < 0.995) {
      var ey = y + s / 2;
      var er = (s - pad * 2) / 2;
      var g = ctx.createLinearGradient(leadX - s * 0.09, 0, leadX, 0);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(40,20,5,0.30)');
      ctx.fillStyle = g;
      ctx.fillRect(leadX - s * 0.09, y + pad, s * 0.09, s - pad * 2);
      ctx.fillStyle = PALETTE.trailBase;
      var ex = (dir === 'left') ? leadX - er * 0.15 : leadX + er * 0.15;
      ellipse(ctx, ex, ey, er * 0.32, er); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ellipse(ctx, ex - er * 0.06, ey - er * 0.45, er * 0.10, er * 0.32); ctx.fill();
    }
    ctx.restore();
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
    particles: particles,
    spawnDust: spawnDust,
    spawnHarvest: spawnHarvest,
    spawnConfetti: spawnConfetti,
    updateParticles: updateParticles,
    drawParticles: drawParticles
  };

  global.HarvestArt = api;
})(typeof window !== 'undefined' ? window : this);
