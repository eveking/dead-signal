'use strict';
// 临时 M3a 冒烟脚本：页内定步长推进 g.update(1/60)，验证完即删除。
const path = require('node:path');
const fs = require('node:fs');
const connect = require('./browser.cjs');

const HELPERS = {
  ok(name, cond, info) {
    this.log.push([name, Boolean(cond), info === undefined || info === null ? '' : String(info)]);
  },
  g() { return window.DZ.game; },
  unpatch() {
    const es = this.g().enemies;
    if (Object.prototype.hasOwnProperty.call(es, 'damage')) delete es.damage;
  },
  step(n, dt) {
    dt = dt || 1 / 60;
    for (let i = 0; i < n; i++) this.g().update(dt);
  },
  stepPin(n, pins, dt) {
    dt = dt || 1 / 60;
    for (let i = 0; i < n; i++) {
      this.g().update(dt);
      for (const p of pins) p.obj.root.position.set(p.x, 0, p.z);
    }
  },
  boot(mode, difficulty) {
    const DZ = window.DZ;
    if (!window.__rafFreeze) {
      window.__rafFreeze = window.requestAnimationFrame;
      window.requestAnimationFrame = function () { return 0; };
    }
    this.unpatch();
    DZ.Settings = { mode: mode || 'giant', difficulty: difficulty || 'normal', coins: 30 };
    const g = DZ.game;
    g.newGame();
    g.state = 'playing';
    g.ui.setScreen('playing');
    g.wave = 4;
    g.wavePhase = 'active';
    g.enemies.startWave(5);
    this.clear();
    this.spot = this.findSpot(16);
    if (!this.spot) return 'no-open-spot';
    this.placePlayer(this.spot.p);
    this.killAllies();
    return 'ready';
  },
  clear() {
    const es = this.g().enemies;
    while (es.list.length) es.remove(0);
    es.runner.queue = [];
    es.runner.pending = 1;
    es.runner.batchLeft = 0;
    es.runner.reinforceClock = 1e9;
    es.spawnTimer = 1e9;
    this.g().effects.reset();
    this.g().time = 0;
    const g = this.g();
    g.score = 0; g.kills = 0; g.headshots = 0; g.squadKills = 0;
  },
  killAllies() {
    const sq = this.g().squad;
    if (!sq) return;
    for (const m of sq.members) { m.dead = true; m.respawn = 1e9; }
  },
  reviveAlly(index, x, z, freeze) {
    const m = this.g().squad.members[index];
    m.dead = false; m.respawn = 1e9; m.stagger = freeze ? 1e9 : 0;
    m.hp = m.maxHp; m.ammo = m.def.magazine; m.reserve = m.def.reserve; m.reload = 0;
    m.root.position.set(x, 0, z);
    m.order = 'hold';
    m.target = null;
    return m;
  },
  clearAlong(p, dx, dz, len, radius) {
    const world = this.g().world;
    for (let t = 0.5; t <= len + 0.01; t += 0.5) {
      if (!world.canStand(p.x + dx * t, p.z + dz * t, radius)) return t - 0.5;
    }
    return len;
  },
  // 新长图有车厢/斜坡/掩体，测试用的相对坐标必须落在真正的空地上：
  // 沿一个轴向 ±len 全通、垂直轴向 ±8m 全通，并在两张图上都按 bounds 全图搜索。
  findSpot(len) {
    const world = this.g().world, b = world.bounds;
    const axes = [{ x: 0, z: 1 }, { x: 1, z: 0 }];
    let best = null, bestScore = 0;
    for (let x = Math.round(b.minX) + 9; x <= b.maxX - 9; x++) {
      for (let z = Math.round(b.minZ) + 17; z <= b.maxZ - 17; z += 2) {
        const p = { x, z };
        if (!world.canStand(p.x, p.z, 0.62)) continue;
        for (const d of axes) {
          const side = { x: -d.z, z: d.x };
          const axial = Math.min(this.clearAlong(p, d.x, d.z, len, 0.62), this.clearAlong(p, -d.x, -d.z, len, 0.62));
          if (axial < len) continue;
          const lateral = Math.min(this.clearAlong(p, side.x, side.z, 8, 0.62), this.clearAlong(p, -side.x, -side.z, 8, 0.62));
          if (lateral < 8) continue;
          const score = Math.min(axial, lateral * 2);
          if (score > bestScore) { bestScore = score; best = { p, dir: d }; }
        }
      }
    }
    return best;
  },
  rayDir(from, len, radius) {
    const world = this.g().world;
    for (let a = 0; a < 24; a++) {
      const ang = a * Math.PI / 12;
      const dir = { x: Math.sin(ang), z: Math.cos(ang) };
      let clear = true;
      for (let t = 0.25; t <= len + 0.01; t += 0.25) {
        if (!world.canStand(from.x + dir.x * t, from.z + dir.z * t, radius)) { clear = false; break; }
      }
      if (clear) return dir;
    }
    return null;
  },
  at(base, dir, dist) {
    return new window.THREE.Vector3(base.x + dir.x * dist, 0, base.z + dir.z * dist);
  },
  placePlayer(p) {
    const g = this.g();
    g.player.position.set(p.x, 0, p.z);
    g.player.velocityY = 0; g.player.grounded = true;
    g.player.stagger = 0; g.player.invulnerable = 0; g.player.health = 100;
    g.player.yaw = 0; g.player.pitch = 0;
    g.player.syncCamera();
  },
  immortal() { this.g().player.invulnerable = 1e9; },
  look(dir) {
    const g = this.g();
    g.player.yaw = Math.atan2(-dir.x, -dir.z);
    g.player.pitch = -0.02;
    g.player.syncCamera();
  },
  spawn(type, position, wave) {
    const e = this.g().enemies.spawn(position.clone ? position.clone() : new window.THREE.Vector3(position.x, 0, position.z),
      wave || 5, type ? { type } : null);
    e.born = 0;
    e.root.scale.setScalar(e.scale);
    return e;
  },
  arm(e) { e.pathClock = 0; this.step(1); return e; },
  dist(a, b) { return Math.hypot(a.x - b.x, a.z - b.z); },
  forceTarget(e) {
    const g = this.g();
    g.enemies.chooseTarget(e, window.DZ.allyUnits(g));
    return e.targetId;
  },
  px(x, z) {
    const canvas = this.g().ui.el.minimap;
    const b = this.g().world.bounds || { minX: -24, maxX: 24, minZ: -24, maxZ: 24 };
    // 与 ui._drawMinimap 同一套映射：按各自地图边界等比缩放并居中（长图上下留边）。
    const pad = 8, w = canvas.width - pad * 2, h = canvas.height - pad * 2;
    const spanX = b.maxX - b.minX, spanZ = b.maxZ - b.minZ;
    const scale = Math.min(w / spanX, h / spanZ);
    const offX = pad + (w - spanX * scale) / 2, offZ = pad + (h - spanZ * scale) / 2;
    return { x: Math.round(offX + (x - b.minX) * scale), y: Math.round(offZ + (z - b.minZ) * scale) };
  },
  bright(x, z) {
    const ui = this.g().ui, canvas = ui.el.minimap;
    const p = this.px(x, z);
    let max = 0;
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        const sx = p.x + dx, sy = p.y + dy;
        if (sx < 0 || sy < 0 || sx >= canvas.width || sy >= canvas.height) continue;
        const d = ui.context.getImageData(sx, sy, 1, 1).data;
        max = Math.max(max, d[0] + d[1] + d[2]);
      }
    }
    return max;
  }
};

