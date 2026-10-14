(function () {
  'use strict';
  const DZ = window.DZ = window.DZ || {};

  // M0 波次数据层：30 波配置表 + 难度倍率 + 开局默认设置。
  // 数值来源 docs/design-giant-city-30waves.md §5 §6；行为与外形由 enemies.js 的敌种注册表登记。
  const TYPES = {
    walker: { key: 'walker', name: '步行者', hp: 80, speed: 1.7, damage: 10, score: 100 },
    runner: { key: 'runner', name: '疾行者', hp: 55, speed: 2.9, damage: 8, score: 120 },
    bomber: { key: 'bomber', name: '膨胀体', hp: 40, speed: 2.4, damage: 60, score: 150 },
    tyrant: { key: 'tyrant', name: '暴君', hp: 500, speed: 1.5, damage: 30, score: 400 },
    fogger: { key: 'fogger', name: '雾散体', hp: 90, speed: 1.8, damage: 12, score: 200 },
    splitter: { key: 'splitter', name: '裂魂者', hp: 120, speed: 2.6, damage: 15, score: 250 },
    titan: { key: 'titan', name: '泰坦', hp: 6000, speed: 2.2, damage: 50, score: 5000, boss: true, model: 'walker', scale: 2.2 },
    megaTitan: { key: 'megaTitan', name: '巨型泰坦', hp: 15000, speed: 2.2, damage: 50, score: 20000, boss: true, model: 'walker', scale: 2.8 }
  };

  const DIFFICULTY = {
    normal: { key: 'normal', name: '经典·普通', hp: 1, damage: 1, count: 1, defaultCoins: 30, scoreMultiplier: 1 },
    hard: { key: 'hard', name: '高级', hp: 1.5, damage: 1.3, count: 1.15, defaultCoins: 20, scoreMultiplier: 1.5 },
    nightmare: { key: 'nightmare', name: '噩梦', hp: 2.2, damage: 1.8, count: 1.35, defaultCoins: 10, scoreMultiplier: 2.5 }
  };

  // 西/东/北/顶四组刷怪点由各套地图自带（world.spawnGroups），波次数据只登记组名。
  function wave(config) {
    return Object.assign({ interval: 0.6, maxAlive: 30, groups: ['西', '东'], batches: 1, batchInterval: 0, boss: false, specialBox: false, reinforce: null, summon: null }, config);
  }

  const GIANT_WAVES = [
    wave({ total: 10, entries: [{ type: 'walker', count: 6 }, { type: 'runner', count: 4 }], interval: 0.9 }),
    wave({ total: 12, entries: [{ type: 'walker', count: 8 }, { type: 'runner', count: 4 }], interval: 0.87 }),
    wave({ total: 14, entries: [{ type: 'walker', count: 9 }, { type: 'runner', count: 5 }], interval: 0.85 }),
    wave({ total: 16, entries: [{ type: 'walker', count: 10 }, { type: 'runner', count: 6 }], interval: 0.82 }),
    wave({ total: 18, entries: [{ type: 'walker', count: 13 }, { type: 'runner', count: 0 }, { type: 'bomber', count: 4 }, { type: 'tyrant', count: 1 }], interval: 0.8, note: '自爆登场' }),
    wave({ total: 20, entries: [{ type: 'walker', count: 11 }, { type: 'bomber', count: 5 }, { type: 'tyrant', count: 2 }, { type: 'runner', count: 2 }], interval: 0.78 }),
    wave({ total: 22, entries: [{ type: 'walker', count: 12 }, { type: 'bomber', count: 6 }, { type: 'tyrant', count: 2 }, { type: 'runner', count: 2 }], groups: ['西', '西', '东'], interval: 0.76, note: '西重' }),
    wave({ total: 24, entries: [{ type: 'bomber', count: 6 }, { type: 'tyrant', count: 3 }, { type: 'runner', count: 8 }, { type: 'walker', count: 7 }], interval: 0.74, specialBox: true }),
    wave({ total: 26, entries: [{ type: 'bomber', count: 8 }, { type: 'tyrant', count: 3 }, { type: 'walker', count: 10 }, { type: 'runner', count: 5 }], interval: 0.72, note: '阶段末压力检查' }),
    wave({ total: 26, entries: [{ type: 'fogger', count: 3 }, { type: 'splitter', count: 2 }, { type: 'bomber', count: 6 }, { type: 'walker', count: 8 }, { type: 'runner', count: 7 }], interval: 0.7, maxAlive: 32, note: '高威胁新种登场' }),
    wave({ total: 28, entries: [{ type: 'fogger', count: 3 }, { type: 'splitter', count: 3 }, { type: 'bomber', count: 8 }, { type: 'tyrant', count: 1 }, { type: 'walker', count: 13 }], interval: 0.67, maxAlive: 32 }),
    wave({ total: 30, entries: [{ type: 'fogger', count: 4 }, { type: 'splitter', count: 3 }, { type: 'bomber', count: 8 }, { type: 'tyrant', count: 2 }, { type: 'walker', count: 7 }, { type: 'runner', count: 6 }], interval: 0.65, maxAlive: 34 }),
    wave({ total: 32, entries: [{ type: 'splitter', count: 4 }, { type: 'bomber', count: 10, groups: ['顶'] }, { type: 'fogger', count: 4 }, { type: 'runner', count: 14 }], interval: 0.62, maxAlive: 34, note: '混合冲锋' }),
    wave({ total: 34, entries: [{ type: 'fogger', count: 4 }, { type: 'splitter', count: 4 }, { type: 'bomber', count: 8 }, { type: 'tyrant', count: 3 }, { type: 'runner', count: 15 }], interval: 0.6, maxAlive: 36, note: '泰坦前哨战' }),
    wave({ total: 46, boss: true, bossType: 'titan', entries: [{ type: 'walker', count: 1 }, { type: 'runner', count: 1 }], interval: 0.6, maxAlive: 36, reinforce: { every: 20, entries: [{ type: 'walker', count: 2 }, { type: 'runner', count: 2 }] }, summon: { every: 20, picks: [[{ type: 'walker', count: 2 }, { type: 'runner', count: 2 }]] }, specialBox: true, note: '泰坦 + 无限增援' }),
    wave({ total: 36, entries: [{ type: 'bomber', count: 10 }, { type: 'tyrant', count: 3 }, { type: 'splitter', count: 4 }, { type: 'runner', count: 10 }, { type: 'walker', count: 9 }], interval: 0.57, maxAlive: 36, note: '报复性攻势' }),
    wave({ total: 38, entries: [{ type: 'bomber', count: 10 }, { type: 'tyrant', count: 4 }, { type: 'splitter', count: 6 }, { type: 'fogger', count: 6 }, { type: 'runner', count: 12 }], interval: 0.55, maxAlive: 38 }),
    wave({ total: 40, entries: [{ type: 'splitter', count: 6 }, { type: 'bomber', count: 12 }, { type: 'fogger', count: 4 }, { type: 'walker', count: 18 }], interval: 0.52, maxAlive: 38 }),
    wave({ total: 42, entries: [{ type: 'tyrant', count: 5 }, { type: 'bomber', count: 12 }, { type: 'splitter', count: 6 }, { type: 'fogger', count: 7 }, { type: 'runner', count: 12 }], interval: 0.5, maxAlive: 40 }),
    wave({ total: 52, boss: true, bossType: 'titan', entries: [{ type: 'walker', count: 6 }, { type: 'runner', count: 6 }], groups: ['西', '东', '北'], interval: 0.5, maxAlive: 40, reinforce: { every: 20, entries: [{ type: 'bomber', count: 2 }, { type: 'runner', count: 2 }] }, summon: { every: 20, picks: [[{ type: 'bomber', count: 2 }, { type: 'runner', count: 2 }]] }, specialBox: true, note: '双线作战' }),
    wave({ total: 44, entries: [{ type: 'splitter', count: 8 }, { type: 'fogger', count: 5 }, { type: 'bomber', count: 10 }, { type: 'walker', count: 11 }, { type: 'runner', count: 10 }], interval: 0.47, maxAlive: 40, note: '波次密集化' }),
    wave({ total: 46, entries: [{ type: 'bomber', count: 10, groups: ['顶'] }, { type: 'tyrant', count: 4 }, { type: 'splitter', count: 8 }, { type: 'fogger', count: 6 }, { type: 'runner', count: 18 }], interval: 0.45, maxAlive: 42, note: '车顶争夺' }),
    wave({ total: 48, entries: [{ type: 'bomber', count: 12 }, { type: 'tyrant', count: 5 }, { type: 'splitter', count: 8 }, { type: 'fogger', count: 6 }, { type: 'walker', count: 9 }, { type: 'runner', count: 8 }], interval: 0.42, maxAlive: 42, note: '全类型混合' }),
    wave({ total: 50, entries: [{ type: 'splitter', count: 10 }, { type: 'bomber', count: 12 }, { type: 'fogger', count: 6 }, { type: 'walker', count: 22 }], interval: 0.4, maxAlive: 44, specialBox: true, note: '团灭高发波' }),
    wave({ total: 50, entries: [{ type: 'fogger', count: 6 }, { type: 'splitter', count: 8 }, { type: 'bomber', count: 16 }, { type: 'tyrant', count: 4 }, { type: 'runner', count: 16 }], groups: ['西', '东', '北'], interval: 0.4, maxAlive: 44, note: '北通道启用' }),
    wave({ total: 52, entries: [{ type: 'tyrant', count: 6 }, { type: 'bomber', count: 14 }, { type: 'splitter', count: 6 }, { type: 'walker', count: 14 }, { type: 'runner', count: 12 }], groups: ['西', '东', '北'], interval: 0.38, maxAlive: 45 }),
    wave({ total: 54, entries: [{ type: 'fogger', count: 6 }, { type: 'bomber', count: 14 }, { type: 'splitter', count: 8 }, { type: 'tyrant', count: 5 }, { type: 'walker', count: 12 }, { type: 'runner', count: 9 }], groups: ['西', '东', '北'], interval: 0.38, maxAlive: 45, note: '视野压制波' }),
    wave({ total: 56, entries: [{ type: 'fogger', count: 8 }, { type: 'bomber', count: 16 }, { type: 'splitter', count: 8 }, { type: 'tyrant', count: 6 }, { type: 'runner', count: 18 }], groups: ['西', '东', '北'], interval: 0.36, maxAlive: 45, note: '先破封雾再上顶' }),
    wave({ total: 60, entries: [{ type: 'bomber', count: 14 }, { type: 'splitter', count: 10 }, { type: 'fogger', count: 8 }, { type: 'tyrant', count: 8 }, { type: 'walker', count: 10 }, { type: 'runner', count: 10 }], groups: ['西', '东', '北', '顶'], interval: 0.35, maxAlive: 45, batches: 4, batchInterval: 5, specialBox: true, note: '小最终关，分 4 批投放' }),
    wave({ total: 1, boss: true, bossType: 'megaTitan', entries: [], groups: ['南'], interval: 0.35, maxAlive: 45, reinforce: { every: 18, entries: [{ type: 'bomber', count: 3 }] }, summon: { every: 18, picks: [[{ type: 'bomber', count: 3 }], [{ type: 'runner', count: 4 }]] }, note: '决战' })
  ];

  // 旧「隔离区 07 · 5 波练习」模式：waveSizes 数据化，生成公式仍走旧逻辑（dataDriven:false）。
  const PRACTICE_WAVES = [8, 12, 17, 23, 30].map((size, index) => wave({
    total: size,
    entries: [{ type: 'walker', count: size }],
    interval: Math.max(0.3, 0.76 - (index + 1) * 0.08),
    maxAlive: 30,
    dataDriven: false
  }));

  const MODES = {
    giant: {
      key: 'giant', name: '巨人城 · 30 波防守', waves: GIANT_WAVES, dataDriven: true,
      intermission: 15, waveScore: 300, noReviveBonus: 100, allowCoins: true, allowSquad: true,
      revive: { castTime: 3, health: 50, guard: 5, rallyWindow: 20 },
      banner: { eyebrow: 'GIANT SECTOR / 30 WAVES', title: '守住防线', subtitle: '三十波感染者 · 队友掩护 · 复活币归队' }
    },
    practice: {
      key: 'practice', name: '隔离区 07 · 5 波练习', waves: PRACTICE_WAVES, dataDriven: false,
      intermission: 6, waveScore: 250, noReviveBonus: 0, allowCoins: false, allowSquad: false,
      revive: null,
      banner: { eyebrow: 'OPERATION / SECTOR 07', title: '守住防线', subtitle: '五波感染者 · 瞄准头部 · 拾取地面补给' }
    }
  };

  // 前线复活点随战线推进解锁：1–9=A 出发区，10–24=B 中央，25–30=C 火车南端。
  const REVIVE_STAGES = [[9, 'A'], [24, 'B'], [Infinity, 'C']];

  const DEFAULT_SETTINGS = { mode: 'giant', difficulty: 'normal', coins: 30 };

  // 开局设置；coins 由 M1 消费，这里先入库。
  DZ.Settings = Object.assign({}, DEFAULT_SETTINGS);

  DZ.WAVES = {
    TYPES, DIFFICULTY, MODES, DEFAULT_SETTINGS, REVIVE_STAGES,
    mode(modeKey) { return MODES[modeKey] || MODES.giant; },
    difficulty(difficultyKey) { return DIFFICULTY[difficultyKey] || DIFFICULTY.normal; },
    waveAt(mode, index) { return mode.waves[Math.max(0, Math.min(mode.waves.length - 1, index))]; },
    stageForWave(wave) {
      for (const [until, stage] of REVIVE_STAGES) if (wave <= until) return stage;
      return 'C';
    },
    // 兵力按难度倍率取整。
    queue(mode, index, difficulty) {
      const mult = this.difficulty(difficulty).count;
      const queue = [];
      const cfg = this.waveAt(mode, index);
      for (const entry of cfg.entries) {
        const total = Math.max(0, Math.round(entry.count * mult));
        const groups = entry.groups || cfg.groups;
        for (let i = 0; i < total; ++i) queue.push({ type: entry.type, group: groups[i % groups.length] });
      }
      return queue;
    },
    // 原地重排（Fisher-Yates），避免所有西点怪先于东点刷出。
    shuffle(queue, random = Math.random) {
      for (let i = queue.length - 1; i > 0; --i) {
        const j = Math.floor(random() * (i + 1));
        const t = queue[i]; queue[i] = queue[j]; queue[j] = t;
      }
      return queue;
    }
  };

  // 波次出怪运行器：批次数/间隔、生成间隔、同屏上限、BOSS 增援全部由波配置驱动。
  // dataDriven=false 时退化为旧模式的 count 驱动。
  DZ.WaveRunner = class WaveRunner {
    constructor(mode, difficulty) {
      this.mode = mode;
      this.difficulty = DZ.WAVES.difficulty(difficulty);
      this.cfg = null;
      this.queue = [];
      this.pending = 0;
      this.spawnTimer = 0;
      this.batchSize = 0;
      this.batchLeft = 0;
      this.batchClock = 0;
      this.reinforceClock = 0;
      this.bossSpawned = false;
      this.dataDriven = false;
    }
    start(index) {
      this.index = index;
      this.cfg = DZ.WAVES.waveAt(this.mode, index);
      this.dataDriven = this.mode.dataDriven && this.cfg.dataDriven !== false;
      this.spawnTimer = 0.2;
      this.bossSpawned = false;
      this.queue = this.dataDriven ? DZ.WAVES.shuffle(DZ.WAVES.queue(this.mode, index, this.difficulty.key)) : [];
      this.pending = 0;
      const batches = Math.max(1, this.cfg.batches || 1);
      this.batchSize = Math.ceil(this.queue.length / batches);
      this.batchLeft = this.queue.length;
      this.batchClock = 0;
      this.reinforceClock = this.cfg.reinforce ? this.cfg.reinforce.every : 0;
      // BOSS 波的增援只在 BOSS 存活时投放，否则击杀 BOSS 后波次永远无法结算。
      this.bossAlive = false;
      // 分批波次：待生成数按批次逐批释放；不分批时一次性全部开放。
      if (!this.dataDriven) this.pending = this.cfg.total;
      else if (batches <= 1) { this.pending = this.queue.length; this.batchLeft = 0; }
    }
    tick(dt) {
      if (!this.cfg || !this.dataDriven) return;
      if (this.batchLeft > 0) {
        this.batchClock -= dt;
        if (this.batchClock <= 0) {
          const release = Math.min(this.batchSize, this.batchLeft);
          this.batchLeft -= release;
          this.pending += release;
          this.batchClock = this.cfg.batchInterval;
        }
      }
      if (this.cfg.reinforce && (!this.cfg.boss || this.bossAlive)) {
        this.reinforceClock -= dt;
        if (this.reinforceClock <= 0) {
          this.reinforceClock = this.cfg.reinforce.every;
          for (const entry of this.cfg.reinforce.entries) {
            const groups = entry.groups || this.cfg.groups;
            const total = Math.max(0, Math.round(entry.count * this.difficulty.count));
            for (let i = 0; i < total; ++i) this.queue.push({ type: entry.type, group: groups[i % groups.length] });
            this.pending += total;
          }
        }
      }
    }
    take() {
      if (!this.cfg) return null;
      if (!this.dataDriven) return this.pending > 0 ? { legacy: true } : null;
      return this.pending > 0 && this.queue.length ? this.queue.shift() : null;
    }
  };
})();
