'use strict';
// 临时 M4b 冒烟脚本：页内定步长推进 g.update(1/60)，验证完即删除。
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
  // 逐步推进并记录回调，用于"全程都必须成立"的断言（战场限制、高度不越界）。
  scan(n, watch, dt) {
    dt = dt || 1 / 60;
    const seen = [];
    for (let i = 0; i < n; i++) {
      this.g().update(dt);
      const s = watch();
      if (s) seen.push(s);
    }
    return seen;
  },
  freeze() {
    if (!window.__rafFreeze) {
      window.__rafFreeze = window.requestAnimationFrame;
      window.requestAnimationFrame = function () { return 0; };
    }
  },
  setup(wave, options) {
    const opts = options || {};
    const DZ = window.DZ;
    this.freeze();
    this.unpatch();
    DZ.Settings = { mode: opts.mode || 'giant', difficulty: 'normal', coins: 30 };
    const g = DZ.game;
    g.newGame();
    g.state = 'playing';
    g.ui.setScreen('playing');
    this.spot = this.findCorridor(17, 5) || this.findSpot(20) || this.findSpot(14) || this.findSpot(8);
    if (!this.spot) return 'no-open-spot';
    this.placePlayer(this.spot.p);
    if (!opts.allies) this.killAllies();
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
    this.g().world.settleY(m.root.position);
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
  // 落点高度一律交给 floorAt：地面传 y=0，车顶传 y=3.2，与真实站立面一致。
  placePlayer(p) {
    const g = this.g();
    g.player.position.set(p.x, 0, p.z);
    g.world.settleY(g.player.position);
    g.player.velocityY = 0; g.player.grounded = true;
    g.player.stagger = 0; g.player.invulnerable = 0; g.player.health = 100;
    g.player.yaw = 0; g.player.pitch = 0;
    g.player.syncCamera();
  },
  immortal() { this.g().player.invulnerable = 1e9; },
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
  // 走真实投放链路（组名 → 白名单 → 净空搜索），才能带上 entry.group 的冲顶/战场标记。
  spawnAt(group, type, wave) {
    const es = this.g().enemies;
    const entry = { type, group };
    if (wave) entry.summon = window.DZ.WAVES.mode('giant').waves[wave - 1].summon;
    return es.spawnAt(es.groupPoint(group, es.defOf(entry)), entry);
  },
  bossAt(group, type, wave) {
    const es = this.g().enemies;
    // 波次运行器会自动投 BOSS，手工构造时先锁掉它，否则同波出现两只泰坦。
    es.runner.bossSpawned = true;
    const e = this.spawnAt(group, type, wave);
    e.born = 0;
    e.root.scale.setScalar(e.scale);
    return e;
  },
  // 与 tmp-m3b 同规格的"测试直刷"：不带 group，用来验证新规则不侵入既有测试路径。
  boss(type, dist, wave) {
    const M = this, g = M.g(), es = g.enemies;
    const p = M.spot.p, dir = M.spot.dir;
    const cfg = window.DZ.WAVES.mode('giant').waves[(wave || 15) - 1];
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
    this.g().world.settleY(e.root.position);
    return e;
  },
  pin(e, x, z) {
    e.root.position.set(x, 0, z);
    this.g().world.settleY(e.root.position);
    return e;
  },
  cell(x, z) {
    const nav = this.g().world.nav;
    return Math.floor(z - nav.minZ) * nav.w + Math.floor(x - nav.minX);
  },
  look(dir) {
    const g = this.g();
    g.player.yaw = Math.atan2(-dir.x, -dir.z);
    g.player.pitch = -0.02;
    g.player.syncCamera();
  }
};