const CASES = {
  registry() {
    const M = window.__M3, DZ = window.DZ, es = M.g().enemies;
    for (const key of ['bomber', 'tyrant', 'fogger', 'splitter', 'titan', 'megaTitan']) {
      M.ok('TYPES 去掉 placeholder: ' + key, !DZ.WAVES.TYPES[key].placeholder);
    }
    const expect = {
      walker: { hp: 80, speed: 1.7, damage: 10, score: 100 },
      runner: { hp: 55, speed: 2.9, damage: 8, score: 120 },
      bomber: { hp: 40, speed: 2.4, damage: 60, score: 150 },
      tyrant: { hp: 500, speed: 1.5, damage: 30, score: 400 },
      fogger: { hp: 90, speed: 1.8, damage: 12, score: 200 },
      splitter: { hp: 120, speed: 2.6, damage: 15, score: 250 }
    };
    for (const key of Object.keys(expect)) {
      const s = es.resolveStats({ type: key }, 5), e = expect[key];
      M.ok('§5 数值 ' + key,
        s.hp === e.hp && s.speed === e.speed && s.damage === e.damage && s.score === e.score,
        `${s.hp}/${s.speed}/${s.damage}/${s.score}`);
      const def = es.defOf({ type: key });
      M.ok('注册表合并 ' + key, Boolean(def && def.radius > 0 && def.targetRule &&
        Array.isArray(def.spawnPoints) && def.melee && def.key === key));
    }
    const r = es.defOf({ type: 'runner' });
    M.ok('疾行冲刺 6m / CD 4s', r.dash.distance === 6 && r.dash.cooldown === 4);
    const b = es.defOf({ type: 'bomber' });
    M.ok('膨胀体 2.5m 起爆 / 3m 60 伤', b.fuse.range === 2.5 && b.blast.radius === 3 && b.blast.damage === 60);
    const t = es.defOf({ type: 'tyrant' });
    M.ok('暴君步枪 -20% / 横扫 2.8m', t.rifleResist === 0.2 && t.sweep.reach === 2.8);
    const f = es.defOf({ type: 'fogger' });
    M.ok('雾散体 6s / 6m / 8s', f.fog.every === 6 && f.fog.radius === 6 && f.fog.life === 8);
    const s = es.defOf({ type: 'splitter' });
    M.ok('裂魂者击退 4m+0.5s / 闪现 8m CD8s',
      s.shove.distance === 4 && s.shove.stagger === 0.5 && s.blink.distance === 8 && s.blink.cooldown === 8);
    const w = es.defOf({ type: 'walker' });
    M.ok('步行者/队友近战冷却回归 1.1s', w.melee.cooldown === 1.1 && w.radius === 0.44);
  },

  scaling() {
    const M = window.__M3, DZ = window.DZ, es = M.g().enemies;
    for (const spec of [['hard', 1.5, 1.3], ['nightmare', 2.2, 1.8]]) {
      es.runner.difficulty = DZ.WAVES.difficulty(spec[0]);
      const t = es.resolveStats({ type: 'tyrant' }, 5);
      M.ok('难度 ' + spec[0] + ' 暴君血量', t.hp === Math.round(500 * spec[1]), t.hp);
      M.ok('难度 ' + spec[0] + ' 暴君伤害', t.damage === Math.round(30 * spec[2]), t.damage);
    }
    es.runner.difficulty = DZ.WAVES.difficulty('normal');
    const boss = es.resolveStats({ type: 'titan' }, 15);
    M.ok('泰坦 hp 6000 / scale 2.2', boss.hp === 6000 && boss.scale === 2.2 && boss.boss === true,
      `${boss.hp}/${boss.scale}`);
    const mega = es.resolveStats({ type: 'megaTitan' }, 30);
    M.ok('巨型泰坦 hp 15000 / scale 2.8', mega.hp === 15000 && mega.scale === 2.8);
  },

  legacy() {
    const M = window.__M3, DZ = window.DZ;
    M.boot('practice', 'normal');
    const es = M.g().enemies;
    const normal = es.resolveStats({ fast: false }, 3);
    M.ok('练习模式公式 hp98/dmg15/步行者 def', normal.hp === 98 && normal.damage === 15 &&
      normal.type === 'walker' && normal.def === DZ.ENEMY_REGISTRY.walker, `${normal.hp}/${normal.damage}`);
    M.ok('练习模式速度公式 1.72+wave*0.19', Math.abs(normal.speed - (1.72 + 3 * 0.19)) < 1e-9, normal.speed);
    const fast = es.resolveStats({ fast: true }, 3);
    M.ok('fast 变体速度 ×1.22', Math.abs(fast.speed - (1.72 + 3 * 0.19) * 1.22) < 1e-9);
    M.boot('practice', 'normal');
    const g = M.g();
    const walker = g.enemies.spawn(new THREE.Vector3(M.spot.p.x + 3, 0, M.spot.p.z), 3, { fast: true });
    M.ok('旧模式 fast 配色不变', walker.skin.color.getHex() === 0x8c7350 &&
      walker.cloth.color.getHex() === 0x67452f, walker.skin.color.getHexString());
    M.ok('旧模式 fast 仍是 walker', walker.type === 'walker' && walker.def === DZ.ENEMY_REGISTRY.walker);
    const plain = g.enemies.spawn(new THREE.Vector3(M.spot.p.x - 3, 0, M.spot.p.z), 3, { fast: false });
    M.ok('旧模式普通外观/停止距离', plain.skin.color.getHex() === 0x768568 &&
      plain.stopAt === 1.14 && Math.abs(plain.attackAt - 1.58) < 1e-9);
    M.ok('旧模式 aggro 规则 + 无黑雾/闪现字段', plain.def.targetRule === 'aggro' &&
      !plain.def.fog && !plain.def.blink);
    M.boot('giant', 'normal');
  },

  dash() {
    const M = window.__M3, g = M.g();
    const p = M.spot.p, dir = M.spot.dir;
    M.immortal();
    M.clear();
    const e = M.spawn('runner', M.at(p, dir, 10));
    M.arm(e);
    M.ok('8m 视线通畅时触发冲刺', Boolean(e.dash) && e.dashCd === 4, e.dashCd);
    const start = { x: e.root.position.x, z: e.root.position.z };
    let frames = 0;
    while (e.dash && frames++ < 120) M.step(1);
    const travelled = M.dist(start, e.root.position);
    M.ok('冲刺位移 ≈6m', travelled > 5.4 && travelled < 6.7, travelled.toFixed(2));
    M.ok('冲刺耗时 ≈0.5s（12m/s）', frames > 25 && frames < 40, frames);
    M.arm(e);
    M.ok('冷却期内不再起冲', !e.dash && e.dashCd > 2, e.dashCd.toFixed(2));
    M.step(210);
    e.root.position.set(p.x + dir.x * 8, 0, p.z + dir.z * 8);
    M.arm(e);
    M.ok('CD 4s 后再次起冲', Boolean(e.dash), `cd=${e.dashCd.toFixed(2)}`);
    M.clear();
    const far = M.spawn('runner', M.at(p, dir, 15));
    M.arm(far);
    M.ok('15m（>13m）不冲', !far.dash && far.dashCd === 0);
    const near = M.spawn('runner', M.at(p, dir, 2.6));
    M.arm(near);
    M.ok('2.6m（<3.5m）不冲', !near.dash && near.dashCd === 0);
  },

  bomber() {
    const M = window.__M3, g = M.g();
    const p = M.spot.p, dir = M.spot.dir;
    M.clear();
    M.placePlayer(p);
    const b = M.spawn('bomber', M.at(p, dir, 4));
    let trigger = -1, fuseFrames = 0;
    for (let i = 0; i < 240; i++) {
      const before = M.dist(b.root.position, p);
      M.step(1);
      if (b.fuse > 0) { trigger = before; fuseFrames = i; break; }
      if (i === 4) M.ok('3.7m 外不起爆', b.fuse <= 0, before.toFixed(2));
    }
    M.ok('≤2.5m 才起爆', trigger > 0 && trigger <= 2.501, trigger.toFixed(3));
    M.ok('起爆后腹部发光', b.glowMat && b.glowMat.emissive.getHex() !== 0,
      b.glowMat && b.glowMat.emissive.getHexString());
    const hp0 = g.player.health;
    let stepMax = 0;
    for (let i = 0; i < 60 && !b.dead; i++) {
      const prev = M.dist(b.root.position, p);
      M.step(1);
      stepMax = Math.max(stepMax, prev - M.dist(b.root.position, p));
    }
    M.ok('引信 0.45s 后爆炸', b.dead === true && g.effects.blows.length === 1);
    M.ok('爆炸对玩家 60 伤', hp0 - g.player.health === 60, hp0 - g.player.health);
    M.ok('引信阶段移速减半', stepMax < 0.021, stepMax.toFixed(4));
    M.ok('自爆不计击杀与得分', g.kills === 0 && g.score === 0, `${g.kills}/${g.score}`);
    M.killAllies();
  },

  bomberAlly() {
    const M = window.__M3, g = M.g();
    const p = M.spot.p, dir = M.spot.dir;
    M.clear();
    M.placePlayer(p);
    g.player.invulnerable = 1e9;
    const blade = M.reviveAlly(0, p.x + 1.4, p.z);
    const shield = M.reviveAlly(1, p.x + 2.9, p.z);
    const ranger = M.reviveAlly(2, p.x + 5.2, p.z);
    const b = M.spawn('bomber', M.at(p, dir, 1.2));
    const hp = [blade.hp, shield.hp, ranger.hp];
    b.pathClock = 999;
    b.fuse = 0.02;
    M.step(4);
    M.ok('爆炸对队友 60 伤', hp[0] - blade.hp === 60, hp[0] - blade.hp);
    M.ok('3.4m 边界（含半径）判定命中', Math.abs((hp[1] - shield.hp) - 42) < 1e-9, hp[1] - shield.hp);
    M.ok('5m 外队友不受波及', hp[2] - ranger.hp === 0, hp[2] - ranger.hp);
    M.killAllies();
    M.clear();
    M.placePlayer(p);
    const shot = M.spawn('bomber', M.at(p, dir, 6));
    g.score = 0; g.kills = 0;
    const hpP = g.player.health;
    g.enemies.damage(shot, 100, shot.root.position, new THREE.Vector3(0, 0, 1), false, 0, 'rifle');
    M.step(30);
    M.ok('被射杀不爆炸', g.effects.blows.length === 0 && g.player.health === hpP, g.effects.blows.length);
    M.ok('被射杀正常结算 150 分', g.score === 150 && g.kills === 1, `${g.score}/${g.kills}`);
  },

  tyrant() {
    const M = window.__M3, g = M.g();
    const p = M.spot.p, dir = M.spot.dir;
    M.clear();
    const t = M.spawn('tyrant', M.at(p, dir, 6));
    const base = t.hp;
    g.enemies.damage(t, 27, t.root.position, new THREE.Vector3(0, 0, 1), false, 0, 'rifle');
    M.ok('步枪躯干 -20%（27→21.6）', Math.abs(base - t.hp - 21.6) < 1e-9, base - t.hp);
    const t2 = M.spawn('tyrant', M.at(p, dir, 6.5));
    const b2 = t2.hp;
    g.enemies.damage(t2, 27, t2.root.position, new THREE.Vector3(0, 0, 1), true, 0, 'rifle');
    M.ok('暴君爆头不减免（27）', Math.abs(b2 - t2.hp - 27) < 1e-9, b2 - t2.hp);
    const t3 = M.spawn('tyrant', M.at(p, dir, 7));
    const b3 = t3.hp;
    g.enemies.damage(t3, 27, t3.root.position, new THREE.Vector3(0, 0, 1), false, 0, 'pistol');
    M.ok('手枪躯干不减免（27）', Math.abs(b3 - t3.hp - 27) < 1e-9, b3 - t3.hp);
    const w = M.spawn('walker', M.at(p, dir, 7.5));
    const b4 = w.hp;
    g.enemies.damage(w, 27, w.root.position, new THREE.Vector3(0, 0, 1), false, 0, 'rifle');
    M.ok('步行者不吃减伤', b4 - w.hp === 27, b4 - w.hp);
    M.ok('暴君头部命中盒 1.55 倍', t.head.userData.headshot === true &&
      Math.abs(t.head.scale.y - 1.12 * 1.55) < 1e-6 && Math.abs(w.head.scale.y - 1.12) < 1e-6,
      t.head.scale.y.toFixed(3));
    M.ok('暴君半径/距离 0.75 推算', Math.abs(t.radius - 0.75) < 1e-9 &&
      Math.abs(t.stopAt - 1.45) < 1e-9 && Math.abs(t.attackAt - 1.89) < 1e-9 &&
      Math.abs(t.shadow.scale.x - 0.75 / 0.44) < 1e-6, `${t.stopAt}/${t.attackAt}`);
  },

  sweep() {
    const M = window.__M3, g = M.g();
    const p = M.spot.p;
    M.clear();
    M.placePlayer(p);
    const blade = M.reviveAlly(0, p.x + 2.2, p.z + 0.4, true);
    const ranger = M.reviveAlly(2, p.x - 2.4, p.z + 0.2, true);
    const shield = M.reviveAlly(1, p.x + 4.6, p.z, true);
    const hp = [g.player.health, blade.hp, ranger.hp, shield.hp];
    const pins = [{ obj: blade, x: p.x + 2.2, z: p.z + 0.4 },
      { obj: ranger, x: p.x - 2.4, z: p.z + 0.2 }, { obj: shield, x: p.x + 4.6, z: p.z }];
    const t = M.spawn('tyrant', new window.THREE.Vector3(p.x + 0.3, 0, p.z + 0.5));
    M.arm(t);
    M.stepPin(40, pins);
    M.ok('横扫命中玩家 30', hp[0] - g.player.health === 30, hp[0] - g.player.health);
    M.ok('横扫一次命中尖刀 30', hp[1] - blade.hp === 30, hp[1] - blade.hp);
    M.ok('横扫一次命中游骑兵 30', hp[2] - ranger.hp === 30,
      `${hp[2] - ranger.hp} spot ${p.x}/${p.z} tyrant ${t.root.position.x.toFixed(1)}/${t.root.position.z.toFixed(1)}@${t.root.position.y.toFixed(2)} d=${M.dist(t.root.position, ranger.root.position).toFixed(2)} los=${g.world.segmentClear(t.root.position, ranger.root.position, 0.12)}`);
    M.ok('2.8m 外队友不受波及', hp[3] - shield.hp === 0, hp[3] - shield.hp);
    M.ok('横扫冷却取 melee 1.7s', Math.abs(t.melee.cooldown - 1.7) < 1e-9, t.cooldown.toFixed(2));
    const after = [g.player.health, blade.hp, ranger.hp];
    M.stepPin(75, pins);
    M.ok('冷却期间不重复横扫',
      g.player.health === after[0] && blade.hp === after[1] && ranger.hp === after[2]);
    M.killAllies();
    M.clear();
    M.placePlayer(p);
    const bl = M.reviveAlly(0, p.x + 1.4, p.z - 0.5);
    const bhp = bl.hp, php = g.player.health;
    const w = M.spawn('walker', new window.THREE.Vector3(p.x + 0.3, 0, p.z + 0.4));
    M.arm(w);
    M.stepPin(45, [{ obj: bl, x: p.x + 1.4, z: p.z - 0.5 }]);
    const hitCount = [php - g.player.health, bhp - bl.hp].filter(v => v > 0).length;
    M.ok('步行者仍是单体攻击（只伤一个单位）', hitCount === 1,
      `${php - g.player.health}/${bhp - bl.hp}`);
    M.killAllies();
  },

  fogger() {
    const M = window.__M3, g = M.g();
    const p = M.spot.p, dir = M.spot.dir;
    M.clear();
    M.immortal();
    const f = M.spawn('fogger', M.at(p, dir, 9));
    M.step(330);
    M.ok('5.5s 前无黑雾', g.effects.fogs.length === 0, g.effects.fogs.length);
    M.step(45);
    const cloud = g.effects.fogs[0];
    M.ok('6s 生成第一团：半径 6 / 生命 8',
      g.effects.fogs.length === 1 && cloud.radius === 6 && cloud.maxLife === 8,
      `${g.effects.fogs.length}/${cloud && cloud.radius}/${cloud && cloud.maxLife}`);
    M.step(72);
    M.ok('雾心密度≈1', g.effects.fogDensity(cloud.position) > 0.95,
      g.effects.fogDensity(cloud.position).toFixed(3));
    const mid = { x: cloud.position.x + 5, z: cloud.position.z };
    M.ok('5m 处密度衰减到 0.2–0.5',
      g.effects.fogDensity(mid) > 0.2 && g.effects.fogDensity(mid) < 0.5,
      g.effects.fogDensity(mid).toFixed(3));
    M.ok('7m 外密度 0', g.effects.fogDensity({ x: cloud.position.x + 7, z: cloud.position.z }) === 0);
    M.placePlayer(cloud.position);
    M.step(2);
    const veil = g.ui.el['fog-veil'];
    M.ok('玩家身处雾中 → 视野遮挡', veil.hidden === false && parseFloat(veil.style.opacity) > 0.8,
      veil.style.opacity);
    M.placePlayer({ x: cloud.position.x, z: cloud.position.z - 9 });
    M.step(2);
    M.ok('雾外视野恢复', g.ui.el['fog-veil'].hidden === true);
    M.ok('squad.fogScale 雾内 0.5 / 雾外 1',
      g.squad.fogScale(cloud.position) === 0.5 &&
      g.squad.fogScale({ x: cloud.position.x + 8, z: cloud.position.z }) === 1);
    M.step(430);
    M.ok('第一团 8s 后消散', !g.effects.fogs.some(c => c === cloud) && cloud.life <= 0);
  },

  fogLimit() {
    const M = window.__M3, g = M.g();
    M.clear();
    const p = M.spot.p;
    for (let i = 0; i < 16; i++) g.effects.fog(new THREE.Vector3(p.x + i * 0.4, 0, p.z), 6, 8);
    M.ok('雾团数量上限 12', g.effects.fogs.length === 12, g.effects.fogs.length);
    g.effects.reset();
    M.ok('reset 清空雾团', g.effects.fogs.length === 0 && g.effects.fogDensity(p) === 0);
  },

  fogMinimap() {
    const M = window.__M3, g = M.g();
    M.clear();
    const p = M.spot.p, dir = M.spot.dir;
    const e = M.spawn('walker', M.at(p, dir, 9));
    e.pathClock = 999;
    M.step(12);
    const before = M.bright(e.root.position.x, e.root.position.z);
    const center = { x: e.root.position.x, z: e.root.position.z };
    g.effects.fog(new window.THREE.Vector3(center.x, 0, center.z), 6, 8);
    M.step(72);
    const after = M.bright(center.x, center.z);
    const side = { x: -dir.z, z: dir.x };
    const outside = M.bright(center.x + side.x * 10, center.z + side.z * 10);
    M.ok('雾区雷达失效（敌点被盖住）', before > 90 && after < before * 0.5,
      `${before}→${after}`);
    M.ok('雾外雷达不受影响', outside > after, `${outside} vs ${after}`);
    g.effects.reset();
    M.clear();
  },

  fogAlly() {
    const M = window.__M3, g = M.g();
    const p = M.spot.p, dir = M.spot.dir;
    M.clear();
    M.immortal();
    const blade = M.reviveAlly(0, p.x, p.z);
    blade.order = 'free';
    const target = M.at(p, dir, 10);
    const e = M.spawn('walker', target);
    e.hp = 1e9; e.maxHp = 1e9; e.pathClock = 999;
    const pins = [{ obj: blade, x: p.x, z: p.z }, { obj: e, x: target.x, z: target.z }];
    const real = g.enemies.damage.bind(g.enemies);
    const seen = [];
    g.enemies.damage = function (en, amount, point, direction, headshot, unitId, weapon) {
      seen.push([unitId, amount, weapon]);
      return real(en, 0, point, direction, headshot, unitId, weapon);
    };
    M.stepPin(300, pins);
    const plain = seen.filter(s => s[0] === blade.id && s[2] === 'rifle');
    M.ok('无雾：队友单发 13', plain.length > 1 && plain.every(s => s[1] === 13),
      `${plain.length} 发 ${plain.map(s => s[1]).slice(0, 3)}`);
    seen.length = 0;
    g.effects.fog(new window.THREE.Vector3(target.x, 0, target.z), 6, 8);
    M.step(60);
    M.stepPin(300, pins);
    M.unpatch();
    // 雾生成后的前 0.6s 是淡入（密度未过阈值），跳过这几发再判定。
    const fogged = seen.filter(s => s[0] === blade.id && s[2] === 'rifle').slice(3);
    M.ok('目标在雾内：队友命中 -50%（6.5）', fogged.length > 1 && fogged.every(s => s[1] === 6.5),
      `${fogged.length} 发 ${fogged.map(s => s[1]).slice(0, 3)}`);
    g.effects.reset();
    M.killAllies();
    M.clear();
  },

  blink() {
    const M = window.__M3, g = M.g();
    const p = M.spot.p, dir = M.spot.dir;
    M.clear();
    M.placePlayer(p);
    M.immortal();
    const far = M.spawn('splitter', M.at(p, dir, 14));
    M.arm(far);
    M.step(3);
    M.ok('14m（>12m）不闪现', far.blinkCd === 0);
    const near = M.spawn('splitter', M.at(p, dir, 2.4));
    M.arm(near);
    M.step(3);
    M.ok('2.4m（<4m）不闪现', near.blinkCd === 0);
    M.clear();
    M.placePlayer(p);
    M.immortal();
    const e = M.spawn('splitter', M.at(p, dir, 11));
    const before = M.dist(e.root.position, p);
    M.arm(e);
    M.step(1);
    const moved = M.dist(e.root.position, { x: p.x + dir.x * before, z: p.z + dir.z * before });
    M.ok('11m 触发闪现，位移 ≈8m', moved > 7 && moved < 8.3, moved.toFixed(2));
    M.ok('闪现后 CD 8s', Math.abs(e.blinkCd - 8) < 0.05, e.blinkCd.toFixed(2));
    M.ok('落点可站立', g.world.canStand(e.root.position.x, e.root.position.z, e.radius));
    const park = () => e.root.position.set(p.x + dir.x * 11, 0, p.z + dir.z * 11);
    let jumps = 0, prev = { x: e.root.position.x, z: e.root.position.z };
    for (let i = 0; i < 360; i++) {
      M.step(1);
      const now = { x: e.root.position.x, z: e.root.position.z };
      if (M.dist(prev, now) > 3) jumps++;
      prev = now;
      if (i % 15 === 14) { park(); prev = { x: e.root.position.x, z: e.root.position.z }; }
    }
    M.ok('CD 6s 内不重复闪现', jumps === 0, jumps);
    for (let i = 0; i < 300 && jumps === 0; i++) {
      M.step(1);
      const now = { x: e.root.position.x, z: e.root.position.z };
      if (M.dist(prev, now) > 3) jumps++;
      prev = now;
      if (i % 15 === 14) { park(); prev = { x: e.root.position.x, z: e.root.position.z }; }
    }
    M.ok('CD 走完（8s）后再次闪现', jumps === 1, jumps);
  },

  shove() {
    const M = window.__M3, g = M.g();
    const p = M.spot.p, dir = M.rayDir(p, 7, 0.5) || M.spot.dir;
    M.clear();
    M.placePlayer(p);
    const e = M.spawn('splitter', M.at(p, dir, 1.5));
    e.blinkCd = 8;
    let guard = 0;
    while (g.player.health === 100 && guard++ < 90) M.step(1);
    const moved = M.dist(p, g.player.position);
    M.ok('裂魂者命中 15 伤', 100 - g.player.health === 15, 100 - g.player.health);
    M.ok('命中附带击退 ≈4m', moved > 3.4 && moved < 4.25, moved.toFixed(2));
    M.ok('附带 0.5s 硬直', g.player.stagger > 0.4 && g.player.stagger <= 0.5,
      g.player.stagger.toFixed(2));
    const frozen = { x: g.player.position.x, z: g.player.position.z };
    g.player.keys.add('KeyW');
    M.step(12);
    M.ok('硬直期间禁移动', M.dist(frozen, g.player.position) === 0);
    g.player.keys.delete('KeyW');
    M.step(24);
    const freed = { x: g.player.position.x, z: g.player.position.z };
    g.player.keys.add('KeyW');
    M.step(20);
    g.player.keys.delete('KeyW');
    M.ok('硬直结束恢复移动', M.dist(freed, g.player.position) > 0.3,
      M.dist(freed, g.player.position).toFixed(2));
    M.clear();
    M.placePlayer(p);
    g.player.health = 100;
    g.player.invulnerable = 5;
    const e2 = M.spawn('splitter', M.at(p, dir, 1.5));
    e2.blinkCd = 8;
    const pos = { x: p.x, z: p.z };
    M.arm(e2);
    M.step(50);
    M.ok('无敌期间免疫伤害与击退',
      g.player.health === 100 && M.dist(pos, g.player.position) === 0 && g.player.stagger === 0,
      `${g.player.health}/${M.dist(pos, g.player.position).toFixed(2)}`);
    M.clear();
    M.placePlayer(p);
    const allyPos = M.at(p, dir, 1.15);
    const ally = M.reviveAlly(0, allyPos.x, allyPos.z);
    const e3 = M.spawn('splitter', M.at(p, dir, -0.35));
    e3.blinkCd = 8;
    e3.pathClock = 999;
    e3.targetId = ally.id;
    let jump = 0, hpPrev = ally.hp;
    for (let i = 0; i < 120 && !jump; i++) {
      const prev = { x: ally.root.position.x, z: ally.root.position.z };
      M.step(1);
      e3.root.position.set(p.x - dir.x * 0.35, 0, p.z - dir.z * 0.35);
      if (ally.hp < hpPrev) { jump = M.dist(prev, ally.root.position); hpPrev = ally.hp; }
      else ally.root.position.set(allyPos.x, 0, allyPos.z);
    }
    M.ok('队友被击退 ≈4m 并硬直', jump > 3.4 && jump < 4.3 && ally.stagger > 0.3,
      `${jump.toFixed(2)}/${ally.stagger.toFixed(2)}`);
    M.killAllies();
    M.clear();
    M.placePlayer(p);
  },

  targeting() {
    const M = window.__M3, g = M.g();
    const p = M.spot.p, dir = M.spot.dir, side = { x: -dir.z, z: dir.x };
    M.clear();
    const blade = M.reviveAlly(0, p.x + side.x * 4.5 + dir.x * 3.5, p.z + side.z * 4.5 + dir.z * 3.5);
    const w = M.spawn('walker', M.at(p, side, 6));
    M.ok('等距压力优先玩家（bias 15）', M.forceTarget(w) === 0, w.targetId);
    g.enemies.damage(w, 10, w.root.position, new THREE.Vector3(1, 0, 0), false, blade.id, 'rifle');
    M.ok('队友伤害记忆 +40 抢仇恨', M.forceTarget(w) === blade.id, w.targetId);
    g.time += 6;
    M.ok('记忆 5s 衰减后回落玩家', M.forceTarget(w) === 0, w.targetId);
    M.clear();
    M.placePlayer(p);
    const bl2 = M.reviveAlly(0, p.x + side.x * 3, p.z + side.z * 3);
    const b = M.spawn('bomber', M.at(p, side, 8));
    M.ok('膨胀体 targetRule=nearest 追最近', M.forceTarget(b) === bl2.id, b.targetId);
    const s = M.spawn('splitter', M.at(p, side, 8));
    M.ok('裂魂者 targetRule=nearest 追最近', M.forceTarget(s) === bl2.id, s.targetId);
    const r = M.spawn('runner', M.at(p, side, 8));
    M.ok('疾行者仍走 aggro 打分', M.forceTarget(r) === 0, r.targetId);
    M.killAllies();
    M.clear();
    M.placePlayer(p);
  },

  spawnGating() {
    const M = window.__M3, g = M.g(), DZ = window.DZ, es = g.enemies;
    const top = g.world.spawnGroups['顶'];
    const bomber = es.defOf({ type: 'bomber' }), tyrant = es.defOf({ type: 'tyrant' });
    let fromTop = 0, topHit = 0;
    for (let i = 0; i < 120; i++) {
      const p = es.groupPoint('顶', tyrant);
      for (const point of top) if (p.distanceToSquared(point) < 1e-6) fromTop++;
      const q = es.groupPoint('顶', bomber);
      for (const point of top) if (q.distanceToSquared(point) < 1e-6) topHit++;
    }
    M.ok('非膨胀体绝不走车顶投放点', fromTop === 0, fromTop);
    M.ok('膨胀体按车顶组投放', topHit >= 30, topHit);
    M.ok('注册表 spawnPoints 覆盖', bomber.spawnPoints.indexOf('顶') >= 0 && tyrant.spawnPoints.length === 3);
    const wave13 = DZ.WAVES.mode('giant').waves[12];
    const bomberEntry = wave13.entries.find(x => x.type === 'bomber');
    M.ok('第 13 波自爆点名车顶', bomberEntry && bomberEntry.groups[0] === '顶');
  },

  waveMix() {
    const M = window.__M3, g = M.g();
    M.boot('giant', 'normal');
    g.wave = 5;
    g.enemies.startWave(5);
    M.immortal();
    g.enemies.spawnTimer = 0;
    const types = new Set();
    for (let i = 0; i < 1200; i++) {
      g.enemies.runner.pending = 1;
      g.update(1 / 60);
      for (const e of g.enemies.list) types.add(e.type);
      if (types.size >= 3 && g.enemies.aliveCount() >= 10) break;
    }
    const list = ['walker', 'bomber', 'tyrant'];
    M.ok('第 5 波三种敌全部落地', list.every(t => types.has(t)), Array.from(types).sort().join(','));
    M.ok('第 5 波不出高威胁新种', !types.has('fogger') && !types.has('splitter'));
    const any = g.enemies.list.find(e => e.type === 'tyrant');
    M.ok('实际生成的敌持有 def/钩子', any && any.def.key === 'tyrant' &&
      typeof any.behavior.attack === 'function' && any.melee.cooldown === 1.7);
    const bo = g.enemies.list.find(e => e.type === 'bomber');
    M.ok('膨胀体 def 挂上起爆参数', bo && bo.def.blast.damage === 60 && typeof bo.behavior.think === 'function');
    M.clear();
  },

  wave10() {
    const M = window.__M3, g = M.g();
    M.boot('giant', 'normal');
    g.wave = 10;
    g.enemies.startWave(10);
    M.immortal();
    g.enemies.spawnTimer = 0;
    const types = new Set();
    let peak = 0;
    for (let i = 0; i < 1500 && !(types.size >= 5 && peak >= 12); i++) {
      g.enemies.runner.pending = 1;
      g.update(1 / 60);
      for (const e of g.enemies.list) types.add(e.type);
      peak = Math.max(peak, g.enemies.aliveCount());
    }
    const want = ['fogger', 'splitter', 'bomber', 'walker', 'runner'];
    M.ok('第 10 波五类敌同场', want.every(t => types.has(t)), Array.from(types).sort().join(','));
    M.ok('第 10 波不出暴君', !types.has('tyrant'));
    M.ok('同屏上限 32 生效', peak > 5 && peak <= 32, peak);
    const fog = g.enemies.list.find(e => e.type === 'fogger');
    M.ok('雾散体 def 挂上黑雾参数',
      Boolean(fog) && fog.def.fog.radius === 6 && fog.def.fog.life === 8 && fog.def.fog.every === 6);
    const sp = g.enemies.list.find(e => e.type === 'splitter');
    M.ok('裂魂者 def 挂上闪现与击退参数',
      Boolean(sp) && sp.def.blink.cooldown === 8 && sp.def.shove.distance === 4);
    M.clear();
  },

  waveTable() {
    const M = window.__M3;
    const W = window.DZ.WAVES, mode = W.mode('giant');
    // §6 六波检查表：普通难度下逐波核对兵力、同屏上限与批次/BOSS 标记。
    for (const [n, total, alive] of [[5, 18, 30], [10, 26, 32], [15, 2, 36], [20, 12, 40], [29, 60, 45], [30, 0, 45]]) {
      const cfg = W.waveAt(mode, n - 1);
      const q = W.queue(mode, n - 1, 'normal');
      M.ok(`${n} 波兵力 ${total} / 同屏 ${alive}`, q.length === total && cfg.maxAlive === alive,
        `${q.length}/${cfg.maxAlive}`);
    }
    const b15 = W.waveAt(mode, 14), b20 = W.waveAt(mode, 19), b30 = W.waveAt(mode, 29);
    M.ok('15/20 波为泰坦', b15.boss && b15.bossType === 'titan' && b20.boss && b20.bossType === 'titan');
    M.ok('30 波为巨型泰坦', Boolean(b30.boss) && b30.bossType === 'megaTitan');
    M.ok('29 波分 4 批投放', W.waveAt(mode, 28).batches === 4 && W.waveAt(mode, 28).batchInterval === 5);
    M.ok('15/20/30 波带无限增援', Boolean(b15.reinforce && b20.reinforce && b30.reinforce));
    const keys = ['walker', 'runner', 'bomber', 'tyrant', 'fogger', 'splitter', 'titan', 'megaTitan'];
    const reg = window.DZ.ENEMY_REGISTRY;
    M.ok('注册表 8 类登记完整', keys.every(k => reg[k] && reg[k].radius > 0 &&
      ['aggro', 'nearest', 'threat'].includes(reg[k].targetRule) && Array.isArray(reg[k].spawnPoints) &&
      reg[k].melee.cooldown > 0));
    M.ok('BOSS 登记 threat 仇恨规则与技能参数',
      reg.titan.targetRule === 'threat' && reg.megaTitan.targetRule === 'threat' &&
      reg.titan.charge.distance === 10 && reg.megaTitan.charge.distance === 16 &&
      reg.megaTitan.quake.at === 0.6 && reg.megaTitan.rage.at === 0.4);
    M.ok('M3b 后 TYPES 全部落地', keys.every(k => !window.DZ.WAVES.TYPES[k].placeholder));
  },

  diag() {
    const M = window.__M3, g = M.g();
    const p = M.spot.p, dir = M.spot.dir;
    M.ok('spot', true, `${p.x},${p.z} dir=${dir.x.toFixed(2)},${dir.z.toFixed(2)}`);
    M.immortal();
    M.clear();
    const f = M.spawn('fogger', M.at(p, dir, 9));
    const rows = [];
    for (let i = 0; i < 420; i++) {
      M.step(1);
      if (i % 60 === 59) rows.push(`t${((i + 1) / 60).toFixed(1)} cd=${f.fogCd.toFixed(2)} hp=${f.hp} dead=${f.dead} fogs=${g.effects.fogs.length} st=${g.state}`);
    }
    M.ok('fogger trace', true, rows.join(' | '));
    M.ok('fogger hooks', true, `${Object.keys(f.behavior).join(',')} fog=${JSON.stringify(f.def.fog)} scale=${f.scale} r=${f.radius}`);
    M.clear();
    M.immortal();
    const t = M.spawn('tyrant', new window.THREE.Vector3(p.x + 0.3, 0, p.z + 0.5));
    const blade = M.reviveAlly(0, p.x + 2.2, p.z + 0.4);
    const rows2 = [];
    for (let i = 0; i < 60; i++) {
      M.step(1);
      if (i % 10 === 9) rows2.push(`f${i} d=${M.dist(t.root.position, g.player.position).toFixed(2)} cd=${t.cooldown.toFixed(2)} direct=${t.direct} tc=${t.targetId} php=${g.player.health} bhp=${blade.hp}`);
    }
    M.ok('tyrant trace', true, rows2.join(' | '));
    M.ok('tyrant seg', true, `seg=${g.world.segmentClear(t.root.position, g.player.position, 0.12)} standE=${g.world.canStand(t.root.position.x, t.root.position.z, 0.12)} units=${g.enemies.ctx.units.length} reach=${t.def.sweep.reach}`);
    M.killAllies();
    M.clear();
    M.placePlayer(p);
    const bl = M.reviveAlly(0, p.x + 2.2, p.z + 0.4);
    const rg = M.reviveAlly(2, p.x - 2.4, p.z + 0.2);
    const sh = M.reviveAlly(1, p.x + 4.6, p.z);
    const t3 = M.spawn('tyrant', new window.THREE.Vector3(p.x + 0.3, 0, p.z + 0.5));
    const rows3 = [];
    for (let i = 0; i < 60; i++) {
      M.step(1);
      bl.root.position.set(p.x + 2.2, 0, p.z + 0.4);
      rg.root.position.set(p.x - 2.4, 0, p.z + 0.2);
      sh.root.position.set(p.x + 4.6, 0, p.z);
      if (i % 8 === 7) {
        const c = g.enemies.ctx;
        const ep = t3.root.position;
        const scores = c.units.map(u => {
          const d = Math.hypot(u.position.x - ep.x, u.position.z - ep.z);
          const mem = t3.aggro[u.id];
          const kept = mem ? mem.value * Math.max(0, 1 - (g.time - mem.at) / 5) : 0;
          return `${u.id}:d${d.toFixed(2)}/s${(d < 15 ? (15 - d) * 2 : 0) + kept + (u.isPlayer ? 15 : 0)}`;
        }).join(' ');
        rows3.push(`f${i} cd=${t3.cooldown.toFixed(2)} tc=${t3.targetId} epos=${ep.x.toFixed(2)},${ep.z.toFixed(2)}` +
          ` ppos=${g.player.position.x.toFixed(2)},${g.player.position.z.toFixed(2)} ${scores}` +
          ` php=${g.player.health} bhp=${bl.hp} rhp=${rg.hp} shp=${sh.hp} st=${g.state}`);
      }
    }
    M.ok('sweep trace', true, rows3.join(' | '));
    M.killAllies();
  },

  fogShot() {
    const M = window.__M3, g = M.g();
    const p = M.spot.p, dir = M.spot.dir;
    M.clear();
    M.immortal();
    for (const m of (g.squad ? g.squad.members : [])) m.root.visible = false;
    const f = M.spawn('fogger', M.at(p, dir, 9));
    const w = M.spawn('walker', M.at(p, dir, 13));
    M.stepPin(400, [{ obj: f, x: f.root.position.x, z: f.root.position.z },
      { obj: w, x: w.root.position.x, z: w.root.position.z }]);
    M.look(dir);
    g.world.render();
    const cloud = g.effects.fogs[0];
    M.ok('黑雾体积球已生成', Boolean(cloud) && cloud.root.visible !== false && cloud.material.opacity > 0.2,
      `${g.effects.fogs.length}/${cloud && cloud.material.opacity.toFixed(2)}/${cloud && cloud.life.toFixed(1)}`);
  },

  visuals() {
    const M = window.__M3, g = M.g();
    M.clear();
    g.ui.bannerRemaining = 0;
    g.ui.el['wave-banner'].style.display = 'none';
    const p = M.spot.p, dir = M.spot.dir, side = { x: -dir.z, z: dir.x };
    const keys = ['tyrant', 'bomber', 'splitter', 'fogger', 'runner', 'walker'];
    const posed = keys.map((k, i) => {
      const off = (i - 2.5) * 2.6;
      const e = M.spawn(k, new window.THREE.Vector3(
        p.x + dir.x * 9 + side.x * off, 0, p.z + dir.z * 9 + side.z * off));
      e.pathClock = 1e9;
      e.root.rotation.y = Math.atan2(p.x - e.root.position.x, p.z - e.root.position.z);
      return { e, x: e.root.position.x, z: e.root.position.z };
    });
    posed.find(o => o.e.type === 'bomber').e.fuse = 2;
    for (const m of (g.squad ? g.squad.members : [])) m.root.visible = false;
    M.immortal();
    M.look(dir);
    for (let i = 0; i < 30; i++) {
      g.time += 1 / 60;
      g.enemies.update(1 / 60);
      g.effects.update(1 / 60);
      g.world.update(1 / 60);
      for (const o of posed) o.e.root.position.set(o.x, 0, o.z);
    }
    g.world.render();
    M.ok('六敌种同屏渲染无异常', g.enemies.list.length === 6, g.enemies.list.length);
    M.ok('排布', true, posed.map(o => `${o.e.type}@${M.dist(o, p).toFixed(1)}`).join(' '));
    return 'rendered';
  }
};

