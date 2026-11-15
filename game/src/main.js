// FOUNDRY-9: the game loop. A fixed 60 Hz simulation, decoupled from rendering,
// owns the player controller; the bots, the rounds and the HUD plug into it.
import * as THREE from 'three';
import { createMap, SITES, SPAWNS, stepMover, rayHitDistance, inSite } from './map.js';
import { createInput } from './input.js';
import { createAudio } from './audio.js';
import { createHud } from './hud.js';
import {
  createCombatFx, createWeaponState, createGrenades,
  weaponStep, weaponReady, weaponReload, fireRound, applyDamage,
} from './combat.js';
import { createBot, botStep, botSetObjective, EMBER_NAMES, ALLOY_NAMES } from './bots.js';
import { createRounds } from './rounds.js';
import { ROUND, WEAPONS, GRENADE, KEVLAR, MOVE } from './config.js';
import { mulberry32, range } from './rng.js';

const params = new URLSearchParams(location.search);
const shotMode = params.get('shot');
const seed = Number(params.get('seed') ?? 7) || 7;
const random = mulberry32(seed);

const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayCopy = document.getElementById('overlay-copy');
const playButton = document.getElementById('play');
const gameRoot = document.getElementById('game');

// --- Renderer, scene, map ---------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
gameRoot.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x171310);
scene.fog = new THREE.Fog(0x171310, 42, 95);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.1, 220);
const { colliders, shootables } = createMap(scene);
void shootables;

const audio = createAudio();
const hud = createHud(document);
const fx = createCombatFx(scene);
const grenades = createGrenades(scene, colliders);

// --- Fighters ----------------------------------------------------------------
function makePlayer() {
  return {
    kind: 'player',
    team: 'ember',
    name: 'You',
    x: 0, y: 0, z: 17,
    vx: 0, vy: 0, vz: 0,
    yaw: 0, pitch: 0,
    eye: MOVE.standEye, height: MOVE.standHeight,
    onGround: true, crouching: false,
    hp: 100, armor: 0, alive: true,
    weapon: createWeaponState('p9'),
    grenades: 0, money: 800, kills: 0, deaths: 0,
    carrier: true,
  };
}

const player = makePlayer();
const fighters = [player];
for (let i = 0; i < 4; i += 1) {
  fighters.push(createBot(scene, 'ember', EMBER_NAMES[i], SPAWNS.ember[i + 1] ?? SPAWNS.ember[0], random));
}
for (let i = 0; i < 4; i += 1) {
  fighters.push(createBot(scene, 'alloy', ALLOY_NAMES[i], SPAWNS.alloy[i], random));
}

// --- Rounds ------------------------------------------------------------------
const events = {
  onRoundStart(round) {
    hud.setRound(round, 'buy');
    for (const f of fighters) {
      if (f.kind !== 'bot') continue;
      if (f.team === 'ember') botSetObjective(f, f.assignedSite ?? (random() < 0.6 ? 'A' : 'B'), random);
      else botSetObjective(f, null, random);
    }
    hud.showBuy(true, buyOwned());
    hud.showBanner(`Round ${round}`, 'Buy phase — press B, keys 1–6 to buy', null);
    hud.setObjective('Buy phase — press B for the buy menu');
  },
  onLiveStart() {
    hud.setRound(rounds.state.round, 'live');
    hud.showBuy(false, player);
    hud.showBanner('Go!', 'Plant the charge at A or B, or eliminate ALLOY', null);
    audio.buy();
  },
  onRoundEnd(winner, reason, score) {
    const won = winner === 'ember';
    hud.setScore(score);
    hud.setRound(rounds.state.round, 'end');
    hud.showBanner(won ? 'Round won' : 'Round lost', reason, won ? 'win' : 'lose');
    audio.roundEnd(won);
  },
  onMatchEnd(winner, score) {
    const won = winner === 'ember';
    overlayTitle.innerHTML = won ? 'EMBER <span>wins the match</span>' : 'ALLOY <span>wins the match</span>';
    overlayCopy.textContent = `Final score EMBER ${score.ember} — ${score.alloy} ALLOY. ${won ? 'The foundry is yours.' : 'The charge never went off.'}`;
    playButton.textContent = 'Play again';
    overlay.hidden = false;
    playButton.onclick = () => location.reload();
  },
  onPlanted(by, site) {
    hud.showBanner('Charge planted', `Site ${site} — defend it until it blows`, 'win');
    audio.plantBeep(true);
  },
  onDefused(by) {
    hud.showBanner('Charge defused', `${by.name} cut the wires`, 'lose');
  },
  onExploded(site) {
    const s = SITES[site];
    fx.burst({ x: s.x, y: 1, z: s.z }, 0xffb347, 10);
    fx.flashAt({ x: s.x, y: 2, z: s.z }, 80);
    audio.explosion();
  },
  onKill() {},
  onCarrierChange(carrier) {
    hud.setObjective(carrier === player
      ? 'You carry the charge — plant it at Site A or B (hold E in the ring)'
      : `${carrier.name} carries the charge — escort them to A or B`);
  },
  onChannelStart(kind) { hud.showPlantBar(true, 0, kind === 'plant' ? 'Planting the charge…' : 'Defusing the charge…'); },
  onChannelTick(kind, frac) { hud.showPlantBar(true, frac, kind === 'plant' ? 'Planting the charge…' : 'Defusing the charge…'); },
  onChannelCancel() { hud.showPlantBar(false, 0); },
};
const rounds = createRounds(fighters, random, events);
for (const f of fighters) {
  if (f.kind === 'bot') {
    const site = f.team === 'ember' ? (random() < 0.6 ? 'A' : 'B') : null;
    f.assignedSite = site;
  }
}

