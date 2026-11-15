// Bots: one mesh and one brain each. The brain is deliberately simple and legible —
// perceive, react, burst-fire, strafe — because a bot that reads the map and holds
// angles beats a bot with a cleverer plan that never fires straight.
import * as THREE from 'three';
import { WEAPONS, GRENADE } from './config.js';
import { WAYPOINTS, route, nearestWaypoint, rayHitDistance, inSite, SITES } from './map.js';
import { createWeaponState, weaponStep, weaponReady, weaponReload, fireRound, applyDamage } from './combat.js';
import { stepMover } from './map.js';
import { pick, range } from './rng.js';

export const EMBER_NAMES = ['Ash', 'Cinder', 'Flint', 'Slag'];
export const ALLOY_NAMES = ['Vise', 'Anvil', 'Rivet', 'Bolt'];

const TEAM_COLOR = { ember: 0xff7a1a, alloy: 0x2ec4b6 };
const HOLD_POINTS = {
  alloy: ['siteA', 'siteB', 'midN', 'westC', 'eastC'],
  ember: ['westM', 'eastM', 'midW', 'midE'],
};

export function createBot(scene, team, name, spawn, random) {
  const color = TEAM_COLOR[team];
  const group = new THREE.Group();
  const torsoMat = new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.1 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x23211e, roughness: 0.85 });
  const visorMat = new THREE.MeshStandardMaterial({ color: 0xf2ead9, roughness: 0.3, emissive: 0x222222 });

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.95, 0.38), torsoMat);
  torso.position.y = 0.95;
  torso.castShadow = true;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.36, 0.36), darkMat);
  head.position.y = 1.6;
  head.castShadow = true;
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.08, 0.05), visorMat);
  visor.position.set(0, 1.62, -0.19);
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.5, 0.3), darkMat);
  legL.position.set(-0.18, 0.25, 0);
  const legR = legL.clone();
  legR.position.x = 0.18;
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.12, 0.85), darkMat);
  gun.position.set(0.28, 1.15, -0.45);
  group.add(torso, head, visor, legL, legR, gun);
  group.position.set(spawn[0], 0, spawn[1]);
  scene.add(group);

  const skill = {
    reaction: range(random, 0.38, 0.62),
    aimErr: range(random, 0.012, 0.028),
    burstMin: 3,
    burstMax: 6,
    pauseMin: 0.45,
    pauseMax: 0.95,
  };

  const bot = {
    kind: 'bot',
    team,
    name,
    x: spawn[0], y: 0, z: spawn[1],
    vx: 0, vz: 0, yaw: team === 'ember' ? 0 : Math.PI, pitch: 0,
    height: 1.72, eye: 1.6,
    hp: 100, armor: 0, alive: true,
    weapon: createWeaponState('longshot'),
    grenades: 1,
    money: 800, kills: 0, deaths: 0,
    skill, group,
    state: 'route',
    path: [], pathIdx: 0,
    holdUntil: 0, holdYaw: 0,
    target: null, seenAt: -10, reactionAt: 0,
    aimYaw: 0, aimPitch: 0,
    burstLeft: 0, burstPause: 0,
    strafeDir: 1, strafeT: 0,
    channelT: 0, channelKind: null,
    carrier: false,
    assignedSite: null,
    holdPoint: null,
    grenadeUsed: false,
    lastNoise: null,
    stuckT: 0, sidestepT: 0, sidestepDir: 1,
    walkPhase: random() * Math.PI * 2,
  };
  bot.aimYaw = bot.yaw;
  return bot;
}

export function botSetObjective(bot, site, random) {
  bot.assignedSite = site;
  if (bot.team === 'alloy') {
    bot.holdPoint = pick(random, HOLD_POINTS.alloy);
    bot.path = route(nearestWaypoint(bot.x, bot.z), bot.holdPoint);
  } else {
    const entry = site === 'A' ? 'westN' : 'eastN';
    bot.path = route(nearestWaypoint(bot.x, bot.z), entry);
  }
  bot.pathIdx = 0;
  bot.state = 'route';
}

function botEye(bot) {
  return { x: bot.x, y: bot.y + bot.eye, z: bot.z };
}

function canSee(bot, enemy, colliders) {
  const dx = enemy.x - bot.x;
  const dz = enemy.z - bot.z;
  const dist = Math.hypot(dx, dz);
  if (dist > 58) return null;
  const eye = botEye(bot);
  const tx = enemy.x;
  const ty = enemy.y + 1.2;
  const tz = enemy.z;
  const len = Math.hypot(tx - eye.x, ty - eye.y, tz - eye.z);
  const dir = { x: (tx - eye.x) / len, y: (ty - eye.y) / len, z: (tz - eye.z) / len };
  const wall = rayHitDistance(colliders, eye.x, eye.y, eye.z, dir.x, dir.y, dir.z, len);
  if (wall < len - 0.05) return null;
  // Facing cone: bots notice what is in front of them, or anything very close.
  const facingX = -Math.sin(bot.yaw);
  const facingZ = -Math.cos(bot.yaw);
  const dot = (dx * facingX + dz * facingZ) / (dist || 1);
  if (dist > 7 && dot < 0.15) return null;
  return { dist, dir, chest: { x: tx, y: ty, z: tz } };
}

