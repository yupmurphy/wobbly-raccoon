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
const STATE = {
  MENU: 'menu', SETTINGS: 'settings', READY: 'ready',
  PLAYING: 'playing', PAUSED: 'paused', DEAD: 'dead',
};
let state = STATE.MENU;

let raccoon, obstacles, particles, starPops, score, best, runStars, deadTime, shake;

// Stars are kept across runs - one per pillar cleared. They are the seed of
// an in-game currency, so they are stored separately from the best score.
let stars = 0;

function loadStars() {
  try { return parseInt(localStorage.getItem('wobbly-raccoon-stars') || '0', 10) || 0; }
  catch (e) { return 0; }
}
function saveStars() {
  try { localStorage.setItem('wobbly-raccoon-stars', String(stars)); } catch (e) {}
}

// ---------------------------- SOUND SWITCH ---------------------------
let muted = false;
try { muted = localStorage.getItem('wobbly-raccoon-muted') === '1'; } catch (e) {}

function toggleMute() {
  muted = !muted;
  try { localStorage.setItem('wobbly-raccoon-muted', muted ? '1' : '0'); } catch (e) {}
}

// ---------------------------- SETTINGS -------------------------------
// Player-set difficulty. Each value is a multiplier on a CFG default, so
// 1 is always "as designed" and the sliders read the same way.
//
// The ceiling on `pillar` is not a taste call, it is derived. One boost
// lifts the raccoon boostSpeed^2 / (2 * gravity) = about 65 units. Clearing
// an opening needs room for roughly two of those corrections on top of his
// own height, so the smallest honest opening is about
//   2 * 65 * 0.6 + 2 * raccoonRadius = 138
// which is CFG.gapHeight / 1.25. Past that the gap is narrower than a
// single jump arc and clearing it stops being skill.
const SETTINGS_RANGE = {
  speed:   { min: 0.5, max: 3.0,  step: 0.1,  label: 'GAME SPEED' },
  pillar:  { min: 0.5, max: 1.25, step: 0.05, label: 'PILLAR HEIGHT' },
  spacing: { min: 0.7, max: 1.6,  step: 0.05, label: 'PILLAR SPACING' },
  jump:    { min: 0.6, max: 1.5,  step: 0.05, label: 'JUMP HEIGHT' },
};
const SETTINGS_ORDER = ['speed', 'pillar', 'spacing', 'jump'];
const SETTINGS_DEFAULT = { speed: 1, pillar: 1, spacing: 1, jump: 1 };

let settings = Object.assign({}, SETTINGS_DEFAULT);

function loadSettings() {
  try {
    const raw = JSON.parse(localStorage.getItem('wobbly-raccoon-settings') || '{}');
    for (const k of SETTINGS_ORDER) {
      const r = SETTINGS_RANGE[k];
      if (typeof raw[k] === 'number' && isFinite(raw[k])) {
        settings[k] = Math.min(r.max, Math.max(r.min, raw[k]));
      }
    }
  } catch (e) { /* defaults stand */ }
  applySettings();
}

function saveSettings() {
  try { localStorage.setItem('wobbly-raccoon-settings', JSON.stringify(settings)); }
  catch (e) {}
}

// The values the game actually runs on. Everything below reads these, not
// CFG, so a settings change takes effect the moment it is made.
let curSpeed, curGap, curSpacing, curGravity, curBoost, curMaxFall, curThrust;

// GAME SPEED scales *time*, not just the scroll. Run the clock k times
// faster and velocities go up by k while acceleration goes up by k squared.
// Do that and the flight path keeps exactly the same shape - same jump
// height, same number of flaps between pillars - it just plays faster.
// Scaling only the scroll, as it did before, quietly shrank the gap in
// time: at 3x there was not even one flap left between pillars.
//
// JUMP HEIGHT is the separate dial. Boost scales with its square root, so
// the arc becomes exactly that much taller without touching the tempo.
function applySettings() {
  const k = settings.speed;
  const j = settings.jump;

  curSpeed   = CFG.scrollSpeed * k;
  curGravity = CFG.gravity * k * k;
  curBoost   = CFG.boostSpeed * k * Math.sqrt(j);
  curMaxFall = CFG.maxFallSpeed * k;
  curThrust  = CFG.thrustTime / k;

  curGap     = Math.round(CFG.gapHeight / settings.pillar);
  curSpacing = Math.round(CFG.obstacleSpacing * settings.spacing);
}

