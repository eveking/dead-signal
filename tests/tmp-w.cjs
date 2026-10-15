'use strict';
// 武器五槽改造（3 手雷 / 4 军刀 / 5 狙击）正式回归脚本：页内定步长推进 g.update(1/60)，冻结 rAF，不 sleep。
// 用法：node tests/tmp-w.cjs [caseName]（或经页内装载器批量运行）
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
      g.effects.reset();
    }
    this.g().time = 0;
    this.immortal();
    return started ? 'ready' : 'boot-fail:' + g.wave + '/' + g.wavePhase;
  },
  killAllies() {
    const sq = this.g().squad;
    if (!sq) return;
    for (const m of sq.members) { m.dead = true; m.respawn = 1e9; }
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
    g.player.shooting = false; g.player.scoping = false;
    g.player.keys.clear();
    g.player.syncCamera();
  },
  immortal() { this.g().player.invulnerable = 1e9; },
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
  // 精确瞄到某个网格（如爆头判定盒）的世界坐标：yaw 取水平方向，pitch 补高度差。
  aimAt(e, wantHead) {
    const g = this.g();
    const targets = e.targets || [];
    let mesh = wantHead ? targets.find(t => t.userData.headshot) : targets.find(t => !t.userData.headshot);
    if (!mesh) return false;
    const v = new window.THREE.Vector3();
    mesh.getWorldPosition(v);
    const dx = v.x - g.player.position.x, dz = v.z - g.player.position.z;
    const horiz = Math.hypot(dx, dz);
    const eye = g.player.position.y + 1.68;
    g.player.yaw = Math.atan2(-dx, -dz);
    // 上一发后坐力 kick 会叠进 rotation.x，不归零就描不到头。
    g.player.kick = 0;
    // 约定与 syncCamera 一致：rotation.x = pitch，正值抬头，所以目标在视野上方时 pitch 为正。
    g.player.pitch = Math.max(-1.4, Math.min(1.4, Math.atan2(v.y - eye, horiz)));
    g.player.syncCamera();
    return true;
  },
  // 瞄准后再验一次弹道：第一个交点必须是目标网格（走廊上方箱顶栈道会拦高弹道）。
  aimClear(e, wantHead) {
    const g = this.g();
    if (!this.aimAt(e, wantHead)) return false;
    const mesh = (e.targets || []).find(t => wantHead ? t.userData.headshot : !t.userData.headshot);
    g.world.scene.updateMatrixWorld(true);
    g.player.syncCamera(0);
    const ray = new window.THREE.Raycaster();
    ray.far = 95;
    ray.setFromCamera(new window.THREE.Vector2(0, 0), g.world.camera);
    const hit = ray.intersectObjects(g.world.blockers.concat(g.enemies.hitTargets()), false)[0];
    return Boolean(hit) && hit.object === mesh;
  },
  runMetered(on) {
    const p = this.g().player;
    // 清场防污染：走廊里活着的暴君/泰坦会用击退打断测速位移。
    const es = this.g().enemies;
    while (es.list.length) es.remove(0);
    es.boss = null;
    this.placePlayer(this.spot.p);
    this.look(this.spot.dir);
    if (on) on();
    p.keys.add('KeyW');
    const x0 = p.position.x, z0 = p.position.z;
    for (let i = 0; i < 60; i++) { p.stagger = 0; this.g().update(1 / 60); }
    p.keys.delete('KeyW');
    return Math.hypot(p.position.x - x0, p.position.z - z0);
  }
};

