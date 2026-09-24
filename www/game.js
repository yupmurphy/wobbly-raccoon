// =====================================================================
//  WOBBLY RACCOON  -  a Flappy Bird style game with a rocket raccoon
//  No dependencies, no build step. Every gameplay value worth tuning
//  lives in the CFG object below - change it and refresh the page.
// =====================================================================

const cv  = document.getElementById('game');
const ctx = cv.getContext('2d');

// The game thinks in a world 480 units wide and as many units tall as the
// screen's shape needs. The raccoon and the pillars therefore keep the same
// size relative to the screen everywhere; a taller phone simply gets more
// sky. Nothing below ever touches real pixels - layout() does that once.
const WORLD_WIDTH = 480;   // the play area on a phone
const WORLD_MAX_W = 640;   // never let the play area get wider than this
const WORLD_MIN_H = 660;
const WORLD_MAX_H = 1400;

let W = WORLD_WIDTH;
let H = 720;
let viewScale = 1, viewX = 0, viewY = 0;

// The canvas edges expressed in world units. On a phone these are just
// 0,0,W,H. On a wide window the canvas reaches past the play area, and the
// scenery is drawn out to these bounds so there is no black border and
// nothing pops into view at the edge of the play area.
let viewLeft = 0, viewTop = 0, viewRight = 480, viewBottom = 720;

// --------------------------- TUNING ---------------------------------
const CFG = {
  gravity:        1500,   // px/s^2 - how hard it pulls down
  boostSpeed:     -440,   // px/s   - vertical speed right after a tap
  maxFallSpeed:    780,   // px/s   - terminal velocity

  scrollSpeed:     180,   // px/s   - how fast obstacles come at you
  gapHeight:       170,   // px     - opening between the two pillars
  obstacleWidth:    72,   // px
  obstacleSpacing: 280,   // px     - horizontal distance between obstacles
  gapMargin:        90,   // px     - keeps the gap away from ceiling/ground

  maxGapShift:     210,   // px     - how far a gap may move from the previous one
  thrustTime:     0.26,   // s      - how long the flame burns after a tap
  raccoonRadius:    30,   // px     - collision circle; he rides a rocket, so it is chunky
  groundHeight:     90,   // px
};

// --------------------------- LAYOUT ---------------------------------
let HORIZON = H - CFG.groundHeight;

function layout() {
  const vw = Math.max(1, window.innerWidth);
  const vh = Math.max(1, window.innerHeight);
  const aspect = vw / vh;

  // The play area starts 480 wide and grows taller to match the screen.
  // A wide window would make it absurdly short, so there the height is
  // pinned and the width grows instead, up to a limit that keeps the
  // raccoon a sensible size.
  W = WORLD_WIDTH;
  H = W / aspect;
  if (H < WORLD_MIN_H) {
    H = WORLD_MIN_H;
    W = Math.min(WORLD_MAX_W, H * aspect);
  } else if (H > WORLD_MAX_H) {
    H = WORLD_MAX_H;
  }
  W = Math.round(W);
  H = Math.round(H);
  HORIZON = H - CFG.groundHeight;

  // Match the screen's real pixel density. Without this the canvas is a
  // small image stretched to fit, which is what makes text look smeared.
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  cv.width  = Math.round(vw * dpr);
  cv.height = Math.round(vh * dpr);
  cv.style.width  = vw + 'px';
  cv.style.height = vh + 'px';

  // fit the play area into the canvas, centred
  viewScale = Math.min(cv.width / W, cv.height / H);
  viewX = (cv.width  - W * viewScale) / 2;
  viewY = (cv.height - H * viewScale) / 2;

  // whatever is left over around it still gets painted
  viewLeft   = -viewX / viewScale;
  viewTop    = -viewY / viewScale;
  viewRight  = viewLeft + cv.width  / viewScale;
  viewBottom = viewTop  + cv.height / viewScale;
}

window.addEventListener('resize', layout);
window.addEventListener('orientationchange', layout);

// ---------------------------- STATE ---------------------------------
const STATE = { READY: 'ready', PLAYING: 'playing', DEAD: 'dead' };
let state = STATE.READY;

let raccoon, obstacles, particles, score, best, deadTime, shake;

// The storage key still says "jetpack" on purpose: renaming it would wipe
// the best score already saved in the browser. It is invisible to players.
function loadBest() {
  try { return parseInt(localStorage.getItem('jetpack-raccoon-best') || '0', 10) || 0; }
  catch (e) { return 0; }
}
function saveBest(v) {
  try { localStorage.setItem('jetpack-raccoon-best', String(v)); } catch (e) {}
}

function reset() {
  raccoon = {
    x: W * 0.3,
    y: H * 0.45,
    vy: 0,
    angle: 0,
    sinceBoost: 99,   // seconds since the last boost, drives the flame
  };
  obstacles = [];
  particles = [];
  score = 0;
  best = loadBest();
  deadTime = 0;
  shake = 0;

  fillObstacles();
}