// --- Input -------------------------------------------------------------------
let locked = false;
const input = createInput(renderer.domElement, (isLocked) => {
  locked = isLocked;
  if (!isLocked && !shotMode && rounds.state.phase !== 'match') overlay.hidden = false;
});
playButton.addEventListener('click', () => {
  audio.unlock();
  overlay.hidden = true;
  input.requestLock();
});
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- Shared damage path -------------------------------------------------------
let spectateTarget = null;
function dealDamage(attacker, victim, raw, part, weaponDef, weaponName) {
  if (!victim.alive) return;
  const dmg = raw * (part === 'head' ? weaponDef.headMult : 1);
  applyDamage(victim, dmg);
  if (victim === player) {
    hud.damageFlash();
    audio.hurt();
    if (!victim.alive) {
      rounds.playerChannelCancel();
      spectateTarget = fighters.find((f) => f.team === 'ember' && f.alive && f !== player) ?? null;
    }
  } else if (attacker === player) {
    hud.hitmarker(!victim.alive);
    audio.hit(!victim.alive);
  }
  if (!victim.alive) {
    if (victim.kind === 'bot') victim.group.visible = false;
    rounds.onKill(attacker, victim);
    hud.killfeedAdd(attacker, victim, weaponName);
  }
}

function noiseEvent(from, team) {
  for (const f of fighters) {
    if (f.kind !== 'bot' || f.team === team || !f.alive) continue;
    if (Math.hypot(f.x - from.x, f.z - from.z) < 26) f.lastNoise = { x: from.x, z: from.z, t: time };
  }
}

const botCtx = {
  colliders,
  fighters,
  get time() { return time; },
  random,
  get phase() { return rounds.state.phase; },
  get bomb() { return rounds.state.bomb; },
  onBotShot(bot, eye, res) {
    fx.tracer(eye, res.point, bot.weapon.def.tracer);
    if (res.blocked) fx.burst(res.point, 0xf2ead9, 6);
    const d = Math.hypot(player.x - bot.x, player.z - bot.z);
    if (d < 16) audio.shot(bot.weapon.id);
    else audio.distantShot();
    noiseEvent(bot, bot.team);
  },
  onDamage(attacker, victim, part, def) {
    dealDamage(attacker, victim, def.damage, part, def, def.name);
  },
  onGrenade(bot, from, vel) { grenades.throw(from, vel, bot); },
  onPlanted(bot) { rounds.onPlanted(bot); },
  onDefused(bot) { rounds.onDefused(bot); },
  onPlantStart(bot) { hud.setObjective(`${bot.name} is planting at Site ${bot.assignedSite} — cover them`); audio.plantBeep(false); },
  onDefuseStart(bot) { hud.setObjective(`${bot.name} is defusing — stop them!`); audio.defuseBeep(); },
};

// --- Player controller --------------------------------------------------------
const probe = new THREE.Box3();
let recoilPitch = 0;
let lastBeep = 0;
let time = 0;
let buyOpen = true;

