// FOUNDRY-9: a dusk foundry yard, 60 x 40 m, built from boxes. Two bomb sites (A west,
// B east) behind the furnace, three lanes (west, mid, east) and two cross corridors.
// Every box is a collider for movement and a surface a bullet stops on. The waypoint
// graph is what the bots walk: nodes at every junction, edges between neighbours.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

// [centerX, centerZ, width, depth, height, material]
const BOXES = [
  // Floor and perimeter (floor is not a wall: it is the ground the feet stand on).
  [0, 0, 62, 42, 0.4, 'canvas'],
  [-30.5, 0, 1, 42, 4.6, 'surface'],
  [30.5, 0, 1, 42, 4.6, 'surface'],
  [0, -20.5, 62, 1, 4.6, 'surface'],
  [0, 20.5, 62, 1, 4.6, 'surface'],
  // The furnace: the map's heart, a hot block with a molten slit on its south face.
  [0, 0, 9, 6, 4.4, 'furnace'],
  [0, 3.05, 5, 0.3, 0.7, 'molten'],
  // Mid walls that turn the furnace's flanks into corners worth holding.
  [-9.5, -6, 1, 8, 3.2, 'surface'],
  [9.5, -6, 1, 8, 3.2, 'surface'],
  [-9.5, 8, 1, 6, 2.6, 'hairline'],
  [9.5, 8, 1, 6, 2.6, 'hairline'],
  // South connector stubs: gaps at the centre and at both edges.
  [-17, 8, 7, 1, 2.6, 'hairline'],
  [17, 8, 7, 1, 2.6, 'hairline'],
  // Site cover: a rust container at A, a teal one at B, each with a low crate beside it.
  [-24, -8, 4.5, 2.2, 2.6, 'rust'],
  [-19, -14, 2, 2, 1.1, 'crate'],
  [24, -8, 4.5, 2.2, 2.6, 'tealbox'],
  [19, -14, 2, 2, 1.1, 'crate'],
  // Lane crates: crouch cover at the lane edges, never on the lane centreline
  // (a bot walking the centreline must not meet a crate head-on).
  [-20.5, -2, 2, 2, 1.1, 'crate'],
  [-20.5, 6, 2, 2, 1.1, 'crate'],
  [20.5, -2, 2, 2, 1.1, 'crate'],
  [20.5, 6, 2, 2, 1.1, 'crate'],
  [-5, 13, 2.4, 1.4, 0.9, 'crate'],
  [5, 13, 2.4, 1.4, 0.9, 'crate'],
  [-13, -13, 2, 2, 1.1, 'crate'],
  [13, -13, 2, 2, 1.1, 'crate'],
  [-26, 4, 2, 2, 1.1, 'crate'],
  [26, 4, 2, 2, 1.1, 'crate'],
  // Pillars that break the long sightlines.
  [-8, -14, 1.2, 1.2, 4.2, 'steel'],
  [8, -14, 1.2, 1.2, 4.2, 'steel'],
  [-8, 14, 1.2, 1.2, 4.2, 'steel'],
  [8, 14, 1.2, 1.2, 4.2, 'steel'],
  // Low site walls: defenders can crouch behind them, attackers must clear them.
  [-22, -16.5, 8, 1, 1.2, 'hairline'],
  [22, -16.5, 8, 1, 1.2, 'hairline'],
];

export const SITES = {
  A: { x: -22, z: -12, radius: 4.5 },
  B: { x: 22, z: -12, radius: 4.5 },
};

export const SPAWNS = {
  ember: [[-5, 17], [-2, 18], [0, 16.5], [2, 18], [5, 17]],
  alloy: [[-5, -17], [-2, -18], [0, -16.5], [2, -18], [5, -17]],
};

// Waypoint graph: id -> [x, z], edges by id. Bots walk edges; attackers pick a site
// and a lane, defenders fan out to site entrances and mid holds.
export const WAYPOINTS = {
  spawnE: [0, 17], south: [0, 11], westS: [-18, 11], eastS: [18, 11],
  westM: [-18, 2], eastM: [18, 2], midW: [-6.5, 0], midE: [6.5, 0],
  westC: [-13, -6], eastC: [13, -6], midN: [0, -8],
  westN: [-18, -10], eastN: [18, -10],
  siteA: [-22, -12], siteB: [22, -12], defN: [0, -17],
};
export const EDGES = {
  spawnE: ['south', 'westS', 'eastS'],
  south: ['spawnE', 'westS', 'eastS', 'midW', 'midE'],
  westS: ['spawnE', 'south', 'westM'],
  eastS: ['spawnE', 'south', 'eastM'],
  westM: ['westS', 'westC', 'westN'],
  eastM: ['eastS', 'eastC', 'eastN'],
  midW: ['south', 'midN', 'westC'],
  midE: ['south', 'midN', 'eastC'],
  westC: ['westM', 'midW', 'westN'],
  eastC: ['eastM', 'midE', 'eastN'],
  midN: ['midW', 'midE', 'westN', 'eastN', 'defN'],
  westN: ['westM', 'westC', 'midN', 'siteA'],
  eastN: ['eastM', 'eastC', 'midN', 'siteB'],
  siteA: ['westN'],
  siteB: ['eastN'],
  defN: ['midN', 'westN', 'eastN'],
};

// Breadth-first route over the graph; returns an array of waypoint ids.
export function route(fromId, toId) {
  if (fromId === toId) return [toId];
  const prev = { [fromId]: null };
  const queue = [fromId];
  while (queue.length) {
    const cur = queue.shift();
    for (const next of EDGES[cur] ?? []) {
      if (prev[next] !== undefined) continue;
      prev[next] = cur;
      if (next === toId) {
        const path = [toId];
        let node = cur;
        while (node) { path.unshift(node); node = prev[node]; }
        return path;
      }
      queue.push(next);
    }
  }
  return [toId];
}