// Keep enough pillars queued to cover the canvas, however wide it is, so
// none of them ever pops into existence somewhere the player can see.
function fillObstacles() {
  if (obstacles.length === 0) addObstacle(viewRight + 220);
  let last = obstacles[obstacles.length - 1];
  while (last.x < viewRight + CFG.obstacleSpacing) {
    addObstacle(last.x + CFG.obstacleSpacing);
    last = obstacles[obstacles.length - 1];
  }
}

function addObstacle(x) {
  const min = CFG.gapMargin;
  const max = Math.max(min, HORIZON - CFG.gapHeight - CFG.gapMargin);

  // On a tall screen the gap could otherwise jump from the ceiling to the
  // floor between two pillars, which no amount of skill can clear. Each gap
  // stays within reach of the previous one.
  const prev = obstacles[obstacles.length - 1];
  const lo = prev ? Math.max(min, prev.gapY - CFG.maxGapShift) : min;
  const hi = prev ? Math.min(max, prev.gapY + CFG.maxGapShift) : max;

  obstacles.push({
    x: x,
    gapY: lo + Math.random() * Math.max(0, hi - lo),  // top edge of the opening
    scored: false,
  });
}

// ---------------------------- INPUT ---------------------------------
// Holding a key down must NOT fire repeated boosts: one boost per press.
// (the OS keeps re-firing keydown while a key is held)
const keysDown = {};

function press() {
  if (state === STATE.READY) {
    state = STATE.PLAYING;
    boost();
  } else if (state === STATE.PLAYING) {
    boost();
  } else if (state === STATE.DEAD && deadTime > 0.8) {
    reset();
    state = STATE.READY;
  }
}

function boost() {
  raccoon.vy = CFG.boostSpeed;
  raccoon.sinceBoost = 0;
  for (let i = 0; i < 14; i++) spawnExhaust();
  sound('boost');
}

cv.addEventListener('pointerdown', function (e) { e.preventDefault(); press(); });

window.addEventListener('keydown', function (e) {
  if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') {
    e.preventDefault();
    if (e.repeat || keysDown[e.code]) return;   // key is being held - ignore
    keysDown[e.code] = true;
    press();
  }
});

window.addEventListener('keyup', function (e) { delete keysDown[e.code]; });

// if the window loses focus, release everything so no key stays stuck
window.addEventListener('blur', function () {
  for (const k in keysDown) delete keysDown[k];
});

// ---------------------------- SOUND ---------------------------------
let audio = null;

// one short tone that slides from f0 to f1; soft attack so nothing clicks
function blip(type, f0, f1, delay, dur, vol) {
  const t = audio.currentTime + delay;
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.connect(gain); gain.connect(audio.destination);

  osc.type = type;
  osc.frequency.setValueAtTime(f0, t);
  osc.frequency.exponentialRampToValueAtTime(f1, t + dur * 0.7);

  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(vol, t + 0.012);   // gentle fade in
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);

  osc.start(t);
  osc.stop(t + dur + 0.02);
}

function sound(kind) {
  try {
    if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume();

    if (kind === 'boost') {
      // a soft round "bwip" plus a quiet sparkle on top
      blip('sine',     430, 880,  0,     0.15, 0.10);
      blip('triangle', 960, 1500, 0.015, 0.09, 0.028);
    } else if (kind === 'point') {
      blip('triangle', 680, 700,  0,    0.09, 0.07);
      blip('triangle', 900, 920,  0.07, 0.13, 0.06);
    } else if (kind === 'crash') {
      blip('sawtooth', 320, 60, 0, 0.32, 0.12);
    }
  } catch (e) { /* no audio, no problem */ }
}

// -------------------------- PARTICLES -------------------------------
// The rocket nozzle, in the raccoon's own coordinates (he faces +x).
const NOZZLE_X = -33;
const NOZZLE_Y = 16;

// The exhaust leaves the nozzle backwards and a little downwards.
const EXHAUST_DX = -0.93;
const EXHAUST_DY = 0.37;
const EXHAUST_ANGLE = Math.atan2(EXHAUST_DY, EXHAUST_DX);

function spawnExhaust() {
  const c = Math.cos(raccoon.angle), s = Math.sin(raccoon.angle);
  // nozzle position in world coordinates
  const ox = raccoon.x + NOZZLE_X * c - NOZZLE_Y * s;
  const oy = raccoon.y + NOZZLE_X * s + NOZZLE_Y * c;
  // exhaust direction, rotated with the rocket
  const dirX = EXHAUST_DX * c - EXHAUST_DY * s;
  const dirY = EXHAUST_DX * s + EXHAUST_DY * c;

  const speed = 200 + Math.random() * 260;
  const spread = (Math.random() - 0.5) * 110;
  const smoke = Math.random() < 0.3;

  particles.push({
    x: ox + (Math.random() - 0.5) * 5,
    y: oy + (Math.random() - 0.5) * 5,
    // perpendicular of (dirX, dirY) is (-dirY, dirX)
    vx: dirX * speed - dirY * spread - CFG.scrollSpeed,  // drifts with the world
    vy: dirY * speed + dirX * spread,
    life: 0,
    span: smoke ? 0.5 + Math.random() * 0.4 : 0.16 + Math.random() * 0.18,
    size: smoke ? 4 + Math.random() * 4 : 3 + Math.random() * 4,
    smoke: smoke,
  });
}