export function botStep(bot, dt, ctx) {
  if (!bot.alive) { syncMesh(bot); return; }
  const { colliders, fighters, time, random, phase, bomb } = ctx;
  weaponStep(bot.weapon, dt);

  // --- Perception: nearest visible enemy. Only during the live phase: nobody
  // shoots during buy time, so the round always starts 5v5.
  let best = null;
  let bestDist = Infinity;
  if (phase === 'live') {
    for (const f of fighters) {
      if (f === bot || f.team === bot.team || !f.alive) continue;
      const seen = canSee(bot, f, colliders);
      if (seen && seen.dist < bestDist) { bestDist = seen.dist; best = { fighter: f, seen }; }
    }
  }
  if (best) {
    if (bot.target !== best.fighter) {
      bot.target = best.fighter;
      bot.reactionAt = time + bot.skill.reaction;
      bot.burstLeft = 0;
      bot.burstPause = 0;
    }
    bot.seenAt = time;
    bot.lastSeen = { x: best.fighter.x, y: best.fighter.y, z: best.fighter.z };
  } else if (bot.target && time - bot.seenAt > 1.6) {
    bot.target = null;
  }

  const engaging = bot.target && time >= bot.reactionAt;
  let wishX = 0;
  let wishZ = 0;
  let speed = 4.6;

  // --- Plant / defuse channels interrupt everything else. ---
  if (bot.channelKind) {
    bot.channelT -= dt;
    if (bot.channelT <= 0) {
      const kind = bot.channelKind;
      bot.channelKind = null;
      if (kind === 'plant') ctx.onPlanted(bot);
      else ctx.onDefused(bot);
    }
    syncMesh(bot);
    return;
  }

  if (engaging) {
    const t = bot.target;
    // Aim at the chest, sometimes the head, with skill error.
    const headShot = random() < 0.22;
    const aimY = t.y + (headShot ? 1.55 : 1.15);
    const dx = t.x - bot.x;
    const dy = aimY - (bot.y + bot.eye);
    const dz = t.z - bot.z;
    const dist = Math.hypot(dx, dy, dz) || 1;
    const wantYaw = Math.atan2(-dx, -dz);
    const wantPitch = Math.asin(Math.max(-1, Math.min(1, dy / dist)));
    const err = bot.skill.aimErr * (1 + dist / 40);
    bot.aimYaw = wantYaw + (random() * 2 - 1) * err;
    bot.aimPitch = wantPitch + (random() * 2 - 1) * err;
    bot.yaw = bot.aimYaw;
    bot.pitch = bot.aimPitch;
    // Strafe: sidestep while firing, flip direction every second or so.
    bot.strafeT -= dt;
    if (bot.strafeT <= 0) { bot.strafeDir = random() < 0.5 ? -1 : 1; bot.strafeT = range(random, 0.6, 1.4); }
    const sx = Math.cos(bot.yaw) * bot.strafeDir;
    const sz = -Math.sin(bot.yaw) * bot.strafeDir;
    wishX = sx;
    wishZ = sz;
    speed = 2.6;
    // Burst fire.
    if (bot.burstPause > 0) bot.burstPause -= dt;
    else if (bot.burstLeft > 0) {
      if (weaponReady(bot.weapon)) {
        const eye = botEye(bot);
        const spread = bot.weapon.def.spread + bot.weapon.bloom;
        const dir = {
          x: -Math.sin(bot.aimYaw) * Math.cos(bot.aimPitch),
          y: Math.sin(bot.aimPitch),
          z: -Math.cos(bot.aimYaw) * Math.cos(bot.aimPitch),
        };
        const res = fireRound(bot.weapon, eye, dir, spread, random, colliders, fighters.filter((f) => f !== bot && f.team !== bot.team), bot.weapon.def.range);
        if (res) {
          ctx.onBotShot(bot, eye, res);
          if (res.hit) ctx.onDamage(bot, res.hit, res.part, bot.weapon.def);
          bot.burstLeft -= 1;
          if (bot.burstLeft <= 0) bot.burstPause = range(random, bot.skill.pauseMin, bot.skill.pauseMax);
        }
      }
    } else {
      bot.burstLeft = Math.floor(range(random, bot.skill.burstMin, bot.skill.burstMax + 1));
    }
    if (bot.weapon.mag === 0) weaponReload(bot.weapon);
    // Frag: lob one at a distant, visible enemy.
    if (!bot.grenadeUsed && bot.grenades > 0 && bestDist > 10 && random() < dt * 0.12) {
      bot.grenades -= 1;
      bot.grenadeUsed = true;
      const eye = botEye(bot);
      const to = { x: t.x - eye.x, y: 0, z: t.z - eye.z };
      const d = Math.hypot(to.x, to.z) || 1;
      const vel = { x: (to.x / d) * d * 0.55, y: 4.6, z: (to.z / d) * d * 0.55 };
      ctx.onGrenade(bot, eye, vel);
    }
  } else if (phase === 'live') {
    // --- Objective movement. ---
    const planted = bomb.planted;
    if (bot.team === 'alloy' && planted) {
      // Retake: everyone converges on the planted site.
      const dest = bomb.site;
      if (inSite(SITES[dest], bot.x, bot.z) && !bot.target) {
        bot.channelKind = 'defuse';
        bot.channelT = 3.5 + 1.5; // defuse takes 5s; the first 1.5s is the approach settle
        ctx.onDefuseStart(bot);
      } else {
        const w = followPath(bot, dest === 'A' ? 'siteA' : 'siteB', ctx);
        wishX = w.x; wishZ = w.z; speed = w.speed;
      }
    } else if (bot.team === 'ember' && bot.carrier && !planted) {
      const site = bot.assignedSite;
      if (inSite(SITES[site], bot.x, bot.z)) {
        bot.channelKind = 'plant';
        bot.channelT = 3.5;
        ctx.onPlantStart(bot);
      } else {
        const w = followPath(bot, site === 'A' ? 'siteA' : 'siteB', ctx);
        wishX = w.x; wishZ = w.z; speed = w.speed;
      }
    } else if (bot.state === 'route' && bot.path.length) {
      const w = followPath(bot, null, ctx);
      wishX = w.x; wishZ = w.z; speed = w.speed;
    } else {
      // Hold: stand, scan slowly, and listen. Noise pulls the bot to investigate.
      bot.holdUntil -= dt;
      const noise = bot.lastNoise;
      if (noise && time - noise.t < 6 && Math.hypot(noise.x - bot.x, noise.z - bot.z) < 26) {
        const dest = nearestWaypoint(noise.x, noise.z);
        bot.path = route(nearestWaypoint(bot.x, bot.z), dest);
        bot.pathIdx = 0;
        bot.state = 'route';
        bot.lastNoise = null;
      } else if (bot.holdUntil <= 0) {
        bot.holdYaw = range(random, -Math.PI, Math.PI);
        bot.holdUntil = range(random, 1.5, 3.5);
        if (bot.team === 'alloy' && random() < 0.4) {
          bot.holdPoint = pick(random, HOLD_POINTS.alloy);
          bot.path = route(nearestWaypoint(bot.x, bot.z), bot.holdPoint);
          bot.pathIdx = 0;
          bot.state = 'route';
        }
      }
      bot.yaw += (bot.holdYaw - bot.yaw) * Math.min(1, dt * 1.5);
    }
  }

  // Apply movement through the shared collider solver. A bot that wants to move
  // but barely does for a full second is pressing against a corner: sidestep
  // around it instead of pushing forever.
  if (bot.sidestepT > 0 && (wishX || wishZ)) {
    bot.sidestepT -= dt;
    const nx = -wishZ * bot.sidestepDir;
    const nz = wishX * bot.sidestepDir;
    wishX = nx;
    wishZ = nz;
  }
  const prevX = bot.x;
  const prevZ = bot.z;
  if (wishX || wishZ) {
    const len = Math.hypot(wishX, wishZ) || 1;
    stepMover(bot, (wishX / len) * speed, (wishZ / len) * speed, dt, colliders);
  } else {
    stepMover(bot, 0, 0, dt, colliders);
  }
  const moved = Math.hypot(bot.x - prevX, bot.z - prevZ);
  if ((wishX || wishZ) && moved < 0.015) bot.stuckT = (bot.stuckT || 0) + dt;
  else bot.stuckT = 0;
  if (bot.stuckT > 1.0) {
    bot.stuckT = 0;
    bot.sidestepT = 0.9;
    bot.sidestepDir = random() < 0.5 ? -1 : 1;
  }
  syncMesh(bot);
}

