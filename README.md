# Wobbly Raccoon

A Flappy Bird style game where a raccoon rides a rocket through the skyline of a
ruined city. Plain HTML and JavaScript on a canvas — no framework, no build step,
no dependencies at runtime.

## Play it

Open `docs/index.html` in a browser. That is the whole game.

For the service worker (offline play) to register, it needs to be served over
http rather than opened from disk:

```
py -m http.server 8000 -d docs
```

## How it is put together

```
docs/         the entire game - named "docs" because GitHub Pages will
              only publish from the repository root or a folder with
              exactly that name
  index.html  page shell, mobile meta, service worker registration
  game.js     all of it: physics, drawing, sound, layout
  sw.js       offline cache
  manifest.webmanifest   makes it installable on a phone
resources/    source art the Android icons are generated from
android/      Capacitor project that wraps docs/ into a native app
```

### The world

The game thinks in a world 480 units wide whose height follows the shape of the
screen, so the raccoon and the pillars keep the same size relative to the screen
on any device and a taller phone simply gets more sky. `layout()` is the only
place that deals in real pixels; it also sizes the canvas to the display's pixel
density so nothing is ever drawn stretched.

### Tuning

Everything worth adjusting lives in the `CFG` object at the top of `game.js`:

| value | what it does |
| --- | --- |
| `gravity` | how hard the raccoon is pulled down |
| `boostSpeed` | upward speed given by one tap |
| `scrollSpeed` | how fast the pillars come at you |
| `gapHeight` | the opening between the two pillars — the difficulty dial |
| `obstacleSpacing` | horizontal distance between pillars |
| `raccoonRadius` | collision circle; the drawing is deliberately larger |
| `maxGapShift` | how far one gap may move from the previous one |

The usable corridor is `gapHeight - 2 * raccoonRadius`, so raising the collision
radius makes the game harder even though the gap is unchanged.

### Player settings

The settings screen multiplies those defaults, and the running game reads the
derived `cur*` values rather than `CFG` directly.

`GAME SPEED` scales *time*, not just the scroll: velocities by `k`, gravity by
`k²`. The flight path therefore keeps its exact shape at any speed — the same
jump height, the same 2.65 flaps between pillars — and only reaction time gets
harder. Scaling the scroll alone, as an earlier build did, silently squeezed the
gap in time until at 3× there was not one flap left between pillars.

`JUMP HEIGHT` is the separate dial for arc shape: boost scales with its square
root, so the arc grows by exactly that factor without touching the tempo.

`PILLAR HEIGHT` stops at 1.25 for a derived reason. One boost lifts about 65
units, the raccoon is 60 across, so at 1.25 the opening is 136 and the free
corridor 76 — about 1.2 jump arcs, just enough to correct once inside the gap.
Past that the corridor is smaller than a single arc and clearing it is luck.

## Building the Android app

Needs Node.js, Android Studio with its SDK, and JDK 21 — the toolchain does not
accept newer Java versions yet.

```
npx cap sync
cd android && ./gradlew assembleDebug
```

The package lands in `android/app/build/outputs/apk/debug/`. Bump `versionCode`
in `android/app/build.gradle` before distributing a new build, otherwise Android
refuses to install it over the previous one.