// --------------------------- SCENERY --------------------------------
// Minimal post-apocalyptic backdrop: ash sky, a dead sun, two parallax
// layers of ruined skyline, falling ash. Flat shapes, no detail noise.
let groundOffset = 0;
const SLAB_SPACING   = 40;              // spacing of the two ground layers
const RUBBLE_SPACING = 65;
const GROUND_CYCLE   = SLAB_SPACING * RUBBLE_SPACING;   // both divide it
const SKYLINE_SPAN = WORLD_WIDTH * 2;   // the strip that loops seamlessly

function makeSkyline(count, minH, maxH) {
  const list = [];
  for (let i = 0; i < count; i++) {
    list.push({
      x: (i / count) * SKYLINE_SPAN + (Math.random() - 0.5) * 24,
      w: 26 + Math.random() * 48,
      h: minH + Math.random() * (maxH - minH),
      lean: (Math.random() - 0.5) * 0.16,   // collapsed, uneven roofline
      broken: Math.random() < 0.45,         // a chunk missing off the top
    });
  }
  return list;
}

const skylineFar  = makeSkyline(20, 50, 150);
const skylineNear = makeSkyline(13, 90, 235);
let farOffset = 0, nearOffset = 0;

const ash = [];
for (let i = 0; i < 46; i++) {
  ash.push({
    x: Math.random() * W,
    y: Math.random() * H,
    r: 0.8 + Math.random() * 1.9,
    fall: 8 + Math.random() * 24,
  });
}

// ---------------------------- UPDATE --------------------------------
function update(dt) {
  // the background keeps moving even in the menu, so the scene feels alive
  farOffset  = (farOffset  + CFG.scrollSpeed * 0.10 * dt) % SKYLINE_SPAN;
  nearOffset = (nearOffset + CFG.scrollSpeed * 0.26 * dt) % SKYLINE_SPAN;
  // One growing counter for the ground; each layer takes its own remainder
  // from it. It wraps on a common multiple of every layer's spacing, so no
  // layer ever jumps sideways when the counter resets.
  groundOffset = (groundOffset + CFG.scrollSpeed * dt) % GROUND_CYCLE;

  for (const a of ash) {
    a.x -= (CFG.scrollSpeed * 0.12 + a.fall * 0.35) * dt;
    a.y += a.fall * dt;
    if (a.y > viewBottom) {
      a.y = viewTop - 4;
      a.x = viewLeft + Math.random() * (viewRight - viewLeft);
    }
    if (a.x < viewLeft - 4) { a.x = viewRight + 4; }
  }

  if (state === STATE.READY) {
    raccoon.y = H * 0.45 + Math.sin(performance.now() / 300) * 10;
    raccoon.angle = -0.12 + Math.sin(performance.now() / 300) * 0.05;
    raccoon.sinceBoost = 99;
  }

  if (state === STATE.PLAYING) {
    // --- physics ---
    raccoon.vy += CFG.gravity * dt;
    if (raccoon.vy > CFG.maxFallSpeed) raccoon.vy = CFG.maxFallSpeed;
    raccoon.y += raccoon.vy * dt;
    raccoon.sinceBoost += dt;

    // Tilt: only slightly nose-up while the rocket lifts him,
    // rotating towards straight-down as he falls.
    const target = Math.max(-0.30, Math.min(1.45, raccoon.vy / 450));
    raccoon.angle += (target - raccoon.angle) * Math.min(1, dt * 8);

    // keep the flame alive for a moment after the tap
    if (raccoon.sinceBoost < CFG.thrustTime) {
      spawnExhaust();
      if (Math.random() < 0.6) spawnExhaust();
    }

    // --- obstacles ---
    for (const o of obstacles) {
      o.x -= CFG.scrollSpeed * dt;
      if (!o.scored && o.x + CFG.obstacleWidth < raccoon.x) {
        o.scored = true;
        score++;
        sound('point');
      }
    }
    // drop what left the canvas, queue new ones beyond the far edge
    obstacles = obstacles.filter(function (o) {
      return o.x + CFG.obstacleWidth > viewLeft - 40;
    });
    fillObstacles();

    if (hitSomething()) crash();
  }

  if (state === STATE.DEAD) {
    deadTime += dt;
    raccoon.vy += CFG.gravity * dt;
    raccoon.y += raccoon.vy * dt;
    raccoon.angle += dt * 4;
    const floor = HORIZON - CFG.raccoonRadius;
    if (raccoon.y > floor) { raccoon.y = floor; raccoon.vy = 0; }
  }

  if (shake > 0) shake = Math.max(0, shake - dt * 3);

  for (const p of particles) {
    p.life += dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    if (p.smoke) {
      p.vx *= 1 - dt * 2.2;      // smoke slows down and lingers
      p.vy *= 1 - dt * 2.2;
    } else {
      p.vx *= 1 - dt * 3.5;      // flame burns out fast
      p.vy *= 1 - dt * 3.5;
    }
  }
  particles = particles.filter(function (p) { return p.life < p.span; });
}

