'use strict';
// M5 · 补给与特殊武器 正式回归脚本：页内定步长推进 g.update(1/60)，冻结 rAF，不 sleep。
// 用法：node tests/tmp-m5.cjs [caseName]
const connect = require('./browser.cjs');

const HELPERS = {
  ok(name, cond, info) {
    this.log.push([name, Boolean(cond), info === undefined || info === null ? '' : String(info)]);
  },
  g() { return window.DZ.game; },
  unpatch() {},
  step(n, dt) {
    dt = dt || 1 / 60;
    for (let i = 0; i < n; i++) this.g().update(dt);
  },
  freeze() {
    if (!window.__rafFreeze) {
      window.__rafFreeze = window.requestAnimationFrame;
      window.requestAnimationFrame = function () { return 0; };
    }
  },
  // 真实链路开局：intermission 倒数 → game.startWave()（8/24/29 特殊箱就在这里投放）。
  // 默认随后进"静场"：清空队列但 pending=1 卡住波次结算，防测试中途自动换波。
  boot(wave, options) {
    const opts = options || {};
    const DZ = window.DZ;
    this.freeze();
    this.unpatch();
    DZ.Settings = { mode: opts.mode || 'giant', difficulty: 'normal', coins: opts.coins != null ? opts.coins : 30 };
    const g = DZ.game;
    g.newGame();
    g.state = 'playing';
    g.ui.setScreen('playing');
    this.spot = this.findCorridor(17, 5) || this.findSpot(20) || this.findSpot(14) || this.findSpot(8);
    if (!this.spot) return 'no-open-spot';
    this.placePlayer(this.spot.p);
    if (!opts.allies) this.killAllies();
    g.wave = wave - 1;
    g.wavePhase = 'intermission';
    g.nextWaveIn = 0.02;
    this.step(2);
    const started = g.wave === wave && g.wavePhase === 'active';
    if (!opts.live && !opts.keepBoss) {
      const es = g.enemies;
      es.runner.queue = [];
      while (es.list.length) es.remove(0);
      es.boss = null;
      es.runner.bossSpawned = true;
      es.runner.bossAlive = false;
      es.runner.pending = 1;
      es.runner.batchLeft = 0;
      es.runner.reinforceClock = 1e9;
      es.spawnTimer = 1e9;
      if (!opts.keepDrops) g.effects.reset();
    }
    this.g().time = 0;
    this.immortal();
    return started ? 'ready' : 'boot-fail:' + g.wave + '/' + g.wavePhase;
  },
  // 手动触发一次波次结算（走 game.update 的真实 clear 分支）。
  forceClear() {
    const g = this.g(), es = g.enemies;
    while (es.list.length) es.remove(0);
    es.boss = null;
    es.runner.queue = [];
    es.runner.batchLeft = 0;
    es.runner.pending = 0;
    es.runner.reinforceClock = 1e9;
    es.spawnTimer = 1e9;
    this.step(2);
    g.nextWaveIn = 1e9;
    return g.wavePhase;
  },
  killAllies() {
    const sq = this.g().squad;
    if (!sq) return;
    for (const m of sq.members) { m.dead = true; m.respawn = 1e9; }
  },
  reviveAlly(index, x, z) {
    const m = this.g().squad.members[index];
    m.dead = false; m.respawn = 1e9; m.stagger = 0;
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
  placePlayer(p) {
    const g = this.g();
    g.player.position.set(p.x, 0, p.z);
    g.world.settleY(g.player.position);
    g.player.velocityY = 0; g.player.grounded = true;
    g.player.stagger = 0; g.player.invulnerable = 0; g.player.health = 100;
    g.player.yaw = 0; g.player.pitch = 0;
    g.player.shooting = false;
    g.player.keys.clear();
    g.player.syncCamera();
  },
  immortal() { this.g().player.invulnerable = 1e9; },
  dist(a, b) { return Math.hypot(a.x - b.x, a.z - b.z); },
  spawn(type, position, wave) {
    const g = this.g();
    const p = position.clone ? position.clone() : new window.THREE.Vector3(position.x, 0, position.z);
    const e = g.enemies.spawn(p, wave != null ? wave : g.wave, { type });
    e.born = 0;
    e.root.scale.setScalar(e.scale);
    g.world.settleY(e.root.position);
    return e;
  },
  pin(e, x, z) {
    e.root.position.set(x, 0, z);
    this.g().world.settleY(e.root.position);
    return e;
  },
  look(dir, pitch) {
    const g = this.g();
    g.player.yaw = Math.atan2(-dir.x, -dir.z);
    g.player.pitch = pitch == null ? -0.02 : pitch;
    g.player.syncCamera();
  },
  // 玩家走到掉落/补给点上（水平 0.2m 内）触发拾取。
  standAt(p) { this.placePlayer({ x: p.x, z: p.z }); }
};

const CASES = {
  // ① 掉落寿命 35→20、寿命浮字、补给点位/上限/拾取/波末过期、波间结算真实链路。
  supplyCycle() {
    const M = window.__M5, g = M.g(), fx = g.effects, world = g.world;
    M.ok('巨人城 13 波真实开局', M.boot(13) === 'ready');
    M.immortal();
    fx.drop(g.player.position.clone().add(new THREE.Vector3(9, 0, 0)), 'health');
    const drop = fx.drops[fx.drops.length - 1];
    M.ok('击杀掉落寿命改为 20s（§8）', drop.life === 20, drop.life);
    M.ok('箱体浮字显示剩余秒数', drop.label && drop.label.text === '20', drop.label && drop.label.text);
    M.step(120);
    M.ok('浮字随时间倒数', drop.label && +drop.label.text <= 19, drop.label.text);

    // 点位静态验收
    const pts = world.supplyPoints;
    M.ok('4 个固定补给点', pts.length === 4);
    const badPts = pts.filter(p =>
      !world.canStand(p.x, p.z, 0.5) ||
      (p.x >= -22 && p.x <= 22 && p.z >= 14 && p.z <= 44)).map(p => [p.x, p.z]);
    M.ok('补给点全部可站立且避开 BOSS 战场', badPts.length === 0, JSON.stringify(badPts));
    M.ok('特殊箱中央平台投放位存在', world.specialBoxPoint &&
      world.canStand(world.specialBoxPoint.x, world.specialBoxPoint.z, 0.5));

    // 上一波遗留：未捡的特殊箱 + 已过半场的普通掉落 + 旧补给
    fx.drop(M.at(world.specialBoxPoint, { x: 1, z: 0 }, 2), 'gatling', { waveEnd: true });
    fx.drop(M.at(M.spot.p, M.spot.dir, 7), 'ammo');
    g.spawnWaveSupplies();
    const before = fx.drops.length;
    M.forceClear();
    M.ok('波次结算进入间歇', g.wavePhase === 'intermission' && g.completedWaves === 13,
      `${g.wavePhase}/${g.completedWaves}`);
    M.ok('未拾取的特殊箱波末消失', fx.drops.every(d => !d.weapon), `结算前 ${before} 现 ${fx.drops.length}`);
    M.ok('普通击杀掉落不吃波末规则（仍按 20s 寿命）', fx.drops.some(d => d.type === 'ammo'));
    M.ok('结算点亮 4 个补给箱', fx.supplies.length === 4);
    const kinds = fx.supplies.map(s => s.kind).sort().join(',');
    M.ok('补给构成为弹药×2 + 医疗×2', kinds === 'ammo,ammo,health,health', kinds);
    M.ok('补给点位与固定 4 点一一对应', fx.supplies.every(s =>
      pts.some(p => Math.abs(s.root.position.x - p.x) < 0.01 && Math.abs(s.root.position.z - p.z) < 0.01)));
    M.ok('间歇期浮字显示下一波倒数', /^\d+$/.test(fx.supplies[0].label.text), fx.supplies[0].label.text);
    M.standAt(fx.supplies[0].root.position);
    const reserve0 = g.weapons.items[0].reserve;
    const hp0 = g.player.health;
    const kind0 = fx.supplies[0].kind;
    M.step(2);
    const consumed = fx.supplies.length === 3;
    if (kind0 === 'ammo') {
      M.ok('弹药箱 +90/+36 走 addAmmo 入口', consumed &&
        g.weapons.items[0].reserve === Math.min(420, reserve0 + 90), `${reserve0}->${g.weapons.items[0].reserve}`);
      M.ok('满血也收弹药箱', consumed);
    } else {
      M.standAt(fx.supplies.find(s => s.kind === 'health').root.position);
      g.player.health = 60;
      M.step(2);
      M.ok('医疗箱回血 +35', g.player.health === 95, g.player.health);
    }
    // 满血拒收医疗箱
    g.player.health = 100;
    const hSupply = fx.supplies.find(s => s.kind === 'health');
    if (hSupply) {
      M.standAt(hSupply.root.position);
      M.step(2);
      M.ok('满血不浪费医疗箱', fx.supplies.includes(hSupply));
    }
    // 同屏上限 8
    for (let i = 0; i < 10; i++) fx.spawnSupply(pts[0], 'ammo');
    M.ok('补给同屏上限 8（超出丢最旧）', fx.supplies.length === 8, fx.supplies.length);
    fx.expireSupplies();

    // 队友吃补给 / 队友不吃特殊武器箱
    const sq = g.squad;
    M.boot(13);
    fx.spawnSupply(new THREE.Vector3(0, 0, 20), 'ammo');
    const ally = M.reviveAlly(0, 0.2, 20);
    ally.reserve = ally.def.reserve - 90;
    M.placePlayer({ x: 0, z: 34 });
    M.step(180);
    M.ok('队友会捡普通补给箱', fx.supplies.length === 0 && ally.reserve === ally.def.reserve,
      `${fx.supplies.length}/${ally.reserve}`);
    fx.drop(new THREE.Vector3(0, 0, 20), 'gatling', { waveEnd: true });
    M.reviveAlly(0, 0.2, 20);
    M.step(180);
    M.ok('队友绝不捡特殊武器箱（§4）', fx.drops.length === 1 && fx.drops[0].weapon, fx.drops.length);
    M.ok('玩家走到箱前立刻装备', (() => {
      M.standAt(fx.drops[0].root.position);
      M.step(1);
      return g.weapons.special && g.weapons.current.type === 'gatling' && fx.drops.length === 0;
    })());
  },

  // ③ 投放规则：8/24/29 开局中央平台，15/20 泰坦必掉，30 波不掉，练习模式全程零变化。
  specialBoxWaves() {
    const M = window.__M5, g = M.g();
    const WAVES = window.DZ.WAVES;
    const table = [[8, 'gatling'], [15, 'rocket'], [20, 'rocket'], [24, 'gatling'], [29, 'rocket']];
    let dataOk = true, detail = '';
    for (const [w, kind] of table) {
      const cfg = WAVES.waveAt(WAVES.mode('giant'), w - 1);
      if (!cfg.specialBox || cfg.specialWeapon !== kind) { dataOk = false; detail = `波 ${w}: ${cfg.specialBox}/${cfg.specialWeapon}`; }
    }
    M.ok('波表 8/15/20/24/29 都带 specialBox 且武器按表', dataOk, detail);
    for (const [w, kind] of [[8, 'gatling'], [24, 'gatling'], [29, 'rocket']]) {
      M.boot(w, { keepDrops: true });
      const box = g.effects.drops.find(d => d.weapon);
      M.ok(`${w} 波开局中央平台投${kind === 'rocket' ? '火箭筒' : '加特林'}箱`,
        box && box.type === kind &&
        Math.abs(box.root.position.x - g.world.specialBoxPoint.x) < 0.01 &&
        Math.abs(box.root.position.z - g.world.specialBoxPoint.z) < 0.01,
        box ? `${box.type}@${box.root.position.x.toFixed(1)},${box.root.position.z.toFixed(1)}` : '无箱');
      M.ok(`${w} 波箱：无限寿命 + 波末过期 + '波末'浮字`,
        box && box.life === Infinity && box.waveEnd === true && box.label.text === '波末');
    }
    for (const w of [15, 20]) {
      M.boot(w);
      M.ok(`${w} 波开局不预投（BOSS 必掉走死亡钩子）`, g.effects.drops.every(d => !d.weapon));
    }
    M.boot(30);
    M.ok('30 波巨型泰坦无 specialBox 标记',
      WAVES.waveAt(WAVES.mode('giant'), 29).specialBox === false);

    // 15 波泰坦必掉：走 damage→onBossDeath 真实链路
    M.boot(15, { keepBoss: true, live: true });
    let frames = 0;
    while (!g.enemies.boss && frames++ < 900) M.step(1);
    const titan = g.enemies.boss;
    M.ok('15 波 BOSS 已入场', Boolean(titan) && titan.type === 'titan', `等 ${frames} 帧`);
    const dropBefore = g.effects.drops.length;
    g.enemies.damage(titan, 999999, titan.root.position.clone(), new THREE.Vector3(0, 0, -1), false, 0, 'rifle');
    M.step(2);
    const box = g.effects.drops.find(d => d.weapon);
    M.ok('泰坦死亡必掉火箭筒箱（onBossDeath 接缝）',
      box && box.type === 'rocket' && g.effects.drops.length > dropBefore,
      box ? box.type : '未掉箱');
    M.ok('箱子落在泰坦倒地处', box &&
      Math.hypot(box.root.position.x - titan.root.position.x, box.root.position.z - titan.root.position.z) < 0.01);
    M.ok('30 波无标记 → 巨型泰坦不掉箱', (() => {
      M.boot(30);
      const mega = M.spawn('megaTitan', M.at(M.spot.p, M.spot.dir, 10));
      mega.maxHp = mega.hp = 9000;
      g.enemies.boss = mega;
      g.enemies.damage(mega, 999999, mega.root.position.clone(), new THREE.Vector3(0, 0, -1), false, 0, 'rifle');
      M.step(2);
      return g.effects.drops.every(d => !d.weapon);
    })());
    // 练习模式：任何波都不掉箱
    M.boot(5, { mode: 'practice' });
    const pt = M.spawn('titan', M.at(M.spot.p, M.spot.dir, 10));
    g.enemies.boss = pt;
    g.enemies.damage(pt, 999999, pt.root.position.clone(), new THREE.Vector3(0, 0, -1), false, 0, 'rifle');
    M.step(2);
    M.ok('练习模式泰坦死亡也不掉特殊箱', g.effects.drops.every(d => !d.weapon));
  },

  // ② M-56 加特林：数值/移速减益/禁跳/30s 时间表/HUD/倒地掉落与重捡。
  gatlingKit() {
    const M = window.__M5, g = M.g(), w = g.weapons, p = g.player;
    M.boot(13);
    M.immortal();
    // 数据：DPS ≈ 步枪 ×1.6
    const rifle = w.items[0];
    M.ok('M-56 面板 DPS ≈ 步枪×1.6', Math.abs((43 / 0.105) / (rifle.damage / rifle.interval) - 1.6) < 0.03,
      `${(43 / 0.105).toFixed(0)} vs ${(rifle.damage / rifle.interval).toFixed(0)}`);
    // 狙击快照：弹药原样冻结（武器五槽改造后特殊武器替换 5 号狙击槽）
    w.items[4].ammo = 5; w.items[4].reserve = 30;
    w.grantSpecial('gatling');
    M.ok('狙击槽被替换、步枪永远保留', w.current.type === 'gatling' && w.index === 4 &&
      w.items[0].type === 'rifle' && w.special.kind === 'gatling');
    M.ok('拾取时快照狙击弹药', w.special.sniper.ammo === 5 && w.special.sniper.reserve === 30);
    M.ok('持特殊枪时补给记到快照并封顶 40（addAmmo 路由）', (() => {
      w.addAmmo(0, 0, 36);
      return w.special.sniper.reserve === 40 && w.current.type === 'gatling';
    })(), w.special.sniper.reserve);
    M.ok('加特林持续弹 30s 起表', Math.abs(w.specialTimer - 30) < 0.01 && w.current.reserve === 0);

    // 移速 -40%：同走廊对比步枪
    const runMetered = () => {
      M.placePlayer(M.spot.p);
      M.look(M.spot.dir);
      p.keys.add('KeyW');
      const x0 = p.position.x, z0 = p.position.z;
      M.step(60);
      p.keys.delete('KeyW');
      return Math.hypot(p.position.x - x0, p.position.z - z0);
    };
    w.switchTo(0);
    const dRifle = runMetered();
    w.grantSpecial('gatling');
    w.switchTo(4);
    const dGat = runMetered();
    M.ok('加特林移速 ×0.6（实测比值≈0.6）', dGat / dRifle > 0.5 && dGat / dRifle < 0.7,
      `${dRifle.toFixed(2)}m -> ${dGat.toFixed(2)}m`);
    M.ok('heavy 口对步枪为 false、对加特林为 true', (() => {
      w.switchTo(0); const a = w.heavy; w.switchTo(4); return a === false && w.heavy === true;
    })());
    // 禁跳 / 切回解除
    p.jumpQueued = true;
    M.step(1);
    M.ok('加特林状态无法跳跃', p.grounded === true && p.velocityY <= 0, `${p.grounded}/${p.velocityY}`);
    w.switchTo(0);
    p.jumpQueued = true;
    M.step(1);
    M.ok('切回步枪立刻解除禁跳', p.grounded === false && p.velocityY > 5.5, `${p.grounded}/${p.velocityY.toFixed(2)}`);
    p.velocityY = 0; p.grounded = true; p.position.y = g.world.floorAt(p.position.x, p.position.z);

    // 30s 时间表：持枪才走表
    w.grantSpecial('gatling');
    M.step(300);
    M.ok('持枪 5s 后剩余约 25s', w.specialTimer > 24.8 && w.specialTimer < 25.2, w.specialTimer.toFixed(2));
    w.switchTo(0);
    M.step(300);
    M.ok('切走不计消耗（暂停走表）', w.specialTimer > 24.8 && w.specialTimer < 25.2, w.specialTimer.toFixed(2));
    // HUD 口径
    w.switchTo(4);
    w.specialTimer = 25;
    g.ui.update(0);
    const ui = g.ui.el;
    M.ok('HUD 弹药位显示剩余秒数', ui['ammo-value'].textContent === '25' &&
      ui['reserve-value'].textContent === '∞', `${ui['ammo-value'].textContent}/${ui['reserve-value'].textContent}`);
    M.ok('HUD 武器名切到 M-56', ui['weapon-name'].textContent.includes('M-56'), ui['weapon-name'].textContent);
    // 实射验证：弹匣在扣、伤害在掉
    w.switchTo(4);
    const ty = M.spawn('tyrant', M.at(M.spot.p, M.spot.dir, 9));
    ty.maxHp = ty.hp = 1200;
    M.look(M.spot.dir);
    const hp0 = ty.hp, ammo0 = w.current.ammo;
    p.shooting = true;
    M.step(45);
    p.shooting = false;
    M.ok('加特林连射：弹药在扣、暴君掉血', w.current.ammo < ammo0 && ty.hp < hp0 - 43 * 2,
      `${ammo0}->${w.current.ammo} / ${hp0}->${ty.hp}`);
    M.ok('暴君步枪减伤不挡加特林（每发满 43）', hp0 - ty.hp >= 43 * 3, hp0 - ty.hp);
    // 打空自动换回狙击 + 快照带回（含期间补给，封顶 40）
    w.specialTimer = 0.5;
    M.step(60);
    M.ok('30s 走完后换回 M-21', w.current.type === 'sniper' && w.special === null && w.specialTimer === 0);
    M.ok('换回后弹药取快照（含期间补给）', w.items[4].ammo === 5 && w.items[4].reserve === 40,
      `${w.items[4].ammo}/${w.items[4].reserve}`);

    // 倒地掉落 → 原地可重捡
    w.grantSpecial('gatling');
    M.placePlayer({ x: 0, z: 22 });
    p.health = 100; p.invulnerable = 0;
    p.damage(9999);
    M.ok('巨人城 0 血进入濒死而非结算', p.downed === true && g.state === 'playing');
    const lost = g.effects.drops.find(d => d.weapon);
    M.ok('倒地时特殊武器掉在身旁', lost && lost.type === 'gatling' &&
      Math.hypot(lost.root.position.x - p.position.x, lost.root.position.z - p.position.z) < 0.5);
    M.ok('倒地后狙击槽已还原', w.current.type === 'sniper' && w.special === null);
    p.downed = false; p.health = 100; g.ui.showDowned(false);
    M.standAt(lost.root.position);
    M.step(2);
    M.ok('回去踩箱子可重新装备', w.special && w.current.type === 'gatling');
    g.effects.reset();
  },

  // ② R-80 火箭筒：单发装填链路、AoE 数值、2.2m 同层门、耗尽换回。
  rocketKit() {
    const M = window.__M5, g = M.g(), w = g.weapons, p = g.player;
    M.boot(13);
    M.immortal();
    w.grantSpecial('rocket');
    M.ok('R-80 数据：1 发装填 3.2s / 备弹 3 / 2.5m-450',
      w.current.capacity === 1 && w.current.reloadTime === 3.2 && w.current.reserve === 3 &&
      w.current.explosive.radius === 2.5 && w.current.explosive.damage === 450);
    g.ui.update(0);
    M.ok('HUD 火箭筒标"单发"', g.ui.el['weapon-mode'].textContent === '单发', g.ui.el['weapon-mode'].textContent);
    // 先测"持加特林时再拾火箭"直接替换、快照仍是手枪
    M.ok('换持新特殊枪时狙击快照不变', (() => {
      w.grantSpecial('gatling'); w.grantSpecial('rocket');
      return w.current.type === 'rocket' && w.special.kind === 'rocket' && w.special.sniper.type === 'sniper';
    })());

    const base = new THREE.Vector3(M.spot.p.x, 0, M.spot.p.z);
    const far = M.spawn('tyrant', base.clone().add(new THREE.Vector3(0, 0, 24)));
    const near = M.spawn('tyrant', M.at(M.spot.p, M.spot.dir, 9));
    const beside = M.spawn('tyrant', M.at(M.spot.p, M.spot.dir, 10.6));
    for (const e of [far, near, beside]) { e.maxHp = e.hp = 1200; }
    M.look(M.spot.dir);
    const hp = [far, near, beside].map(e => e.hp);
    M.step(20); // 等切换硬直结束
    w.shoot();   // 半发武器：直接开一炮
    M.ok('直射命中点立即起爆：圈内双 450',
      hp[1] - near.hp === 450 && hp[2] - beside.hp === 450, `${hp[1] - near.hp}/${hp[2] - beside.hp}`);
    M.ok('2.5m 半径外不受波及', hp[0] - far.hp === 0, hp[0] - far.hp);
    M.ok('火箭不吃暴君步枪减伤（weapon 非 rifle）', hp[1] - near.hp === 450);
    M.ok('开火扣掉唯一一发', w.current.ammo === 0);
    // 同层门：与 enemies.area 一致的 2.2m 高度闸（爆炸点取真实地面，车顶目标用同一 xz 抬到 3.2m）
    const gp = M.at(M.spot.p, M.spot.dir, 3);
    const down = M.spawn('tyrant', gp);
    const up = M.spawn('tyrant', gp);
    up.maxHp = up.hp = 1200; down.maxHp = down.hp = 1200;
    up.root.position.y = 3.2;
    const up0 = up.hp, down0 = down.hp;
    g.enemies.explode(new THREE.Vector3(gp.x, 0, gp.z), 2.5, 450);
    M.ok('AoE 沿用 2.2m 同层门：车顶目标免伤', up.hp === up0 && down0 - down.hp === 450,
      `${up0 - up.hp}/${down0 - down.hp}`);
    M.ok('AoE 只算敌人不伤己方', g.player.health === 100);
    // 装填链路：弹药 0 且有备弹 → 冷却结束自动进入 3.2s 装填
    M.step(40);
    M.ok('打空后自动装填 3.2s', Math.abs(w.reloadDuration - 3.2) < 0.01 && w.reloadRemaining > 0,
      `${w.reloadRemaining}/${w.reloadDuration}`);
    M.step(120);
    M.ok('装填未完不交弹', w.current.ammo === 0);
    M.step(80);
    M.ok('3.2s 后 1 发复装、备弹 3→2', w.current.ammo === 1 && w.current.reserve === 2,
      `${w.current.ammo}/${w.current.reserve}`);
    // 耗尽路径：备弹 0 再打空 → 换回手枪
    w.current.reserve = 0;
    M.step(20);
    w.shoot();
    M.step(4);
    M.ok('弹鼓与备弹全空自动换回 M-21', w.current.type === 'sniper' && w.special === null);
    // 泰坦满 450（无减伤）
    w.grantSpecial('rocket');
    const titan = M.spawn('titan', M.at(M.spot.p, M.spot.dir, 9), 15);
    titan.maxHp = titan.hp = 6000;
    M.look(M.spot.dir, 0.16); // 泰坦 2.2 倍体型：弹道抬高才打得到躯干（射线打地会提前起爆）
    w.spread = 0; // 前面加特林连射把散布顶满，直射验收清零
    // 清掉场上残留小怪并封锁后续刷新，保证直射射线只会命中泰坦（前面子测试留下的暴君会挡弹）。
    const es = g.enemies;
    for (let i = es.list.length - 1; i >= 0; i--) if (es.list[i] !== titan) es.remove(i);
    es.runner.queue = []; es.runner.pending = 1; es.runner.batchLeft = 0;
    es.runner.reinforceClock = 1e9; es.spawnTimer = 1e9;
    const t0 = titan.hp;
    M.step(20);
    w.shoot();
    M.ok('对泰坦一发满 450', t0 - titan.hp === 450, t0 - titan.hp);
    g.effects.reset();
  },

  // ④ BOSS 血条：登场显示 / 数值随伤害 / 狂暴变色 / 死亡隐藏。
  bossHud() {
    const M = window.__M5, g = M.g();
    const bar = document.getElementById('boss-bar');
    M.boot(15, { live: true });
    M.immortal();
    let frames = 0;
    while (!g.enemies.boss && frames++ < 900) M.step(1);
    const boss = g.enemies.boss;
    M.ok('BOSS 已入场', Boolean(boss));
    g.ui.update(0);
    M.ok('血条随登场显示', bar.hidden === false);
    M.ok('名字取敌种 def', bar.querySelector('#boss-name').textContent === boss.def.name,
      bar.querySelector('#boss-name').textContent);
    M.ok('数值 = 当前/上限', bar.querySelector('#boss-value').textContent ===
      `${Math.ceil(boss.hp)} / ${Math.ceil(boss.maxHp)}`, bar.querySelector('#boss-value').textContent);
    M.ok('满血填充 100%', bar.querySelector('#boss-fill').style.width === '100%',
      bar.querySelector('#boss-fill').style.width);
    M.ok('常态无 rage 类', !bar.classList.contains('rage'));
    g.enemies.damage(boss, 2100, boss.root.position.clone(), new THREE.Vector3(0, 0, -1), false, 0, 'rifle');
    M.step(2);
    g.ui.update(0);
    const pct = parseFloat(bar.querySelector('#boss-fill').style.width);
    M.ok('填充宽度随血量收缩', Math.abs(pct - 65) < 1, pct);
    g.enemies.damage(boss, 999999, boss.root.position.clone(), new THREE.Vector3(0, 0, -1), false, 0, 'rifle');
    M.step(2);
    g.ui.update(0);
    M.ok('BOSS 死亡血条隐藏', bar.hidden === true && g.enemies.boss === null);
    // 狂暴只属于巨型泰坦（§7）：30 波验证变色与数值
    M.boot(30, { live: true });
    M.immortal();
    frames = 0;
    while (!g.enemies.boss && frames++ < 1200) M.step(1);
    g.ui.update(0);
    const mega = g.enemies.boss;
    M.ok('巨型泰坦同样有血条', mega && !bar.hidden &&
      bar.querySelector('#boss-name').textContent === '巨型泰坦', mega && mega.def.name);
    g.enemies.damage(mega, mega.maxHp * 0.7, mega.root.position.clone(), new THREE.Vector3(0, 0, -1), false, 0, 'rifle');
    M.step(40); // 出生缩放 0.45s 内不跑 think，狂暴判定要等出场动画结束
    g.ui.update(0);
    M.ok('血量 ≤40% 进入狂暴，血条变色', mega.rage === true && bar.classList.contains('rage'));
    M.ok('狂暴后数值与填充同步', parseFloat(bar.querySelector('#boss-fill').style.width) < 40 &&
      bar.querySelector('#boss-value').textContent === `${Math.ceil(mega.hp)} / ${Math.ceil(mega.maxHp)}`,
      bar.querySelector('#boss-value').textContent);
    M.boot(5, { mode: 'practice' });
    g.ui.update(0);
    M.ok('练习模式无 BOSS 波，血条保持隐藏', bar.hidden === true);
  },

  // 练习模式零变化：35s 寿命、无浮字、无补给点位、拾取经济仍是 60/24、跳跃移速如旧。
  practiceZero() {
    const M = window.__M5, g = M.g(), w = g.weapons, p = g.player;
    M.ok('练习 4 波可开局', M.boot(4, { mode: 'practice' }) === 'ready');
    M.immortal();
    const world = g.world;
    M.ok('练习图没有补给点位', world.supplyPoints.length === 0);
    M.ok('练习图没有特殊箱投放位', world.specialBoxPoint === null);
    g.spawnWaveSupplies();
    M.ok('结算函数在练习模式空转', g.effects.supplies.length === 0);
    g.effects.drop(p.position.clone().add(new THREE.Vector3(6, 0, 0)), 'ammo');
    const drop = g.effects.drops[0];
    M.ok('击杀掉落仍是 35s 寿命', drop.life === 35, drop.life);
    M.ok('练习模式箱体零浮字（外观不变）', drop.label === null && !g.effects.labelMode);
    w.items[0].reserve = 10;
    M.standAt(drop.root.position);
    M.step(2);
    M.ok('旧拾取经济未动：弹药 +60/+24', w.items[0].reserve === 70, w.items[0].reserve);
    g.effects.drop(M.at(M.spot.p, M.spot.dir, 6), 'health');
    M.standAt(g.effects.drops[g.effects.drops.length - 1].root.position);
    g.player.health = 60; // placePlayer 会把血量重置 100，须在站上去之后压血
    M.step(2);
    M.ok('旧拾取经济未动：医疗 +30', g.player.health === 90, g.player.health);
    M.forceClear();
    M.ok('波末结算不产生任何补给/临时箱',
      g.effects.supplies.length === 0 && g.effects.drops.every(d => !d.weapon && !d.waveEnd));
    M.ok('无特殊武器：heavy=false 且手枪槽完整', w.heavy === false && w.special === null &&
      w.items[1].type === 'pistol' && w.items[1].capacity === 12);
    M.placePlayer(M.spot.p);
    M.look(M.spot.dir);
    p.keys.add('KeyW');
    const x0 = p.position.x, z0 = p.position.z;
    M.step(60);
    p.keys.delete('KeyW');
    const moved = Math.hypot(p.position.x - x0, p.position.z - z0);
    M.ok('移速基线不变（≈4.5m/s）', moved > 4 && moved < 5, moved.toFixed(2));
    p.jumpQueued = true;
    M.step(1);
    M.ok('跳跃不受影响', p.grounded === false);
    p.velocityY = 0; p.grounded = true;
    p.position.y = world.floorAt(p.position.x, p.position.z);
    p.health = 1; p.invulnerable = 0;
    p.damage(999);
    M.ok('练习模式 0 血直接失守（无濒死、无掉落）',
      g.state === 'lost' && p.downed === false && g.effects.drops.every(d => !d.weapon));
  }
};

(async () => {
  const only = process.argv[2] || null;
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
      window.__M5 = M;
      return typeof window.DZ + '/' + (window.DZ && typeof window.DZ.game);
    })()`;
    console.log('harness ->', await browser.evaluate(harness));
    let pass = 0, fail = 0;
    const failures = [];
    for (const name of names) {
      const result = await browser.evaluate(
        `(() => {
          window.__M5.log = [];
          window.__case = function ${CASES[name].toString()};
          try { window.__case(); } catch (err) {
            window.__M5.log.push(['异常 ${name}', false, (err && err.message) + ' @ ' + String(err && err.stack || '').split('\\n')[1]]);
          }
          delete window.__case;
          return window.__M5.log;
        })()`);
      const bad = result.filter(r => !r[1]);
      pass += result.length - bad.length;
      fail += bad.length;
      failures.push(...bad.map(r => `${name} :: ${r[0]} -> ${r[2]}`));
      console.log(`\n[${name}] ${result.length - bad.length}/${result.length}`);
      for (const r of result) console.log(`  ${r[1] ? 'PASS' : 'FAIL'} ${r[0]}${r[2] ? '  -> ' + r[2] : ''}`);
    }
    console.log(`\n== ${pass} passed, ${fail} failed ==`);
    if (failures.length) console.log(failures.join('\n'));
    if (browser.errors.length) console.log('page exceptions:', JSON.stringify(browser.errors.slice(0, 2)).slice(0, 600));
    if (fail || browser.errors.length) process.exitCode = 1;
  } finally {
    let restored = false;
    try {
      await browser.evaluate('(() => { if (window.__M5) window.__M5.unpatch(); if (window.__rafFreeze) { window.requestAnimationFrame = window.__rafFreeze; window.__rafFreeze = null; } const g = window.DZ.game; while (g.enemies.list.length) g.enemies.remove(0); g.effects.reset(); g.showMenu(); return "restored"; })()');
      restored = true;
    } catch (error) { console.log('restore skipped:', error.message); }
    if (!restored) { try { await browser.send('Page.reload', { ignoreCache: false }); } catch (error) { /* 连接已断，交给下一次运行 */ } }
    browser.close();
  }
})();
