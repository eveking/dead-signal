(function () {
  'use strict';
  const DZ = window.DZ = window.DZ || {};

  function bootError(message) {
    document.getElementById('boot').hidden = true;
    const error = document.getElementById('load-error');
    error.hidden = false;
    error.textContent = message;
    document.getElementById('start-label').textContent = '无法进入隔离区';
  }

  if (!window.THREE) {
    bootError('Three.js 加载失败，请检查网络后刷新。也可以运行“启动游戏.cmd”，再用 Chrome 或 Edge 打开本地地址。');
    return;
  }

  DZ.Game = class Game {
    constructor() {
      this.state = 'menu';
      this.applySettings();
      this.wave = this.completedWaves = this.score = this.kills = this.headshots = this.squadKills = 0;
      this.killScore = this.waveScoreTotal = this.waveCoins = 0;
      this.finalScore = 0;
      this.coinsUsed = 0;
      this.deathWave = 0;
      this.scoreMultiplier = 1;
      this.wavePhase = 'intermission';
      this.nextWaveIn = 4;
      this.time = 0;
      this.menuTime = 0;
      this.fps = 60;
      this.world = new DZ.World(document.getElementById('viewport'));
      this.audio = new DZ.Audio();
      this.player = new DZ.Player(this);
      this.effects = new DZ.Effects(this);
      this.enemies = new DZ.Enemies(this);
      this.weapons = new DZ.Weapons(this);
      this.squad = null;
      this.ui = new DZ.UI(this);
      this.bindEvents();
      this.decorateMenu();
      this.world.render();
      const button = document.getElementById('start-btn');
      button.disabled = false;
      document.getElementById('start-label').textContent = '进入隔离区';
      document.getElementById('boot').classList.add('ready');
      if (matchMedia('(pointer: coarse)').matches) document.getElementById('mobile-notice').hidden = false;
      let previous = performance.now(), accumulator = 0, fpsTime = 0, frames = 0;
      const loop = now => {
        const elapsed = Math.max(0, (now - previous) / 1000);
        previous = now;
        fpsTime += elapsed; frames++;
        if (fpsTime >= 0.5) { this.fps = Math.round(frames / fpsTime); fpsTime = 0; frames = 0; }
        // 固定物理步长避免低帧率时穿墙；暂停期间不积累时间或后台生成怪物。
        if (this.state === 'playing') {
          accumulator += Math.min(elapsed, 0.1);
          let steps = 0;
          while (accumulator >= 1 / 60 && steps < 6 && this.state === 'playing') {
            this.update(1 / 60);
            accumulator -= 1 / 60;
            steps++;
          }
        } else {
          accumulator = 0;
          if (this.state === 'menu') {
            this.menuTime += Math.min(elapsed, 0.05);
            this.world.menuView(this.menuTime);
            this.world.update(Math.min(elapsed, 0.05));
          }
        }
        this.world.render();
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    }

    // 开局设置（模式/难度/复活币）入库；coins 为 M1 的复活币经济。
    applySettings() {
      const s = DZ.Settings;
      this.modeKey = s.mode;
      this.waveMode = DZ.WAVES.mode(s.mode);
      this.difficulty = s.difficulty;
      this.difficultyConfig = DZ.WAVES.difficulty(s.difficulty);
      this.coins = s.coins;
      // 硬核加成（§9）：巨人城模式开局把复活币设为 0，最终得分 ×1.5。
      this.hardcore = this.waveMode.allowCoins && s.coins === 0;
      this.allowRevive = this.waveMode.allowCoins && Boolean(this.waveMode.revive);
      this.totalWaves = this.waveMode.waves.length;
      this.waveSizes = this.waveMode.waves.map(w => w.total);
    }

    // F 传送目标：巨人城模式传向最近存活队友（全部阵亡返回 null，玩家侧提示）；练习模式保持岗位点。
    rallyTarget() {
      if (this.squad) return this.squad.nearestAlive(this.player.position);
      return this.world.defensePost;
    }

    bindEvents() {
      const byId = id => document.getElementById(id);
      byId('start-btn').addEventListener('click', () => this.newGame());
      byId('restart-btn').addEventListener('click', () => this.newGame());
      byId('restart-pause-btn').addEventListener('click', () => this.newGame());
      byId('resume-btn').addEventListener('click', () => this.requestPlay());
      byId('menu-btn').addEventListener('click', () => this.showMenu());
      document.querySelector('.brand').addEventListener('click', e => { e.preventDefault(); });
      byId('mobile-dismiss').addEventListener('click', () => { byId('mobile-notice').hidden = true; });
      this.muted = false;
      byId('sound-btn').addEventListener('click', () => {
        this.muted = !this.muted;
        this.audio.setMuted(this.muted);
        this.audio.unlock();
        byId('sound-btn').setAttribute('aria-pressed', String(this.muted));
        byId('sound-btn').querySelector('span').textContent = this.muted ? '音效关闭' : '音效开启';
      });
      document.addEventListener('pointerlockchange', () => {
        if (document.pointerLockElement === this.world.renderer.domElement) {
          if (this.state === 'paused') {
            this.state = 'playing';
            this.player.clearInput();
            this.ui.setScreen('playing');
            this.ui.update(0);
          }
        } else if (this.state === 'playing') this.pause(false);
      });
      document.addEventListener('pointerlockerror', () => this.lockError());
      document.addEventListener('keydown', event => {
        if (event.code === 'Escape' && this.state === 'playing') this.pause();
        if (event.code === 'Enter' && this.state === 'menu' && event.target.tagName !== 'BUTTON') this.newGame();
      });
      addEventListener('blur', () => { if (this.state === 'playing') this.pause(); });
      document.addEventListener('visibilitychange', () => { if (document.hidden && this.state === 'playing') this.pause(); });
      this.world.renderer.domElement.addEventListener('webglcontextlost', event => {
        event.preventDefault();
        this.pause();
        byId('pause-message').textContent = '显卡连接已中断，请刷新页面重新加载游戏。';
        byId('resume-btn').disabled = true;
        byId('restart-pause-btn').disabled = true;
      });
    }

    newGame() {
      this.applySettings();
      // 两套地图按模式切换：巨人城用 96×48 长图，5 波练习保留原 48×48 隔离区。
      this.world.useMap(this.modeKey);
      if (this.squad) { this.squad.dispose(); this.squad = null; }
      this.enemies.runner = new DZ.WaveRunner(this.waveMode, this.difficulty);
      this.enemies.reset();
      this.effects.reset();
      this.player.reset();
      this.weapons.reset();
      if (this.waveMode.allowSquad) this.squad = new DZ.Squad(this);
      // M3b 留的接缝：15/20 波泰坦击杀必掉特殊武器箱（30 波无 specialBox 标记不掉）。
      this.enemies.onBossDeath = enemy => {
        const cfg = DZ.WAVES.waveAt(this.waveMode, this.wave - 1);
        if (this.waveMode.key !== 'giant' || !cfg.boss || !cfg.specialBox) return;
        this.spawnSpecialBox(cfg.specialWeapon || 'rocket', enemy.root.position);
      };
      this.time = 0;
      this.wave = this.completedWaves = this.score = this.kills = this.headshots = this.squadKills = 0;
      this.killScore = this.waveScoreTotal = this.waveCoins = 0;
      this.finalScore = 0;
      this.coinsUsed = 0;
      this.deathWave = 0;
      this.scoreMultiplier = 1;
      this.wavePhase = 'intermission';
      this.nextWaveIn = 4;
      this.growlIn = 5;
      this.state = 'paused';
      this.world.resetNavigation();
      this.player.syncCamera();
      this.weapons.view.visible = true;
      this.weapons.update(0);
      this.ui.reset();
      this.ui.setScreen('paused');
      const banner = this.waveMode.banner;
      this.ui.showBanner(banner.title, banner.subtitle, banner.eyebrow, 3.5);
      this.requestPlay();
    }

    requestPlay() {
      if (this.state !== 'paused') return;
      this.audio.unlock();
      document.getElementById('pause-message').textContent = '战场正在等待。准备好后，继续守住防线。';
      if (!this.world.renderer.domElement.requestPointerLock) {
        this.lockError('当前浏览器不支持鼠标锁定，请使用电脑版 Chrome、Edge 或 Firefox。');
        return;
      }
      // 请求必须直接发生在点击回调中，不能等待音频解锁后再调用。
      try {
        const request = this.world.renderer.domElement.requestPointerLock();
        if (request && request.catch) request.catch(() => this.lockError());
      } catch (error) { this.lockError(); }
    }

    lockError(message) {
      if (this.state !== 'paused') return;
      document.getElementById('pause-message').textContent = message || '鼠标锁定未获允许。请在浏览器中点击“继续战斗”；刚按过 Esc 时，请稍等一秒再点击。';
    }

    pause(unlock = true) {
      if (this.state !== 'playing') return;
      this.state = 'paused';
      this.player.clearInput();
      this.ui.setScreen('paused');
      if (unlock && document.pointerLockElement) document.exitPointerLock();
    }

    decorateMenu() {
      for (const [x, z, angle] of this.world.menuDecor) {
        const e = this.enemies.spawn(new THREE.Vector3(x, 0, z), 1);
        e.root.rotation.y = angle;
        e.limbs[0].rotation.x = -0.6;
        e.limbs[2].rotation.x = -0.4;
      }
    }

    showMenu() {
      this.state = 'menu';
      this.world.useMap(DZ.Settings.mode);
      if (document.pointerLockElement) document.exitPointerLock();
      this.player.clearInput();
      if (this.squad) { this.squad.dispose(); this.squad = null; }
      this.enemies.reset();
      this.effects.reset();
      this.weapons.view.visible = false;
      this.ui.reset();
      this.ui.setScreen('menu');
      this.decorateMenu();
    }

    // 固定投放（§8）：8/24/29 波开局刷中央平台，15/20 波泰坦必掉；波次结束未拾取则消失。
    spawnSpecialBox(kind, position) {
      this.effects.drop(position.clone ? position.clone() : position, kind, { waveEnd: true });
      this.ui.toast(`特殊武器补给投放 · ${kind === 'rocket' ? 'R-80 火箭筒' : 'M-56 加特林'}`, 2.5);
    }

    // 波间补给：4 固定点位每波点亮（弹药×2 + 医疗×2 随机分配，点位轮换=类型轮换）。
    spawnWaveSupplies() {
      const points = this.world.supplyPoints;
      if (!points.length) return;
      const kinds = ['ammo', 'ammo', 'health', 'health'];
      for (let i = kinds.length - 1; i > 0; --i) {
        const j = Math.floor(Math.random() * (i + 1));
        const t = kinds[i]; kinds[i] = kinds[j]; kinds[j] = t;
      }
      for (let i = 0; i < points.length && i < kinds.length; i++) this.effects.spawnSupply(points[i], kinds[i]);
    }

    startWave() {
      this.wave++;
      this.wavePhase = 'active';
      this.waveCoins = 0;
      const giant = this.waveMode.key === 'giant';
      const cfg = DZ.WAVES.waveAt(this.waveMode, this.wave - 1);
      this.enemies.startWave(this.wave);
      this.audio.wave();
      if (giant && cfg.specialBox && !cfg.boss) this.spawnSpecialBox(cfg.specialWeapon || 'gatling', this.world.specialBoxPoint);
      if (giant) {
        const isBoss = cfg.boss;
        const last = this.wave === this.totalWaves;
        const bossName = isBoss ? DZ.WAVES.TYPES[cfg.bossType].name : '';
        this.ui.showBanner(
          last ? '最终波 · 决战' : isBoss ? `第 ${this.wave} 波 · ${bossName}现身` : `第 ${this.wave} 波`,
          isBoss ? `${bossName}正在接近，做好战斗准备` : `${this.waveSizes[this.wave - 1]} 名感染者正在接近`,
          isBoss ? 'BOSS INBOUND' : 'HOSTILES INBOUND', 2.6);
      } else {
        this.ui.showBanner(this.wave === this.totalWaves ? '最后一波' : `第 ${this.wave} 波`, `${this.waveSizes[this.wave - 1]} 名感染者正在接近`, this.wave === this.totalWaves ? 'FINAL ASSAULT' : 'HOSTILES INBOUND', 2.6);
      }
    }

    update(dt) {
      this.time += dt;
      this.player.update(dt);
      this.weapons.update(dt);
      if (this.squad) this.squad.update(dt);
      this.enemies.update(dt);
      if (this.state !== 'playing') return;
      this.effects.update(dt);
      this.world.update(dt);
      this.growlIn -= dt;
      if (this.growlIn <= 0) { if (this.enemies.aliveCount()) this.audio.growl(); this.growlIn = 5 + Math.random() * 4; }
      if (this.wavePhase === 'intermission') {
        this.nextWaveIn -= dt;
        if (this.nextWaveIn <= 0) this.startWave();
      } else if (this.enemies.pending === 0 && this.enemies.aliveCount() === 0) {
        this.completedWaves = this.wave;
        // §9 波次分 = 每波 300 + 该波未耗币奖励 100（练习模式 noReviveBonus 为 0，行为不变）。
        const bonus = this.waveCoins === 0 ? (this.waveMode.noReviveBonus || 0) : 0;
        this.score += this.waveMode.waveScore + bonus;
        this.waveScoreTotal += this.waveMode.waveScore + bonus;
        if (this.wave === this.totalWaves) { this.finish(true); return; }
        this.wavePhase = 'intermission';
        this.nextWaveIn = this.waveMode.intermission;
        this.player.heal(20);
        this.weapons.addAmmo(60, 24);
        if (this.squad) this.squad.resupply();
        // M5 波末：上一波的临时箱（特殊武器箱/倒地掉落）过期，再点亮本波补给。
        if (this.waveMode.supplies) {
          this.effects.expireWaveDrops();
          this.effects.expireSupplies();
          this.spawnWaveSupplies();
        }
        this.audio.pickup();
        this.ui.showBanner('区域暂时安全', `生命 +20 · 弹药已补给 · 准备第 ${this.wave + 1} 波`,
          `WAVE CLEARED / +${this.waveMode.waveScore + bonus}`, 4);
      }
      this.ui.update(dt);
    }

    finish(won) {
      if (this.state !== 'playing') return;
      this.state = won ? 'won' : 'lost';
      if (!won) this.deathWave = this.wave;
      // §9 总分 = (击杀分 + 波次分) × 难度倍率 × 硬核加成；练习模式不乘（scoreMultiplied:false）。
      const mult = this.waveMode.scoreMultiplied ?
        this.difficultyConfig.scoreMultiplier * (this.hardcore ? 1.5 : 1) : 1;
      this.scoreMultiplier = mult;
      this.finalScore = Math.round(this.score * mult);
      this.player.downed = false;
      this.player.downedRemaining = 0;
      this.player.clearInput();
      this.weapons.view.visible = false;
      if (document.pointerLockElement) document.exitPointerLock();
      this.audio.end(won);
      this.ui.showDowned(false);
      this.ui.result(won);
    }
  };

  try { DZ.game = new DZ.Game(); }
  catch (error) {
    console.error(error);
    bootError('游戏初始化失败。请启用浏览器硬件加速并更新浏览器；按 F12 查看具体错误。');
  }
})();