export function nearestWaypoint(x, z) {
  let best = null;
  let bestD = Infinity;
  for (const [id, [wx, wz]] of Object.entries(WAYPOINTS)) {
    const d = (wx - x) ** 2 + (wz - z) ** 2;
    if (d < bestD) { bestD = d; best = id; }
  }
  return best;
}

export function createMap(scene) {
  const group = new THREE.Group();
  scene.add(group);
  const materials = {};
  for (const name of Object.keys(PALETTE)) {
    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE[name]),
      roughness: name === 'molten' || name === 'accent' ? 0.5 : 0.92,
      metalness: name === 'steel' ? 0.55 : 0.05,
      emissive: name === 'molten' ? new THREE.Color(PALETTE.molten) : new THREE.Color(0x000000),
      emissiveIntensity: name === 'molten' ? 1.6 : 0,
    });
    materials[name] = mat;
  }

  const colliders = [];
  const shootables = [];
  function box(cx, cz, w, d, h, material) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), materials[material]);
    mesh.position.set(cx, h / 2 - (material === 'canvas' ? 0.2 : 0), cz);
    if (material === 'canvas') mesh.position.y = -0.2;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    const b = new THREE.Box3().setFromObject(mesh);
    if (material !== 'canvas') {
      colliders.push(b);
      shootables.push(mesh);
    }
    return mesh;
  }
  for (const [cx, cz, w, d, h, material] of BOXES) box(cx, cz, w, d, h, material);

  // Site markers: glowing rings on the floor so the objective reads at a glance.
  const siteMeshes = {};
  for (const [key, site] of Object.entries(SITES)) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(site.radius - 0.35, site.radius, 40),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.55, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(site.x, 0.03, site.z);
    group.add(ring);
    siteMeshes[key] = ring;
    const letter = new THREE.Mesh(
      new THREE.BoxGeometry(1.6, 2.4, 0.3),
      new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), emissive: new THREE.Color(PALETTE.accent), emissiveIntensity: 0.7 }),
    );
    letter.position.set(site.x, 1.2, site.z - site.radius - 0.8);
    group.add(letter);
  }

  // Light: low dusk sun from the south-west, cool fill from the north, warm sky.
  const sky = new THREE.HemisphereLight(new THREE.Color(0x8a6a4a), new THREE.Color(PALETTE.canvas), 1.0);
  scene.add(sky);
  const key = new THREE.DirectionalLight(new THREE.Color(0xffd9a0), 2.4);
  key.position.set(-18, 22, 16);
  key.target.position.set(0, 0, -4);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -34;
  key.shadow.camera.right = 34;
  key.shadow.camera.top = 26;
  key.shadow.camera.bottom = -26;
  key.shadow.camera.far = 70;
  key.shadow.bias = -0.0008;
  scene.add(key, key.target);
  const fill = new THREE.DirectionalLight(new THREE.Color(0x7fb4c7), 0.5);
  fill.position.set(10, 12, -18);
  scene.add(fill);
  // Molten glow from the furnace mouth.
  const glow = new THREE.PointLight(new THREE.Color(PALETTE.molten), 18, 16, 1.8);
  glow.position.set(0, 1.6, 4.2);
  scene.add(glow);

  return { colliders, shootables, group, siteMeshes, glow };
}

// Slab ray vs a list of AABBs: returns the distance to the first hit, or Infinity.
export function rayHitDistance(colliders, ox, oy, oz, dx, dy, dz, maxDist) {
  let best = Infinity;
  for (const b of colliders) {
    const t = rayBox(ox, oy, oz, dx, dy, dz, b, maxDist);
    if (t < best) best = t;
  }
  return best;
}

function rayBox(ox, oy, oz, dx, dy, dz, b, maxDist) {
  let tmin = 0;
  let tmax = maxDist;
  const mins = [b.min.x, b.min.y, b.min.z];
  const maxs = [b.max.x, b.max.y, b.max.z];
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

export function inSite(site, x, z) {
  const dx = x - site.x;
  const dz = z - site.z;
  return dx * dx + dz * dz <= site.radius * site.radius;
}

// Shared horizontal mover: the player and the bots resolve against the same
// colliders, one axis at a time, so a wall never swallows either of them.
// `wishX/wishZ` are target velocities in m/s; the body carries vx/vz.
const MOVER_RADIUS = 0.34;
const _probe = new THREE.Box3();
export function stepMover(body, wishX, wishZ, dt, colliders, accel = 30) {
  const blend = Math.min(1, accel * dt);
  body.vx += (wishX - body.vx) * blend;
  body.vz += (wishZ - body.vz) * blend;
  if (!wishX && !wishZ) {
    const damp = Math.max(0, 1 - 9 * dt);
    body.vx *= damp;
    body.vz *= damp;
  }
  const h = body.height || 1.72;
  const nextX = body.x + body.vx * dt;
  if (!moverOverlaps(nextX, body.y, body.z, h, colliders)) body.x = nextX;
  else body.vx = 0;
  const nextZ = body.z + body.vz * dt;
  if (!moverOverlaps(body.x, body.y, nextZ, h, colliders)) body.z = nextZ;
  else body.vz = 0;
}

function moverOverlaps(x, y, z, height, colliders) {
  _probe.min.set(x - MOVER_RADIUS, y + 0.04, z - MOVER_RADIUS);
  _probe.max.set(x + MOVER_RADIUS, y + height - 0.04, z + MOVER_RADIUS);
  for (const c of colliders) if (_probe.intersectsBox(c)) return true;
  return false;
}
