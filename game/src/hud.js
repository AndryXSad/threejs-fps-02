// HUD: every DOM write in one module, so the game logic never touches the DOM
// directly. The minimap draws the map walls from a static list and the fighters
// the player can legitimately see: teammates always, enemies only when visible
// or recently firing.
import { WEAPONS, GRENADE, KEVLAR } from './config.js';

const WALL_RECTS = [
  [-30.5, -21, 1, 42], [30.5, -21, 1, 42], [-31, -20.5, 62, 1], [-31, 20.5, 62, 1],
  [-4.5, -3, 9, 6], [-10, -10, 1, 8], [9, -10, 1, 8], [-10, 5, 1, 6], [9, 5, 1, 6],
  [-20.5, 7.5, 7, 1], [13.5, 7.5, 7, 1],
  [-26.25, -9.1, 4.5, 2.2], [21.75, -9.1, 4.5, 2.2],
  [-21.5, -3, 2, 2], [-21.5, 5, 2, 2], [19.5, -3, 2, 2], [19.5, 5, 2, 2],
  [-6.2, 12.3, 2.4, 1.4], [3.8, 12.3, 2.4, 1.4],
  [-14, -14, 2, 2], [12, -14, 2, 2], [-27, 3, 2, 2], [25, 3, 2, 2],
  [-8.6, -14.6, 1.2, 1.2], [7.4, -14.6, 1.2, 1.2], [-8.6, 13.4, 1.2, 1.2], [7.4, 13.4, 1.2, 1.2],
  [-26, -17, 8, 1], [18, -17, 8, 1],
];