const CASES = {
  // 友方导航层：车顶/斜坡对友方开放，地面层与悬崖规则不变。
  allyNavGrid() {
    const M = window.__M4, g = M.g(), world = g.world;
    const nav = world.nav, ally = world.navAlly;
    M.ok('navAlly 与地面层同规格', ally && ally.w === nav.w && ally.h === nav.h &&
      ally.minX === nav.minX && ally.minZ === nav.minZ, `${ally.w}x${ally.h}`);
    M.ok('navAlly 比地面层更宽（多出顶面与斜坡）', (() => {
      let extra = 0;
      for (let i = 0; i < nav.blocked.length; i++) if (!nav.blocked[i] && ally.blocked[i]) extra++;
      return extra === 0;
    })(), (() => {
      let extra = 0;
      for (let i = 0; i < nav.blocked.length; i++) if (!nav.blocked[i] && ally.blocked[i]) extra++;
      return `地面可达但友方不可达 ${extra} 格`;
    })());
    M.ok('车顶格子只对友方开放', ally.blocked[M.cell(0, -2)] === 0 && nav.blocked[M.cell(0, -2)] === 1);
    M.ok('斜坡格子只对友方开放', ally.blocked[M.cell(-6, 18)] === 0 && nav.blocked[M.cell(-6, 18)] === 1);
    M.ok('装载甲板格子友方可达', ally.blocked[M.cell(0, 11)] === 0 && nav.blocked[M.cell(0, 11)] === 1);
    M.ok('车头残骸顶面对谁都不可达', ally.blocked[M.cell(0, -17.6)] === 1);
    M.ok('出发区/通道口两层都可达', ally.blocked[M.cell(0, 30)] === 0 && nav.blocked[M.cell(0, 30)] === 0 &&
      ally.blocked[M.cell(-20.5, -26)] === 0);
    M.ok('无斜坡的顶面不会凭空连通（车厢下方地面仍是墙）',
      world.floorAt(0, 0) === 3.2 && world.canStand(0, 0, 0.5, 0) === false);
    M.ok('换图后流场缓存清空（不会残留旧图导航层）', world.fields.size === 0, world.fields.size);
  },

  // 游骑兵默认岗位在车顶，并能从车顶压制同一射界内的地面目标。
  rangerRoof() {
    const M = window.__M4, g = M.g(), world = g.world;
    const ranger = g.squad.members[2];
    const post = world.squadPosts[2];
    M.immortal();
    M.ok('游骑兵默认岗位就是火车车顶（§4）', post.y === 3.2 && world.floorAt(post.x, post.z) === 3.2,
      `${post.x},${post.y},${post.z}`);
    M.ok('开局游骑兵已在车顶', Math.abs(ranger.root.position.y - 3.2) < 0.01 &&
      M.dist(ranger.root.position, post) < 0.6, `${ranger.root.position.y.toFixed(2)}/${M.dist(ranger.root.position, post).toFixed(2)}`);
    M.step(120);
    M.ok('无人可打时游骑兵守在同一顶面', Math.abs(ranger.root.position.y - 3.2) < 0.01,
      ranger.root.position.y.toFixed(2));
    // 车厢侧脚下射界内的地面目标
    const w = M.spawn('walker', { x: 6.5, y: 0, z: 4 });
    w.pathClock = 1e9;
    const hp0 = w.hp, ammo0 = ranger.ammo;
    let held = true;
    for (let i = 0; i < 900; i++) {
      M.pin(w, 6.5, 4);
      M.step(1);
      if (Math.abs(ranger.root.position.y - 3.2) > 0.01) held = false;
    }
    M.ok('游骑兵在车顶狙杀地面目标（掉血）', w.hp < hp0 - 20, `${hp0}->${w.hp}`);
    M.ok('射击消耗弹匣（确实在开火）', ranger.ammo < ammo0 || ranger.reload > 0, `${ammo0}->${ranger.ammo}`);
    M.ok('车顶队友不因这段射击离开顶面', held === true, ranger.root.position.y.toFixed(2));
    M.ok('地面怪物咬不到车顶（高台安全仍在）', ranger.hp === ranger.maxHp, `${ranger.hp}/${ranger.maxHp}`);
    M.ok('冲顶以外的怪不会误上顶面', g.enemies.list.every(e => !e.topRush || e === w));
  },

  // 阵亡重生后，游骑兵沿斜坡自己跑回车顶岗位（navAlly 的端到端验证）。
  rangerReturn() {
    const M = window.__M4, g = M.g(), world = g.world;
    const ranger = g.squad.members[2];
    M.immortal();
    g.squad.damage(ranger, 9999, ranger.root.position, { x: 0, z: 1 });
    M.ok('游骑兵阵亡', ranger.dead === true);
    ranger.respawn = 0.01;
    M.step(10);
    M.ok('在阶段 C 复活点重生（地面）', !ranger.dead && ranger.root.position.y < 0.5,
      `${ranger.root.position.y.toFixed(2)} @ ${ranger.root.position.z.toFixed(1)}`);
    const start = { x: ranger.root.position.x, z: ranger.root.position.z };
    // 装载甲板与车顶同为 3.2m，只判高度会中途误停，必须一路走到岗位点。
    let climb = 0, frames = 0, walked = 0, px = start.x, pz = start.z;
    while (frames++ < 3000 && M.dist(ranger.root.position, world.squadPosts[2]) > 2) {
      M.step(1);
      const p = ranger.root.position;
      walked += M.dist(p, { x: px, z: pz }); px = p.x; pz = p.z;
      if (p.y > 0.5 && p.y < 3.1) climb = 1;
    }
    const near = M.dist(ranger.root.position, world.squadPosts[2]);
    M.ok('沿斜坡自行返岗上车顶', Math.abs(ranger.root.position.y - 3.2) < 0.01 && near < 2,
      `${ranger.root.position.y.toFixed(2)} / ${frames} 帧`);
    M.ok('途中确实经过斜坡中间高度', climb === 1);
    M.ok('返岗后停在岗位附近', near < 2.5, near.toFixed(2));
    M.ok('返岗路程不是瞬移（走了 >15m）', walked > 15, walked.toFixed(1));
  },

  // '顶'组投放的自爆体沿斜坡冲顶起爆；其余敌种仍受地面规则约束。
  topRushClimb() {
    const M = window.__M4, g = M.g(), world = g.world;
    M.placePlayer({ x: 0, z: -2 });
    M.vulnerable();
    M.ok('玩家已站到车顶', Math.abs(g.player.position.y - 3.2) < 0.01, g.player.position.y.toFixed(2));
    const b = M.spawnAt('顶', 'bomber');
    M.ok('顶组自爆体拿到冲顶标记', b.topRush === true && b.def.key === 'bomber');
    M.ok('冲顶起点在坡脚地面', b.root.position.y === 0 && b.root.position.z > 20,
      `${b.root.position.y}/${b.root.position.z.toFixed(1)}`);
    const walker = M.spawn('walker', { x: 6.5, y: 0, z: 4 });
    walker.pathClock = 1e9;
    let mid = 0, onRamp = 0, frames = 0;
    while (frames++ < 1800 && !b.dead) {
      M.pin(walker, 6.5, 4);
      M.step(1);
      const y = b.root.position.y;
      if (y > 0.5 && y < 3.1) mid = 1;
      if (y > 0.5 && (b.root.position.x > 3.9 || b.root.position.x < -3.9) && b.root.position.z > 11.9) onRamp = 1;
      M.ok.length; // 占位：循环里不记录断言
    }
    M.ok('冲顶自爆体爬上车顶高度', Math.abs(b.root.position.y - 3.2) < 0.01 || b.dead,
      `${b.root.position.y.toFixed(2)}/${frames} 帧`);
    M.ok('中途经过斜坡高度', mid === 1);
    M.ok('走的是南端两条斜坡而不是穿墙', onRamp === 1);
    M.ok('在车顶起爆并对车顶玩家造成 60 伤', b.dead === true && g.player.health === 40,
      `${b.dead}/${g.player.health}`);
    M.ok('车顶仍不塌：起爆后位置在顶面', b.root.position.y > 3, b.root.position.y.toFixed(2));
    M.ok('普通步行者全程贴地（地面规则未破）', walker.root.position.y === 0, walker.root.position.y.toFixed(2));
  },

  // 无人占顶时冲顶个体退回地面作战；非'顶'组自爆体绝不获得冲顶能力。
  topRushGround() {
    const M = window.__M4, g = M.g();
    M.placePlayer({ x: 0, z: 30 });
    M.vulnerable();
    const b = M.spawnAt('顶', 'bomber');
    M.ok('顶组个体仍然带冲顶标记', b.topRush === true);
    const far = M.spawnAt('西', 'bomber');
    M.ok('西组自爆体不带冲顶标记（只有顶组启用）', far.topRush === false && far.def.key === 'bomber');
    let climb = 0;
    // 长图西点在 60m 外，自爆体按 2.4m/s 走近要 25s，给足 3200 帧。
    for (let i = 0; i < 3200; i++) {
      M.step(1);
      if (b.root.position.y > 0.5 || far.root.position.y > 0.5) climb = 1;
      // 第一只已经用伤害证明"地面照常威胁"，之后保命免得玩家进入濒死影响后续判定。
      if (g.player.health < 70) M.immortal();
      if (b.dead && far.dead) break;
    }
    M.ok('车顶无人时冲顶个体在地面作战', climb === 0 && b.root.position.y < 0.5 && far.root.position.y < 0.5,
      `${b.root.position.y}/${far.root.position.y}`);
    M.ok('两只自爆体都贴脸起爆（地面照常威胁）',
      g.player.health < 100 && b.dead && far.dead, `${g.player.health}/${b.dead}/${far.dead}`);
    const roofAlly = M.reviveAlly(2, 0, -2, false);
    roofAlly.root.position.set(0, 3.2, -2);
    M.ok('高层队友会抢到冲顶个体的仇恨', (() => {
      g.player.position.set(0, 0, 24);
      g.world.settleY(g.player.position);
      const c = M.spawnAt('顶', 'bomber');
      c.pathClock = 0;
      M.forceTarget(c);
      return c.targetId === roofAlly.id;
    })(), 'targetId ' + (g.enemies.list[g.enemies.list.length - 1] || {}).targetId);
  },

  // BOSS 刷点净空：泰坦 0.968 / 巨型泰坦 1.232，落点绝不嵌进掩体。
  bossClear() {
    const M = window.__M4, g = M.g(), es = g.enemies, world = g.world;
    M.immortal();
    const titanDef = es.defOf({ type: 'titan', bossScale: 2.2 });
    const megaDef = es.defOf({ type: 'megaTitan', bossScale: 2.8 });
    M.ok('净空半径按 radius×bossScale', Math.abs(titanDef.radius * 2.2 - 0.968) < 0.01 &&
      Math.abs(megaDef.radius * 2.8 - 1.232) < 0.01,
      `${(titanDef.radius * 2.2).toFixed(3)}/${(megaDef.radius * 2.8).toFixed(3)}`);
    for (const group of ['西', '东', '北']) {
      let bad = 0;
      for (let i = 0; i < 60; i++) {
        const p = es.groupPoint(group, titanDef);
        if (!world.canStand(p.x, p.z, 0.968)) bad++;
      }
      M.ok(`泰坦在${group}组刷点有 0.968m 净空`, bad === 0, `${bad}/60 不合格`);
    }
    let megaBad = 0, outside = 0;
    for (let i = 0; i < 60; i++) {
      const p = es.groupPoint('南', megaDef);
      if (!world.canStand(p.x, p.z, 1.232)) megaBad++;
      if (Math.abs(p.x) > 24 - 1.232 || Math.abs(p.z) > 48 - 1.232) outside++;
    }
    M.ok('巨型泰坦在南组刷点有 1.232m 净空', megaBad === 0 && outside === 0, `${megaBad}/60`);
    M.ok('南组两个刷点都在战场内', world.spawnGroups['南'].every(p =>
      p.x >= -22 && p.x <= 22 && p.z >= 14 && p.z <= 44),
      JSON.stringify(world.spawnGroups['南'].map(p => [p.x, p.z])));
    const t = M.bossAt('西', 'titan', 15);
    M.ok('泰坦实际落点满足自身半径', world.canStand(t.root.position.x, t.root.position.z, t.radius),
      `${t.radius.toFixed(3)} @ ${t.root.position.x.toFixed(1)},${t.root.position.z.toFixed(1)}`);
    const mega = M.bossAt('南', 'megaTitan', 30);
    M.ok('巨型泰坦实际落点满足自身半径', world.canStand(mega.root.position.x, mega.root.position.z, mega.radius) &&
      world.floorAt(mega.root.position.x, mega.root.position.z) === 0,
      `${mega.radius.toFixed(3)} @ ${mega.root.position.x.toFixed(1)},${mega.root.position.z.toFixed(1)}`);
    M.ok('巨型泰坦只认南组（白名单换成战场）', megaDef.spawnPoints.length === 1 && megaDef.spawnPoints[0] === '南',
      JSON.stringify(megaDef.spawnPoints));
    M.ok('自爆体白名单同时保留顶组与南组', es.defOf({ type: 'bomber' }).spawnPoints.join(',') === '西,东,北,顶,南',
      es.defOf({ type: 'bomber' }).spawnPoints.join(','));
  },

  // §7 决战战场：巨型泰坦被压在火车南段 30m 内，冲刺也不越界；测试直刷不受限。
  arena() {
    const M = window.__M4, g = M.g(), world = g.world;
    const a = world.bossArena;
    M.ok('战场取值：南段 30m 纵深', a && a.minZ === 14 && a.maxZ === 44 && a.maxZ - a.minZ === 30,
      a && `${a.minX}..${a.maxX} / ${a.minZ}..${a.maxZ}`);
    M.immortal();
    const b = M.bossAt('南', 'megaTitan', 30);
    M.ok('南组投放的巨型泰坦绑定战场', b.arena === a && b.topRush !== true);
    M.pin(b, -22, 15);
    M.placePlayer({ x: -18, z: 6 });
    b.skill.slamCd = 1e9;
    b.skill.summonCd = 1e9;
    b.skill.chargeCd = 0;
    b.cooldown = 1e9;
    let wind = 0, frames = 0, escaped = null;
    while (frames++ < 900 && b.skill.phase !== 'charge') {
      M.step(1);
      if (b.skill.phase === 'chargeWind') wind = 1;
      const p = b.root.position;
      if (p.z < a.minZ - 0.02 || p.z > a.maxZ + 0.02 || p.x < a.minX - 0.02 || p.x > a.maxX + 0.02) escaped = p.z;
    }
    M.ok('玩家退到战场外仍触发冲刺（前摇 0.8s）', wind === 1, b.skill.phase);
    const startZ = b.root.position.z;
    let chargeFrames = 0;
    while (b.skill.phase === 'charge' && chargeFrames++ < 200) {
      M.step(1);
      const p = b.root.position;
      if (p.z < a.minZ - 0.02 || p.z > a.maxZ + 0.02 || p.x < a.minX - 0.02 || p.x > a.maxX + 0.02) escaped = p.z;
      if (p.z < a.minZ + 0.1) break;
    }
    M.ok('16m 冲刺被战场边界截住（贴边不越界）', escaped === null && b.root.position.z >= a.minZ - 0.01,
      `start ${startZ.toFixed(1)} -> ${b.root.position.z.toFixed(1)} / 越界=${escaped}`);
    M.ok('冲刺位移小于纸面 16m（边界吃掉剩余里程）', startZ - b.root.position.z < 11.5,
      (startZ - b.root.position.z).toFixed(2));
    M.step(120);
    M.ok('冲刺结束后仍在战场内且进入 CD', b.root.position.z >= a.minZ - 0.01 && b.skill.chargeCd > 9,
      `${b.root.position.z.toFixed(1)}/${b.skill.chargeCd.toFixed(1)}`);
    // 追击越界的玩家：整段时间都不许离开战场
    M.pin(b, 0, 20);
    M.placePlayer({ x: 0, z: -40 });
    const track = M.scan(1200, () => {
      const p = b.root.position;
      return (p.z < a.minZ - 0.02 || p.x < a.minX - 0.02 || p.x > a.maxX + 0.02) ? p.z : null;
    });
    M.ok('追击北方玩家 20s 也出不去战场', track.length === 0 && b.root.position.z >= a.minZ - 0.01,
      `越界 ${track.length} 帧 / z=${b.root.position.z.toFixed(1)}`);
    M.ok('仇恨仍按威胁记忆走（不被战场逻辑改写）', b.targetId === 0, b.targetId);
    // 回归安全：测试直刷（不带 group）不绑定战场，tmp-m3b 的冲刺位移断言才仍然成立
    const raw = M.boss('megaTitan', 16, 30);
    M.ok('不带组的手刷 BOSS 不受战场限制', raw.arena === null && raw.skill.phase === 'idle', String(raw.arena));
    const plain = M.bossAt('西', 'titan', 15);
    M.ok('15/20 波泰坦不绑定战场（只限巨型泰坦）', plain.arena === null);
  },

  // 真实 30 波链路：BOSS 与增援都从南组入场、落点在战场内。
  wave30() {
    const M = window.__M4, g = M.g(), es = g.enemies, runner = es.runner, a = g.world.bossArena;
    M.immortal();
    M.placePlayer({ x: 0, z: 40 });
    const cfg = window.DZ.WAVES.mode('giant').waves[29];
    M.ok('30 波数据改为南段战场投放', cfg.groups.length === 1 && cfg.groups[0] === '南', JSON.stringify(cfg.groups));
    runner.bossSpawned = false;
    M.step(2);
    const b = es.boss;
    M.ok('30 波开局从南组刷出巨型泰坦', b && b.type === 'megaTitan' && runner.bossAlive);
    M.ok('BOSS 落在战场内并绑定限制', b.root.position.z >= a.minZ && b.root.position.z <= a.maxZ && b.arena === a,
      `${b.root.position.x.toFixed(1)},${b.root.position.z.toFixed(1)}`);
    runner.reinforceClock = 0.5;
    M.step(60);
    const queued = runner.queue.slice(0, 3).map(e => e.group);
    M.ok('增援也按南组入队', queued.every(x => x === '南') && runner.queue.length === 3, JSON.stringify(queued));
    es.spawnTimer = 0;
    const born = [];
    for (let i = 0; i < 240; i++) {
      es.runner.pending = 3;
      es.spawnTimer = 0;
      M.step(1);
      for (const e of es.list) if (e.type === 'bomber' && born.indexOf(e) < 0) born.push(e);
      if (born.length >= 3) break;
    }
    M.ok('南组增援能真的落地（白名单放行）', born.length >= 3, `${born.length} 只`);
    M.ok('增援自爆体入场点在战场南侧', born.every(e => e.root.position.z >= 14 && e.root.position.z <= 44),
      JSON.stringify(born.map(e => Math.round(e.root.position.z))));
    M.ok('增援自爆体不是冲顶个体', born.every(e => e.topRush === false));
  },

  // 练习模式零变化：旧图、旧玩法、无小队、无战场。
  practiceZero() {
    const M = window.__M4, g = M.g(), world = g.world;
    const state = M.setup(5, { mode: 'practice' });
    M.ok('练习模式可开局', state === 'ready', state);
    M.ok('练习模式不建小队（§4 只在巨人城）', g.squad === null);
    M.ok('练习图没有战场限制', world.bossArena === undefined && world.defensePost.y === 0);
    M.ok('练习图没有高度面', world.surfaces.length === 0 && world.floorAt(0, 0) === 0);
    M.ok('练习图 navAlly 与地面层等价', (() => {
      const n = world.nav, a = world.navAlly;
      if (a.w !== n.w || a.h !== n.h) return false;
      for (let i = 0; i < n.blocked.length; i++) if (n.blocked[i] && !a.blocked[i]) return false;
      return true;
    })(), '友方层不得比地面层更宽');
    M.ok('练习图刷点组保持原样', Object.keys(world.spawnGroups).join(',') === '西,东,北,顶' &&
      world.spawnGroups['顶'].length === 1, Object.keys(world.spawnGroups).join(','));
    M.ok('练习波次表仍是 5 波', g.totalWaves === 5 && window.DZ.WAVES.mode('practice').dataDriven === false,
      g.totalWaves);
    const e = M.spawn('walker', { x: 0, y: 0, z: 6 });
    M.step(180);
    M.ok('练习模式怪物照旧贴地追击', e.root.position.y === 0 && e.targetId === 0,
      `${e.root.position.y}/${e.targetId}`);
    const b = M.spawnAt('顶', 'bomber');
    M.ok('练习图顶组自爆体上不了任何高度', b.root.position.y === 0, b.root.position.y.toFixed(2));
  },

  // 氛围适配：长图阴影取景、南段作业灯、雾与背景。
  atmosphere() {
    const M = window.__M4, g = M.g(), world = g.world;
    const sun = world.group.children.find(o => o.isDirectionalLight);
    const cam = sun.shadow.camera;
    M.ok('太阳阴影取景覆盖 96m 长图', cam.top >= 70 && cam.bottom <= -70 && cam.left <= -44 && cam.right >= 44 &&
      cam.far >= 150, JSON.stringify({ l: cam.left, r: cam.right, t: cam.top, b: cam.bottom, f: cam.far }));
    const points = world.group.children.filter(o => o.isPointLight);
    M.ok('斜坡/甲板区有独立作业灯', points.some(p => p.position.z > 12 && p.position.z < 26 && p.position.y > 5),
      JSON.stringify(points.map(p => [p.position.x, p.position.y, Math.round(p.position.z)])));
    M.ok('背景与体积雾随图设置', world.scene.fog && world.scene.fog.isFogExp2 &&
      world.scene.fog.density > 0 && !!world.scene.background,
      world.scene.fog.density.toFixed(4));
    M.ok('换图重烘静态阴影', g.world.renderer.shadowMap.autoUpdate === false &&
      g.world.renderer.shadowMap.enabled === true);
    M.step(60);
    M.ok('车顶能被玩家正常看见（floorAt 与视线一致）', (() => {
      M.placePlayer({ x: 0, z: -2 });
      const ray = new window.THREE.Raycaster();
      ray.set(new window.THREE.Vector3(0, 5.2, 6), new window.THREE.Vector3(0, -1, -8).normalize());
      ray.far = 20;
      const hit = ray.intersectObjects(world.blockers, false)[0];
      return Math.abs(g.world.floorAt(0, -2) - 3.2) < 0.01 && Boolean(hit);
    })(), '车顶阻挡视线用 blockers 判定');
  },

  // 45 同屏性能：定步长纯模拟 + 带渲染两种口径。
  perf45() {
    const M = window.__M4, g = M.g(), es = g.enemies, world = g.world;
    M.setup(29, { allies: true });
    M.immortal();
    M.placePlayer({ x: 0, z: 20 });
    // 关掉自然出怪与增援，改用 29 波兵种直刷，保证同屏数稳定可控。
    es.spawnTimer = 1e9;
    es.runner.reinforceClock = 1e9;
    const mix = ['walker', 'runner', 'splitter', 'fogger', 'tyrant'];
    let serial = 0;
    const spawnOne = () => {
      for (let r = 17; r >= 7; r -= 2) {
        for (let a = 0; a < 24; a++) {
          const ang = a * Math.PI / 12 + serial * 0.37;
          const x = Math.round(Math.sin(ang) * r), z = Math.round(20 + Math.cos(ang) * r);
          if (!world.canStand(x, z, 0.6, 0)) continue;
          if (es.list.some(e => !e.dead && Math.hypot(e.root.position.x - x, e.root.position.z - z) < e.radius + 0.5)) continue;
          serial++;
          // 每 9 只塞一只顶组自爆体：navAlly 上的 'e'+id 流场与冲顶爬升要一起计入成本。
          if (serial % 9 === 0) return Boolean(M.spawnAt('顶', 'bomber', 29));
          M.spawn(mix[serial % mix.length], new window.THREE.Vector3(x, 0, z), 29);
          return true;
        }
      }
      return false;
    };
    let guard = 0;
    while (es.aliveCount() < 45 && guard++ < 200) if (!spawnOne()) break;
    const peak = es.aliveCount();
    M.ok('第 29 波能堆到 45 同屏', peak >= 45, `${peak} 只 / ${guard} 次投放`);
    let simMs = 0, sumAlive = 0;
    for (let i = 0; i < 600; i++) {
      while (es.aliveCount() < 45) if (!spawnOne()) break;
      const t0 = performance.now();
      g.update(1 / 60);
      simMs += performance.now() - t0;
      sumAlive += es.aliveCount();
    }
    simMs /= 600;
    const frame0 = performance.now();
    for (let i = 0; i < 120; i++) { g.update(1 / 60); g.world.render(); }
    const frameMs = (performance.now() - frame0) / 120;
    const alive = es.aliveCount(), meanAlive = sumAlive / 600;
    const topRush = es.list.filter(e => e.topRush && !e.dead).length;
    const fields = world.fields.size;
    M.ok('45 同屏定步长模拟 < 8ms/帧', simMs < 8, `${simMs.toFixed(2)}ms（均 ${meanAlive.toFixed(1)} 只存活，冲顶 ${topRush}，流场 ${fields} 张）`);
    M.ok('45 同屏含渲染 < 40ms/帧（软渲染机）', frameMs < 40, `${frameMs.toFixed(2)}ms`);
    M.ok('模拟全程存活数不超过同屏上限', peak <= (es.runner.cfg.maxAlive || 45) + 2 && meanAlive > 35,
      `峰值 ${peak} / 均值 ${meanAlive.toFixed(1)}`);
    console.log(`  perf: sim ${simMs.toFixed(2)}ms/frame, frame(with render) ${frameMs.toFixed(2)}ms, alive ${alive}, topRush ${topRush}`);
  }
};