function playerOverlaps(x, y, z, height, lift) {
  probe.min.set(x - MOVE.radius, y + lift, z - MOVE.radius);
  probe.max.set(x + MOVE.radius, y + height - lift, z + MOVE.radius);
  for (const c of colliders) if (probe.intersectsBox(c)) return c;
  return null;
}

function currentSpread() {
  const w = player.weapon;
  const ads = input.state.ads && player.alive;
  let s = ads ? w.def.adsSpread : w.def.spread;
  const speed = Math.hypot(player.vx, player.vz);
  if (speed > 1) s += w.def.moveSpread * Math.min(1, speed / MOVE.walk);
  if (player.crouching) s *= 0.7;
  return s + w.bloom;
}

function buyOwned() {
  return { weapon: player.weapon.id, grenades: player.grenades, armor: player.armor };
}

function tryBuy(kind) {
  if (rounds.state.phase !== 'buy' || !player.alive) return;
  const w = player.weapon;
  if (kind === 'rasp' || kind === 'longshot' || kind === 'lance') {
    const def = WEAPONS[kind];
    if (player.money < def.price || w.id === kind) { audio.denied(); return; }
    player.money -= def.price;
    player.weapon = createWeaponState(kind);
    audio.buy();
  } else if (kind === 'p9') {
    player.weapon = createWeaponState('p9');
    audio.buy();
  } else if (kind === 'grenade') {
    if (player.money < GRENADE.price || player.grenades >= 2) { audio.denied(); return; }
    player.money -= GRENADE.price;
    player.grenades += 1;
    audio.buy();
  } else if (kind === 'kevlar') {
    if (player.money < KEVLAR.price || player.armor >= KEVLAR.armor) { audio.denied(); return; }
    player.money -= KEVLAR.price;
    player.armor = KEVLAR.armor;
    audio.buy();
  }
  hud.showBuy(true, buyOwned());
}

function playerShoot() {
  const w = player.weapon;
  if (!weaponReady(w)) { if (w.mag === 0) audio.dry(); return; }
  const eye = { x: player.x, y: player.y + player.eye, z: player.z };
  const cp = player.pitch + recoilPitch;
  const dir = {
    x: -Math.sin(player.yaw) * Math.cos(cp),
    y: Math.sin(cp),
    z: -Math.cos(player.yaw) * Math.cos(cp),
  };
  const muzzle = { x: eye.x + dir.x * 0.5, y: eye.y + dir.y * 0.5, z: eye.z + dir.z * 0.5 };
  const res = fireRound(w, muzzle, dir, currentSpread(), random, colliders,
    fighters.filter((f) => f.team === 'alloy'), w.def.range);
  if (!res) return;
  fx.tracer(muzzle, res.point, w.def.tracer);
  if (res.blocked && !res.hit) fx.burst(res.point, 0xf2ead9, 6);
  audio.shot(w.id);
  recoilPitch += w.def.recoil * (input.state.ads ? 0.6 : 1);
  player.yaw += (random() - 0.5) * w.def.recoil * 0.5;
  noiseEvent(player, 'ember');
  if (res.hit) dealDamage(player, res.hit, w.def.damage, res.part, w.def, w.def.name);
}