const CASES = {
  // ① 五槽数据面 / HUD 文案 / 换弹与弹药的按型分支（巨人城与练习模式都有 5 槽，⑤）。
  slotsHud() {
    const M = window.__W, g = M.g(), w = g.weapons;
    M.boot(13);
    M.immortal();
    M.ok('五槽顺序 = 步枪/手枪/手雷/军刀/狙击',
      w.items.map(i => i.type).join(',') === 'rifle,pistol,grenade,knife,sniper',
      w.items.map(i => i.type).join(','));
    M.ok('手雷：初始 4 / 上限 6（①）', w.items[2].ammo === 4 && w.items[2].capacity === 6);
    M.ok('狙击：弹匣 5 / 备弹 25 / 间隔 1.3s / 弹体 250',
      w.items[4].ammo === 5 && w.items[4].reserve === 25 && w.items[4].interval === 1.3 && w.items[4].damage === 250);
    M.ok('手枪槽保持不变（capacity 12）', w.items[1].capacity === 12 && w.items[1].damage === 44);
    // 数字键接线：keydown 直接走 switchTo
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit4' }));
    M.ok('按 4 直切军刀槽', w.index === 3);
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit5' }));
    M.ok('按 5 直切狙击槽', w.index === 4);
    // 换弹键对手雷/军刀无效
    w.switchTo(2); w.reload();
    M.ok('手雷无装填概念（R 键空转）', w.reloadRemaining === 0);
    w.switchTo(3); w.reload();
    M.ok('军刀无装填概念（R 键空转）', w.reloadRemaining === 0);
    // HUD 分支
    const ui = g.ui.el;
    w.switchTo(3); g.ui.update(0);
    M.ok('军刀 HUD：∞ / — / MELEE / 04 — MELEE',
      ui['ammo-value'].textContent === '∞' && ui['reserve-value'].textContent === '—' &&
      ui['weapon-mode'].textContent === 'MELEE' && ui['weapon-slots'].textContent === '04 — MELEE',
      `${ui['ammo-value'].textContent}/${ui['reserve-value'].textContent}/${ui['weapon-mode'].textContent}`);
    w.switchTo(2); g.ui.update(0);
    M.ok('手雷 HUD：持数 / 上限 6 / 投掷 / 03 — THROWN',
      ui['ammo-value'].textContent === '4' && ui['reserve-value'].textContent === '6' &&
      ui['weapon-mode'].textContent === '投掷' && ui['weapon-slots'].textContent === '03 — THROWN',
      `${ui['ammo-value'].textContent}/${ui['reserve-value'].textContent}/${ui['weapon-mode'].textContent}`);
    w.switchTo(4); g.ui.update(0);
    M.ok('狙击 HUD：BOLT / 05 — MARKSMAN',
      ui['weapon-mode'].textContent === 'BOLT' && ui['weapon-slots'].textContent === '05 — MARKSMAN');
    // 底部提示条：5 个武器 + P 暂停，高亮跟槽位
    const hints = document.querySelectorAll('.hud-bottom-center > span');
    M.ok('提示条含 3 手雷/4 军刀/5 狙击', hints.length === 6 &&
      hints[2].textContent.includes('手雷') && hints[3].textContent.includes('军刀') &&
      hints[4].textContent.includes('狙击'), String(hints.length));
    w.switchTo(1); g.ui.update(0);
    M.ok('高亮跟随当前槽位（手枪=第 2 项）',
      hints[1].getAttribute('aria-current') === 'true' && !hints[4].hasAttribute('aria-current'));
    // 弹药经济：狙击备弹上限 40、手雷满 6 不+1
    w.items[4].reserve = 35;
    w.addAmmo(0, 0, 15, 1);
    M.ok('狙击备弹封顶 40', w.items[4].reserve === 40, w.items[4].reserve);
    M.ok('手雷 +1（4→5）', w.items[2].ammo === 5, w.items[2].ammo);
    w.addAmmo(0, 0, 0, 1);
    w.addAmmo(0, 0, 0, 1);
    M.ok('手雷封顶 6', w.items[2].ammo === 6, w.items[2].ammo);
    w.addAmmo(0, 0, 0, 1);
    M.ok('满 6 后弹药箱不再加手雷', w.items[2].ammo === 6);
    // 波间自动补给不带狙击/手雷（game.js:319 旧经济 60/24），狙击备弹不被 NaN 污染
    const resBefore = w.items[4].reserve;
    w.items[0].reserve = 10;
    M.boot(13);
    g.effects.reset();
    const es = g.enemies;
    while (es.list.length) es.remove(0);
    es.runner.pending = 0;
    M.step(2);
    M.ok('波间结算 addAmmo(60,24) 不产生 NaN',
      Number.isFinite(w.items[4].reserve) && Number.isFinite(w.items[0].reserve),
      `${w.items[0].reserve}/${w.items[4].reserve}`);
    // 练习模式同样有 5 槽
    M.boot(4, { mode: 'practice' });
    M.ok('练习模式同为 5 槽（⑤都可用）',
      g.weapons.items.map(i => i.type).join(',') === 'rifle,pistol,grenade,knife,sniper');
  },

  // ② 手雷：抛物消耗、引信 1.1s 起爆、半径 5 / 中心 350、BOSS 减半（④）、空手雷拒投。
  grenadeKit() {
    const M = window.__W, g = M.g(), w = g.weapons, p = g.player;
    M.boot(13);
    M.immortal();
    w.switchTo(2);
    M.step(20);
    const walkers = [
      M.spawn('walker', M.at(M.spot.p, M.spot.dir, 9)),
      M.spawn('walker', M.at(M.spot.p, M.spot.dir, 12.5)),
      M.spawn('walker', M.at(M.spot.p, M.spot.dir, 16)),
      M.spawn('walker', M.at(M.spot.p, M.spot.dir, 24))
    ];
    M.look(M.spot.dir, 0.05);
    const ammo0 = w.current.ammo;
    M.ok('扣手雷 1 枚并生成投射物', (() => {
      const fired = w.shoot();
      return fired && w.current.ammo === ammo0 - 1 && g.effects.grenades.length === 1;
    })(), w.current.ammo);
    M.ok('投掷冷却 0.9s 内不能再投', w.shoot() === false);
    // 引信起爆：~1.1s + 同屏余量
    let frames = 0;
    while (g.effects.grenades.length && frames++ < 120) M.step(1);
    M.ok('约 1.1s 引信后自动起爆（投射物清空）', g.effects.grenades.length === 0 && frames <= 80, `${frames} 帧`);
    const killed = walkers.filter(e => e.dead);
    M.ok('破片半径 5m：圈内至少 2 只必死、24m 处不受波及', killed.length >= 2 && !walkers[3].dead,
      `倒 ${killed.length} 只，第 4 只存活`);
    // 精确数值：暴君吃满 350（不吃步枪减伤）
    const ty = M.spawn('tyrant', M.at(M.spot.p, M.spot.dir, 9));
    ty.maxHp = ty.hp = 1200;
    const hp0 = ty.hp;
    w.cooldown = 0;
    g.effects.throwGrenade(ty.root.position.clone().add(new THREE.Vector3(0, 0.4, 0)), new THREE.Vector3(0, 0, 0));
    frames = 0;
    while (g.effects.grenades.length && frames++ < 120) M.step(1);
    M.ok('圈内普通怪吃满中心 350（暴君无手雷减伤）', hp0 - ty.hp === 350, hp0 - ty.hp);
    // ④ BOSS 减半：泰坦只掉 175
    const titan = M.spawn('titan', M.at(M.spot.p, M.spot.dir, 9), 15);
    titan.maxHp = titan.hp = 6000;
    g.enemies.explode(titan.root.position.clone(), 5, 350, 'grenade');
    M.ok('手雷对 BOSS 伤害减半（6000→5825）', 6000 - titan.hp === 175, 6000 - titan.hp);
    // 火箭仍走全额（回归确认）
    titan.maxHp = titan.hp = 6000;
    g.enemies.explode(titan.root.position.clone(), 2.5, 450, 'rocket');
    M.ok('火箭对 BOSS 不减半（规则只针对 grenade）', 6000 - titan.hp === 450, 6000 - titan.hp);
    // 空仓：弹药 0 拒投、不扣数、走冷却 0.25s
    w.items[2].ammo = 0;
    w.cooldown = 0;
    const grenadesBefore = g.effects.grenades.length;
    M.ok('没有手雷时拒投并提示', w.shoot() === false && g.effects.grenades.length === grenadesBefore);
    M.ok('拒投后进入 0.25s 空仓冷却（不逐帧刷屏）', Math.abs(w.cooldown - 0.25) < 0.01, w.cooldown);
    // 拾取弹药箱 +1：走 addAmmo 入口
    w.items[2].ammo = 5;
    w.addAmmo(60, 24, 10, 1);
    M.ok('弹药箱 +1 手雷（5→6）', w.items[2].ammo === 6, w.items[2].ammo);
    g.effects.reset();
  },

  // ③ 军刀：普通怪一挥必杀、泰坦 150、暴君 60、扇形多目标、背后免伤、持刀 +15% 移速（②）。
  knifeKit() {
    const M = window.__W, g = M.g(), w = g.weapons, p = g.player;
    M.boot(13);
    M.immortal();
    w.switchTo(3);
    M.step(20);
    // 前方 2.6m 内两只（左右各 40°，arc=1.0 → 半角 57.3° 内）+ 背后一只
    const front = M.spawn('walker', M.at(M.spot.p, M.spot.dir, 2.2));
    M.look(M.spot.dir);
    const left = M.spawn('walker', M.at(M.spot.p, { x: M.spot.dir.x * 0.76 - M.spot.dir.z * 0.64, z: M.spot.dir.z * 0.76 + M.spot.dir.x * 0.64 }, 2.2));
    const behind = M.spawn('walker', M.at(M.spot.p, M.spot.dir, -2.2));
    const hit = w.shoot();
    M.ok('扇形挥砍命中多目标：正面两只一挥必杀', hit && front.dead && left.dead,
      `${front.dead}/${left.dead}`);
    M.ok('背后敌人不受击', !behind.dead);
    M.ok('0.55s 内第二刀被冷却挡住', w.shoot() === false);
    // 暴君 60 / 泰坦 150（⑥推荐值）
    const ty = M.spawn('tyrant', M.at(M.spot.p, M.spot.dir, 2.2));
    ty.maxHp = ty.hp = 1200;
    w.cooldown = 0;
    M.look(M.spot.dir);
    const fired = w.shoot();
    M.ok('暴君吃军刀 60', fired && 1200 - ty.hp === 60, fired ? 1200 - ty.hp : '未命中');
    const titan = M.spawn('titan', M.at(M.spot.p, M.spot.dir, 2.6), 15);
    titan.maxHp = titan.hp = 6000;
    w.cooldown = 0;
    w.shoot();
    M.ok('泰坦吃军刀 150（必杀规则只限普通怪）', 6000 - titan.hp === 150, 6000 - titan.hp);
    // 超距免伤：3m 目标在 reach 2.6 + radius 之外？用 4m 稳超界
    const far = M.spawn('walker', M.at(M.spot.p, M.spot.dir, 4.2));
    w.cooldown = 0;
    w.shoot();
    M.ok('超出 reach 的目标不受击', !far.dead);
    // ② 持刀移速 +15%：与步枪基线对比
    w.switchTo(0);
    const dRifle = M.runMetered();
    w.switchTo(3);
    const dKnife = M.runMetered();
    M.ok('持刀移速 ×1.15（实测比值≈1.15）', dKnife / dRifle > 1.1 && dKnife / dRifle < 1.2,
      `${dRifle.toFixed(2)}m -> ${dKnife.toFixed(2)}m = ${(dKnife / dRifle).toFixed(3)}`);
    M.ok('knifeBoost 口只对军刀为 true', w.knifeBoost === true);
    w.switchTo(0);
    M.ok('切回步枪立刻失效', w.knifeBoost === false);
    g.effects.reset();
  },

  // ④ 狙击：弹体 250、普通怪爆头秒杀、BOSS 爆头仍 ×2、装填 2.6s、开镜移速/FOV/取消链。
  sniperKit() {
    const M = window.__W, g = M.g(), w = g.weapons, p = g.player;
    M.boot(13);
    M.immortal();
    w.switchTo(4);
    M.step(20);
    // 躯干 250：暴君（500 血）中一发躯干不倒
    const ty = M.spawn('tyrant', M.at(M.spot.p, M.spot.dir, 12));
    ty.maxHp = ty.hp = 500;
    M.look(M.spot.dir);
    w.spread = 0;
    let fired = w.shoot();
    M.ok('躯干一发 250（暴君存活剩 250）', fired && 500 - ty.hp === 250, fired ? ty.hp : '未命中');
    // 爆头必杀：普通怪（暴君也吃必杀——非 BOSS）
    w.cooldown = 0; w.spread = 0; ty.knock.set(0, 0, 0);
    const aim = M.aimAt(ty, true);
    const hpBefore = ty.hp;
    M.ok('爆头瞄准可用', aim === true);
    fired = w.shoot();
    M.ok('狙击爆头一击必杀（250 血残血也直接死）', fired && ty.dead, `${hpBefore}->${ty.hp}/${ty.dead}`);
    // BOSS 爆头 ×2 = 500，不秒杀
    const titan = M.spawn('titan', M.at(M.spot.p, M.spot.dir, 14), 15);
    titan.maxHp = titan.hp = 6000;
    w.cooldown = 0; w.spread = 0;
    // 4.3m 高的 BOSS 头容易被箱顶栈道拦线：逐级拉近直到弹道干净。
    let clearLine = false;
    for (const d of [14, 12, 11, 9.5, 8, 6.5, 5]) {
      const pos = M.at(M.spot.p, M.spot.dir, d);
      M.pin(titan, pos.x, pos.z);
      g.world.scene.updateMatrixWorld(true);
      clearLine = M.aimClear(titan, true);
      if (clearLine) break;
    }
    M.ok('BOSS 爆头弹道无遮挡（选到净空距离）', clearLine);
    fired = w.shoot();
    M.ok('BOSS 爆头按 ×2=500（保留头倍率，不吃必杀）', fired && 6000 - titan.hp === 500,
      fired ? 6000 - titan.hp : '未命中');
    // 装填 2.6s：打空 5 发后自动装填
    w.items[4].ammo = 0;
    M.step(80);
    M.ok('弹匣打空自动装填 2.6s', Math.abs(w.reloadDuration - 2.6) < 0.01 && w.reloadRemaining > 0);
    M.step(160);
    M.ok('装填完成 5/20', w.current.ammo === 5 && w.current.reserve === 20,
      `${w.current.ammo}/${w.current.reserve}`);
    // 开镜链路：scoping → 灵敏度/移速/FOV/禁跳/切枪取消/overlay
    p.scoping = true;
    const dScope = M.runMetered(() => { g.weapons.switchTo(4); p.scoping = true; });
    w.switchTo(0);
    const dBase = M.runMetered();
    w.switchTo(4);
    M.ok('开镜移速 ×0.55', Math.abs(dScope / dBase - 0.55) < 0.05,
      `${dBase.toFixed(2)}m -> ${dScope.toFixed(2)}m = ${(dScope / dBase).toFixed(3)}`);
    p.scoping = true;
    M.step(60);
    M.ok('开镜 FOV 收到 ≈16（4 倍视野）', g.world.camera.fov > 15 && g.world.camera.fov < 18,
      g.world.camera.fov.toFixed(1));
    p.jumpQueued = true;
    M.step(1);
    M.ok('开镜禁止跳跃', p.grounded === true);
    g.ui.update(0);
    M.ok('开镜 HUD：准星隐藏、镜筒 overlay 显示',
      g.ui.el.crosshair.hidden === true && g.ui.el.scope.hidden === false);
    M.ok('开镜收起枪模（view.visible=false）', w.view.visible === false);
    w.switchTo(0);
    M.ok('切枪立刻退出开镜', p.scoping === false);
    M.step(2);
    g.ui.update(0);
    M.ok('关镜后 overlay 隐藏、准星与枪模恢复',
      g.ui.el.scope.hidden === true && g.ui.el.crosshair.hidden === false && w.view.visible === true);
    // 开镜吃满精度：满散布积累下 15m 躯干仍命中（散布系数 ×0.05）
    w.switchTo(4);
    const ty2 = M.spawn('tyrant', M.at(M.spot.p, M.spot.dir, 15));
    ty2.maxHp = ty2.hp = 500;
    p.scoping = true;
    w.spread = 0.14; w.cooldown = 0;
    M.look(M.spot.dir);
    fired = w.shoot();
    M.ok('开镜压掉积累散布：远距仍命中', fired && 500 - ty2.hp === 250, fired ? ty2.hp : '未命中');
    p.scoping = false;
    g.effects.reset();
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
      window.__W = M;
      return typeof window.DZ + '/' + (window.DZ && typeof window.DZ.game);
    })()`;
    console.log('harness ->', await browser.evaluate(harness));
    let pass = 0, fail = 0;
    const failures = [];
    for (const name of names) {
      const result = await browser.evaluate(
        `(() => {
          window.__W.log = [];
          window.__case = function ${CASES[name].toString()};
          try { window.__case(); } catch (err) {
            window.__W.log.push(['异常 ${name}', false, (err && err.message) + ' @ ' + String(err && err.stack || '').split('\\n')[1]]);
          }
          delete window.__case;
          return window.__W.log;
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
      await browser.evaluate('(() => { if (window.__W) window.__W.unpatch(); if (window.__rafFreeze) { window.requestAnimationFrame = window.__rafFreeze; window.__rafFreeze = null; } const g = window.DZ.game; while (g.enemies.list.length) g.enemies.remove(0); g.effects.reset(); g.showMenu(); return "restored"; })()');
      restored = true;
    } catch (error) { console.log('restore skipped:', error.message); }
    if (!restored) { try { await browser.send('Page.reload', { ignoreCache: false }); } catch (error) { /* 连接已断，交给下一次运行 */ } }
    browser.close();
  }
})();