// how high one boost lifts him, in world units
function jumpHeight() { return (curBoost * curBoost) / (2 * curGravity); }

// ---------------------------- THIS BUILD -----------------------------
// Bumped together with versionCode/versionName in android/app/build.gradle
// and with docs/version.json, which is what the update check reads.
const BUILD = { code: 4, name: '1.4' };

const SITE        = 'https://yupmurphy.github.io/wobbly-raccoon/';
const APK_URL     = SITE + 'WobblyRaccoon.apk';
const VERSION_URL = SITE + 'version.json';

// Capacitor only exists inside the packaged Android app, so this tells the
// two builds apart: the web page offers the download, the app offers the
// update check.
const IS_APP = !!window.Capacitor;

const updateCheck = { busy: false, message: '', available: null };

function openLink(url) {
  try {
    const w = window.open(url, '_blank');
    if (!w) location.href = url;
  } catch (e) {
    location.href = url;
  }
}

function checkForUpdate() {
  if (updateCheck.busy) return;
  updateCheck.busy = true;
  updateCheck.message = '';

  fetch(VERSION_URL, { cache: 'no-store' })
    .then(function (r) { return r.json(); })
    .then(function (info) {
      updateCheck.busy = false;
      if (info && info.versionCode > BUILD.code) {
        updateCheck.available = info;
        updateCheck.message = 'Version ' + info.versionName + ' is out';
      } else {
        updateCheck.message = 'You are up to date';
      }
    })
    .catch(function () {
      updateCheck.busy = false;
      updateCheck.message = 'Could not reach the server';
    });
}

function secondaryLabel() {
  if (!IS_APP) return 'DOWNLOAD APP';
  if (updateCheck.available) return 'GET ' + updateCheck.available.versionName;
  if (updateCheck.busy) return 'CHECKING...';
  return 'CHECK FOR UPDATES';
}

function secondaryAction() {
  if (!IS_APP) { openLink(APK_URL); return; }
  if (updateCheck.available) {
    openLink(updateCheck.available.url || APK_URL);
    return;
  }
  checkForUpdate();
}

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
  starPops = [];
  score = 0;
  runStars = 0;
  best = loadBest();
  stars = loadStars();
  deadTime = 0;
  shake = 0;

  fillObstacles();
}

// Keep enough pillars queued to cover the canvas, however wide it is, so
// none of them ever pops into existence somewhere the player can see.
function fillObstacles() {
  if (obstacles.length === 0) addObstacle(viewRight + 220);
  let last = obstacles[obstacles.length - 1];
  while (last.x < viewRight + curSpacing) {
    addObstacle(last.x + curSpacing);
    last = obstacles[obstacles.length - 1];
  }
}

