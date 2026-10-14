'use strict';
// 临时 M3b 冒烟脚本：页内定步长推进 g.update(1/60)，验证完即删除。
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
    es.onBossDeath = null;
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
  freeze(rAF) {
    if (!window.__rafFreeze) {
      window.__rafFreeze = window.requestAnimationFrame;
      window.requestAnimationFrame = function () { return 0; };
    }
  },
  setup(wave) {
    const DZ = window.DZ;
    this.freeze();
    this.unpatch();
    DZ.Settings = { mode: 'giant', difficulty: 'normal', coins: 30 };
    const g = DZ.game;
    g.newGame();
    g.state = 'playing';
    g.ui.setScreen('playing');
    this.spot = this.findCorridor(17, 5) || this.findSpot(20) || this.findSpot(14) || this.findSpot(8);
    if (!this.spot) return 'no-open-spot';
    this.placePlayer(this.spot.p);
    this.killAllies();
    g.wave = wave - 1;
    g.enemies.startWave(wave);
    // 直接进波：绕开 4 秒准备倒计时，否则测试中途会自动 startWave() 换波。
    g.wavePhase = 'active';
    g.nextWaveIn = 1e9;
    this.clear();
    return 'ready';
  },
  clear() {
    const es = this.g().enemies;
    while (es.list.length) es.remove(0);
    // 冻结 rAF 前还有一帧真实循环会跑，先锁掉自动投 BOSS，否则上一波的泰坦会漏进当前场景。
    es.boss = null;
    es.runner.bossSpawned = true;
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
  findSpot(len) {
    const world = this.g().world;
    for (let r = 0; r <= 18; r += 3) {
      for (let a = 0; a < 12; a++) {
        const ang = a * Math.PI / 6;
        const p = { x: Math.round(Math.sin(ang) * r), z: Math.round(Math.cos(ang) * r) };
        if (!world.canStand(p.x, p.z, 0.62)) continue;
        const dir = this.rayDir(p, len, 0.62);
        if (dir) return { p, dir };
      }
    }
    return null;
  },
  // BOSS 冲刺要穿过玩家身后，所以要求前后都有无障碍走廊。
  findCorridor(front, back) {
    const world = this.g().world;
    for (let r = 0; r <= 18; r += 2) {
      for (let a = 0; a < 24; a++) {
        const ang = a * Math.PI / 12;
        const p = { x: Math.round(Math.sin(ang) * r), z: Math.round(Math.cos(ang) * r) };
        if (!world.canStand(p.x, p.z, 1.1)) continue;
        const dir = this.rayDir(p, front, 1.1);
        if (!dir) continue;
        let clear = true;
        for (let t = 0.25; t <= back + 0.01; t += 0.25) {
          if (!world.canStand(p.x - dir.x * t, p.z - dir.z * t, 1.1)) { clear = false; break; }
        }
        if (clear) return { p, dir };
      }
    }
    return null;
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
  // 伤害/击退断言要求玩家处于可受击状态：invulnerable>0 时 player.damage 与 knockback 都会早退。
  vulnerable() {
    const p = this.g().player;
    p.invulnerable = 0; p.health = 100;
  },
  dist(a, b) { return Math.hypot(a.x - b.x, a.z - b.z); },
  forceTarget(e) {
    const g = this.g();
    g.enemies.chooseTarget(e, window.DZ.allyUnits(g));
    return e.targetId;
  },
  // 直接构造 BOSS，绕开波次投放，保证技能断言可复现。
  boss(type, dist, wave) {
    const M = this, g = M.g(), es = g.enemies;
    const p = M.spot.p, dir = M.spot.dir;
    const cfg = window.DZ.WAVES.mode('giant').waves[(wave || 15) - 1];
    // 波次运行器会自动投一个 BOSS，手工构造时先锁掉它，否则同波出现两只泰坦。
    es.runner.bossSpawned = true;
    const e = es.spawn(M.at(p, dir, dist), wave || 15,
      { type, bossScale: window.DZ.WAVES.TYPES[type].scale, summon: cfg.summon });
    e.born = 0;
    e.root.scale.setScalar(e.scale);
    return e;
  },
  spawn(type, position, wave) {
    const p = position.clone ? position.clone() : new window.THREE.Vector3(position.x, 0, position.z);
    const e = this.g().enemies.spawn(p, wave || 5, { type });
    e.born = 0;
    e.root.scale.setScalar(e.scale);
    return e;
  },
  look(dir) {
    const g = this.g();
    g.player.yaw = Math.atan2(-dir.x, -dir.z);
    g.player.pitch = -0.02;
    g.player.syncCamera();
  }
};

const CASES = {
  // §7 泰坦骨架：血量/体型/刷点/仇恨规则。
  titanBase() {
    const M = window.__M3, g = M.g(), es = g.enemies;
    M.immortal();
    const b = M.boss('titan', 12, 15);
    M.ok('泰坦 6000 HP / scale 2.2 / 半径 0.97',
      b.hp === 6000 && b.scale === 2.2 && Math.abs(b.radius - 0.968) < 0.01 && b.boss,
      `${b.hp}/${b.scale}/${b.radius.toFixed(3)}`);
    M.ok('BOSS 技能阶段机就位', b.skill && b.skill.phase === 'idle' &&
      b.skill.chargeCd === 3 && b.skill.slamCd === 5 && b.skill.summonCd === 12,
      JSON.stringify({ p: b.skill.phase, c: b.skill.chargeCd, s: b.skill.slamCd, u: b.skill.summonCd }));
    M.ok('冲刺/砸地/召唤参数对齐 §7',
      b.def.charge.cooldown === 12 && b.def.charge.windup === 0.8 && b.def.charge.speed === 14 &&
      b.def.charge.distance === 10 && b.def.charge.damage === 40 && b.def.charge.knockback === 3 &&
      b.def.slam.cooldown === 8 && b.def.slam.windup === 0.9 && b.def.slam.radius === 5 &&
      b.def.slam.damage === 50 && b.def.summon.every === 20,
      JSON.stringify(b.def.charge));
    M.ok('移速 2.2（践踏缓慢贴近）', b.speed === 2.2 && b.def.targetRule === 'threat');
    M.ok('近战接触 CD 2s / 前摇 0.5s', b.melee.cooldown === 2 && b.melee.windup === 0.5);
  },

  // 直线冲刺：0.8s 抬臂前摇不动身 → 14m/s 冲 10m → 40 伤 + 击退 3m → CD 12s。
  charge() {
    const M = window.__M3, g = M.g();
    const p = M.spot.p, dir = M.spot.dir;
    M.immortal();
    const b = M.boss('titan', 12, 15);
    b.skill.slamCd = 1e9;
    b.skill.summonCd = 1e9;
    b.cooldown = 1e9;
    let wind = 0, windFrames = 0, movedInWind = 0;
    for (let i = 0; i < 600 && b.skill.phase !== 'charge'; i++) {
      const before = { x: b.root.position.x, z: b.root.position.z };
      M.step(1);
      if (b.skill.phase === 'chargeWind') {
        if (!wind) wind = 1;
        windFrames++;
        movedInWind = Math.max(movedInWind, M.dist(before, b.root.position));
      }
    }
    M.ok('进入冲刺前摇并持续 0.8s', wind === 1 && windFrames > 44 && windFrames < 52, windFrames);
    M.ok('前摇期间不位移', movedInWind < 0.05, movedInWind.toFixed(3));
    const start = { x: b.root.position.x, z: b.root.position.z };
    M.vulnerable();
    const hpBefore = g.player.health;
    const pStart = { x: p.x, z: p.z };
    let frames = 0;
    while (b.skill.phase === 'charge' && frames++ < 120) M.step(1);
    const travelled = M.dist(start, b.root.position);
    M.ok('冲刺位移 ≈10m', travelled > 9.2 && travelled < 10.9, travelled.toFixed(2));
    M.ok('冲刺命中 40 伤', hpBefore - g.player.health === 40, hpBefore - g.player.health);
    M.ok('冲刺命中击退 ≈3m', M.dist(pStart, g.player.position) > 2.5,
      M.dist(pStart, g.player.position).toFixed(2));
    M.ok('冲刺结束后 CD 12s', b.skill.chargeCd > 11.4 && b.skill.chargeCd <= 12 && b.skill.phase === 'idle',
      b.skill.chargeCd.toFixed(2));
    // 同一轮冲刺不重复结算伤害。
    M.ok('一次冲刺对同一目标只结算一次', g.player.health >= 60, g.player.health);
  },

  // 砸地：0.9s 红圈预警 → 5m 半径 50 伤 → CD 8s；圈外不受影响。
  slam() {
    const M = window.__M3, g = M.g();
    const p = M.spot.p, dir = M.spot.dir, side = { x: -dir.z, z: dir.x };
    M.immortal();
    const b = M.boss('titan', 3.6, 15);
    b.skill.chargeCd = 1e9;
    b.skill.summonCd = 1e9;
    b.skill.slamCd = 0.4;
    b.cooldown = 1e9;
    const far = M.spawn('walker', M.at(p, dir, 0).add(new window.THREE.Vector3(side.x * 6.4, 0, side.z * 6.4)));
    far.pathClock = 1e9;
    far.speed = 0;
    let frames = 0;
    while (b.skill.phase !== 'slamWind' && frames++ < 400) M.step(1);
    const warned = g.effects.warns[0] || null;
    M.ok('砸地前摇生成红圈（半径 5）', warned && warned.root.scale.x === 5, warned && warned.root.scale.x);
    let windFrames = 0, hpBefore = g.player.health;
    while (b.skill.phase === 'slamWind' && windFrames++ < 200) {
      // 前摇最后一刻才放开无敌，否则砸地伤害被开局无敌窗吃掉。
      if (b.skill.wind <= 0.05) M.vulnerable();
      M.step(1);
    }
    M.ok('红圈持续 0.9s', windFrames > 48 && windFrames < 62, windFrames);
    M.ok('砸地结算 50 伤', hpBefore - g.player.health === 50, hpBefore - g.player.health);
    M.ok('5m 圈外单位不受砸地', far.hp === 80, far.hp);
    M.ok('砸地后 boom 特效生成', g.effects.blows.length > 0, g.effects.blows.length);
    M.ok('砸地 CD 8s', b.skill.slamCd > 7.4 && b.skill.slamCd <= 8, b.skill.slamCd.toFixed(2));
  },

  // 召唤：15 波 2 步行 + 2 疾行，CD 20s；20 波换成 2 自爆 + 2 疾行。
  summon() {
    const M = window.__M3, g = M.g();
    M.immortal();
    const b = M.boss('titan', 14, 15);
    b.skill.chargeCd = 1e9;
    b.skill.slamCd = 1e9;
    b.skill.summonCd = 0.2;
    M.step(30);
    const born = g.enemies.list.filter(e => e !== b && !e.dead);
    const count = type => born.filter(e => e.type === type).length;
    M.ok('15 波召唤 2 步行 + 2 疾行', born.length === 4 && count('walker') === 2 && count('runner') === 2,
      born.map(e => e.type).join(','));
    M.ok('召唤 CD 20s 复位', b.skill.summonCd > 19, b.skill.summonCd.toFixed(2));
    M.ok('召唤物落在 BOSS 周围', born.every(e => M.dist(e.root.position, b.root.position) < 9),
      Math.max(...born.map(e => M.dist(e.root.position, b.root.position))).toFixed(1));
    M.clear();
    const c = M.boss('titan', 14, 20);
    c.skill.chargeCd = 1e9; c.skill.slamCd = 1e9; c.skill.summonCd = 0.2;
    M.step(30);
    const born2 = g.enemies.list.filter(e => e !== c && !e.dead);
    M.ok('20 波召唤 2 自爆 + 2 疾行',
      born2.filter(e => e.type === 'bomber').length === 2 && born2.filter(e => e.type === 'runner').length === 2,
      born2.map(e => e.type).join(','));
    M.ok('召唤表来自波次配置而非注册表', c.def.summon.picks[0].some(x => x.type === 'bomber') &&
      b.def.summon.picks[0].every(x => x.type !== 'bomber'));
  },

  // 践踏仇恨：追伤害记忆最深者；无人输出时取最远目标。
  threat() {
    const M = window.__M3, g = M.g(), es = g.enemies;
    const p = M.spot.p, dir = M.spot.dir, side = { x: -dir.z, z: dir.x };
    M.immortal();
    const b = M.boss('titan', 10, 15);
    b.pathClock = 1e9;
    const blade = M.reviveAlly(0, p.x + side.x * 3, p.z + side.z * 3, true);
    const ranger = M.reviveAlly(2, p.x - side.x * 9, p.z - side.z * 9, true);
    M.step(1);
    M.forceTarget(b);
    M.ok('无人输出时 BOSS 扑向最远目标', b.targetId === ranger.id, `${b.targetId}`);
    es.damage(b, 10, b.root.position, { x: 0, z: 1 }, false, 0);
    M.step(1);
    M.forceTarget(b);
    M.ok('玩家单次输出即锁定 BOSS', b.targetId === 0, `${b.targetId}`);
    for (let i = 0; i < 4; i++) es.damage(b, 10, b.root.position, { x: 0, z: 1 }, false, blade.id);
    M.step(1);
    M.forceTarget(b);
    M.ok('BOSS 转咬最高伤害来源', b.targetId === blade.id, `${b.targetId}`);
    g.time += 5.2;
    M.forceTarget(b);
    M.ok('记忆 5s 衰减后回到最远目标', b.targetId === ranger.id, `${b.targetId}`);
  },

  // 巨型泰坦：15000 HP、冲刺 16m/50 伤/可小幅转向、连砸两次、震波。
  mega() {
    const M = window.__M3, g = M.g();
    const p = M.spot.p, dir = M.spot.dir;
    M.immortal();
    const b = M.boss('megaTitan', 16, 30);
    M.ok('巨型泰坦 15000 HP / scale 2.8', b.hp === 15000 && b.scale === 2.8 && b.radius > 1.2,
      `${b.hp}/${b.scale}/${b.radius.toFixed(2)}`);
    M.ok('增强参数：冲刺 16m 50 伤可转向、连砸 2 次',
      b.def.charge.distance === 16 && b.def.charge.damage === 50 && b.def.charge.turn === 0.4 &&
      b.def.slam.repeats === 2 && b.def.quake.at === 0.6 && b.def.rage.at === 0.4,
      JSON.stringify({ c: b.def.charge.distance, r: b.def.slam.repeats }));
    b.skill.slamCd = 1e9;
    b.skill.summonCd = 1e9;
    b.skill.chargeCd = 0.1;
    b.cooldown = 1e9;
    let wind = 0;
    for (let i = 0; i < 600 && b.skill.phase !== 'charge'; i++) {
      if (b.skill.phase === 'chargeWind') wind = 1;
      M.step(1);
    }
    const start = { x: b.root.position.x, z: b.root.position.z };
    M.vulnerable();
    const hpBefore = g.player.health;
    let frames = 0;
    while (b.skill.phase === 'charge' && frames++ < 150) M.step(1);
    const travelled = M.dist(start, b.root.position);
    M.ok('巨型泰坦冲刺 ≈16m', travelled > 14.8 && travelled < 17.4, travelled.toFixed(2));
    M.ok('冲刺伤害 50', hpBefore - g.player.health === 50, hpBefore - g.player.health);
    M.ok('前摇仍为 0.8s', wind === 1);
  },

  // 连砸 + 震波：两次 5m AoE；HP 跨过 60% 时全场击退 2m 且不掉血。
  megaSkills() {
    const M = window.__M3, g = M.g();
    const p = M.spot.p, dir = M.spot.dir;
    M.immortal();
    const b = M.boss('megaTitan', 3.6, 30);
    b.skill.chargeCd = 1e9;
    b.skill.summonCd = 1e9;
    b.skill.slamCd = 0.1;
    let slams = 0, prevBlows = 0, phases = [];
    for (let i = 0; i < 240 && slams < 2; i++) {
      M.step(1);
      if (g.effects.blows.length > prevBlows) { slams++; phases.push(b.skill.phase); }
      prevBlows = g.effects.blows.length;
    }
    M.ok('连砸结算两次', slams === 2, `${slams}/${phases.join('>')}`);
    M.ok('两次之间有 0.5s 间隔（slamGap 阶段）', phases[0] === 'slamGap', phases[0]);
    M.ok('连砸后进入 8s CD', b.skill.slamCd > 7 && b.skill.slamCd <= 8, b.skill.slamCd.toFixed(2));
    // 震波
    M.clear();
    const b2 = M.boss('megaTitan', 9, 30);
    b2.skill.chargeCd = 1e9; b2.skill.slamCd = 1e9; b2.skill.summonCd = 1e9;
    const blade = M.reviveAlly(0, p.x + dir.x * 16, p.z + dir.z * 16, true);
    M.step(1);
    M.vulnerable();
    blade.stagger = 0;
    const bladePos = { x: blade.root.position.x, z: blade.root.position.z };
    const playerPos = { x: g.player.position.x, z: g.player.position.z };
    const hpBefore = g.player.health;
    b2.hp = Math.round(b2.maxHp * 0.59);
    M.step(2);
    const playerJump = M.dist(playerPos, g.player.position);
    const bladeJump = M.dist(bladePos, blade.root.position);
    M.ok('HP<60% 触发全场震波', playerJump > 1.5 && bladeJump > 1.5,
      `${playerJump.toFixed(2)}/${bladeJump.toFixed(2)}`);
    M.ok('震波不造成伤害', g.player.health === hpBefore, `${hpBefore}/${g.player.health}`);
    const posAfter = { x: g.player.position.x, z: g.player.position.z };
    b2.hp = Math.round(b2.maxHp * 0.5);
    M.step(30);
    M.ok('震波只触发一次（quakeDone 锁定）',
      M.dist(posAfter, g.player.position) < 0.2 && b2.skill.quakeDone === true,
      M.dist(posAfter, g.player.position).toFixed(3));
  },

  // 狂暴：HP≤40% 切形态，速度/CD/砸地半径/召唤表全部换档，可复现。
  rage() {
    const M = window.__M3, g = M.g();
    M.immortal();
    const b = M.boss('megaTitan', 12, 30);
    M.ok('狂暴前保持基础形态', !b.rage && b.speed === 2.2 && b.def.rage.at === 0.4);
    b.hp = Math.round(b.maxHp * 0.41);
    M.step(2);
    M.ok('HP 41% 尚未狂暴', !b.rage);
    b.hp = Math.round(b.maxHp * 0.39);
    M.step(2);
    M.ok('HP≤40% 触发狂暴', b.rage === true);
    M.ok('狂暴移速 3.3', b.speed === 3.3, b.speed);
    M.ok('狂暴 CD×0.6', window.DZ.ENEMY_REGISTRY.megaTitan &&
      Math.abs(b.def.rage.cdScale - 0.6) < 1e-9 && b.def.rage.cdScale === 0.6);
    M.ok('狂暴砸地半径 6.5', b.def.rage.slamRadius === 6.5 && b.def.rage.summonFixed === 0);
    M.ok('狂暴红自发光', b.skin.emissive.getHex() === 0xa8281a && b.cloth.emissive.getHex() === 0x6e150f,
      b.skin.emissive.getHexString());
    // CD 缩放落到实际计时器上：狂暴后砸地 CD 8×0.6=4.8s，红圈半径 6.5
    b.skill.slamCd = 0;
    b.skill.chargeCd = 1e9;
    b.skill.summonCd = 1e9;
    b.skill.phase = 'idle';
    let frames = 0, sawWarn = 0;
    while (frames++ < 500 && !(b.skill.phase === 'idle' && b.skill.slamCd > 0)) {
      M.step(1);
      if (g.effects.warns.some(w => w.root.scale.x === 6.5)) sawWarn = 1;
    }
    M.ok('狂暴后砸地红圈半径 6.5', sawWarn === 1, g.effects.warns.length);
    M.ok('狂暴后砸地 CD 4.8s（8×0.6）', b.skill.slamCd > 4.3 && b.skill.slamCd <= 4.8, b.skill.slamCd.toFixed(2));
    // 召唤固定自爆
    M.clear();
    const c = M.boss('megaTitan', 12, 30);
    c.skill.chargeCd = 1e9; c.skill.slamCd = 1e9;
    c.hp = Math.round(c.maxHp * 0.3);
    c.skill.summonCd = 0.2;
    M.step(34);
    const born = g.enemies.list.filter(e => e !== c && !e.dead);
    M.ok('狂暴后召唤固定为自爆体', born.length === 3 && born.every(e => e.type === 'bomber'),
      born.map(e => e.type).join(','));
    M.ok('狂暴后召唤 CD 10.8s（18×0.6）', c.skill.summonCd > 10.3 && c.skill.summonCd <= 10.8,
      c.skill.summonCd.toFixed(2));
  },

  // 真实波次：15 波刷 BOSS、增援只在 BOSS 存活时入队、击杀后波次可结算。
  wave15() {
    const M = window.__M3, g = M.g(), es = g.enemies, runner = es.runner;
    M.immortal();
    runner.bossSpawned = false;
    M.step(2);
    M.ok('15 波开局投放泰坦', es.boss && es.boss.type === 'titan' && runner.bossAlive,
      `${es.boss && es.boss.type}/${runner.bossAlive}`);
    M.ok('泰坦击杀分 5000（§5 分数表）', es.boss.score === 5000 && es.boss.def.boss === true,
      es.boss.score);
    runner.reinforceClock = 0.5;
    M.step(60);
    M.ok('BOSS 存活时 20s 增援入队（2 步行 + 2 疾行）',
      runner.queue.length === 4 && runner.pending === 5, `${runner.queue.length}/${runner.pending}`);
    const b = es.boss;
    es.damage(b, 99999, b.root.position, { x: 0, z: 1 }, false, 0);
    M.ok('BOSS 死亡清除 bossAlive', !es.boss && runner.bossAlive === false);
    M.ok('BOSS 死亡计入击杀分', g.kills === 1 && g.score === 5000, `${g.kills}/${g.score}`);
    M.clear();
    g.enemies.startWave(15);
    M.step(2);
    const b2 = es.boss;
    M.ok('重新投放后 BOSS 就位', Boolean(b2) && b2.type === 'titan');
    es.damage(b2, 99999, b2.root.position, { x: 0, z: 1 }, false, 0);
    const queued = runner.queue.length;
    runner.reinforceClock = 0.5;
    M.step(600);
    M.ok('BOSS 死后增援停止投放', runner.queue.length === queued && es.list.filter(e => !e.dead).length === 0,
      `${queued}/${runner.queue.length}`);
    runner.pending = 0;
    M.step(2);
    M.ok('BOSS 死亡后波次可结算', g.wavePhase === 'intermission', g.wavePhase);
  },

  // M5 接缝：BOSS 死亡回调（15/20 波必掉特殊武器箱）。
  hook() {
    const M = window.__M3, g = M.g(), es = g.enemies;
    M.immortal();
    let calls = 0, at = null;
    es.onBossDeath = enemy => { calls++; at = { x: enemy.root.position.x, z: enemy.root.position.z }; };
    const b = M.boss('titan', 10, 15);
    es.damage(b, 99999, b.root.position, { x: 0, z: 1 }, false, 0);
    M.ok('BOSS 死亡触发特殊武器箱钩子', calls === 1 && at && Math.abs(at.x) < 40, `${calls}`);
    const w = M.spawn('walker', M.at(M.spot.p, M.spot.dir, 6));
    es.damage(w, 99999, w.root.position, { x: 0, z: 1 }, false, 0);
    M.ok('普通敌种死亡不触发钩子', calls === 1, calls);
    es.onBossDeath = null;
  },

  // 29 波（BOSS 前最后一波）：4 批次 × 5s 投放、六类混合、同屏上限 45、无 BOSS。
  wave29() {
    const M = window.__M3, g = M.g(), es = g.enemies, runner = es.runner;
    M.immortal();
    g.wave = 29;
    es.startWave(29);
    es.spawnTimer = 0;
    const types = new Set();
    const releases = [];
    let peak = 0, prevPending = 0, frames = 0;
    while (frames++ < 1500 && (runner.batchLeft > 0 || runner.pending > 0 || es.aliveCount() > 0)) {
      g.update(1 / 60);
      if (runner.pending > prevPending) releases.push(frames / 60);
      prevPending = runner.pending;
      for (const e of es.list) types.add(e.type);
      peak = Math.max(peak, es.aliveCount());
    }
    M.ok('29 波分 4 批投放 · 间隔 5s', releases.length === 4 &&
      Math.abs(releases[1] - releases[0] - 5) < 0.1 && Math.abs(releases[3] - releases[2] - 5) < 0.1,
      releases.map(t => t.toFixed(1)).join(','));
    M.ok('六类敌同场', ['bomber', 'splitter', 'fogger', 'tyrant', 'walker', 'runner']
      .every(t => types.has(t)), Array.from(types).sort().join(','));
    M.ok('同屏上限 45 生效', peak > 20 && peak <= 45, peak);
    M.ok('29 波不投 BOSS', !es.boss && runner.cfg.boss === false && !types.has('titan'),
      Array.from(types).sort().join(','));
    M.clear();
  },

  diag() {
    const M = window.__M3, g = M.g(), es = g.enemies;
    const p = M.spot.p, dir = M.spot.dir;
    M.ok('spot', true, `${p.x},${p.z} dir=${dir.x.toFixed(2)},${dir.z.toFixed(2)}`);
    M.immortal();
    const b = M.boss('titan', 12, 15);
    b.skill.slamCd = 1e9; b.skill.summonCd = 1e9;
    const trace = [];
    for (let i = 1; i <= 600; i++) {
      M.step(1);
      if (i % 60 === 0) trace.push(`t${i / 60} ph=${b.skill.phase} cd=${b.skill.chargeCd.toFixed(1)} d=${M.dist(b.root.position, g.player.position).toFixed(1)} direct=${b.direct} hp=${g.player.health}`);
    }
    M.ok('charge trace', true, trace.join(' | '));
    M.ok('warns/blows', true, `${g.effects.warns.length}/${g.effects.blows.length}`);
  },

  bossShot() {
    const M = window.__M3, g = M.g();
    const p = M.spot.p, dir = M.spot.dir, side = { x: -dir.z, z: dir.x };
    M.clear();
    g.ui.bannerRemaining = 0;
    g.ui.el['wave-banner'].style.display = 'none';
    for (const m of (g.squad ? g.squad.members : [])) m.root.visible = false;
    const t = M.boss('titan', 4.2, 15);
    const mega = M.boss('megaTitan', 15, 30);
    mega.root.position.set(p.x + dir.x * 15 + side.x * 7, 0, p.z + dir.z * 15 + side.z * 7);
    const tyr = M.spawn('tyrant', M.at(p, dir, 8).add(new window.THREE.Vector3(side.x * -6, 0, side.z * -6)));
    t.skill.slamCd = 0.2; t.skill.chargeCd = 1e9; t.skill.summonCd = 1e9;
    mega.skill.chargeCd = 1e9; mega.skill.summonCd = 1e9;
    t.pathClock = 1e9; mega.pathClock = 1e9; tyr.pathClock = 1e9;
    M.immortal();
    M.look(dir);
    const pins = [{ obj: t, x: t.root.position.x, z: t.root.position.z },
      { obj: mega, x: mega.root.position.x, z: mega.root.position.z },
      { obj: tyr, x: tyr.root.position.x, z: tyr.root.position.z }];
    M.stepPin(60, pins);
    g.world.render();
    M.ok('泰坦/巨型泰坦/暴君同框', g.enemies.list.length === 3 && g.effects.warns.length > 0,
      `${g.enemies.list.length}/${g.effects.warns.length}`);
  }
};

(async () => {
  const browser = await connect();
  const only = process.argv[2];
  const shotAt = process.argv[3] || (only ? null : 'bossShot');
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
        `(() => { try { window.__M3.log = []; return window.__M3.setup(${name === 'wave15' ? 15 : name === 'summon' ? 15 : 15}); } catch (e) { return 'BOOT-FAIL ' + e.message; } })()`);
      if (bootState !== 'ready') console.log('!! setup ->', bootState);
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