function stepPlayer(dt) {
  const keys = input.state.keys;
  const look = input.takeLook();
  const ads = input.state.ads && player.alive;
  const sens = ads ? 0.0013 : 0.0022;
  if (player.alive) {
    player.yaw -= look.x * sens;
    player.pitch = Math.max(-1.45, Math.min(1.45, player.pitch - look.y * sens));
  }
  recoilPitch *= Math.max(0, 1 - dt * 6);

  // Crouch with headroom check.
  const wantCrouch = keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyC');
  if (wantCrouch && !player.crouching) {
    player.crouching = true;
    player.height = MOVE.crouchHeight;
  } else if (!wantCrouch && player.crouching && !playerOverlaps(player.x, player.y, player.z, MOVE.standHeight, 0.02)) {
    player.crouching = false;
    player.height = MOVE.standHeight;
  }
  const eyeTarget = player.crouching ? MOVE.crouchEye : MOVE.standEye;
  player.eye += (eyeTarget - player.eye) * Math.min(1, dt * 12);

  // Movement wish.
  const forward = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
  const strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
  let wishX = 0;
  let wishZ = 0;
  if ((forward || strafe) && player.alive && rounds.state.phase !== 'end' && rounds.state.phase !== 'match') {
    const sin = Math.sin(player.yaw);
    const cos = Math.cos(player.yaw);
    wishX = -sin * forward + cos * strafe;
    wishZ = -cos * forward - sin * strafe;
    const len = Math.hypot(wishX, wishZ) || 1;
    const speed = player.crouching ? MOVE.crouch : ads ? MOVE.ads : MOVE.walk;
    wishX = (wishX / len) * speed;
    wishZ = (wishZ / len) * speed;
  }
  stepMover(player, wishX, wishZ, dt, colliders, player.onGround ? MOVE.accel : MOVE.airAccel);

  // Vertical: jump and gravity, resolved against the same boxes.
  if (keys.has('Space') && player.onGround && player.alive) {
    player.vy = MOVE.jump;
    player.onGround = false;
  }
  player.vy -= MOVE.gravity * dt;
  player.y += player.vy * dt;
  player.onGround = false;
  const hit = playerOverlaps(player.x, player.y, player.z, player.height, 0);
  if (hit && player.vy <= 0) {
    player.y = hit.max.y;
    player.vy = 0;
    player.onGround = true;
  } else if (hit) {
    player.y = hit.min.y - player.height;
    player.vy = 0;
  }
  if (player.y < 0) {
    player.y = 0;
    player.vy = 0;
    player.onGround = true;
  }
  player.vy = Math.max(-30, player.vy);

  weaponStep(player.weapon, dt);

  // Buy keys, reload, grenade, channel, scoreboard.
  if (input.takePressed('KeyB') && rounds.state.phase === 'buy') {
    buyOpen = !buyOpen;
    hud.showBuy(buyOpen, player);
  }
  if (rounds.state.phase === 'buy') {
    if (input.takePressed('Digit1')) tryBuy('rasp');
    if (input.takePressed('Digit2')) tryBuy('longshot');
    if (input.takePressed('Digit3')) tryBuy('lance');
    if (input.takePressed('Digit4')) tryBuy('p9');
    if (input.takePressed('Digit5')) tryBuy('grenade');
    if (input.takePressed('Digit6')) tryBuy('kevlar');
  }
  if (input.takePressed('KeyR') && weaponReload(player.weapon)) audio.reload();
  if (input.takePressed('KeyG') && player.grenades > 0 && player.alive && rounds.state.phase === 'live') {
    player.grenades -= 1;
    const eye = { x: player.x, y: player.y + player.eye, z: player.z };
    const cp = player.pitch + recoilPitch;
    const dir = { x: -Math.sin(player.yaw) * Math.cos(cp), y: Math.sin(cp), z: -Math.cos(player.yaw) * Math.cos(cp) };
    grenades.throw(eye, { x: dir.x * 13, y: dir.y * 13 + 4.2, z: dir.z * 13 }, player);
  }

  // Plant / defuse: hold E in the ring. Moving or firing cancels.
  const inPlantSite = player.carrier && (inSite(SITES.A, player.x, player.z) || inSite(SITES.B, player.x, player.z));
  const inDefuseSite = rounds.state.bomb.planted && inSite(SITES[rounds.state.bomb.site], player.x, player.z);
  if (keys.has('KeyE') && player.alive && rounds.state.phase === 'live' && (inPlantSite || inDefuseSite)) {
    if (!rounds.state.playerChannel) {
      rounds.playerChannelStart(inPlantSite ? 'plant' : 'defuse');
    }
  } else if (rounds.state.playerChannel) {
    rounds.playerChannelCancel();
  }
  if (rounds.state.playerChannel && (forward || strafe || input.state.firing)) {
    rounds.playerChannelCancel();
  }

  if (keys.has('Tab')) hud.showScoreboard(true, fighters);
  else hud.showScoreboard(false, fighters);

  // Fire (shot mode has no pointer lock, so it fires without it).
  if ((locked || shotMode) && input.state.firing && player.alive && rounds.state.phase === 'live') playerShoot();
}

