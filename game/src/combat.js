// Combat: one weapon per fighter, shared by the player and the bots. A shot is a ray
// against the world's boxes and every fighter's body/head boxes, so a headshot is a
// real hit on a real box and cover is real cover. Tracers and impact bursts are
// pooled: no new objects in the hot loop.
import * as THREE from 'three';
import { WEAPONS, GRENADE } from './config.js';
import { rayHitDistance } from './map.js';

const TRACER_POOL = 24;
const BURST_POOL = 10;

export function createCombatFx(scene) {
  const tracers = [];
  for (let i = 0; i < TRACER_POOL; i += 1) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const mat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0 });
    const line = new THREE.Line(geo, mat);
    line.frustumCulled = false;
    scene.add(line);
    tracers.push({ line, life: 0 });
  }
  const bursts = [];
  for (let i = 0; i < BURST_POOL; i += 1) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(30), 3));
    const mat = new THREE.PointsMaterial({ color: 0xffb347, size: 0.09, transparent: true, opacity: 0 });
    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    scene.add(points);
    bursts.push({ points, life: 0, vel: new Float32Array(30) });
  }
  const flash = new THREE.PointLight(0xffb347, 0, 9, 2);
  scene.add(flash);
  let tracerIdx = 0;
  let burstIdx = 0;

  return {
    tracer(from, to, color) {
      const t = tracers[tracerIdx];
      tracerIdx = (tracerIdx + 1) % TRACER_POOL;
      const pos = t.line.geometry.attributes.position.array;
      pos[0] = from.x; pos[1] = from.y; pos[2] = from.z;
      pos[3] = to.x; pos[4] = to.y; pos[5] = to.z;
      t.line.geometry.attributes.position.needsUpdate = true;
      t.line.material.color.setHex(color);
      t.line.material.opacity = 0.9;
      t.life = 0.07;
    },
    burst(point, color, count = 8) {
      const b = bursts[burstIdx];
      burstIdx = (burstIdx + 1) % BURST_POOL;
      const pos = b.points.geometry.attributes.position.array;
      for (let i = 0; i < 10; i += 1) {
        const k = i * 3;
        pos[k] = point.x; pos[k + 1] = point.y; pos[k + 2] = point.z;
        b.vel[k] = (Math.random() * 2 - 1) * 2.2;
        b.vel[k + 1] = Math.random() * 2.4 + 0.6;
        b.vel[k + 2] = (Math.random() * 2 - 1) * 2.2;
      }
      b.points.material.color.setHex(color);
      b.points.material.opacity = 1;
      b.life = 0.5;
      void count;
    },
    flashAt(point, intensity) {
      flash.position.set(point.x, point.y, point.z);
      flash.intensity = intensity;
    },
    step(dt) {
      for (const t of tracers) {
        if (t.life > 0) {
          t.life -= dt;
          t.line.material.opacity = Math.max(0, t.life / 0.07) * 0.9;
        }
      }
      for (const b of bursts) {
        if (b.life > 0) {
          b.life -= dt;
          const pos = b.points.geometry.attributes.position.array;
          for (let i = 0; i < 10; i += 1) {
            const k = i * 3;
            pos[k] += b.vel[k] * dt;
            pos[k + 1] += b.vel[k + 1] * dt;
            pos[k + 2] += b.vel[k + 2] * dt;
            b.vel[k + 1] -= 9 * dt;
          }
          b.points.geometry.attributes.position.needsUpdate = true;
          b.points.material.opacity = Math.max(0, b.life / 0.5);
        }
      }
      if (flash.intensity > 0) flash.intensity = Math.max(0, flash.intensity - dt * 60);
    },
  };
}

// Ray vs one fighter's boxes. Returns { dist, part } or null.
export function rayFighter(ox, oy, oz, dx, dy, dz, fighter, maxDist) {
  const { x, y, z } = fighter;
  const head = rayAABB(ox, oy, oz, dx, dy, dz, x - 0.22, y + 1.32, z - 0.22, x + 0.22, y + 1.74, z + 0.22, maxDist);
  const body = rayAABB(ox, oy, oz, dx, dy, dz, x - 0.36, y, z - 0.36, x + 0.36, y + 1.32, z + 0.36, maxDist);
  if (head !== Infinity && head <= body) return { dist: head, part: 'head' };
  if (body !== Infinity) return { dist: body, part: 'body' };
  return null;
}

function rayAABB(ox, oy, oz, dx, dy, dz, minX, minY, minZ, maxX, maxY, maxZ, maxDist) {
  let tmin = 0;
  let tmax = maxDist;
  const mins = [minX, minY, minZ];
  const maxs = [maxX, maxY, maxZ];
  const os = [ox, oy, oz];
  const ds = [dx, dy, dz];
  for (let i = 0; i < 3; i += 1) {
    if (Math.abs(ds[i]) < 1e-9) {
      if (os[i] < mins[i] || os[i] > maxs[i]) return Infinity;
    } else {
      let t1 = (mins[i] - os[i]) / ds[i];
      let t2 = (maxs[i] - os[i]) / ds[i];
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return Infinity;
    }
  }
  return tmin;
}