export function createHud(doc) {
  const $ = (id) => doc.getElementById(id);
  const el = {
    timer: $('timer'), roundLabel: $('round-label'),
    scoreEmber: $('score-ember'), scoreAlloy: $('score-alloy'),
    aliveEmber: $('alive-ember'), aliveAlloy: $('alive-alloy'),
    hpNum: $('hp-num'), hpFill: $('hp-fill'), armorNum: $('armor-num'), armorFill: $('armor-fill'),
    ammoMag: $('ammo-mag'), ammoReserve: $('ammo-reserve'), weaponName: $('weapon-name'), money: $('money'),
    objective: $('objective-text'), plantBar: $('plant-bar'), plantFill: $('plant-fill'),
    banner: $('banner'), bannerTitle: $('banner-title'), bannerSub: $('banner-sub'),
    buy: $('buy'), buyMoney: $('buy-money'), buyTable: $('buy-table'),
    scoreboard: $('scoreboard'), scoreRows: $('score-rows'),
    killfeed: $('killfeed'), crosshair: $('crosshair'), hitmarker: $('hitmarker'),
    damage: $('damage-vignette'), heal: $('heal-vignette'),
    minimap: $('minimap'),
  };
  const mm = el.minimap.getContext('2d');
  let hitTimer = 0;
  let bannerTimer = 0;

  function fmtTime(sec) {
    const s = Math.max(0, Math.ceil(sec));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  function buildBuyTable(owned) {
    const rows = [
      ['1', WEAPONS.rasp, owned.weapon === 'rasp'],
      ['2', WEAPONS.longshot, owned.weapon === 'longshot'],
      ['3', WEAPONS.lance, owned.weapon === 'lance'],
      ['4', WEAPONS.p9, owned.weapon === 'p9'],
      ['5', GRENADE, owned.grenades > 0],
      ['6', KEVLAR, owned.armor > 0],
    ];
    el.buyTable.innerHTML = rows.map(([key, item, has]) => {
      const extra = item === GRENADE ? ` · ${owned.grenades} held` : item === KEVLAR ? ` · ${owned.armor} armor` : '';
      return `<tr><td class="key">${key}</td><td>${item.name}${extra}</td><td class="${has ? 'owned' : ''}">${has ? 'owned' : ''}</td><td class="price">$${item.price}</td></tr>`;
    }).join('');
  }

  return {
    setTimer(sec, bomb) {
      el.timer.textContent = fmtTime(sec);
      el.timer.classList.toggle('low', sec <= 10);
      if (bomb) el.timer.style.color = 'var(--danger)';
      else el.timer.style.color = '';
    },
    setRound(round, phase) {
      el.roundLabel.textContent = `Round ${round} · ${phase === 'buy' ? 'Buy' : phase === 'live' ? 'Live' : phase === 'end' ? 'Round over' : 'Match over'}`;
    },
    setScore(score) {
      el.scoreEmber.textContent = score.ember;
      el.scoreAlloy.textContent = score.alloy;
    },
    setAlive(ember, alloy) {
      el.aliveEmber.textContent = ember;
      el.aliveAlloy.textContent = alloy;
    },
    setHealth(hp, armor) {
      el.hpNum.textContent = Math.ceil(hp);
      el.hpNum.classList.toggle('low', hp <= 25);
      el.hpFill.style.width = `${Math.max(0, hp)}%`;
      el.armorNum.textContent = Math.ceil(armor);
      el.armorFill.style.width = `${Math.min(100, armor * 2)}%`;
    },
    setAmmo(weapon, mag, reserve) {
      el.weaponName.textContent = weapon.name;
      el.ammoMag.textContent = mag;
      el.ammoMag.classList.toggle('empty', mag === 0);
      el.ammoReserve.textContent = `/ ${reserve}`;
    },
    setMoney(m) {
      el.money.textContent = `$${m}`;
      el.buyMoney.textContent = `$${m}`;
    },
    setObjective(text) { el.objective.textContent = text; },
    showPlantBar(show, frac, label) {
      el.plantBar.style.display = show ? 'block' : 'none';
      if (show) el.plantFill.style.width = `${Math.round(frac * 100)}%`;
      if (label) el.objective.textContent = label;
    },
    showBanner(title, sub, kind) {
      el.bannerTitle.textContent = title;
      el.bannerSub.textContent = sub;
      el.banner.className = kind ? `on ${kind}` : 'on';
      bannerTimer = 3.2;
    },
    hideBannerSoon(dt) {
      if (bannerTimer > 0) {
        bannerTimer -= dt;
        if (bannerTimer <= 0) el.banner.className = '';
      }
    },
    showBuy(show, owned) {
      el.buy.classList.toggle('on', show);
      if (show) buildBuyTable(owned);
    },
    showScoreboard(show, fighters) {
      el.scoreboard.classList.toggle('on', show);
      if (!show) return;
      el.scoreRows.innerHTML = fighters.map((f) => (
        `<tr><td>${f.name}${f.carrier ? ' ●' : ''}</td><td class="${f.team}">${f.team.toUpperCase()}</td><td>${f.kills ?? 0}</td><td>${f.deaths ?? 0}</td><td>$${f.money ?? 0}</td></tr>`
      )).join('');
    },
    killfeedAdd(killer, victim, weaponName) {
      const div = doc.createElement('div');
      const kc = killer.team === 'ember' ? 'e' : 'a';
      const vc = victim.team === 'ember' ? 'e' : 'a';
      div.innerHTML = `<span class="${kc}">${killer.name}</span> <span class="w">${weaponName}</span> <span class="${vc}">${victim.name}</span>`;
      el.killfeed.prepend(div);
      while (el.killfeed.children.length > 5) el.killfeed.lastChild.remove();
      setTimeout(() => div.remove(), 6000);
    },
    hitmarker(kill) {
      el.hitmarker.className = kill ? 'on kill' : 'on';
      hitTimer = 0.12;
    },
    hitmarkerTick(dt) {
      if (hitTimer > 0) {
        hitTimer -= dt;
        if (hitTimer <= 0) el.hitmarker.className = '';
      }
    },
    damageFlash() {
      el.damage.style.opacity = 1;
      setTimeout(() => { el.damage.style.opacity = 0; }, 140);
    },
    setCrosshairGap(px) {
      const spread = Math.round(px);
      const kids = el.crosshair.children;
      kids[0].style.top = `${-spread}px`;
      kids[1].style.bottom = `${-spread}px`;
      kids[2].style.left = `${-spread}px`;
      kids[3].style.right = `${-spread}px`;
    },
    drawMinimap(player, fighters, visibleEnemies) {
      const W = el.minimap.width;
      const H = el.minimap.height;
      const sx = W / 62;
      const sy = H / 42;
      const X = (x) => (x + 31) * sx;
      const Z = (z) => (z + 21) * sy;
      mm.clearRect(0, 0, W, H);
      mm.fillStyle = '#262019';
      mm.fillRect(0, 0, W, H);
      mm.fillStyle = '#3d332a';
      for (const [x, z, w, d] of WALL_RECTS) mm.fillRect(X(x), Z(z), w * sx, d * sy);
      mm.strokeStyle = '#ff7a1a';
      mm.lineWidth = 1.5;
      for (const [cx, cz] of [[-22, -12], [22, -12]]) {
        mm.beginPath();
        mm.arc(X(cx), Z(cz), 4.5 * sx, 0, Math.PI * 2);
        mm.stroke();
      }
      mm.font = 'bold 9px monospace';
      mm.fillStyle = '#ff7a1a';
      mm.fillText('A', X(-22) - 3, Z(-12) + 3);
      mm.fillText('B', X(22) - 3, Z(-12) + 3);
      for (const f of fighters) {
        if (!f.alive) continue;
        const isPlayer = f === player;
        const isEnemy = f.team !== player.team;
        if (isEnemy && !visibleEnemies.has(f)) continue;
        mm.fillStyle = isPlayer ? '#f2ead9' : (f.team === 'ember' ? '#ff7a1a' : '#2ec4b6');
        mm.beginPath();
        mm.arc(X(f.x), Z(f.z), isPlayer ? 3.4 : 2.6, 0, Math.PI * 2);
        mm.fill();
        if (isPlayer) {
          mm.strokeStyle = '#f2ead9';
          mm.beginPath();
          mm.moveTo(X(f.x), Z(f.z));
          mm.lineTo(X(f.x) - Math.sin(f.yaw) * 7, Z(f.z) - Math.cos(f.yaw) * 7);
          mm.stroke();
        }
      }
    },
  };
}