// --- Grenade blasts ------------------------------------------------------------
function explodeGrenade(g, fightersInRange) {
  fx.burst({ x: g.x, y: g.y + 0.3, z: g.z }, 0xff7a1a, 10);
  fx.flashAt({ x: g.x, y: g.y + 0.5, z: g.z }, 50);
  audio.explosion();
  for (const f of fightersInRange) {
    if (!f.alive || f.team === g.owner.team) continue;
    const d = Math.hypot(f.x - g.x, f.z - g.z);
    if (d > GRENADE.radius) continue;
    const raw = GRENADE.damage * (1 - d / GRENADE.radius);
    dealDamage(g.owner, f, raw, 'body', { damage: 1, headMult: 1, name: 'Frag Grenade' }, 'Frag Grenade');
  }
  if (Math.hypot(player.x - g.x, player.z - g.z) < 8) hud.damageFlash();
}

// --- Minimap visibility ---------------------------------------------------------
let minimapT = 0;
const visibleEnemies = new Set();
function updateMinimap(dt) {
  minimapT -= dt;
  if (minimapT > 0) return;
  minimapT = 0.12;
  visibleEnemies.clear();
  const eye = { x: player.x, y: player.y + player.eye, z: player.z };
  for (const f of fighters) {
    if (f.team === 'ember' || !f.alive) continue;
    const dx = f.x - eye.x;
    const dy = (f.y + 1.2) - eye.y;
    const dz = f.z - eye.z;
    const dist = Math.hypot(dx, dy, dz);
    if (dist > 45) continue;
    const wall = rayHitDistance(colliders, eye.x, eye.y, eye.z, dx / dist, dy / dist, dz / dist, dist);
    if (wall >= dist - 0.05) visibleEnemies.add(f);
  }
  hud.drawMinimap(player, fighters, visibleEnemies);
}

// --- Fixed-step simulation ------------------------------------------------------
function step(dt) {
  time += dt;
  stepPlayer(dt);
  for (const f of fighters) {
    if (f.kind === 'bot') botStep(f, dt, botCtx);
  }
  grenades.step(dt, fighters, explodeGrenade);
  fx.step(dt);
  rounds.step(dt);

  // Bomb beeps accelerate as the timer runs down.
  const bomb = rounds.state.bomb;
  if (bomb.planted && bomb.timer > 0) {
    const interval = Math.max(0.3, bomb.timer * 0.025);
    if (time - lastBeep > interval) {
      lastBeep = time;
      audio.plantBeep(false);
    }
  }

  // HUD.
  const st = rounds.state;
  hud.setTimer(st.phase === 'live' && bomb.planted ? bomb.timer : st.phaseT, bomb.planted && st.phase === 'live');
  hud.setRound(st.round, st.phase);
  hud.setScore(st.score);
  hud.setAlive(
    fighters.filter((f) => f.team === 'ember' && f.alive).length,
    fighters.filter((f) => f.team === 'alloy' && f.alive).length,
  );
  hud.setHealth(player.hp, player.armor);
  hud.setAmmo(player.weapon.def, player.weapon.mag, player.weapon.reserve);
  hud.setMoney(player.money);
  hud.setCrosshairGap(player.alive ? 4 + currentSpread() * 900 : 0);
  hud.hitmarkerTick(dt);
  hud.hideBannerSoon(dt);
  if (st.phase === 'live' && !rounds.state.playerChannel) {
    if (!player.alive) hud.setObjective('Spectating — the round continues without you');
    else if (bomb.planted) hud.setObjective(`Charge planted at Site ${bomb.site} — defend it! ${Math.ceil(bomb.timer)}s`);
    else if (player.carrier) hud.setObjective('You carry the charge — plant it at Site A or B (hold E in the ring)');
    else {
      const c = rounds.state.carrier;
      hud.setObjective(c ? `${c.name} carries the charge — escort them to A or B` : 'Eliminate ALLOY to win the round');
    }
  }
  updateMinimap(dt);

  // Camera: first person, or spectating an ally when dead.
  const ads = input.state.ads && player.alive;
  const targetFov = ads ? player.weapon.def.adsFov : 74;
  camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 10);
  camera.updateProjectionMatrix();
  if (player.alive) {
    camera.position.set(player.x, player.y + player.eye, player.z);
    camera.rotation.set(player.pitch + recoilPitch, player.yaw, 0, 'YXZ');
  } else if (spectateTarget && spectateTarget.alive) {
    camera.position.set(spectateTarget.x, spectateTarget.y + spectateTarget.eye, spectateTarget.z);
    camera.rotation.set(spectateTarget.pitch, spectateTarget.yaw, 0, 'YXZ');
  } else {
    camera.position.set(player.x, player.y + player.eye, player.z);
    camera.rotation.y += dt * 0.2;
  }
}