(async () => {
  const only = process.argv[2] || null;
  const shotAt = process.argv[3] || (only ? null : null);
  const names = Object.keys(CASES).filter(n => !only || n === only);
  const browser = await connect();
  try {
    let ready = '';
    for (let i = 0; i < 20; i++) {
      ready = await browser.evaluate('(() => (window.DZ && window.DZ.game && window.DZ.game.world) ? "ok" : "waiting")()');
      if (ready === 'ok') break;
      await new Promise(r => setTimeout(r, 300));
    }
    const harness = `(() => {
      const M = {};
      ${Object.entries(HELPERS).map(([k, v]) => `M.${k} = function ${v.toString()};`).join('\n')}
      M.log = [];
      window.__M4 = M;
      return typeof window.DZ + '/' + (window.DZ && typeof window.DZ.game);
    })()`;
    console.log('harness ->', await browser.evaluate(harness));
    let pass = 0, fail = 0;
    const failures = [];
    for (const name of names) {
      const bootState = await browser.evaluate(
        `(() => { try { window.__M4.log = []; const s = window.__M4.setup(${name === 'practiceZero' ? 5 : name === 'wave30' ? 30 : name === 'bossClear' ? 15 : name === 'arena' ? 30 : name === 'rangerRoof' || name === 'rangerReturn' || name === 'rangerReturn' ? 25 : 13}, ${name === 'practiceZero' ? '{mode:"practice"}' : name === 'rangerRoof' || name === 'rangerReturn' ? '{allies:true}' : '{}'}); return s; } catch (e) { return 'BOOT-FAIL ' + e.message; } })()`);
      if (bootState !== 'ready') console.log('!! setup ->', bootState);
      const result = await browser.evaluate(
        `(() => {
          window.__case = function ${CASES[name].toString()};
          try { window.__case(); } catch (err) {
            window.__M4.log.push(['异常 ${name}', false, (err && err.message) + ' @ ' + String(err && err.stack || '').split('\\n')[1]]);
          }
          delete window.__case;
          return window.__M4.log;
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
    // 收尾只做轻量还原；45 同屏后立刻渲染菜单会把 CDP 卡超时，所以还原失败就改用整页重载兜底。
    let restored = false;
    try {
      await browser.evaluate('(() => { if (window.__M4) window.__M4.unpatch(); if (window.__rafFreeze) { window.requestAnimationFrame = window.__rafFreeze; window.__rafFreeze = null; } const g = window.DZ.game; while (g.enemies.list.length) g.enemies.remove(0); g.effects.reset(); g.showMenu(); return "restored"; })()');
      restored = true;
    } catch (error) { console.log('restore skipped:', error.message); }
    if (!restored) { try { await browser.send('Page.reload', { ignoreCache: false }); } catch (error) { /* 连接已断，交给下一次运行 */ } }
    browser.close();
  }
})();