function addObstacle(x) {
  const min = CFG.gapMargin;
  const max = Math.max(min, HORIZON - curGap - CFG.gapMargin);

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

// Button rectangles are derived from the current world size every time they
// are needed, so they follow the layout on any screen instead of being fixed.
function startButton() {
  const w = 250, h = 78;
  return { x: W / 2 - w / 2, y: H * 0.53, w: w, h: h };
}

function secondaryButton() {
  const w = 218, h = 56;
  const s = startButton();
  return { x: W / 2 - w / 2, y: s.y + s.h + 16, w: w, h: h };
}

// small round toggles in the menu's top corner
function muteButton() {
  const r = 26;
  return { x: W - r * 2 - 16, y: 18, w: r * 2, h: r * 2 };
}

function gearButton() {
  const m = muteButton();
  return { x: m.x - m.w - 12, y: m.y, w: m.w, h: m.h };
}

// the pause key, tucked in the corner during a run
function pauseButton() {
  const r = 23;
  return { x: W - r * 2 - 14, y: 16, w: r * 2, h: r * 2 };
}

// ------------------------- SETTINGS SCREEN ---------------------------
// The rows share out whatever vertical room the screen has, so four
// sliders plus two buttons still fit on a short landscape window.
function settingsRowGap() {
  return Math.min(92, (H * 0.50) / SETTINGS_ORDER.length);
}
function settingsRowY(i) { return H * 0.25 + i * settingsRowGap(); }

function sliderTrack(i) {
  const w = Math.min(300, W - 96);
  return { x: W / 2 - w / 2, y: settingsRowY(i) + 34, w: w, h: 12 };
}

// a generous touch target around the thin visual track
function sliderHit(i) {
  const t = sliderTrack(i);
  return { x: t.x - 18, y: t.y - 26, w: t.w + 36, h: t.h + 52 };
}

function settingsBackButton() {
  const w = 190, h = 56;
  return { x: W / 2 - w / 2, y: settingsRowY(SETTINGS_ORDER.length) + 14, w: w, h: h };
}

function settingsResetButton() {
  const b = settingsBackButton();
  return { x: W / 2 - 80, y: b.y + b.h + 12, w: 160, h: 44 };
}

// turn a horizontal position on the track into a settings value
function valueFromX(key, i, x) {
  const t = sliderTrack(i);
  const r = SETTINGS_RANGE[key];
  const f = Math.min(1, Math.max(0, (x - t.x) / t.w));
  const raw = r.min + f * (r.max - r.min);
  const snapped = Math.round(Math.round(raw / r.step) * r.step * 100) / 100;
  return Math.min(r.max, Math.max(r.min, snapped));
}

function sliderKnobX(key, i) {
  const t = sliderTrack(i);
  const r = SETTINGS_RANGE[key];
  return t.x + t.w * ((settings[key] - r.min) / (r.max - r.min));
}

// which slider a drag is currently holding, if any
let dragging = -1;

function pauseMenuButtons() {
  const cy = H * 0.45, w = 210, h = 62;
  return {
    resume: { x: W / 2 - w / 2, y: cy - 24, w: w, h: h },
    home:   { x: W / 2 - w / 2, y: cy + 50, w: w, h: h },
    mute:   { x: W / 2 - 26,    y: cy + 136, w: 52, h: 52 },
  };
}

// How many full flaps fit between two pillars at the current settings.
// Below 1 there is not even time for one correction, which is the point
// where a fast setting stops being hard and starts being a coin toss.
function flapsBetweenPillars() {
  const flapTime = 2 * Math.abs(curBoost) / curGravity;
  return (curSpacing / curSpeed) / flapTime;
}

function deadButtons() {
  const w = 139, h = 58, gap = 16;
  const y = H * 0.45 + 62;
  return [
    { x: W / 2 - w - gap / 2, y: y, w: w, h: h, label: 'RETRY', action: 'retry' },
    { x: W / 2 + gap / 2,     y: y, w: w, h: h, label: 'MENU',  action: 'menu'  },
  ];
}

function inside(r, p) {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}

function goToMenu() { reset(); state = STATE.MENU; }
function startRun()  { reset(); state = STATE.READY; }

function press() {
  if (state === STATE.READY) {
    state = STATE.PLAYING;
    boost();
  } else if (state === STATE.PLAYING) {
    boost();
  }
}

function boost() {
  raccoon.vy = curBoost;
  raccoon.sinceBoost = 0;
  for (let i = 0; i < 14; i++) spawnExhaust();
  sound('boost');
}

// where a click landed, in world units
function pointerWorld(e) {
  const r = cv.getBoundingClientRect();
  const px = (e.clientX - r.left) * (cv.width  / r.width);
  const py = (e.clientY - r.top)  * (cv.height / r.height);
  return { x: (px - viewX) / viewScale, y: (py - viewY) / viewScale };
}

cv.addEventListener('pointerdown', function (e) {
  e.preventDefault();
  const p = pointerWorld(e);

  if (state === STATE.MENU) {
    if (inside(muteButton(), p))      { toggleMute(); return; }
    if (inside(gearButton(), p))      { state = STATE.SETTINGS; return; }
    if (inside(secondaryButton(), p)) { secondaryAction(); return; }
    if (inside(startButton(), p))     { startRun(); return; }
    return;
  }

  if (state === STATE.SETTINGS) {
    for (let i = 0; i < SETTINGS_ORDER.length; i++) {
      if (inside(sliderHit(i), p)) {
        dragging = i;
        settings[SETTINGS_ORDER[i]] = valueFromX(SETTINGS_ORDER[i], i, p.x);
        applySettings();
        return;
      }
    }
    if (inside(settingsResetButton(), p)) {
      settings = Object.assign({}, SETTINGS_DEFAULT);
      applySettings();
      saveSettings();
      return;
    }
    if (inside(settingsBackButton(), p)) {
      saveSettings();
      state = STATE.MENU;
      return;
    }
    return;
  }

  if (state === STATE.PAUSED) {
    const b = pauseMenuButtons();
    if (inside(b.mute, p))   { toggleMute(); return; }
    if (inside(b.home, p))   { goToMenu(); return; }
    if (inside(b.resume, p)) { state = STATE.PLAYING; return; }
    return;
  }

  if (state === STATE.PLAYING && inside(pauseButton(), p)) {
    state = STATE.PAUSED;
    return;
  }

  if (state === STATE.DEAD) {
    // ignore the tap that was still in flight when he crashed
    if (deadTime < 0.5) return;
    for (const b of deadButtons()) {
      if (inside(b, p)) {
        if (b.action === 'retry') startRun(); else goToMenu();
        return;
      }
    }
    return;
  }

  press();
});

// dragging a slider keeps following the finger until it lifts
window.addEventListener('pointermove', function (e) {
  if (dragging < 0 || state !== STATE.SETTINGS) return;
  e.preventDefault();
  const key = SETTINGS_ORDER[dragging];
  settings[key] = valueFromX(key, dragging, pointerWorld(e).x);
  applySettings();
});

function endDrag() {
  if (dragging >= 0) { dragging = -1; saveSettings(); }
}
window.addEventListener('pointerup', endDrag);
window.addEventListener('pointercancel', endDrag);

window.addEventListener('keydown', function (e) {
  if (e.code === 'Escape') {
    if (state === STATE.DEAD)     { goToMenu(); return; }
    if (state === STATE.SETTINGS) { saveSettings(); state = STATE.MENU; return; }
    if (state === STATE.PLAYING)  { state = STATE.PAUSED; return; }
    if (state === STATE.PAUSED)   { state = STATE.PLAYING; return; }
  }

  if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') {
    e.preventDefault();
    if (e.repeat || keysDown[e.code]) return;   // key is being held - ignore
    keysDown[e.code] = true;

    if (state === STATE.MENU) startRun();
    else if (state === STATE.DEAD) { if (deadTime > 0.5) startRun(); }
    else press();
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
  if (muted) return;
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
    vx: dirX * speed - dirY * spread - curSpeed,  // drifts with the world
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
  // a pause freezes the whole world, background included
  if (state === STATE.PAUSED) return;

  // the background keeps moving even in the menu, so the scene feels alive
  farOffset  = (farOffset  + curSpeed * 0.10 * dt) % SKYLINE_SPAN;
  nearOffset = (nearOffset + curSpeed * 0.26 * dt) % SKYLINE_SPAN;
  // One growing counter for the ground; each layer takes its own remainder
  // from it. It wraps on a common multiple of every layer's spacing, so no
  // layer ever jumps sideways when the counter resets.
  groundOffset = (groundOffset + curSpeed * dt) % GROUND_CYCLE;

  for (const a of ash) {
    a.x -= (curSpeed * 0.12 + a.fall * 0.35) * dt;
    a.y += a.fall * dt;
    if (a.y > viewBottom) {
      a.y = viewTop - 4;
      a.x = viewLeft + Math.random() * (viewRight - viewLeft);
    }
    if (a.x < viewLeft - 4) { a.x = viewRight + 4; }
  }

  if (state === STATE.MENU || state === STATE.READY) {
    // he idles in place; on the menu he sits centred, above the button
    const restY = state === STATE.MENU ? H * 0.40 : H * 0.45;
    if (state === STATE.MENU) raccoon.x = W / 2 - 6;
    raccoon.y = restY + Math.sin(performance.now() / 300) * 10;
    raccoon.angle = -0.12 + Math.sin(performance.now() / 300) * 0.05;
    raccoon.sinceBoost = 99;
  }

  if (state === STATE.PLAYING) {
    // --- physics ---
    raccoon.vy += curGravity * dt;
    if (raccoon.vy > curMaxFall) raccoon.vy = curMaxFall;
    raccoon.y += raccoon.vy * dt;
    raccoon.sinceBoost += dt;

    // Tilt: only slightly nose-up while the rocket lifts him,
    // rotating towards straight-down as he falls.
    // the thresholds are speed-relative, so he leans the same way at any tempo
    const target = Math.max(-0.30, Math.min(1.45, raccoon.vy / (450 * settings.speed)));
    raccoon.angle += (target - raccoon.angle) * Math.min(1, dt * 8 * settings.speed);

    // keep the flame alive for a moment after the tap
    if (raccoon.sinceBoost < curThrust) {
      spawnExhaust();
      if (Math.random() < 0.6) spawnExhaust();
    }

    // --- obstacles ---
    for (const o of obstacles) {
      o.x -= curSpeed * dt;
      if (!o.scored && o.x + CFG.obstacleWidth < raccoon.x) {
        o.scored = true;
        score++;
        runStars++;
        stars++;
        saveStars();
        starPops.push({ x: raccoon.x + 26, y: raccoon.y - 30, life: 0 });
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
    raccoon.vy += curGravity * dt;
    raccoon.y += raccoon.vy * dt;
    raccoon.angle += dt * 4 * settings.speed;
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

  // the little star that pops out when a pillar is cleared
  for (const s of starPops) {
    s.life += dt;
    s.y -= 46 * dt;
    s.x -= curSpeed * 0.25 * dt;
  }
  starPops = starPops.filter(function (s) { return s.life < 0.9; });
}

function hitSomething() {
  if (raccoon.y + CFG.raccoonRadius > HORIZON) return true;
  // the ceiling does not kill, it just stops him
  if (raccoon.y - CFG.raccoonRadius < 0) { raccoon.y = CFG.raccoonRadius; raccoon.vy = 0; }

  for (const o of obstacles) {
    const top = { x: o.x, y: 0, w: CFG.obstacleWidth, h: o.gapY };
    const bottom = { x: o.x, y: o.gapY + curGap, w: CFG.obstacleWidth,
                     h: HORIZON - (o.gapY + curGap) };
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
  raccoon.vy = -180 * settings.speed;
  sound('crash');
  if (score > best) { best = score; saveBest(best); }
  saveStars();
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
  drawStarPops();
  drawGround();
  if (state === STATE.MENU) drawMenuRuins();

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
  const bottomY = o.gapY + curGap;
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
    : Math.max(0, 1 - raccoon.sinceBoost / curThrust);

  // limbs and tail trail against the direction of travel
  const drift = Math.max(-1, Math.min(1, raccoon.vy / (600 * settings.speed)));

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

// ----------------------------- STARS --------------------------------
const STAR_GOLD = '#f5c451';

function starPath(x, y, r) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 === 0 ? r : r * 0.45;
    const a = -Math.PI / 2 + i * Math.PI / 5;
    const px = x + Math.cos(a) * rad;
    const py = y + Math.sin(a) * rad;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

function drawStar(x, y, r, fill, outlineWidth) {
  starPath(x, y, r);
  ctx.fillStyle = fill;
  ctx.fill();
  if (outlineWidth) {
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = outlineWidth;
    ctx.lineJoin = 'round';
    ctx.stroke();
  }
}

// one star floating up out of the pillar you just cleared
function drawStarPops() {
  for (const s of starPops) {
    const t = s.life / 0.9;
    ctx.globalAlpha = 1 - t * t;
    drawStar(s.x, s.y, 11 * (1 + t * 0.35), STAR_GOLD, 2.5);
    ctx.globalAlpha = 1;
  }
}

// ------------------------- MENU SCENERY -----------------------------
// Ruined blocks framing the left and right edges, leaving the middle of
// the screen clear for the button. Fixed shapes, not random, so the menu
// looks the same every time it opens.
const MENU_RUINS = [
  { side: -1, off:  -6, w: 104, h: 0.52, cut: 0.34 },
  { side: -1, off:  86, w:  66, h: 0.33, cut: 0.62 },
  { side: -1, off: 140, w:  52, h: 0.42, cut: 0.18 },
  { side:  1, off:  -6, w: 112, h: 0.56, cut: 0.40 },
  { side:  1, off:  92, w:  60, h: 0.36, cut: 0.24 },
  { side:  1, off: 140, w:  48, h: 0.27, cut: 0.58 },
];

function drawMenuRuins() {
  const groundY = HORIZON + 6;

  for (const b of MENU_RUINS) {
    const x = b.side < 0 ? viewLeft + b.off : viewRight - b.off - b.w;
    const top = groundY - b.h * (groundY - viewTop);

    // body, with a chunk torn off the roof
    ctx.beginPath();
    ctx.moveTo(x, groundY);
    ctx.lineTo(x, top + 14);
    ctx.lineTo(x + b.w * b.cut, top);
    ctx.lineTo(x + b.w * (b.cut + 0.18), top + 22);
    ctx.lineTo(x + b.w, top + 8);
    ctx.lineTo(x + b.w, groundY);
    ctx.closePath();
    ctx.fillStyle = '#1a1622';
    ctx.fill();

    // a few windows, most of them dead, one or two still burning
    const cols = Math.max(1, Math.floor(b.w / 26));
    const rows = Math.max(1, Math.floor((groundY - top) / 34));
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        const wx = x + 10 + c * 26;
        const wy = top + 34 + r * 34;
        if (wy > groundY - 18 || wx + 12 > x + b.w - 6) continue;
        const lit = ((c * 7 + r * 13 + b.off) % 11) === 0;
        ctx.fillStyle = lit ? 'rgba(226,142,84,.55)' : 'rgba(58,48,66,.7)';
        ctx.fillRect(wx, wy, 12, 17);
      }
    }
  }
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

function drawButton(r, label, tone) {
  const warm = tone === 'primary';
  // shadow
  ctx.fillStyle = 'rgba(0,0,0,.35)';
  ctx.beginPath(); roundRectPath(r.x, r.y + 5, r.w, r.h, 14); ctx.fill();

  const g = ctx.createLinearGradient(0, r.y, 0, r.y + r.h);
  if (warm) { g.addColorStop(0, '#f08a4b'); g.addColorStop(1, '#d1592c'); }
  else      { g.addColorStop(0, '#5d5468'); g.addColorStop(1, '#403a4c'); }
  ctx.fillStyle = g;
  ctx.beginPath(); roundRectPath(r.x, r.y, r.w, r.h, 14); ctx.fill();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';
  ctx.stroke();

  // a highlight along the top edge, so it reads as a raised key
  ctx.fillStyle = 'rgba(255,255,255,.22)';
  ctx.beginPath(); roundRectPath(r.x + 6, r.y + 5, r.w - 12, r.h * 0.34, 9); ctx.fill();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  outlinedText(label, r.x + r.w / 2, r.y + r.h / 2 + 1,
               'bold ' + Math.round(r.h * 0.40) + 'px system-ui', '#fff', OUTLINE, 5);
  ctx.textBaseline = 'alphabetic';
}

// round speaker toggle: filled when sound is on, struck through when off
function drawMuteButton(r) {
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2, rad = r.w / 2;

  ctx.beginPath();
  ctx.arc(cx, cy, rad, 0, Math.PI * 2);
  ctx.fillStyle = muted ? 'rgba(32,28,40,.75)' : 'rgba(64,58,76,.85)';
  ctx.fill();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 3;
  ctx.stroke();

  const c = muted ? '#8c8598' : '#f0e8dc';

  // speaker body: a small box with a cone
  ctx.fillStyle = c;
  ctx.beginPath();
  ctx.moveTo(cx - 10, cy - 4);
  ctx.lineTo(cx - 4,  cy - 4);
  ctx.lineTo(cx + 3,  cy - 11);
  ctx.lineTo(cx + 3,  cy + 11);
  ctx.lineTo(cx - 4,  cy + 4);
  ctx.lineTo(cx - 10, cy + 4);
  ctx.closePath();
  ctx.fill();

  if (muted) {
    ctx.strokeStyle = '#e06a52';
    ctx.lineWidth = 3.2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx - 13, cy - 13);
    ctx.lineTo(cx + 13, cy + 13);
    ctx.stroke();
  } else {
    // two sound waves
    ctx.strokeStyle = c;
    ctx.lineWidth = 2.4;
    ctx.lineCap = 'round';
    for (let i = 0; i < 2; i++) {
      ctx.beginPath();
      ctx.arc(cx + 4, cy, 7 + i * 5, -0.85, 0.85);
      ctx.stroke();
    }
  }
}

function roundIcon(r, dim) {
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
  ctx.beginPath();
  ctx.arc(cx, cy, r.w / 2, 0, Math.PI * 2);
  ctx.fillStyle = dim ? 'rgba(32,28,40,.75)' : 'rgba(64,58,76,.85)';
  ctx.fill();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 3;
  ctx.stroke();
  return { cx: cx, cy: cy };
}

function drawGearButton(r) {
  const c = roundIcon(r, false);
  const teeth = 8, outer = 13, inner = 9;
  ctx.fillStyle = '#f0e8dc';
  ctx.beginPath();
  for (let i = 0; i < teeth * 2; i++) {
    const rad = i % 2 === 0 ? outer : inner;
    const a = (i / (teeth * 2)) * Math.PI * 2;
    const px = c.cx + Math.cos(a) * rad;
    const py = c.cy + Math.sin(a) * rad;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  // hub
  ctx.beginPath();
  ctx.arc(c.cx, c.cy, 4.6, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(64,58,76,.95)';
  ctx.fill();
}

function drawPauseKey(r) {
  const c = roundIcon(r, false);
  ctx.fillStyle = '#f0e8dc';
  ctx.beginPath(); roundRectPath(c.cx - 8, c.cy - 9, 6, 18, 2); ctx.fill();
  ctx.beginPath(); roundRectPath(c.cx + 2, c.cy - 9, 6, 18, 2); ctx.fill();
}

// the star counter, drawn as an icon plus a number
function starCount(x, y, value, size) {
  ctx.textAlign = 'left';
  drawStar(x, y, size, STAR_GOLD, 2.5);
  outlinedText(String(value), x + size + 9, y + size * 0.56,
               'bold ' + Math.round(size * 1.7) + 'px system-ui', '#fff', '#1d2b33', 6);
  ctx.textAlign = 'center';
}

function drawUI() {
  ctx.textAlign = 'center';

  if (state === STATE.PLAYING || state === STATE.PAUSED || state === STATE.DEAD) {
    outlinedText(String(score), W / 2, 96, 'bold 64px system-ui', '#fff', '#1d2b33', 7);
    starCount(22, 52, stars, 13);
  }

  if (state === STATE.PLAYING) drawPauseKey(pauseButton());

  if (state === STATE.MENU) {
    outlinedText('WOBBLY', W / 2, H * 0.15, 'bold 54px system-ui', '#fff', '#1d2b33', 8);
    outlinedText('RACCOON', W / 2, H * 0.15 + 52, 'bold 54px system-ui', '#f0a45b', '#1d2b33', 8);

    // totals sit above the buttons, on one line
    const s = startButton();
    ctx.textAlign = 'center';
    starCount(W / 2 - 74, s.y - 34, stars, 14);
    outlinedText('BEST  ' + best, W / 2 + 52, s.y - 24,
                 'bold 21px system-ui', '#e7e2da', '#1d2b33', 5);

    drawButton(s, 'START', 'primary');

    const sec = secondaryButton();
    drawButton(sec, secondaryLabel(), 'plain');

    if (updateCheck.message) {
      outlinedText(updateCheck.message, W / 2, sec.y + sec.h + 26,
                   '17px system-ui', '#d9d2c8', '#1d2b33', 4);
    }

    drawMuteButton(muteButton());
    drawGearButton(gearButton());
  }

  if (state === STATE.SETTINGS) drawSettingsScreen();
  if (state === STATE.PAUSED)   drawPauseScreen();

  if (state === STATE.READY) {
    const pulse = 0.6 + Math.sin(performance.now() / 260) * 0.4;
    ctx.globalAlpha = pulse;
    outlinedText('TAP TO FLY', W / 2, H * 0.62, 'bold 34px system-ui', '#fff', '#1d2b33', 7);
    ctx.globalAlpha = 1;
    starCount(22, 52, stars, 13);
  }

  if (state === STATE.DEAD) {
    const cy = H * 0.45;
    panel(W / 2, cy, 330, 250);

    ctx.fillStyle = '#2b3a44';
    ctx.font = 'bold 32px system-ui';
    ctx.fillText('You crashed!', W / 2, cy - 78);

    ctx.font = '17px system-ui';
    ctx.fillStyle = '#5b6b76';
    ctx.fillText('Score', W / 2 - 72, cy - 46);
    ctx.fillText('Best',  W / 2 + 72, cy - 46);
    ctx.font = 'bold 38px system-ui';
    ctx.fillStyle = '#2b3a44';
    ctx.fillText(String(score), W / 2 - 72, cy - 10);
    ctx.fillText(String(best),  W / 2 + 72, cy - 10);

    // stars earned this run
    ctx.textAlign = 'center';
    drawStar(W / 2 - 30, cy + 22, 13, STAR_GOLD, 2.5);
    ctx.fillStyle = '#2b3a44';
    ctx.font = 'bold 24px system-ui';
    ctx.textAlign = 'left';
    ctx.fillText('+' + runStars, W / 2 - 12, cy + 31);
    ctx.textAlign = 'center';

    if (deadTime > 0.5) {
      const b = deadButtons();
      drawButton(b[0], 'RETRY', 'primary');
      drawButton(b[1], 'MENU', 'plain');
    }
  }
}

function dimScene(alpha) {
  ctx.fillStyle = 'rgba(16,13,22,' + alpha + ')';
  ctx.fillRect(viewLeft, viewTop, viewRight - viewLeft, viewBottom - viewTop);
}

function drawSettingsScreen() {
  dimScene(0.74);

  ctx.textAlign = 'center';
  outlinedText('SETTINGS', W / 2, H * 0.15, 'bold 42px system-ui', '#fff', '#1d2b33', 8);

  for (let i = 0; i < SETTINGS_ORDER.length; i++) {
    const key = SETTINGS_ORDER[i];
    const r = SETTINGS_RANGE[key];
    const t = sliderTrack(i);
    const y = settingsRowY(i);
    const decimals = r.step >= 0.1 ? 1 : 2;

    ctx.textAlign = 'left';
    outlinedText(r.label, t.x, y + 6, 'bold 19px system-ui', '#e7e2da', '#1d2b33', 5);
    ctx.textAlign = 'right';
    outlinedText(settings[key].toFixed(decimals) + '×', t.x + t.w, y + 6,
                 'bold 22px system-ui', '#f0a45b', '#1d2b33', 5);

    // track, then the filled part up to the knob
    ctx.fillStyle = 'rgba(240,232,220,.2)';
    ctx.beginPath(); roundRectPath(t.x, t.y, t.w, t.h, 6); ctx.fill();
    const kx = sliderKnobX(key, i);
    ctx.fillStyle = '#e07b39';
    ctx.beginPath(); roundRectPath(t.x, t.y, Math.max(t.h, kx - t.x), t.h, 6); ctx.fill();

    ctx.beginPath();
    ctx.arc(kx, t.y + t.h / 2, 15, 0, Math.PI * 2);
    ctx.fillStyle = dragging === i ? '#ffd9b0' : '#f5ede2';
    ctx.fill();
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 3;
    ctx.stroke();

    // the ends of the range, so the numbers mean something
    ctx.font = '13px system-ui';
    ctx.fillStyle = 'rgba(231,226,218,.5)';
    ctx.textAlign = 'left';
    ctx.fillText(r.min.toFixed(decimals), t.x, t.y + 36);
    ctx.textAlign = 'right';
    ctx.fillText(r.max.toFixed(decimals), t.x + t.w, t.y + 36);
  }

  // a warning the numbers themselves justify
  const flaps = flapsBetweenPillars();
  if (flaps < 1.15) {
    const t = sliderTrack(SETTINGS_ORDER.length - 1);
    ctx.textAlign = 'center';
    outlinedText(flaps < 0.85 ? 'No room for a single flap between pillars'
                              : 'Barely one flap between pillars',
                 W / 2, t.y + 66, 'bold 15px system-ui', '#ff9a6b', '#1d2b33', 4);
  }

  drawButton(settingsBackButton(), 'BACK', 'primary');
  drawButton(settingsResetButton(), 'DEFAULTS', 'plain');
}

function drawPauseScreen() {
  dimScene(0.6);

  const b = pauseMenuButtons();
  const cy = H * 0.45;
  panel(W / 2, cy + 62, 272, 302);

  ctx.textAlign = 'center';
  ctx.fillStyle = '#2b3a44';
  ctx.font = 'bold 34px system-ui';
  ctx.fillText('Paused', W / 2, cy - 48);

  drawButton(b.resume, 'RESUME', 'primary');
  drawButton(b.home, 'HOME', 'plain');
  drawMuteButton(b.mute);
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

loadSettings();
layout();
reset();
requestAnimationFrame(loop);
