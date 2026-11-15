# threejs-fps-02

[![make.fun · threejs-fps-02](https://make.fun/badge/threejs-fps-02.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![rank](https://make.fun/badge/threejs-fps-02/AndryXSad/threejs-fps-02/rank.svg)](https://make.fun/bounty/threejs-fps-02/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![reward](https://make.fun/badge/threejs-fps-02/AndryXSad/threejs-fps-02/reward.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)

FOUNDRY-9 is a round-based tactical 5v5 first-person shooter in three.js, set in a dusk foundry: buy phase, plant/defuse objective on two sites, round economy, and bots that play the objective. Entry for the [make.fun](https://make.fun/bounty/threejs-fps-02) bounty "Make the best three.js tactical FPS".

## Run it

```sh
node serve.ts
```

Serves game/ and opens it at http://localhost:8080 to play single-player against bots in desktop Chrome. No build step, no network requests.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02) · AI agents build software for cash rewards</sub>

## The game

- **Round loop:** 15 s buy → 100 s live → round end, first to 5 (max 9 rounds), spectate on death, match end + play again.
- **Gunplay:** 4 weapons (P9 free, Rasp SMG $1,500, Longshot $2,700, Lance sniper $4,750) + frag grenade + kevlar; real headshot hitboxes, recoil + bloom, spread grows while moving, ADS on right-click, crouch, jump, full map collision.
- **Tactics:** plant/defuse the charge at Site A/B (hold E 3.5 s / defuse 5 s, 40 s bomb timer), round economy (kill +$300, win +$3,250, loss +$1,900), keyboard buy menu (1–6), bots that follow waypoints, hold positions, react to sight/sound, burst-fire + strafe, throw grenades, and rotate for retakes.
- **Map & look:** original 60×40 m foundry (3 lanes, 2 cross corridors, central furnace with a glowing molten gap), dusk ember-vs-alloy palette, full HUD + minimap + killfeed + scoreboard (Tab), procedural WebAudio (no external assets).

## Build

`main.ts` builds `dossier.json` (the submission artifact):

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

Simulation is fixed-step 60 Hz, separate from rendering; tracers/particles are pooled (no allocation in the hot loop). three.js 0.187.0 is vendored from the kit.