// A fighter's weapon: magazine, reserve, cooldown, reload and bloom. One instance
// per fighter; the player and the bots drive the same code.
export function createWeaponState(weaponId) {
  const def = WEAPONS[weaponId];
  return {
    id: weaponId,
    def,
    mag: def.mag,
    reserve: def.reserve,
    cooldown: 0,
    reloadT: 0,
    bloom: 0,
  };
}

export function weaponStep(w, dt) {
  if (w.cooldown > 0) w.cooldown -= dt;
  if (w.reloadT > 0) {
    w.reloadT -= dt;
    if (w.reloadT <= 0) {
      const need = w.def.mag - w.mag;
      const take = Math.min(need, w.reserve);
      w.mag += take;
      w.reserve -= take;
    }
  }
  w.bloom = Math.max(0, w.bloom - dt * 0.045);
}

export function weaponReady(w) {
  return w.cooldown <= 0 && w.reloadT <= 0 && w.mag > 0;
}

export function weaponReload(w) {
  if (w.reloadT > 0 || w.mag >= w.def.mag || w.reserve <= 0) return false;
  w.reloadT = 1.6;
  return true;
}

// Fire one round. `fighters` are the possible targets (excluding the shooter).
// Returns { hit: fighter|null, part, point, blocked }.
export function fireRound(w, origin, dir, spread, random, colliders, fighters, maxDist) {
  if (!weaponReady(w)) return null;
  w.mag -= 1;
  w.cooldown = w.def.interval;
  w.bloom = Math.min(0.05, w.bloom + (w.id === 'lance' ? 0.02 : 0.008));
  const dx = dir.x + (random() * 2 - 1) * spread;
  const dy = dir.y + (random() * 2 - 1) * spread;
  const dz = dir.z + (random() * 2 - 1) * spread;
  const len = Math.hypot(dx, dy, dz) || 1;
  const nd = { x: dx / len, y: dy / len, z: dz / len };
  const wallDist = rayHitDistance(colliders, origin.x, origin.y, origin.z, nd.x, nd.y, nd.z, maxDist);
  let best = null;
  let bestDist = Math.min(wallDist, maxDist);
  for (const f of fighters) {
    if (!f.alive) continue;
    const hit = rayFighter(origin.x, origin.y, origin.z, nd.x, nd.y, nd.z, f, bestDist);
    if (hit && hit.dist < bestDist) {
      bestDist = hit.dist;
      best = { fighter: f, part: hit.part };
    }
  }
  const point = {
    x: origin.x + nd.x * bestDist,
    y: origin.y + nd.y * bestDist,
    z: origin.z + nd.z * bestDist,
  };
  return { hit: best ? best.fighter : null, part: best ? best.part : null, point, blocked: bestDist < maxDist, dir: nd };
}

// Damage after armour: armour absorbs half until it is gone.
export function applyDamage(fighter, raw) {
  let left = raw;
  if (fighter.armor > 0) {
    const absorbed = Math.min(fighter.armor, left * 0.5);
    fighter.armor -= absorbed;
    left -= absorbed;
  }
  fighter.hp -= left;
  if (fighter.hp <= 0) {
    fighter.hp = 0;
    fighter.alive = false;
  }
  return left;
}

// A thrown frag grenade: ballistic flight, one bounce, then a radius blast.
export function createGrenades(scene, colliders) {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.09, 10, 8),
    new THREE.MeshStandardMaterial({ color: 0x2a2a22, roughness: 0.4, metalness: 0.6 }),
  );
  mesh.visible = false;
  scene.add(mesh);
  const blastLight = new THREE.PointLight(0xffb347, 0, 14, 1.6);
  scene.add(blastLight);
  const active = [];
  return {
    throw(from, vel, owner) {
      active.push({ x: from.x, y: from.y, z: from.z, vx: vel.x, vy: vel.y, vz: vel.z, fuse: GRENADE.fuse, owner });
    },
    step(dt, fighters, onExplode) {
      mesh.visible = active.length > 0;
      if (active.length) {
        const g = active[0];
        mesh.position.set(g.x, g.y, g.z);
      }
      for (let i = active.length - 1; i >= 0; i -= 1) {
        const g = active[i];
        g.fuse -= dt;
        g.vy -= 14 * dt;
        g.x += g.vx * dt;
        g.y += g.vy * dt;
        g.z += g.vz * dt;
        if (g.y < 0.09) { g.y = 0.09; g.vy = Math.abs(g.vy) * 0.35; g.vx *= 0.6; g.vz *= 0.6; }
        if (g.fuse <= 0) {
          active.splice(i, 1);
          blastLight.position.set(g.x, g.y + 0.4, g.z);
          blastLight.intensity = 60;
          onExplode(g, fighters);
        }
      }
      if (blastLight.intensity > 0) blastLight.intensity = Math.max(0, blastLight.intensity - dt * 120);
    },
  };
}
