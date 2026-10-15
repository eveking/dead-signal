'use strict';
// M6 · 调平、性能、结算 正式回归脚本：页内定步长推进 g.update(dt)，冻结 rAF，不 sleep。
// 用法：node tests/tmp-m6.cjs [caseName]
const connect = require('./browser.cjs');

const HELPERS = {
  ok(name, cond, info) {
    this.log.push([name, Boolean(cond), info === undefined || info === null ? '' : String(info)]);
  },
  g() { return window.DZ.game; },
  unpatch() {
    const es = this.g().enemies;
    for (const key of ['damage', 'quake', 'area']) {
      if (Object.prototype.hasOwnProperty.call(es, key)) delete es[key];
    }
  },
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
  // 真实链路开局（与 M5 同规格）：intermission → game.startWave()，默认随后静场卡住结算。
  boot(wave, options) {
    const opts = options || {};
    const DZ = window.DZ;
    this.freeze();
    this.unpatch();
    DZ.Settings = {
      mode: opts.mode || 'giant',
      difficulty: opts.difficulty || 'normal',
      coins: opts.coins != null ? opts.coins : 30
    };
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
    g.time = 0;
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
  // 以相机（=玩家站位）为圆心，在地图内找水平距离落在 [minD,maxD] 的可站点，用于 LOD 档位与 A/B 铺场。
  openRing(minD, maxD, taken, skip) {
    const world = this.g().world, cam = world.camera.position;
    const used = taken || [];
    const start = skip || 0;
    let index = 0;
    for (let z = -46; z <= 46; z += 3) {
      for (let x = -22; x <= 22; x += 3) {
        if (index++ < start) continue;
        if (!world.canStand(x, z, 0.62)) continue;
        const d = Math.hypot(x - cam.x, z - cam.z);
        if (d < minD || d > maxD) continue;
        if (used.some(p => Math.hypot(p.x - x, p.z - z) < 2.2)) continue;
        return { x, z, d };
      }
    }
    return null;
  },
  at(base, dir, dist) {
    return new window.THREE.Vector3(base.x + dir.x * dist, 0, base.z + dir.z * dist);
  },
  placePlayer(p) {
    const g = this.g();
    g.player.position.set(p.x, p.y || 0, p.z);
    g.world.settleY(g.player.position);
    g.player.velocityY = 0; g.player.grounded = true;
    g.player.stagger = 0; g.player.invulnerable = 0; g.player.health = 100;
    g.player.yaw = 0; g.player.pitch = 0;
    g.player.shooting = false;
    g.player.keys.clear();
    g.player.syncCamera();
  },
  immortal() { this.g().player.invulnerable = 1e9; },
  vulnerable() {
    const p = this.g().player;
    p.invulnerable = 0; p.health = 100;
  },
  dist(a, b) { return Math.hypot(a.x - b.x, a.z - b.z); },
  spawn(type, position, wave, extra) {
    const g = this.g();
    const p = position.clone ? position.clone() : new window.THREE.Vector3(position.x, 0, position.z);
    const opts = Object.assign({ type }, extra || {});
    const e = g.enemies.spawn(p, wave != null ? wave : g.wave, opts);
    e.born = 0;
    e.root.scale.setScalar(e.scale);
    g.world.settleY(e.root.position);
    e.lodClock = 0;
    return e;
  },
  // 测试直刷 BOSS：先锁掉波次运行器的自动投放，避免同波两只泰坦。
  // extra 用来补上真实投放路径里的 entry（例如 summon），否则首召唤缓冲读不到 12s。
  boss(type, wave, extra) {
    const g = this.g();
    g.enemies.runner.bossSpawned = true;
    return this.spawn(type, this.at(this.spot.p, this.spot.dir, 14), wave || 15,
      Object.assign({ bossScale: window.DZ.WAVES.TYPES[type].scale }, extra || {}));
  },
  pin(e, x, z) {
    e.root.position.set(x, 0, z);
    this.g().world.settleY(e.root.position);
    return e;
  },
  // 玩家/队友直杀一只：走 enemies.damage 的真实结算分支，返回该次入账分数。
  // weapon 默认空串：绕开暴君的步枪减伤，保证 amount=hp+1 一定致死，测的是计分而不是伤害结算。
  kill(e, opts) {
    const o = opts || {};
    const unitId = o.ally != null ? o.ally + 1 : 0;
    const before = this.g().score;
    const p = e.root.position;
    this.g().enemies.damage(e, e.hp + 1, p, { x: 0, y: 0, z: 1 },
      Boolean(o.headshot), unitId, o.weapon || '');
    return this.g().score - before;
  },
  // 逐次击杀的记账统计（全 30 波冒烟用它核对 killScore 明细）。
  trackKills() {
    const M = this, es = this.g().enemies;
    const origin = Object.getPrototypeOf(es);
    const tally = { player: 0, ally: 0, points: 0, byType: {}, boss: {} };
    M.tally = tally;
    es.damage = function (enemy, amount, point, direction, headshot, unitId, weapon) {
      // 与 enemies.damage 同样的步枪减伤换算，否则"账面致死、实际没死"会让记账虚高。
      let lethal = amount;
      if (enemy.def && enemy.def.rifleResist && weapon === 'rifle' && !headshot) {
        lethal = amount * (1 - enemy.def.rifleResist);
      }
      if (!enemy.dead && enemy.hp - lethal <= 0) {
        const gain = Math.round((enemy.score || 100) * (unitId === 0 ? (headshot ? 1.5 : 1) : 0.6));
        tally.points += gain;
        tally.byType[enemy.type] = (tally.byType[enemy.type] || 0) + 1;
        if (unitId === 0) tally.player++; else tally.ally++;
        if (enemy.boss) tally.boss[enemy.type] = (tally.boss[enemy.type] || 0) + 1;
      }
      return origin.damage.call(this, enemy, amount, point, direction, headshot, unitId, weapon);
    };
    return tally;
  },
  // 统计 BOSS 技能触发次数（震波一次 / 连砸 N 下），并记录触发时刻以便量连砸间隔。
  counters() {
    const g = this.g(), es = g.enemies, origin = Object.getPrototypeOf(es);
    const counts = { quake: 0, area: 0, at: [] };
    es.quake = function () { counts.quake++; return origin.quake.apply(this, arguments); };
    es.area = function () { counts.area++; counts.at.push(g.time); return origin.area.apply(this, arguments); };
    return counts;
  },
  text(id) { return document.getElementById(id).textContent; },
  html(id) { return document.getElementById(id).innerHTML; },
  hidden(id) { const node = document.getElementById(id); return node.hidden === true || node.style.display === 'none'; },
  // 玩家走到掉落/补给点上（水平 0.2m 内）触发拾取。
  standAt(p) { this.placePlayer({ x: p.x, z: p.z }); }
};

const CASES = {
  // §9 击杀表分：六敌种 + 双 BOSS + 爆头 ×1.5，分数不随难度变化（难度只作用全局倍率）。
  scoreTable() {
    const M = window.__M6, g = M.g();
    M.boot(4, {});
    const TYPES = window.DZ.WAVES.TYPES;
    const expect = { walker: 100, runner: 120, bomber: 150, fogger: 200, splitter: 250, tyrant: 400 };
    for (const [type, points] of Object.entries(expect)) {
      const e = M.spawn(type, M.at(M.spot.p, M.spot.dir, 30), 4);
      const gain = M.kill(e);
      M.ok(`${type} 击杀表分 ${points}`, gain === points && e.score === TYPES[type].score,
        `${gain}/${e.score}`);
    }
    const hs = M.spawn('walker', M.at(M.spot.p, M.spot.dir, 30), 4);
    M.ok('爆头 ×1.5（100→150）', M.kill(hs, { headshot: true }) === 150, g.score);
    M.ok('爆头计入爆头数与击杀数', g.headshots === 1 && g.kills === Object.keys(expect).length + 1,
      `${g.kills}/${g.headshots}`);
    M.ok('killScore 与逐次入账一致', g.killScore === g.score, g.killScore);
    g.killScore = 0; g.score = 0;
    const t = M.boss('titan', 15);
    M.ok('泰坦 5000', M.kill(t) === 5000, t.score);
    const mega = M.boss('megaTitan', 30);
    M.ok('巨型泰坦 20000', M.kill(mega) === 20000, mega.score);
    const b = M.boss('titan', 15);
    M.ok('BOSS 爆头同样 ×1.5（5000→7500）', M.kill(b, { headshot: true }) === 7500, g.score);
    M.ok('分数表不随难度变化', (() => {
      M.boot(4, { difficulty: 'nightmare' });
      const e = M.spawn('walker', M.at(M.spot.p, M.spot.dir, 30), 4);
      return e.score === 100 && M.kill(e) === 100 && e.maxHp === Math.round(80 * 2.2);
    })(), '噩梦只放大血量');
  },

  // 队友击杀：60% 团队分，不进玩家击杀数/爆头率，也不驱动玩家掉落节奏。
  allyKillShare() {
    const M = window.__M6, g = M.g();
    M.boot(4, { allies: true });
    const kills0 = g.kills, hs0 = g.headshots, sq0 = g.squadKills, drops0 = g.effects.drops.length;
    const w = M.spawn('walker', M.at(M.spot.p, M.spot.dir, 30), 4);
    const gain = M.kill(w, { ally: 1, headshot: true });
    M.ok('队友击杀按 60% 折算（100→60，爆头不加成分）', gain === 60, gain);
    M.ok('队友击杀不增玩家 kills/headshots',
      g.kills === kills0 && g.headshots === hs0, `${g.kills}/${g.headshots}`);
    M.ok('队友击杀单独计数', g.squadKills === sq0 + 1, g.squadKills);
    const before = g.effects.drops.length;
    for (let i = 0; i < 6; i++) M.kill(M.spawn('walker', M.at(M.spot.p, M.spot.dir, 30), 4), { ally: 0 });
    M.ok('队友击杀不触发玩家掉落节奏', g.effects.drops.length === before,
      `${before}->${g.effects.drops.length}（起点 ${drops0}）`);
    const tyr = M.spawn('tyrant', M.at(M.spot.p, M.spot.dir, 30), 4);
    M.ok('高价值目标同样 60%（400→240）', M.kill(tyr, { ally: 2 }) === 240, tyr.score);
    M.ok('玩家 5 杀才掉医疗、3 杀掉弹药（对照组）', (() => {
      const start = g.effects.drops.length;
      for (let i = 0; i < 3; i++) M.kill(M.spawn('walker', M.at(M.spot.p, M.spot.dir, 30), 4));
      return g.effects.drops.length > start;
    })(), '玩家击杀驱动掉落');
  },

  // 波次分：每波 300，该波未耗复活币再 +100；waveCoins 每波归零，耗币走真实 tryRevive 链路。
  waveScore() {
    const M = window.__M6, g = M.g();
    M.boot(4, {});
    const s0 = g.score, w0 = g.waveScoreTotal;
    M.forceClear();
    M.ok('未耗币波 +400（300+100）', g.score - s0 === 400 && g.waveScoreTotal - w0 === 400,
      `${g.score}/${g.waveScoreTotal}`);
    M.ok('waveMode 决定波次分与奖励', g.waveMode.waveScore === 300 && g.waveMode.noReviveBonus === 100);
    g.waveCoins = 3;
    M.boot(5, {});
    M.ok('换波自动清零 waveCoins', g.waveCoins === 0, g.waveCoins);
    g.coins = 5; g.coinsUsed = 0;
    g.player.downed = true; g.player.downedRemaining = 30;
    g.player.tryRevive();
    M.ok('真实耗币链路标记本波（coins/waveCoins 同步 +1）',
      g.coins === 4 && g.coinsUsed === 1 && g.waveCoins === 1,
      `${g.coins}/${g.coinsUsed}/${g.waveCoins}`);
    const s1 = g.score;
    M.forceClear();
    M.ok('耗币波只 +300', g.score - s1 === 300, g.score - s1);
    M.boot(2, { mode: 'practice' });
    const before = g.score;
    M.forceClear();
    M.ok('练习模式波次分 250、无 +100 奖励',
      g.score - before === 250 && g.waveMode.waveScore === 250 && g.waveMode.noReviveBonus === 0,
      g.score - before);
  },

  // 三难度复测：兵力取整、血量/伤害倍率、默认币量与分数倍率。
  difficultyTuning() {
    const M = window.__M6, g = M.g(), W = window.DZ.WAVES;
    const giant = W.mode('giant');
    for (const key of ['normal', 'hard', 'nightmare']) {
      const d = W.difficulty(key);
      M.boot(3, { difficulty: key });
      const q = W.queue(giant, 2, key);
      const want = giant.waves[2].entries.reduce((n, e) => n + Math.round(e.count * d.count), 0);
      M.ok(`${key}：波 3 兵力按 ×${d.count} 四舍五入`, q.length === want, `${q.length}/${want}`);
      const e = M.spawn('walker', M.at(M.spot.p, M.spot.dir, 30), 3);
      M.ok(`${key}：血量 ×${d.hp} / 伤害 ×${d.damage}`,
        e.maxHp === Math.round(W.TYPES.walker.hp * d.hp) && e.damage === Math.round(W.TYPES.walker.damage * d.damage),
        `${e.maxHp}/${e.damage}`);
      M.ok(`${key}：面板分数倍率 ×${d.scoreMultiplier}`,
        g.difficultyConfig.scoreMultiplier === d.scoreMultiplier, g.difficulty);
      M.boot(1, { difficulty: key, coins: d.defaultCoins });
      M.ok(`${key}：默认开局币 ${d.defaultCoins} 不触发硬核`, g.hardcore === false, g.coins);
      // 全 30 波逐条核对取整口径（BOSS 波 entries 为空，靠增援/召唤补兵）。
      const bad = giant.waves.map((cfg, i) => {
        const len = W.queue(giant, i, key).length;
        const sum = cfg.entries.reduce((n, en) => n + Math.round(en.count * d.count), 0);
        return len === sum ? null : i + 1;
      }).filter(Boolean);
      M.ok(`${key}：30 波兵力全部等于取整和`, bad.length === 0, bad.join(','));
    }
    const counts = giant.waves.map((cfg, i) => W.queue(giant, i, 'nightmare').length);
    M.ok('噩梦普通波兵力随波次增长', counts[28] > counts[0] && counts[12] > counts[4],
      JSON.stringify([counts[0], counts[12], counts[28]]));
    M.ok('第 30 波只刷巨型泰坦（entries 为空、boss 标记在）',
      counts[29] === 0 && giant.waves[29].boss === true && giant.waves[29].bossType === 'megaTitan',
      `${counts[29]}/${giant.waves[29].bossType}`);
    M.ok('BOSS 波 15/20/30 的增援只在 BOSS 存活时投放',
      giant.waves[14].reinforce.every === 20 && giant.waves[19].reinforce.every === 20 &&
      giant.waves[29].reinforce.every === 18, '20/20/18');
  },

  // 总分 = (击杀分 + 波次分) × 难度倍率 × 硬核加成；练习模式不乘。
  finalScore() {
    const M = window.__M6, g = M.g();
    const combos = [
      { difficulty: 'normal', coins: 30, raw: 1200, want: 1 },
      { difficulty: 'normal', coins: 0, raw: 1200, want: 1.5 },
      { difficulty: 'hard', coins: 30, raw: 1634, want: 1.5 },
      { difficulty: 'hard', coins: 0, raw: 1634, want: 2.25 },
      { difficulty: 'nightmare', coins: 0, raw: 1399, want: 3.75 }
    ];
    for (const c of combos) {
      M.boot(3, { difficulty: c.difficulty, coins: c.coins });
      g.killScore = c.raw - 400; g.waveScoreTotal = 400; g.score = c.raw;
      g.finish(false);
      M.ok(`${c.difficulty}${c.coins === 0 ? '·硬核' : ''}：round(${c.raw} × ${c.want})`,
        g.hardcore === (c.coins === 0) && g.scoreMultiplier === c.want &&
        g.finalScore === Math.round(c.raw * c.want),
        `${g.finalScore}/${g.scoreMultiplier}/${g.hardcore}`);
    }
    M.boot(2, { difficulty: 'normal', coins: 0 });
    g.score = 7; g.killScore = 7; g.waveScoreTotal = 0;
    g.finish(false);
    M.ok('奇数分四舍五入（7×1.5→11）', g.finalScore === 11, g.finalScore);
    M.boot(2, { mode: 'practice' });
    g.killScore = 100; g.waveScoreTotal = 250; g.score = 350;
    g.finish(false);
    M.ok('练习模式不乘倍率（finalScore=原始分）',
      g.waveMode.scoreMultiplied === false && g.scoreMultiplier === 1 && g.finalScore === 350 &&
      g.hardcore === false, `${g.finalScore}/${g.hardcore}`);
  },

  // 失败面板：阵亡波次、击杀分保留、爆头率、币耗、用时、明细与队伍存活榜。
  resultLoss() {
    const M = window.__M6, g = M.g();
    M.boot(7, { allies: true });
    M.kill(M.spawn('walker', M.at(M.spot.p, M.spot.dir, 30), 7));
    M.kill(M.spawn('runner', M.at(M.spot.p, M.spot.dir, 30), 7), { headshot: true });
    M.kill(M.spawn('runner', M.at(M.spot.p, M.spot.dir, 30), 7), { headshot: true });
    M.kill(M.spawn('walker', M.at(M.spot.p, M.spot.dir, 30), 7), { ally: 0 });
    g.coins = 28; g.coinsUsed = 2; g.waveCoins = 2; g.time = 372.5;
    g.squad.members.forEach((m, i) => { m.aliveTime = [40, 300, 120][i]; });
    g.finish(false);
    M.ok('失败面板抬头与标题', M.text('result-eyebrow') === 'SIGNAL LOST' &&
      M.text('result-title').indexOf('信号已中断') === 0, M.text('result-title'));
    M.ok('显示"阵亡于第 7 波"', M.text('result-description').indexOf('阵亡于第 7 波') === 0 &&
      g.deathWave === 7, M.text('result-description'));
    M.ok('到达波次 7 / 30', M.text('result-wave') === '7 / 30', M.text('result-wave'));
    M.ok('失败保留击杀分（100+180+180+队友 60 = 520）',
      g.killScore === 520 && Number(M.text('result-score')) === 520,
      `${g.killScore}/${M.text('result-score')}`);
    M.ok('击杀/爆头数与爆头率（3 杀 2 爆 = 67%）',
      M.text('result-kills') === '3 / 2' && M.text('result-headshot') === '67%',
      `${M.text('result-kills')}|${M.text('result-headshot')}`);
    M.ok('复活币消耗 2 枚', M.text('result-coins') === '2', M.text('result-coins'));
    M.ok('用时 6:12', M.text('result-time') === '6:12', M.text('result-time'));
    M.ok('分数明细：(击杀分 520 + 波次分 0) × 难度 ×1 = 520',
      M.html('result-breakdown-text').indexOf('(击杀分 <b>520</b> + 波次分 <b>0</b>) × 难度 <b>×1</b>') >= 0 &&
      M.html('result-breakdown-text').indexOf('总分 <b>520</b>') >= 0 &&
      M.html('result-breakdown-text').indexOf('队友击杀 1') >= 0,
      M.html('result-breakdown-text'));
    const rows = Array.from(document.querySelectorAll('#result-squad-list li')).
      map(li => [li.querySelector('span').textContent, li.querySelector('em').textContent]);
    M.ok('队伍存活时长榜按久→短排（3 行）', rows.length === 3 &&
      rows[0][1] === '5:00' && rows[1][1] === '2:00' && rows[2][1] === '0:40', JSON.stringify(rows));
    M.ok('明细区与币量格在巨人城模式可见',
      M.hidden('result-breakdown') === false && M.hidden('result-coins-cell') === false &&
      M.hidden('result-squad-board') === false);
  },

  // 胜利面板：30 波全清 + 硬核/难度加成同时上屏。
  resultWin() {
    const M = window.__M6, g = M.g();
    M.boot(30, { difficulty: 'hard', coins: 0, allies: true });
    g.killScore = 5600; g.waveScoreTotal = 12000; g.score = 17600;
    g.kills = 40; g.headshots = 10; g.coinsUsed = 0; g.time = 60;
    g.finish(true);
    M.ok('胜利抬头/标题/波次', M.text('result-eyebrow') === 'MISSION COMPLETE' &&
      M.text('result-title').indexOf('防线已守住') === 0 && M.text('result-wave') === '30 / 30',
      M.text('result-wave'));
    M.ok('硬核 + 难度同时生效（×1.5×1.5 → 39600）',
      g.scoreMultiplier === 2.25 && g.finalScore === 39600 && Number(M.text('result-score')) === 39600,
      g.finalScore);
    M.ok('明细含 × 难度 ×1.5 × 硬核 ×1.5',
      M.html('result-breakdown-text').indexOf('× 难度 <b>×1.5</b> × 硬核 <b>×1.5</b>') >= 0 &&
      M.html('result-breakdown-text').indexOf('(击杀分 <b>5600</b> + 波次分 <b>12000</b>)') >= 0,
      M.html('result-breakdown-text'));
    M.ok('胜利文案不提阵亡波次', M.text('result-description').indexOf('阵亡于') < 0 &&
      g.deathWave === 0, String(g.deathWave));
    M.ok('爆头率 25% · 币耗 0 · 用时 1:00',
      M.text('result-headshot') === '25%' && M.text('result-coins') === '0' && M.text('result-time') === '1:00',
      `${M.text('result-headshot')}|${M.text('result-coins')}|${M.text('result-time')}`);
  },

  // 练习模式结算零变化：不显示币/明细/队伍榜，分数口径与 M5 之前一致。
  practiceZero() {
    const M = window.__M6, g = M.g();
    M.boot(3, { mode: 'practice' });
    g.kills = 6; g.headshots = 1; g.score = 850; g.killScore = 600; g.waveScoreTotal = 250;
    g.finish(false);
    M.ok('练习模式明细/币量隐藏',
      M.hidden('result-breakdown') === true && M.hidden('result-coins-cell') === true);
    M.ok('无队伍存活榜', document.querySelectorAll('#result-squad-list li').length === 0 &&
      M.hidden('result-squad-board') === true);
    M.ok('总分仍等于原始分', g.finalScore === 850 && Number(M.text('result-score')) === 850, M.text('result-score'));
    M.ok('练习模式没有 squad/hardcore 字段污染', g.squad == null && g.hardcore === false,
      `${g.squad}/${g.hardcore}`);
    M.ok('练习模式波次数与旧公式血量不变',
      g.waveMode.dataDriven === false && g.totalWaves === 5, `${g.waveMode.dataDriven}/${g.totalWaves}`);
  },

  // 距离 LOD：三档显隐、命中盒不变、BOSS 全细节、拉近可逆。
  lodTiers() {
    const M = window.__M6, g = M.g(), es = g.enemies;
    M.boot(6, {});
    // 把玩家挪到地图南端，才凑得出 4m / 40m / 70m 三条同屏距离。
    const corner = [[-21, -44], [21, -44], [-21, 44], [21, 44]].find(p => g.world.canStand(p[0], p[1], 0.62));
    if (!corner) { M.ok('找到南/北端站位', false, 'none'); return; }
    M.placePlayer({ x: corner[0], z: corner[1] });
    const near = M.openRing(3, 8), mid = M.openRing(32, 45), far = M.openRing(62, 80, [near, mid]);
    if (!near || !mid || !far) {
      M.ok('三档距离都能落地', false, JSON.stringify([near, mid, far]));
      return;
    }
    const eNear = M.spawn('walker', near, 6), eMid = M.spawn('tyrant', mid, 6), eFar = M.spawn('fogger', far, 6);
    M.ok('档位常量 26 / 52', es.lodNear === 26 && es.lodFar === 52, `${es.lodNear}/${es.lodFar}`);
    M.ok('三档实测距离 4/40/70 级', near.d < 26 && mid.d > 26 && far.d > 52,
      [near.d.toFixed(1), mid.d.toFixed(1), far.d.toFixed(1)].join('/'));
    M.ok('装饰件确实存在（眼/角/刀刃/披风）', eNear.detail.length > 0 && eFar.detail.length > 0,
      `${eNear.detail.length}/${eFar.detail.length}`);
    const targets0 = es.hitTargets().length;
    M.step(40);
    M.ok('近/中/远 = 0/1/2 档',
      eNear.lodLevel === 0 && eMid.lodLevel === 1 && eFar.lodLevel === 2,
      [eNear.lodLevel, eMid.lodLevel, eFar.lodLevel].join('/'));
    M.ok('0 档全开，1 档收装饰，2 档再收地面投影',
      eNear.detail.every(d => d.visible) && eNear.shadow.visible &&
      eMid.detail.every(d => !d.visible) && eMid.shadow.visible &&
      eFar.detail.every(d => !d.visible) && eFar.shadow.visible === false,
      `${eMid.detail.length}/${eFar.detail.length}`);
    M.ok('命中盒数量与档位无关', es.hitTargets().length === targets0 && targets0 > 0, `${targets0}`);
    const b = M.boss('titan', 15);
    M.pin(b, far.x, far.z);
    M.step(40);
    M.ok('BOSS 不参与 LOD（永远全细节）',
      b.lodLevel === -1 && b.detail.every(d => d.visible) && b.shadow.visible, String(b.lodLevel));
    M.pin(eFar, near.x, near.z);
    M.step(40);
    M.ok('拉近后回到 0 档（可逆，不是一次性降级）',
      eFar.lodLevel === 0 && eFar.detail.every(d => d.visible), String(eFar.lodLevel));
    M.ok('LOD 只降表现不改规则：血量/表分/速度不变',
      eFar.maxHp === window.DZ.WAVES.TYPES.fogger.hp && eFar.score === 200 && eFar.speed === 1.8,
      `${eFar.maxHp}/${eFar.score}/${eFar.speed}`);
  },

  // 45 同屏 A/B：LOD 降低绘制量，同时给出新的性能门读数。
  perfLodAB() {
    const M = window.__M6, g = M.g(), es = g.enemies, world = g.world;
    M.boot(29, {});
    M.immortal();
    M.placePlayer({ x: 0, z: 20 });
    const types = ['walker', 'runner', 'bomber', 'tyrant', 'fogger', 'splitter'];
    const used = [];
    let cursor = 0;
    const fill = () => {
      while (es.aliveCount() < 45 && cursor < 400) {
        // 在 4–76m 的整张图扇区里取点，保证 0/1/2 三档同时铺开。
        const band = [[3, 8], [9, 25], [27, 50], [53, 76]][cursor % 4];
        const p = M.openRing(band[0], band[1], used, Math.floor(cursor / 4) * 6);
        if (!p) { cursor += 4; continue; }
        cursor++;
        used.push(p);
        const e = M.spawn(types[es.aliveCount() % types.length], p, 29);
        e.pathClock = 1e9;
      }
      return es.aliveCount();
    };
    const peak = fill();
    M.ok('第 29 波能堆到 45 同屏', peak >= 45, `${peak} 只 / ${cursor} 次取点`);
    // 性能口径按 §10-8 要"45 同屏 + 黑雾 + 阴影"三者同场。
    for (let i = 0; i < 6; i++) {
      g.effects.fog(new window.THREE.Vector3(-15 + i * 6, 0, 5 + (i % 3) * 6), 6, 90);
    }
    M.step(40);
    const hist = [0, 1, 2].map(l => es.list.filter(e => e.lodLevel === l).length);
    M.ok('45 只同屏且三档都铺到（0/1/2 计数）',
      es.aliveCount() >= 45 && hist[0] > 0 && hist[1] > 0 && hist[2] > 0 && g.effects.fogs.length === 6,
      `${es.aliveCount()} 只 · 档位 ${hist.join('/')} · 黑雾 ${g.effects.fogs.length} 团`);
    // 绘制量对照必须冻在同一帧：模拟一旦推进，粒子/尸体/位移都会盖过 LOD 省下的几百个三角形。
    const drawStats = () => {
      world.render();
      return { calls: world.renderer.info.render.calls, tris: world.renderer.info.render.triangles };
    };
    const applyLod = () => {
      for (const e of es.list) { e.lodClock = 0; e.lodLevel = -99; }
      M.step(1);
    };
    const lod = drawStats();
    for (const e of es.list) {
      for (const d of e.detail) d.visible = true;
      if (e.shadow) e.shadow.visible = true;
    }
    const full = drawStats();
    applyLod();
    M.ok('LOD 降低三角面数（同帧 A/B）', lod.tris < full.tris,
      `${lod.tris} vs ${full.tris}（省 ${(100 - lod.tris / full.tris * 100).toFixed(1)}%）`);
    M.ok('LOD 降低 draw call（同帧 A/B）', lod.calls < full.calls, `${lod.calls} vs ${full.calls}`);
    const timing = () => {
      let sim = 0, frame = 0;
      for (let i = 0; i < 60; i++) {
        fill();
        const t0 = performance.now();
        g.update(1 / 60);
        const t1 = performance.now();
        world.render();
        sim += t1 - t0; frame += performance.now() - t1;
      }
      return { sim: +(sim / 60).toFixed(3), frame: +(frame / 60).toFixed(3) };
    };
    // 软件渲染 + 后台窗口的抖动能把单次读数差到 1.5 倍，A/B 交替跑三轮、各取最小值。
    const rounds = [];
    for (let r = 0; r < 3; r++) {
      es.lodNear = 26; es.lodFar = 52;
      applyLod();
      const a = timing();
      es.lodNear = 1e9; es.lodFar = 1e9;
      for (const e of es.list) { e.lodClock = 0; e.lodLevel = -99; }
      const b = timing();
      rounds.push([a, b]);
    }
    es.lodNear = 26; es.lodFar = 52;
    applyLod();
    const best = n => ({ sim: Math.min(...rounds.map(x => x[n].sim)), frame: Math.min(...rounds.map(x => x[n].frame)) });
    const tLod = best(0), tFull = best(1);
    M.ok('新性能门（M6 校准）：45 同屏 + 黑雾纯模拟 <8ms', tLod.sim < 8,
      `LOD ${tLod.sim}ms / 全细节 ${tFull.sim}ms · 三轮 ${rounds.map(x => x[0].sim + '/' + x[1].sim).join(' ')}`);
    M.ok('新性能门（M6 校准）：带渲染帧 <160ms 且 LOD 不比全细节慢 10%',
      tLod.frame < 160 && tLod.frame <= tFull.frame * 1.1,
      `LOD ${tLod.frame}ms / 全细节 ${tFull.frame}ms · 三轮 ${rounds.map(x => x[0].frame + '/' + x[1].frame).join(' ')} · document.hidden=${document.hidden}（SwiftShader 软渲染，真 GPU 另计）`);
  },

  // 全 30 波快进冒烟：真实投放/增援/BOSS/补给链路，玩家侧用直杀代替操作。
  fullRun30() {
    const M = window.__M6, g = M.g();
    M.boot(1, { allies: true, live: true });
    M.immortal();
    const tally = M.trackKills();
    const waves = [], clears = [], bossWaves = [];
    let frames = 0, lastWave = g.wave, lastScore = 0, clearedWave = 0, peakAlive = 0;
    while (frames < 150000 && g.state === 'playing') {
      frames++;
      g.update(1 / 30);
      peakAlive = Math.max(peakAlive, g.enemies.aliveCount());
      if (g.enemies.boss && !bossWaves.includes(g.wave)) bossWaves.push(g.wave);
      if (frames % 600 === 0) for (const e of g.enemies.list.slice()) if (!e.dead) M.kill(e);
      if (g.wavePhase === 'intermission' && g.nextWaveIn > 0.2) g.nextWaveIn = 0.2;
      if (g.wavePhase === 'intermission' && clearedWave !== g.wave) {
        clearedWave = g.wave;
        clears.push({ wave: g.wave, gained: g.score - lastScore, supplies: g.effects.supplies.length });
        lastScore = g.score;
      }
      if (g.wave !== lastWave) { waves.push(g.wave); lastWave = g.wave; }
      if (g.player.health < 40) g.player.health = 100;
    }
    M.unpatch();
    M.ok('一路打到 30 波并通关', g.state === 'won' && g.completedWaves === 30 && g.wave === 30,
      `${g.state}/${g.completedWaves}/${g.wave} · ${frames} 帧（模拟 ${(frames / 30 / 60).toFixed(1)} 分钟）`);
    M.ok('30 波逐波推进无跳号', waves.length === 29 && waves.every((w, i) => w === i + 2),
      JSON.stringify(waves.slice(-4)));
    M.ok('29 次波间结算全部触发', clears.length === 29 &&
      clears.every((c, i) => c.wave === i + 1), JSON.stringify(clears.slice(-3).map(c => c.wave)));
    M.ok('波次分合计 30×(300+100)', g.waveScoreTotal === 12000, g.waveScoreTotal);
    M.ok('每波都拿到 +400（全程未耗币）', clears.every(c => c.gained > 400 && g.coinsUsed === 0),
      JSON.stringify(clears.slice(0, 3).map(c => c.gained)));
    M.ok('30 波补给逐波点亮（每波 4 箱）',
      clears.every(c => c.supplies === 4), JSON.stringify(clears.slice(0, 4).map(c => c.supplies)));
    M.ok('BOSS 波 15/20/30 都真的刷出并被击杀',
      bossWaves.includes(15) && bossWaves.includes(20) && bossWaves.includes(30) &&
      tally.boss.titan >= 2 && tally.boss.megaTitan >= 1, JSON.stringify([bossWaves, tally.boss]));
    M.ok('六敌种全部上场', ['walker', 'runner', 'bomber', 'tyrant', 'fogger', 'splitter']
      .every(t => tally.byType[t] > 0), JSON.stringify(tally.byType));
    M.ok('killScore 与逐笔记账吻合', g.killScore === tally.points, `${g.killScore}/${tally.points}`);
    M.ok('总分 = 击杀分 + 波次分（普通难度 ×1）',
      g.finalScore === Math.round(g.score) && g.score === g.killScore + g.waveScoreTotal,
      `${g.finalScore}=${g.killScore}+${g.waveScoreTotal}`);
    M.ok('同屏峰值真的堆到上限附近且不越界（maxAlive 生效）', peakAlive >= 25 && peakAlive <= 45, peakAlive);
    M.ok('全程无 NaN / 负分',
      [g.score, g.killScore, g.waveScoreTotal, g.finalScore, g.time].every(Number.isFinite) && g.score >= 0,
      `${g.score}/${g.time.toFixed(1)}`);
    M.ok('队友参与输出（60% 折算已计入 killScore）', tally.ally > 0,
      `队友击杀 ${tally.ally} · 玩家 ${tally.player}`);
  },

  // 「留给 M6」数值复核落档：走真实取枪/伤害链路读数，结论写进 docs/implementation-plan.md。
  balanceNumbers() {
    const M = window.__M6, W = window.DZ.WAVES, T = W.TYPES, R = window.DZ.ENEMY_REGISTRY, g = M.g();
    M.boot(13, {});
    // 加特林 30s 续航 vs 泰坦 6000 血
    g.weapons.grantSpecial('gatling');
    const gat = g.weapons.items[4];
    const shots = Math.floor(gat.sustained / gat.interval);
    M.ok('加特林 30 秒 285 发 · 12255 理论伤（单挑泰坦够，需留出走位与雾内损耗）',
      gat.damage === 43 && gat.interval === 0.105 && gat.sustained === 30 &&
      shots === 285 && shots * gat.damage === 12255 && shots * gat.damage > T.titan.hp,
      `${shots} 发 · ${shots * gat.damage} 伤 / 泰坦 ${T.titan.hp}`);
    M.ok('加特林对巨型泰坦 15000 血不够（需步枪收尾）',
      shots * gat.damage < T.megaTitan.hp, `${shots * gat.damage} < ${T.megaTitan.hp}`);
    // 火箭 4 发对 BOSS 节奏
    g.weapons.grantSpecial('rocket');
    const rkt = g.weapons.items[4];
    M.ok('火箭 4 发 ×450=1800：泰坦需 14 发、巨型泰坦需 34 发（只当破阵手段）',
      rkt.explosive.damage === 450 && rkt.explosive.radius === 2.5 && rkt.ammo + rkt.reserve === 4 &&
      rkt.explosive.damage * 4 === 1800 && Math.ceil(T.titan.hp / 450) === 14 &&
      Math.ceil(T.megaTitan.hp / 450) === 34,
      `${rkt.explosive.damage}×${rkt.ammo + rkt.reserve}`);
    M.ok('火箭弹容量 1 + 备弹 3 · 装填 3.2s', rkt.capacity === 1 && rkt.reserve === 3 && rkt.reloadTime === 3.2);
    // 暴君伤害规则（M3a 留项：躯干 ×0.8、爆头 ×2 取爆头优先）
    const rifle = g.weapons.items[0];
    const tyr = M.spawn('tyrant', M.at(M.spot.p, M.spot.dir, 30), 13);
    const hp0 = tyr.hp;
    g.enemies.damage(tyr, 100, tyr.root.position, { x: 0, y: 0, z: 1 }, false, 0, 'rifle');
    const body = hp0 - tyr.hp;
    const tyr2 = M.spawn('tyrant', M.at(M.spot.p, M.spot.dir, 30), 13);
    const hp1 = tyr2.hp;
    g.enemies.damage(tyr2, 100, tyr2.root.position, { x: 0, y: 0, z: 1 }, true, 0, 'rifle');
    const head = hp1 - tyr2.hp;
    M.ok('暴君：步枪躯干 ×0.8（rifleResist 0.2），爆头不吃减伤（爆头优先）',
      tyr.def.rifleResist === 0.2 && body === 80 && head === 100, `躯干 ${body} / 爆头 ${head}`);
    M.ok('暴君单发步枪：躯干 21.6、爆头 54（weapons 层 ×2）',
      rifle.damage === 27 && rifle.damage * 0.8 === 21.6 && rifle.damage * 2 === 54,
      `${rifle.damage} → ${rifle.damage * 0.8}/${rifle.damage * 2}`);
    M.ok('暴君 500 血：躯干需 24 发、纯爆头 10 发',
      Math.ceil(T.tyrant.hp / 21.6) === 24 && Math.ceil(T.tyrant.hp / 54) === 10,
      `${Math.ceil(T.tyrant.hp / 21.6)}/${Math.ceil(T.tyrant.hp / 54)}`);
    // 近战 CD / 雾散体首团（M3a 留项，确认沿用）
    M.ok('近战 CD 沿用：普通 1.1s、暴君 1.7s、泰坦/巨型泰坦 2.0s',
      R.walker.melee.cooldown === 1.1 && R.tyrant.melee.cooldown === 1.7 &&
      R.titan.melee.cooldown === 2 && R.megaTitan.melee.cooldown === 2,
      `${R.walker.melee.cooldown}/${R.tyrant.melee.cooldown}/${R.titan.melee.cooldown}`);
    M.ok('雾散体每 6s 一团、半径 6、存活 8s（无开局折扣）',
      R.fogger.fog.every === 6 && R.fogger.fog.radius === 6 && R.fogger.fog.life === 8,
      JSON.stringify(R.fogger.fog));
    // BOSS 开局缓冲（M3b 留项）
    M.boot(15, {});
    const titanCfg = W.mode('giant').waves[14];
    const boss = M.boss('titan', 15, { summon: titanCfg.summon });
    M.ok('BOSS 开局缓冲：冲刺 3s / 砸地 5s / 首次召唤 20×0.6=12s',
      boss.skill.chargeCd === 3 && boss.skill.slamCd === 5 && boss.skill.summonCd === 12 &&
      titanCfg.summon.every === 20 && boss.def.charge.cooldown === 12 && boss.def.slam.cooldown === 8,
      `${boss.skill.chargeCd}/${boss.skill.slamCd}/${boss.skill.summonCd}`);
    // 巨型泰坦：震波只结算一次 + 连砸 2 下（M3b 留项）
    M.boot(30, {});
    const mega = M.boss('megaTitan', 30);
    const counts = M.counters();
    M.step(40);
    const before = counts.quake;
    g.enemies.damage(mega, mega.maxHp * 0.45, mega.root.position, { x: 0, y: 0, z: 1 }, false, 0, '');
    M.step(30);
    const afterFirst = counts.quake;
    g.enemies.damage(mega, mega.maxHp * 0.45, mega.root.position, { x: 0, y: 0, z: 1 }, false, 0, '');
    M.step(300);
    M.ok('巨型泰坦震波只在跌破 60% 血时结算一次',
      before === 0 && afterFirst === 1 && counts.quake === 1 && mega.skill.quakeDone === true,
      `${before}->${afterFirst}->${counts.quake} · quake.at=${mega.def.quake.at}`);
    M.ok('跌破 40% 触发狂暴（速度 3.3、CD×0.6、砸地 5m→6.5m）',
      mega.rage === true && mega.speed === 3.3 && mega.def.rage.cdScale === 0.6 &&
      mega.def.rage.slamRadius === 6.5, `${mega.speed}/${mega.def.rage.at}`);
    M.unpatch();
    const slamCounts = M.counters();
    mega.skill.phase = 'slamWind';
    mega.skill.wind = 0.1;
    mega.skill.slamsLeft = mega.def.slam.repeats;
    M.step(60);
    // 狂暴态下 bossCd 会乘 cdScale 0.6，收尾 CD 应按 8×0.6=4.8 起算（再扣掉砸完后的空跑帧）。
    const slamCdWant = mega.def.slam.cooldown * (mega.rage ? mega.def.rage.cdScale : 1);
    const slamGap = slamCounts.at.length === 2 ? slamCounts.at[1] - slamCounts.at[0] : -1;
    M.ok('连砸窗口：一次砸地连出 2 下、间隔 0.5s，收尾回到 bossCd(8)',
      slamCounts.area === 2 && mega.def.slam.repeats === 2 && mega.def.slam.gap === 0.5 &&
      Math.abs(slamGap - 0.5) < 0.04 && mega.skill.phase === 'idle' &&
      mega.skill.slamCd <= slamCdWant + 1e-6 && mega.skill.slamCd > slamCdWant - 0.6,
      `${slamCounts.area} 下 · 间隔 ${slamGap.toFixed(3)}s · slamCd ${mega.skill.slamCd.toFixed(2)}（基准 ${slamCdWant}）`);
    M.unpatch();
    // threat 仇恨规则手感（M3b 留项：记忆优先、无记忆取最远）
    M.boot(15, {});
    const es = g.enemies;
    const b2 = M.boss('titan', 15);
    M.step(40);
    const far = M.spawn('walker', { x: b2.root.position.x + 20, y: 0, z: b2.root.position.z }, 15);
    const near = M.spawn('walker', { x: b2.root.position.x + 3, y: 0, z: b2.root.position.z }, 15);
    // 用两个合成靶子做纯距离/记忆判定，避免玩家 bias 15 干扰 threat 读数。
    const decoys = [{ id: 1, position: far.root.position, radius: 0.4, isPlayer: false },
      { id: 2, position: near.root.position, radius: 0.4, isPlayer: false }];
    es.chooseTarget(b2, decoys);
    const noMemory = b2.targetId === 1;
    // 伤害记忆挂在"被打的怪"身上：这里要让 BOSS 记住近靶，所以打掉 BOSS 1 点血（攻击者 id=2）。
    es.damage(b2, 1, b2.root.position, { x: 0, y: 0, z: 1 }, false, 2, '');
    es.chooseTarget(b2, decoys);
    M.ok('threat：无记忆取最远、有伤害记忆优先（40 分 > 距离差）',
      b2.def.targetRule === 'threat' && noMemory === true && b2.targetId === 2,
      `无记忆→${noMemory} · 记忆后 id ${b2.targetId}（近 3m / 远 20m）`);
    // 冲顶自爆体的同层 +40 偏好（M4b 留项）
    M.boot(13, { allies: true });
    const ally = g.squad.members[2];
    ally.dead = false; ally.respawn = 0;
    ally.root.position.set(0, 3.2, -7.5);
    g.world.settleY(ally.root.position);
    M.placePlayer({ x: 4, z: -4 });
    const rush = M.spawn('bomber', { x: 6, y: 0, z: -2 }, 13);
    rush.topRush = true;
    const list = window.DZ.allyUnits(g);
    const roof = list.find(u => u.position.y > 1.2);
    g.enemies.chooseTarget(rush, list);
    const plain = M.spawn('bomber', { x: 6, y: 0, z: -2 }, 13);
    plain.topRush = false;
    g.enemies.chooseTarget(plain, list);
    M.ok('冲顶自爆体咬高层目标（同层 +40 偏好），普通自爆体仍打玩家',
      Boolean(roof) && rush.targetId === roof.id && plain.targetId === 0,
      `高层 id ${roof && roof.id} · 冲顶 ${rush.targetId} / 普通 ${plain.targetId}`);
    // 补给与箱量是否随难度（M5 留项 → 定稿：不随难度）
    const sup = [];
    for (const key of ['normal', 'hard', 'nightmare']) {
      M.boot(8, { difficulty: key });
      M.forceClear();
      sup.push(g.effects.supplies.length);
    }
    M.ok('补给不随难度变化：三难度都是每波 4 箱', sup.join(',') === '4,4,4', sup.join(','));
    // 黑雾表现（M3a 留项）
    const fx = g.effects;
    fx.fog(new window.THREE.Vector3(M.spot.p.x + 4, 0, M.spot.p.z), 6, 8);
    M.step(60);
    const fog = fx.fogs[fx.fogs.length - 1];
    M.ok('黑雾表现：体团 opacity 上限 0.5、贴地盘用径向 alphaMap 羽化',
      Math.abs(fog.material.opacity - 0.5) < 0.02 && !fog.material.alphaMap &&
      Boolean(fog.edgeMaterial) && Boolean(fog.edgeMaterial.alphaMap) &&
      Math.abs(fog.edgeMaterial.opacity - 0.78) < 0.02,
      `体团 ${fog.material.opacity.toFixed(3)} / 贴地 ${fog.edgeMaterial.opacity.toFixed(3)}`);
    // 车顶狙击手射界（M4c 遗留：holdRadius 20 + 同层判定）
    M.boot(25, { allies: true });
    const ranger = g.squad.members[2];
    const target = M.spawn('walker', { x: -12, y: 0, z: -6 }, 25);
    target.pathClock = 1e9;
    let stayed = true;
    for (let i = 0; i < 600; i++) {
      M.pin(target, -12, -6);
      M.step(1);
      if (Math.abs(ranger.root.position.y - 3.2) > 0.01) stayed = false;
    }
    M.ok('游骑兵在车顶压制 12m 外地面的目标且从不下楼',
      target.dead === true && stayed === true && Math.abs(ranger.root.position.y - 3.2) < 0.01,
      `剩余弹 ${ranger.ammo} · y ${ranger.root.position.y.toFixed(2)} · 掉血 ${(ranger.hp - 90).toFixed(0)}`);
    M.ok('游骑兵岗位 (0,3.2,-7.5) 与 holdRadius 20 已进数据表',
      g.world.squadPosts[2].y === 3.2 && ranger.def.holdRadius === 20 && ranger.def.range === 38,
      `${g.world.squadPosts[2].y}/${ranger.def.holdRadius}/${ranger.def.range}`);
  }
};

/* eslint-disable no-undef */
if (typeof window === 'undefined') (async () => {
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
      window.__M6 = M;
      return typeof window.DZ + '/' + (window.DZ && typeof window.DZ.game);
    })()`;
    console.log('harness ->', await browser.evaluate(harness));
    let pass = 0, fail = 0;
    const failures = [];
    for (const name of names) {
      const bootState = await browser.evaluate(
        `(() => { try { window.__M6.log = []; return 'ready'; } catch (e) { return 'BOOT-FAIL ' + e.message; } })()`);
      if (bootState !== 'ready') console.log('!! setup ->', bootState);
      const result = await browser.evaluate(
        `(() => {
          window.__M6.log = [];
          window.__case = function ${CASES[name].toString()};
          try { window.__case(); } catch (err) {
            window.__M6.log.push(['异常 ${name}', false, (err && err.message) + ' @ ' + String(err && err.stack || '').split('\\n')[1]]);
          }
          delete window.__case;
          return window.__M6.log;
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
      await browser.evaluate('(() => { if (window.__M6) window.__M6.unpatch(); if (window.__rafFreeze) { window.requestAnimationFrame = window.__rafFreeze; window.__rafFreeze = null; } const g = window.DZ.game; while (g.enemies.list.length) g.enemies.remove(0); g.effects.reset(); g.showMenu(); return "restored"; })()');
      restored = true;
    } catch (error) { console.log('restore skipped:', error.message); }
    if (!restored) { try { await browser.send('Page.reload', { ignoreCache: false }); } catch (error) { /* 连接已断，交给下一次运行 */ } }
    browser.close();
  }
})();