function hitSomething() {
  if (raccoon.y + CFG.raccoonRadius > HORIZON) return true;
  // the ceiling does not kill, it just stops him
  if (raccoon.y - CFG.raccoonRadius < 0) { raccoon.y = CFG.raccoonRadius; raccoon.vy = 0; }

  for (const o of obstacles) {
    const top = { x: o.x, y: 0, w: CFG.obstacleWidth, h: o.gapY };
    const bottom = { x: o.x, y: o.gapY + CFG.gapHeight, w: CFG.obstacleWidth,
                     h: HORIZON - (o.gapY + CFG.gapHeight) };
    if (circleHitsRect(raccoon.x, raccoon.y, CFG.raccoonRadius, top)) return true;
    if (circleHitsRect(raccoon.x, raccoon.y, CFG.raccoonRadius, bottom)) return true;
  }
  return false;
}

function circleHitsRect(cx, cy, r, rect) {
  const px = Math.max(rect.x, Math.min(cx, rect.x + rect.w));
  const py = Math.max(rect.y, Math.min(cy, rect.y + rect.h));
  const dx = cx - px, dy = cy - py;
  return dx * dx + dy * dy < r * r;
}

function crash() {
  state = STATE.DEAD;
  deadTime = 0;
  shake = 1;
  raccoon.vy = -180;
  sound('crash');
  if (score > best) { best = score; saveBest(best); }
}

// ----------------------------- DRAW ---------------------------------
function draw() {
  // paint the whole canvas first, then switch into world units - everything
  // below this point draws in the 480-wide world, never in device pixels
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#15181f';
  ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.setTransform(viewScale, 0, 0, viewScale, viewX, viewY);

  ctx.save();
  if (shake > 0) {
    ctx.translate((Math.random() - 0.5) * 12 * shake,
                  (Math.random() - 0.5) * 12 * shake);
  }

  drawSky();
  drawSkyline(skylineFar,  farOffset,  'rgba(58,50,62,.45)');
  drawSkyline(skylineNear, nearOffset, 'rgba(30,26,36,.72)');
  obstacles.forEach(drawObstacle);
  drawAsh();
  drawParticles();
  drawRider();
  drawGround();

  ctx.restore();
  drawUI();
}