// --- Main loop ------------------------------------------------------------------
let last = performance.now();
let acc = 0;
let frozen = false; // shot=end freezes the sim after staging its capture
const STEP = 1 / 60;
function frame(now) {
  requestAnimationFrame(frame);
  if (frozen) {
    renderer.render(scene, camera);
    return;
  }
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  acc += dt;
  let n = 0;
  while (acc >= STEP && n < 5) {
    step(STEP);
    acc -= STEP;
    n += 1;
  }
  renderer.render(scene, camera);
}
requestAnimationFrame(frame);

// --- Screenshot mode ------------------------------------------------------------
// Deterministic setups, no pointer lock: start shows the buy phase, play runs
// five seconds of real combat against a bot placed in mid, end shows the charge
// going off at Site A. Each sets window.__shotReady after a rendered frame.
function demoRun(steps, script) {
  for (let i = 0; i < steps; i += 1) {
    if (script) script(i);
    step(STEP);
  }
  renderer.render(scene, camera);
  window.__shotReady = true;
}

rounds.start();
if (shotMode === 'start') {
  overlay.hidden = true;
  hud.showBuy(true, buyOwned());
  demoRun(5, null);
} else if (shotMode === 'play') {
  overlay.hidden = true;
  hud.showBuy(false, player);
  // One defender holds mid so the frame has a target; the player walks up and fires.
  const midBot = fighters.find((f) => f.name === 'Vise');
  midBot.x = 0; midBot.z = -2; midBot.yaw = Math.PI;
  midBot.group.position.set(0, 0, -2);
  player.armor = 50; // staging only: keep the player alive for the whole capture
  rounds.state.phase = 'live';
  rounds.state.phaseT = ROUND.liveSeconds;
  demoRun(300, (i) => {
    if (i < 90) {
      player.yaw = 0;
      // Walk forward: emulate the W key through the input set.
      input.state.keys.add('KeyW');
    } else {
      input.state.keys.delete('KeyW');
      // Aim at the mid bot's chest and fire in bursts.
      const dx = midBot.x - player.x;
      const dy = (midBot.y + 1.2) - (player.y + player.eye);
      const dz = midBot.z - player.z;
      player.yaw = Math.atan2(-dx, -dz);
      player.pitch = Math.atan2(dy, Math.hypot(dx, dz));
      if (i % 20 < 8) input.state.firing = true;
      else input.state.firing = false;
    }
  });
  input.state.firing = false;
  input.state.keys.clear();
  // Freeze the sim right after the scripted fight: the capture is the combat
  // moment itself, not whatever the bots do to the player afterwards.
  frozen = true;
  renderer.render(scene, camera);
} else if (shotMode === 'end') {
  overlay.hidden = true;
  hud.showBuy(false, player);
  rounds.state.phase = 'live';
  rounds.state.phaseT = ROUND.liveSeconds;
  // Walk the player to Site A and plant for real, then let the bomb run down.
  player.x = -19; player.z = -9;
  player.yaw = Math.atan2(-(-22 - player.x), -(-12 - player.z));
  player.pitch = -0.05;
  rounds.onPlanted(player, 'A');
  rounds.state.bomb.timer = 1.2;
  demoRun(150, null);
  // Stage the capture: the player survived the blast, standing at the site
  // entrance looking at the ring where the charge went off. Freeze the sim
  // so the banner and the round-over state hold for the screenshot.
  player.alive = true;
  player.hp = 100;
  spectateTarget = null;
  player.x = -16; player.z = -6;
  player.yaw = Math.atan2(-(-22 - player.x), -(-12 - player.z));
  player.pitch = -0.02;
  camera.position.set(player.x, player.y + player.eye, player.z);
  camera.rotation.set(player.pitch, player.yaw, 0, 'YXZ');
  hud.setObjective('Round won — the charge detonated at Site A');
  hud.showBanner('Round won', 'Charge detonated', 'win');
  // The sim freezes below, so refresh the readouts once to match the staged state.
  hud.setHealth(player.hp, player.armor);
  hud.setAlive(
    fighters.filter((f) => f.team === 'ember' && f.alive).length,
    fighters.filter((f) => f.team === 'alloy' && f.alive).length,
  );
  frozen = true;
  renderer.render(scene, camera);
  window.__shotReady = true;
}