(async () => {
  const browser = await connect();
  const only = process.argv[2];
  const shotAt = process.argv[3] || (only ? null : 'visuals');
  const names = Object.keys(CASES).filter(n => !only || n === only);
  try {
    await browser.send('Page.reload', { ignoreCache: true });
    for (let i = 0; i < 120; i++) {
      const ready = await browser.evaluate(
        '(document.getElementById("boot").classList.contains("ready") && window.DZ && window.DZ.game) ? "ready" : "wait"');
      if (ready === 'ready') break;
      await new Promise(r => setTimeout(r, 300));
    }
    const harness = `(() => {
      const M = {};
      ${Object.entries(HELPERS).map(([k, v]) => `M.${k} = function ${v.toString()};`).join('\n')}
      M.log = [];
      window.__M3 = M;
      return typeof window.DZ + '/' + (window.DZ && typeof window.DZ.game);
    })()`;
    console.log('harness ->', await browser.evaluate(harness));
    let pass = 0, fail = 0;
    const failures = [];
    for (const name of names) {
      const bootState = await browser.evaluate(
        '(() => { try { window.__M3.log = []; return window.__M3.boot(); } catch (e) { return "BOOT-FAIL " + e.message; } })()');
      if (bootState !== 'ready') console.log('!! boot ->', bootState);
      const result = await browser.evaluate(
        `(() => {
          window.__case = function ${CASES[name].toString()};
          try { window.__case(); } catch (err) {
            window.__M3.log.push(['异常 ${name}', false, (err && err.message) + ' @ ' + String(err && err.stack || '').split('\\n')[1]]);
          }
          delete window.__case;
          return window.__M3.log;
        })()`);
      const bad = result.filter(r => !r[1]);
      pass += result.length - bad.length;
      fail += bad.length;
      failures.push(...bad.map(r => `${name} :: ${r[0]} -> ${r[2]}`));
      console.log(`\n[${name}] ${result.length - bad.length}/${result.length}`);
      for (const r of result) console.log(`  ${r[1] ? 'PASS' : 'FAIL'} ${r[0]}${r[2] ? '  -> ' + r[2] : ''}`);
      if (shotAt === name) {
        const out = path.resolve(__dirname, `tmp-${name}.png`);
        let buffer = null;
        try {
          await browser.send('Page.bringToFront');
          const shot = await browser.send('Page.captureScreenshot', { format: 'png' });
          buffer = Buffer.from(shot.data, 'base64');
        } catch (error) {
          // 页签无法前台化时 CDP 截图会超时，回退为页内自绘。
          const dataUrl = await browser.evaluate(`(() => {
            const g = window.DZ.game;
            g.world.render();
            return g.world.renderer.domElement.toDataURL('image/png');
          })()`);
          buffer = Buffer.from(dataUrl.replace(/^data:image\/png;base64,/, ''), 'base64');
          console.log('  screenshot fallback (canvas):', error.message);
        }
        fs.writeFileSync(out, buffer);
        console.log('  shot ->', out);
      }
    }
    console.log(`\n== ${pass} passed, ${fail} failed ==`);
    if (failures.length) console.log(failures.join('\n'));
    if (browser.errors.length) console.log('page exceptions:', JSON.stringify(browser.errors.slice(0, 2)).slice(0, 600));
  } finally {
    await browser.evaluate('(() => { if (window.__M3) window.__M3.unpatch(); if (window.__rafFreeze) { window.requestAnimationFrame = window.__rafFreeze; window.__rafFreeze = null; } const g = window.DZ.game; g.showMenu(); return "restored"; })()');
    browser.close();
  }
})();