function drawSky() {
  const g = ctx.createLinearGradient(0, 0, 0, HORIZON);
  g.addColorStop(0,    '#2a2634');   // soot, lifted off pure black
  g.addColorStop(0.42, '#493b44');
  g.addColorStop(0.76, '#8a5544');
  g.addColorStop(1,    '#c47a4d');   // dull ember at the horizon
  ctx.fillStyle = g;
  ctx.fillRect(viewLeft, viewTop, viewRight - viewLeft, viewBottom - viewTop);

  // the sun, barely making it through the smog
  const sx = W * 0.68, sy = HORIZON - 165;
  const halo = ctx.createRadialGradient(sx, sy, 6, sx, sy, 135);
  halo.addColorStop(0, 'rgba(243,173,112,.34)');
  halo.addColorStop(1, 'rgba(243,173,112,0)');
  ctx.fillStyle = halo;
  ctx.beginPath(); ctx.arc(sx, sy, 135, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(248,204,158,.5)';
  ctx.beginPath(); ctx.arc(sx, sy, 30, 0, Math.PI * 2); ctx.fill();
}

function drawSkyline(list, offset, color) {
  ctx.fillStyle = color;
  for (const b of list) {
    // drawn a few spans apart, so the strip loops without a seam however
    // wide the canvas is
    for (let pass = -1; pass < 3; pass++) {
      const x = b.x - offset + pass * SKYLINE_SPAN;
      if (x > viewRight + 70 || x + b.w < viewLeft - 70) continue;
      const top = HORIZON - b.h;
      ctx.beginPath();
      ctx.moveTo(x, HORIZON);
      ctx.lineTo(x, top + b.lean * b.w);
      if (b.broken) {                       // a torn-off corner
        ctx.lineTo(x + b.w * 0.42, top + 12);
        ctx.lineTo(x + b.w * 0.60, top - 5);
      }
      ctx.lineTo(x + b.w, top - b.lean * b.w);
      ctx.lineTo(x + b.w, HORIZON);
      ctx.closePath();
      ctx.fill();
    }
  }
}

function drawAsh() {
  ctx.fillStyle = 'rgba(226,220,213,.42)';
  for (const a of ash) {
    ctx.beginPath();
    ctx.arc(a.x, a.y, a.r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawObstacle(o) {
  const w = CFG.obstacleWidth;
  const bottomY = o.gapY + CFG.gapHeight;
  // the lower pillar runs past the horizon so the ground buries its foot
  // instead of cutting it off in mid-air
  const bottomH = viewBottom - bottomY;

  // same shape and size as before - only the colours moved to concrete
  // and rust, so the pillars belong to the ruined world
  function pillar(x, y, h) {
    const g = ctx.createLinearGradient(x, 0, x + w, 0);
    g.addColorStop(0,    '#3f3b46');
    g.addColorStop(0.35, '#7b7581');
    g.addColorStop(0.7,  '#5e5865');
    g.addColorStop(1,    '#332f3a');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = '#231f29';
    ctx.lineWidth = 3;
    ctx.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);
  }

  function cap(x, y) {
    const cw = w + 14, cx = x - 7;
    const g = ctx.createLinearGradient(cx, 0, cx + cw, 0);
    g.addColorStop(0,    '#5c3a28');
    g.addColorStop(0.35, '#a9694a');
    g.addColorStop(1,    '#4a2f21');
    ctx.fillStyle = g;
    ctx.fillRect(cx, y, cw, 26);
    ctx.strokeStyle = '#231f29';
    ctx.lineWidth = 3;
    ctx.strokeRect(cx + 1.5, y + 1.5, cw - 3, 23);
  }

  pillar(o.x, viewTop, o.gapY - viewTop);
  cap(o.x, o.gapY - 26);
  pillar(o.x, bottomY, bottomH);
  cap(o.x, bottomY);
}

function drawParticles() {
  for (const p of particles) {
    const t = p.life / p.span;          // 0 -> 1
    const a = 1 - t;
    if (p.smoke) {
      ctx.fillStyle = 'rgba(205,205,210,' + (a * 0.3) + ')';
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (1 + t * 1.8), 0, Math.PI * 2);
      ctx.fill();
    } else {
      // flame: white hot -> orange -> deep red
      const rgb = t < 0.3 ? '255,248,205' : t < 0.65 ? '255,163,44' : '222,64,26';
      ctx.fillStyle = 'rgba(' + rgb + ',' + a + ')';
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (1 - t * 0.55), 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

// ------------------- cartoon drawing helpers ------------------------
// Everything is drawn flat-cartoon style: a solid fill plus a thick
// dark outline, the way the sticker art does it.
const OUTLINE   = '#2f2b3d';
const OUTLINE_W = 3;

const FUR       = '#a9aeb6';   // main body grey
const FUR_LIGHT = '#d7dade';   // muzzle, belly, inner face
const FUR_MID   = '#c2c6cd';
const MASK      = '#5a5f6b';   // the dark band across the eyes
const PAW       = '#474b57';
const BLUSH     = '#f18ca8';

const ROCKET_RED  = '#e5533d';
const ROCKET_DARK = '#c33f2d';
const ROCKET_BODY = '#f4efe6';
const WINDOW      = '#7ed0f0';

function outlined(fill) {
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = OUTLINE_W;
  ctx.lineJoin = 'round';
  ctx.stroke();
}

function oval(x, y, rx, ry, rot, fill) {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
  outlined(fill);
}

function flatOval(x, y, rx, ry, rot, fill) {   // no outline
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
}

// a rounded limb: dark stroke underneath, fur stroke on top
function limb(x1, y1, x2, y2, w, fill) {
  ctx.lineCap = 'round';
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = w + OUTLINE_W * 2;
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  ctx.strokeStyle = fill;
  ctx.lineWidth = w;
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
}

// ---------------------- the raccoon on his rocket -------------------
function drawRider() {
  const thrust = state === STATE.DEAD ? 0
    : Math.max(0, 1 - raccoon.sinceBoost / CFG.thrustTime);

  // limbs and tail trail against the direction of travel
  const drift = Math.max(-1, Math.min(1, raccoon.vy / 600));

  ctx.save();
  ctx.translate(raccoon.x, raccoon.y);
  ctx.rotate(raccoon.angle);

  drawFlame(thrust);
  drawTail(drift);
  drawRocketBack();
  // far side arm and leg, tucked behind the body
  limb(-5, 0, 1, 9, 6, '#8d929b');
  limb(1, -9, 10, -2, 5, '#8d929b');
  drawRocketFront();
  drawRaccoonBody(drift);
  drawRaccoonHead();
  // near side arm, hand resting on the hull
  limb(3, -7, 14, 2, 5.5, FUR);
  flatOval(15.5, 3.5, 4, 3.4, 0, PAW);

  ctx.restore();
}

function drawFlame(thrust) {
  if (thrust <= 0.02) return;
  const len = 26 + thrust * 40 + Math.random() * 9;
  const w   = 9 + thrust * 3;

  ctx.save();
  ctx.translate(NOZZLE_X, NOZZLE_Y);
  ctx.rotate(EXHAUST_ANGLE);   // +x now points where the exhaust goes

  const glow = ctx.createRadialGradient(6, 0, 2, 6, 0, 36);
  glow.addColorStop(0, 'rgba(255,170,60,' + (0.45 * thrust) + ')');
  glow.addColorStop(1, 'rgba(255,140,40,0)');
  ctx.fillStyle = glow;
  ctx.beginPath(); ctx.arc(6, 0, 36, 0, Math.PI * 2); ctx.fill();

  const outer = ctx.createLinearGradient(0, 0, len, 0);
  outer.addColorStop(0,    'rgba(255,214,110,' + (0.95 * thrust) + ')');
  outer.addColorStop(0.45, 'rgba(255,145,40,'  + (0.8  * thrust) + ')');
  outer.addColorStop(1,    'rgba(216,54,24,0)');
  ctx.fillStyle = outer;
  ctx.beginPath();
  ctx.moveTo(0, -w);
  ctx.quadraticCurveTo(len * 0.62, -w * 0.5, len, 0);
  ctx.quadraticCurveTo(len * 0.62,  w * 0.5, 0, w);
  ctx.closePath();
  ctx.fill();

  const core = ctx.createLinearGradient(0, 0, len * 0.5, 0);
  core.addColorStop(0, 'rgba(255,252,235,' + (0.95 * thrust) + ')');
  core.addColorStop(1, 'rgba(255,220,120,0)');
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.moveTo(0, -w * 0.42);
  ctx.quadraticCurveTo(len * 0.35, 0, len * 0.5, 0);
  ctx.quadraticCurveTo(len * 0.35, 0, 0, w * 0.42);
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}

function drawTail(drift) {
  // drawn tip first, so each ring overlaps the previous one cleanly
  const swing = drift * 0.18;
  const rings = [
    { x: -25, y: -23, r: 5.5, c: FUR_LIGHT },
    { x: -30, y: -17, r: 6.5, c: '#585d69' },
    { x: -32, y: -10, r: 7.2, c: FUR_LIGHT },
    { x: -29, y:  -4, r: 7.8, c: '#585d69' },
    { x: -22, y:   0, r: 8.2, c: FUR       },
  ];
  ctx.save();
  ctx.rotate(swing);
  for (const r of rings) oval(r.x, r.y, r.r, r.r, 0, r.c);
  ctx.restore();
}

// tail fins, drawn before the hull so they sit behind it
function drawRocketBack() {
  ctx.beginPath();                      // top fin
  ctx.moveTo(-20, 8);
  ctx.lineTo(-30, -4);
  ctx.lineTo(-12, 8);
  ctx.closePath();
  outlined(ROCKET_DARK);

  ctx.beginPath();                      // bottom fin
  ctx.moveTo(-20, 24);
  ctx.lineTo(-30, 34);
  ctx.lineTo(-12, 24);
  ctx.closePath();
  outlined(ROCKET_DARK);

  ctx.beginPath();                      // exhaust ring
  roundRectPath(-34, 8, 10, 16, 4);
  outlined('#8c909b');
}

function drawRocketFront() {
  // hull
  ctx.beginPath();
  roundRectPath(-28, 6, 46, 20, 10);
  outlined(ROCKET_BODY);

  // nose cone
  ctx.beginPath();
  ctx.moveTo(14, 6);
  ctx.quadraticCurveTo(34, 8, 36, 16);
  ctx.quadraticCurveTo(34, 24, 14, 26);
  ctx.closePath();
  outlined(ROCKET_RED);

  // red band near the tail
  ctx.beginPath();
  roundRectPath(-26, 7, 9, 18, 4);
  outlined(ROCKET_DARK);

  // porthole
  oval(-2, 16, 7, 7, 0, '#b9bec8');
  flatOval(-2, 16, 4.6, 4.6, 0, WINDOW);
  flatOval(-3.6, 14.4, 1.8, 1.4, -0.6, 'rgba(255,255,255,.85)');
}

function drawRaccoonBody(drift) {
  // body
  oval(-3, -2, 12, 11, 0, FUR);
  flatOval(0, 1, 8, 7.5, 0, FUR_LIGHT);   // belly patch

  // near side leg, straddling the hull
  const legAngle = 1.0 - drift * 0.35;
  limb(-3, 4, -3 + Math.cos(legAngle) * 12, 4 + Math.sin(legAngle) * 12, 7, FUR);
  flatOval(-3 + Math.cos(legAngle) * 13, 4 + Math.sin(legAngle) * 13, 4.2, 3.8, 0, PAW);
}

function drawRaccoonHead() {
  const hx = 7, hy = -16;   // head centre

  // ears: rounded, with a darker inner ear
  ctx.beginPath();
  ctx.moveTo(hx - 11, hy - 4);
  ctx.quadraticCurveTo(hx - 14, hy - 17, hx - 1, hy - 12);
  ctx.closePath();
  outlined(FUR);
  flatOval(hx - 8, hy - 8.5, 2.8, 3.6, -0.5, '#6d6472');

  ctx.beginPath();
  ctx.moveTo(hx + 4, hy - 12);
  ctx.quadraticCurveTo(hx + 15, hy - 18, hx + 12, hy - 4);
  ctx.closePath();
  outlined(FUR);
  flatOval(hx + 9.5, hy - 9.5, 2.8, 3.6, 0.5, '#6d6472');

  // head
  oval(hx, hy, 12, 11.5, 0, FUR_MID);
  // lighter forehead / cheeks
  flatOval(hx + 1, hy + 3, 10, 8, 0, FUR_LIGHT);

  // the mask: one shape so the outlines never cross
  ctx.beginPath();
  ctx.ellipse(hx - 4.5, hy - 2.5, 6, 5.4, -0.12, 0, Math.PI * 2);
  ctx.fillStyle = MASK; ctx.fill();
  ctx.beginPath();
  ctx.ellipse(hx + 5.5, hy - 3.5, 6, 5.4, 0.12, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(hx + 0.5, hy - 5, 6, 3.2, 0, 0, Math.PI * 2);
  ctx.fill();

  // eyes
  if (state === STATE.DEAD) {
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    cross(hx - 4.5, hy - 2.5, 3);
    cross(hx + 5.5, hy - 3.5, 3);
  } else {
    flatOval(hx - 4.5, hy - 2.5, 3.6, 3.8, 0, '#ffffff');
    flatOval(hx + 5.5, hy - 3.5, 3.6, 3.8, 0, '#ffffff');
    flatOval(hx - 3.8, hy - 2.2, 1.9, 2.1, 0, '#2f2b3d');
    flatOval(hx + 6.2, hy - 3.2, 1.9, 2.1, 0, '#2f2b3d');
    flatOval(hx - 4.4, hy - 3.2, 0.8, 0.8, 0, '#ffffff');
    flatOval(hx + 5.6, hy - 4.2, 0.8, 0.8, 0, '#ffffff');
  }

  // blush
  flatOval(hx - 8.5, hy + 4, 3.4, 2.4, 0, BLUSH);
  flatOval(hx + 8.5, hy + 3, 3.4, 2.4, 0, BLUSH);

  // snout and nose
  flatOval(hx + 1, hy + 6, 6, 4.2, 0, FUR_LIGHT);
  ctx.beginPath();
  ctx.moveTo(hx - 1.6, hy + 4.4);
  ctx.lineTo(hx + 3.6, hy + 4.4);
  ctx.quadraticCurveTo(hx + 1, hy + 8, hx - 1.6, hy + 4.4);
  ctx.closePath();
  ctx.fillStyle = '#2f2b3d'; ctx.fill();

  // little smile
  ctx.strokeStyle = '#2f2b3d';
  ctx.lineWidth = 1.6;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(hx - 3.5, hy + 8);
  ctx.quadraticCurveTo(hx + 1, hy + 10.5, hx + 5.5, hy + 7.5);
  ctx.stroke();
}

function cross(x, y, r) {
  ctx.beginPath();
  ctx.moveTo(x - r, y - r); ctx.lineTo(x + r, y + r);
  ctx.moveTo(x + r, y - r); ctx.lineTo(x - r, y + r);
  ctx.stroke();
}

function drawGround() {
  const y = HORIZON;
  const wide = viewRight - viewLeft;

  // Haze rising off the ground. Pillars sink into it instead of ending
  // on a hard line, which is what made them look cut off.
  const haze = ctx.createLinearGradient(0, y - 60, 0, y);
  haze.addColorStop(0, 'rgba(52,38,42,0)');
  haze.addColorStop(1, 'rgba(46,34,40,.6)');
  ctx.fillStyle = haze;
  ctx.fillRect(viewLeft, y - 60, wide, 60);

  // the earth itself, dark but not dead flat
  const g = ctx.createLinearGradient(0, y, 0, H);
  g.addColorStop(0,    '#3d3243');
  g.addColorStop(0.3,  '#251f2c');
  g.addColorStop(1,    '#15121a');
  ctx.fillStyle = g;
  ctx.fillRect(viewLeft, y, wide, viewBottom - y);

  // the last of the ember light catching the edge
  ctx.fillStyle = 'rgba(200,126,80,.5)';
  ctx.fillRect(viewLeft, y - 2, wide, 3);

  // Broken slabs along the rim. Each layer takes its own remainder of the
  // shared counter, so both drift at exactly the raccoon's travel speed.
  const slabStart = viewLeft - (groundOffset % SLAB_SPACING);
  ctx.fillStyle = '#4b3c4c';
  for (let x = slabStart; x < viewRight + SLAB_SPACING; x += SLAB_SPACING) {
    ctx.beginPath();
    ctx.moveTo(x, y + 1);
    ctx.lineTo(x + 27, y + 1);
    ctx.lineTo(x + 23, y + 10);
    ctx.lineTo(x + 4, y + 8);
    ctx.closePath();
    ctx.fill();
  }

  // rubble silhouettes in the foreground
  const rubbleStart = viewLeft - (groundOffset % RUBBLE_SPACING);
  ctx.fillStyle = '#191520';
  for (let x = rubbleStart; x < viewRight + RUBBLE_SPACING; x += RUBBLE_SPACING) {
    ctx.beginPath();
    ctx.moveTo(x + 4,  viewBottom);
    ctx.lineTo(x + 11, y + 38);
    ctx.lineTo(x + 25, y + 47);
    ctx.lineTo(x + 36, y + 33);
    ctx.lineTo(x + 47, viewBottom);
    ctx.closePath();
    ctx.fill();
  }
}

function drawUI() {
  ctx.textAlign = 'center';

  if (state === STATE.PLAYING || state === STATE.DEAD) {
    outlinedText(String(score), W / 2, 96, 'bold 64px system-ui', '#fff', '#1d2b33', 7);
  }

  if (state === STATE.READY) {
    outlinedText('WOBBLY RACCOON', W / 2, H * 0.30, 'bold 36px system-ui', '#fff', '#1d2b33', 7);
    panel(W / 2, H * 0.66, 330, 150);
    ctx.fillStyle = '#2b3a44';
    ctx.font = 'bold 21px system-ui';
    ctx.fillText('Tap to fire the rocket', W / 2, H * 0.66 - 22);
    ctx.font = '17px system-ui';
    ctx.fillStyle = '#5b6b76';
    ctx.fillText('click / tap / SPACE', W / 2, H * 0.66 + 10);
    ctx.fillText('Best: ' + best, W / 2, H * 0.66 + 40);
  }

  if (state === STATE.DEAD) {
    panel(W / 2, H * 0.45, 300, 210);
    ctx.fillStyle = '#2b3a44';
    ctx.font = 'bold 34px system-ui';
    ctx.fillText('You crashed!', W / 2, H * 0.45 - 55);
    ctx.font = '18px system-ui';
    ctx.fillStyle = '#5b6b76';
    ctx.fillText('Score', W / 2, H * 0.45 - 20);
    ctx.font = 'bold 42px system-ui';
    ctx.fillStyle = '#2b3a44';
    ctx.fillText(String(score), W / 2, H * 0.45 + 18);
    ctx.font = '18px system-ui';
    ctx.fillStyle = '#5b6b76';
    ctx.fillText('Best: ' + best, W / 2, H * 0.45 + 50);

    if (deadTime > 0.8) {
      const pulse = 0.65 + Math.sin(performance.now() / 220) * 0.35;
      ctx.globalAlpha = pulse;
      ctx.fillStyle = '#e07b39';
      ctx.font = 'bold 21px system-ui';
      ctx.fillText('Tap to fly again', W / 2, H * 0.45 + 88);
      ctx.globalAlpha = 1;
    }
  }
}

function panel(cx, cy, w, h) {
  ctx.fillStyle = 'rgba(0,0,0,.18)';
  ctx.beginPath(); roundRectPath(cx - w / 2, cy - h / 2 + 5, w, h, 16); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.93)';
  ctx.beginPath(); roundRectPath(cx - w / 2, cy - h / 2, w, h, 16); ctx.fill();
}

function outlinedText(txt, x, y, font, fill, stroke, weight) {
  ctx.font = font;
  ctx.lineJoin = 'round';
  ctx.lineWidth = weight;
  ctx.strokeStyle = stroke;
  ctx.strokeText(txt, x, y);
  ctx.fillStyle = fill;
  ctx.fillText(txt, x, y);
}

// adds a rounded rectangle to the current path (does not begin one)
function roundRectPath(x, y, w, h, r) {
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y,     x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x,     y + h, r);
  ctx.arcTo(x,     y + h, x,     y,     r);
  ctx.arcTo(x,     y,     x + w, y,     r);
  ctx.closePath();
}

// ----------------------------- LOOP ---------------------------------
let lastFrame = performance.now();
function loop(now) {
  let dt = (now - lastFrame) / 1000;
  lastFrame = now;
  if (dt > 0.05) dt = 0.05;   // cap it, so a lag spike cannot tunnel through a pillar
  update(dt);
  draw();
  requestAnimationFrame(loop);
}

layout();
reset();
requestAnimationFrame(loop);
