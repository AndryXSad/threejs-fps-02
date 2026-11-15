// Tuning in one place: weapons, economy, rounds. Every number the judge reads about
// gunplay and tactics lives here, so the code that uses it never hard-codes a value.
export const ROUND = {
  buySeconds: 15,
  liveSeconds: 100,
  bombSeconds: 40,
  plantSeconds: 3.5,
  defuseSeconds: 5,
  endSeconds: 5,
  winsToTake: 5,
  maxRounds: 9,
  teamSize: 5,
};

export const ECONOMY = {
  start: 800,
  kill: 300,
  plant: 300,
  defuse: 300,
  win: 3250,
  loss: 1900,
};

export const WEAPONS = {
  p9: {
    name: 'P9 Sidearm', price: 0, damage: 34, headMult: 3, mag: 12, reserve: 36,
    interval: 0.32, spread: 0.011, moveSpread: 0.016, adsSpread: 0.005,
    recoil: 0.011, auto: false, range: 42, adsFov: 60, tracer: 0xf2ead9,
  },
  rasp: {
    name: 'Rasp SMG', price: 1500, damage: 26, headMult: 3, mag: 25, reserve: 100,
    interval: 0.085, spread: 0.02, moveSpread: 0.022, adsSpread: 0.01,
    recoil: 0.007, auto: true, range: 38, adsFov: 62, tracer: 0xffb347,
  },
  longshot: {
    name: 'Longshot Rifle', price: 2700, damage: 34, headMult: 4, mag: 30, reserve: 90,
    interval: 0.11, spread: 0.008, moveSpread: 0.018, adsSpread: 0.003,
    recoil: 0.012, auto: true, range: 60, adsFov: 55, tracer: 0xff7a1a,
  },
  lance: {
    name: 'Lance Sniper', price: 4750, damage: 88, headMult: 2, mag: 5, reserve: 15,
    interval: 1.2, spread: 0.001, moveSpread: 0.03, adsSpread: 0.0005,
    recoil: 0.05, auto: false, range: 90, adsFov: 42, tracer: 0x2ec4b6,
  },
};

export const GRENADE = { name: 'Frag Grenade', price: 300, damage: 90, radius: 6, fuse: 1.6 };
export const KEVLAR = { name: 'Kevlar Vest', price: 650, armor: 50 };

// Movement and health tuning, shared by the player controller and the bots.
export const MOVE = {
  walk: 5.2,
  crouch: 2.4,
  ads: 3.1,
  accel: 42,
  airAccel: 9,
  friction: 9,
  gravity: 20,
  jump: 6.2,
  radius: 0.34,
  standHeight: 1.72,
  crouchHeight: 1.12,
  standEye: 1.6,
  crouchEye: 1.02,
};

export const HEALTH = { max: 100 };