function followPath(bot, destId, ctx) {
  if (destId) {
    const cur = nearestWaypoint(bot.x, bot.z);
    if (bot.path.length === 0 || bot.path[bot.path.length - 1] !== destId) {
      bot.path = route(cur, destId);
      bot.pathIdx = 0;
    }
  }
  const targetId = bot.path[bot.pathIdx];
  if (!targetId) { bot.state = 'hold'; bot.holdUntil = 2; return { x: 0, z: 0, speed: 0 }; }
  const [tx, tz] = WAYPOINTS[targetId];
  const dx = tx - bot.x;
  const dz = tz - bot.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 0.9) {
    bot.pathIdx += 1;
    if (bot.pathIdx >= bot.path.length) { bot.state = 'hold'; bot.holdUntil = 2; }
    return { x: 0, z: 0, speed: 0 };
  }
  const wantYaw = Math.atan2(-dx, -dz);
  let diff = wantYaw - bot.yaw;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  bot.yaw += diff * Math.min(1, 8 * 0.016);
  return { x: dx / dist, z: dz / dist, speed: 4.6 };
}

function syncMesh(bot) {
  bot.group.position.set(bot.x, bot.y, bot.z);
  bot.group.rotation.y = bot.yaw;
  bot.group.visible = bot.alive;
}

export function botDamage(bot, raw, part, weaponDef) {
  const dmg = raw * (part === 'head' ? weaponDef.headMult : 1);
  return applyDamage(bot, dmg);
}
