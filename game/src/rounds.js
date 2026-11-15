// Rounds: buy -> live -> end, first to 5 (max 9). The economy, the bomb, and the
// win conditions all live here; the bots and the player only report events.
import { ROUND, ECONOMY } from './config.js';
import { SITES, SPAWNS } from './map.js';
import { pick } from './rng.js';

export function createRounds(fighters, random, events) {
  const player = fighters.find((f) => f.kind === 'player');
  const state = {
    round: 1,
    phase: 'buy',
    phaseT: ROUND.buySeconds,
    score: { ember: 0, alloy: 0 },
    bomb: { planted: false, site: null, timer: 0, planter: null },
    carrier: null,
    playerChannel: null, // { kind, t, total }
    over: false,
    winner: null,
  };

  function resetPositions() {
    for (const f of fighters) {
      const spawn = SPAWNS[f.team][fighters.filter((g) => g.team === f.team).indexOf(f) % 5];
      f.x = spawn[0] + (random() - 0.5) * 0.8;
      f.z = spawn[1] + (random() - 0.5) * 0.8;
      f.y = 0;
      f.vx = 0; f.vz = 0;
      f.hp = 100;
      f.alive = true;
      f.channelKind = null;
      f.channelT = 0;
      if (f.kind === 'bot') {
        f.grenades = 1;
        f.grenadeUsed = false;
        f.target = null;
      }
      // Refill the magazine from reserve at round start, like the real game.
      const w = f.weapon;
      const take = Math.min(w.def.mag - w.mag, w.reserve);
      w.mag += take;
      w.reserve -= take;
      w.reloadT = 0;
      w.cooldown = 0;
      if (f.kind === 'bot' && f.group) f.group.visible = true;
    }
    // Carrier: the player carries the charge first; a bot takes it if the player dies.
    state.carrier = player;
    player.carrier = true;
    for (const f of fighters) if (f.kind === 'bot') f.carrier = false;
    // Attackers split between the two sites; defenders get fresh hold points.
    const sites = ['A', 'A', 'A', 'B', 'B'].sort(() => random() - 0.5);
    let i = 0;
    for (const f of fighters) {
      if (f.kind !== 'bot') continue;
      if (f.team === 'ember') {
        f.assignedSite = sites[i % sites.length];
        i += 1;
      }
    }
    state.bomb = { planted: false, site: null, timer: 0, planter: null };
    state.playerChannel = null;
  }

  function startRound() {
    resetPositions();
    state.phase = 'buy';
    state.phaseT = ROUND.buySeconds;
    events.onRoundStart(state.round);
  }

  function endRound(winner, reason) {
    if (state.phase === 'end' || state.phase === 'match') return;
    state.phase = 'end';
    state.phaseT = ROUND.endSeconds;
    state.score[winner] += 1;
    for (const f of fighters) {
      f.money += f.team === winner ? ECONOMY.win : ECONOMY.loss;
    }
    events.onRoundEnd(winner, reason, { ...state.score });
    if (state.score[winner] >= ROUND.winsToTake || state.round >= ROUND.maxRounds) {
      state.over = true;
      state.winner = state.score.ember > state.score.alloy ? 'ember' : 'alloy';
    }
  }

  function nextRound() {
    if (state.over) {
      state.phase = 'match';
      events.onMatchEnd(state.winner, { ...state.score });
      return;
    }
    state.round += 1;
    startRound();
  }

  return {
    state,
    start: startRound,
    // The player holds E in a site to plant (or to defuse a planted charge).
    playerChannelStart(kind) {
      if (state.phase !== 'live') return false;
      const total = kind === 'plant' ? ROUND.plantSeconds : ROUND.defuseSeconds;
      if (kind === 'plant' && state.carrier !== player) return false;
      if (kind === 'plant' && !inSiteHere(player)) return false;
      if (kind === 'defuse' && (!state.bomb.planted || !inSiteHere(player, state.bomb.site))) return false;
      state.playerChannel = { kind, t: 0, total };
      events.onChannelStart(kind);
      return true;
    },
    playerChannelCancel() {
      if (state.playerChannel) {
        state.playerChannel = null;
        events.onChannelCancel();
      }
    },
    onPlanted(by) {
      if (state.bomb.planted) return;
      state.bomb.planted = true;
      state.bomb.site = by.assignedSite ?? state.bomb.site ?? 'A';
      if (by.kind === 'player') state.bomb.site = inSiteHere(player, 'A') ? 'A' : 'B';
      state.bomb.timer = ROUND.bombSeconds;
      state.bomb.planter = by;
      by.money += ECONOMY.plant;
      events.onPlanted(by, state.bomb.site);
    },
    onDefused(by) {
      if (!state.bomb.planted) return;
      by.money += ECONOMY.defuse;
      events.onDefused(by);
      endRound('alloy', 'Charge defused');
    },
    onKill(killer, victim) {
      if (killer && killer.team) killer.money += ECONOMY.kill;
      killer.kills = (killer.kills ?? 0) + 1;
      victim.deaths = (victim.deaths ?? 0) + 1;
      // The charge passes to the nearest living attacker.
      if (victim === state.carrier) {
        const alive = fighters.filter((f) => f.team === 'ember' && f.alive);
        state.carrier = alive[0] ?? null;
        for (const f of fighters) f.carrier = f === state.carrier;
        if (state.carrier) events.onCarrierChange(state.carrier);
      }
      events.onKill(killer, victim);
    },
    step(dt) {
      if (state.phase === 'match') return;
      state.phaseT -= dt;
      // Player channel progress (bots advance their own channel in botStep).
      if (state.playerChannel) {
        const ch = state.playerChannel;
        ch.t += dt;
        events.onChannelTick(ch.kind, ch.t / ch.total);
        if (ch.t >= ch.total) {
          const kind = ch.kind;
          state.playerChannel = null;
          if (kind === 'plant') this.onPlanted(player);
          else this.onDefused(player);
        }
      }
      if (state.phase === 'buy' && state.phaseT <= 0) {
        state.phase = 'live';
        state.phaseT = ROUND.liveSeconds;
        events.onLiveStart();
      } else if (state.phase === 'live') {
        if (state.bomb.planted) {
          state.bomb.timer -= dt;
          if (state.bomb.timer <= 0) {
            events.onExploded(state.bomb.site);
            endRound('ember', 'Charge detonated');
            return;
          }
        } else if (state.phaseT <= 0) {
          endRound('alloy', 'Time expired — charge never planted');
          return;
        }
        const emberAlive = fighters.some((f) => f.team === 'ember' && f.alive);
        const alloyAlive = fighters.some((f) => f.team === 'alloy' && f.alive);
        if (!emberAlive) endRound('alloy', 'EMBER eliminated');
        else if (!alloyAlive) endRound('ember', 'ALLOY eliminated');
      } else if (state.phase === 'end' && state.phaseT <= 0) {
        nextRound();
      }
    },
  };

  function inSiteHere(f, siteKey) {
    if (siteKey) return inSite(SITES[siteKey], f.x, f.z);
    return inSite(SITES.A, f.x, f.z) || inSite(SITES.B, f.x, f.z);
  }
  function inSite(site, x, z) {
    const dx = x - site.x;
    const dz = z - site.z;
    return dx * dx + dz * dz <= site.radius * site.radius;
  }
}
