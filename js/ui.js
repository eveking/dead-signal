(function () {
  'use strict';

  var DZ = window.DZ = window.DZ || {};
  var RADAR_INTERVAL = 1 / 12;
  var DAMAGE_LIFETIME = 0.65;
  var FEED_LIFETIME = 3.5;
  var HIT_LIFETIME = 0.18;

  function number(value, fallback) {
    return Number.isFinite(value) ? value : fallback;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function count(value) {
    return Math.max(0, Math.floor(number(value, 0)));
  }

  function padded(value, length) {
    return String(count(value)).padStart(length, '0');
  }

  class UI {
    constructor(game) {
      this.game = game || {};
      this.el = {};
      var ids = 'menu topbar hud pause result health-value health-fill score-value ' +
        'wave-status wave-value wave-pips remaining-value radar-count minimap ' +
        'weapon-name weapon-mode weapon-slots ammo-value reserve-value crosshair ' +
        'reload-indicator reload-progress fps hitmarker damage-numbers killfeed ' +
        'wave-banner banner-title banner-subtitle banner-eyebrow toast damage-overlay ' +
        'result-eyebrow result-title result-description result-score result-wave result-kills ' +
        'result-headshot result-coins result-coins-cell result-time result-breakdown ' +
        'result-breakdown-text result-squad-board result-squad-list result-best result-record ' +
        'menu-best menu-best-score menu-best-meta ' +
        'downed downed-ring downed-count downed-hint rally rally-count coins-panel coins-value ' +
        'squad-panel squad-rows fog-veil boss-bar boss-name boss-fill boss-value scope';
      ids.split(' ').forEach((id) => { this.el[id] = document.getElementById(id); });

      this.healthPanel = this.el['health-value'].closest('.health-panel');
      this.healthBar = this.el['health-fill'].parentElement;
      this.ammoPanel = this.el['ammo-value'].closest('.ammo-value');
      this.weaponHints = document.querySelectorAll('.hud-bottom-center > span');
      this.reloadBar = this.el['reload-progress'].parentElement;
      this.waveNumber = document.createTextNode('');
      this.waveTotal = document.createElement('em');
      this.el['wave-value'].textContent = '';
      this.el['wave-value'].append(this.waveNumber, this.waveTotal);
      this.pips = Array.from(this.el['wave-pips'].children);
      this.damageNumbers = [];
      this.feedEntries = [];
      this.context = null;
      try {
        this.context = this.el.minimap.getContext('2d');
      } catch (error) {
        // 雷达不可用时仍保留其余 HUD。
      }

      // 禁用墙钟动画，暂停时所有战斗反馈才能严格冻结。
      this.el['health-fill'].style.transition = 'none';
      this.el['damage-overlay'].style.transition = 'none';
      this.el['wave-banner'].style.animation = 'none';
      ['crosshair', 'hitmarker', 'damage-numbers', 'damage-overlay'].forEach((id) => {
        this.el[id].setAttribute('aria-hidden', 'true');
      });
      ['toast', 'wave-banner'].forEach((id) => {
        this.el[id].setAttribute('role', 'status');
        this.el[id].setAttribute('aria-live', 'polite');
        this.el[id].setAttribute('aria-atomic', 'true');
      });
      this.el.killfeed.setAttribute('role', 'log');
      this.el.killfeed.setAttribute('aria-live', 'polite');
      this.el.killfeed.setAttribute('aria-relevant', 'additions');
      this.el.minimap.setAttribute('role', 'img');
      this.el.minimap.setAttribute('aria-label',
        '战术雷达，北向上；绿色箭头为玩家，红点为敌人，蓝色圆点为 AI 队友，绿色方块为医疗箱，琥珀色方块为弹药箱，紫色方块为特殊武器箱，青色方框为前线复活点，黑色圆区为雾散体黑雾（该区域雷达失效）。');
      this.el['wave-pips'].setAttribute('aria-hidden', 'true');
      [this.healthBar, this.reloadBar].forEach((bar) => {
        bar.setAttribute('role', 'progressbar');
        bar.setAttribute('aria-valuemin', '0');
        bar.setAttribute('aria-valuemax', '100');
      });
      this.healthBar.setAttribute('aria-label', '生命值');
      this.reloadBar.setAttribute('aria-label', '装填进度');
      this.el.pause.setAttribute('role', 'dialog');
      this.el.pause.setAttribute('aria-modal', 'true');
      this.el.pause.setAttribute('aria-label', '行动暂停');
      this.el.result.setAttribute('role', 'dialog');
      this.el.result.setAttribute('aria-modal', 'true');
      this.el.result.setAttribute('aria-labelledby', 'result-title');

      this.reset();
      this.bindSettings();
      this.refreshSettingsUi();
      this.setScreen(this.game.state || 'menu');
    }

    // 开局设置：模式二选一 + 难度三档 + 复活币滑条（0=硬核），写回 DZ.Settings。
    bindSettings() {
      var self = this;
      var setup = document.getElementById('load-setup');
      if (!setup || !window.DZ || !DZ.WAVES) return;
      function segment(id, key, onChange) {
        var root = document.getElementById(id);
        root.addEventListener('click', function (event) {
          var btn = event.target.closest('.seg-btn');
          if (!btn) return;
          DZ.Settings[key] = btn.dataset.value;
          self.refreshSettingsUi();
          if (onChange) onChange(btn.dataset.value);
        });
      }
      // 菜单里切换模式就换图：巨人城预览新长图，练习模式预览旧隔离区。
      segment('setup-mode', 'mode', function (value) {
        var game = self.game;
        if (!game || game.state !== 'menu' || !game.world) return;
        game.world.useMap(value);
        game.enemies.reset();
        game.decorateMenu();
      });
      segment('setup-difficulty', 'difficulty');
      this.el.coins = document.getElementById('setup-coins');
      this.el['setup-coins-value'] = document.getElementById('setup-coins-value');
      this.el.hardcore = document.getElementById('setup-hardcore');
      this.el.coins.addEventListener('input', function () {
        DZ.Settings.coins = clamp(count(self.el.coins.value), 0, 99);
        self.refreshSettingsUi();
      });
      ['setup-mode', 'setup-difficulty'].forEach(function (id) { self.el[id] = document.getElementById(id); });
      this.el['difficulty-row'] = document.getElementById('setup-difficulty-row');
      this.el['coins-row'] = document.getElementById('setup-coins-row');
      this.el['mission-waves'] = document.getElementById('mission-waves');
    }

    refreshSettingsUi() {
      if (!this.el['setup-mode'] || !window.DZ || !DZ.WAVES) return;
      var mode = DZ.WAVES.mode(DZ.Settings.mode);
      var sync = function (root, value) {
        Array.prototype.forEach.call(root.querySelectorAll('.seg-btn'), function (btn) {
          var active = btn.dataset.value === value;
          btn.classList.toggle('active', active);
          btn.setAttribute('aria-checked', String(active));
        });
      };
      sync(this.el['setup-mode'], DZ.Settings.mode);
      sync(this.el['setup-difficulty'], DZ.Settings.difficulty);
      this.el['difficulty-row'].style.display = mode.allowCoins ? '' : 'none';
      this.el['coins-row'].style.display = mode.allowCoins ? '' : 'none';
      this.el.coins.value = String(DZ.Settings.coins);
      this.el['setup-coins-value'].textContent = DZ.Settings.coins + ' 枚';
      this.el.hardcore.hidden = DZ.Settings.coins !== 0;
      this.el['mission-waves'].textContent = padded(mode.waves.length, 2);
      this._updateMenuBest();
    }

    setScreen(state) {
      if (!['menu', 'playing', 'paused', 'won', 'lost'].includes(state)) return;
      this.screen = state;
      var inGame = state === 'playing' || state === 'paused';
      this.el.menu.hidden = state !== 'menu';
      this.el.topbar.hidden = state !== 'menu';
      this.el.hud.hidden = !inGame;
      this.el.pause.hidden = state !== 'paused';
      this.el.result.hidden = state !== 'won' && state !== 'lost';
      this.el['damage-overlay'].hidden = !inGame;
      document.body.classList.toggle('playing', inGame);
      if (state === 'menu') this._updateMenuBest();
    }

    // 主菜单的历史最佳条：只显示当前所选模式的纪录。
    _updateMenuBest() {
      var node = this.el['menu-best'];
      if (!node || !DZ.best) return;
      var mode = DZ.Settings.mode === 'practice' ? 'practice' : 'giant';
      var best = DZ.best.load(mode);
      node.hidden = !best;
      if (!best) return;
      var waves = DZ.WAVES.mode(mode).waves.length;
      var diff = DZ.WAVES.DIFFICULTY[best.difficulty];
      this.el['menu-best-score'].textContent = String(count(best.score));
      this.el['menu-best-meta'].textContent = '第 ' + count(best.wave) + ' / ' + waves + ' 波 · ' +
        (diff ? diff.name : '—') + ' · ' + this._formatTime(best.time) + ' · ' +
        new Date(number(best.date, 0)).toLocaleDateString();
    }

    update(dt) {
      this._text('fps', count(this.game.fps) + ' FPS');
      if (this.screen !== 'playing' ||
          (this.game.state && this.game.state !== 'playing')) return;

      dt = Math.max(0, number(dt, 0));
      this._updateHUD(this.game);
      if (dt === 0) return;

      this.bannerRemaining = Math.max(0, this.bannerRemaining - dt);
      this.toastRemaining = Math.max(0, this.toastRemaining - dt);
      this._timedVisibility(this.el['wave-banner'], this.bannerRemaining, 0.25);
      this._timedVisibility(this.el.toast, this.toastRemaining, 0.2);
      this.hitRemaining = Math.max(0, this.hitRemaining - dt);
      this.el.hitmarker.style.opacity = String(this.hitRemaining / HIT_LIFETIME);
      if (this.hitRemaining === 0) this.el.hitmarker.classList.remove('head');
      this.hurtStrength = Math.max(0, this.hurtStrength - dt * 1.8);
      this.el['damage-overlay'].style.opacity = String(this.hurtStrength);

      for (var i = this.damageNumbers.length - 1; i >= 0; i--) {
        var damage = this.damageNumbers[i];
        damage.remaining = Math.max(0, damage.remaining - dt);
        if (damage.remaining === 0) {
          damage.node.remove();
          this.damageNumbers.splice(i, 1);
          continue;
        }
        var progress = 1 - damage.remaining / DAMAGE_LIFETIME;
        var scale = progress < 0.25 ? 0.7 + progress * 1.6 : 1.1 - (progress - 0.25) / 7.5;
        damage.node.style.opacity = String(Math.min(1, damage.remaining / 0.25));
        damage.node.style.transform = 'translate(-50%, -' + (50 + progress * 170) +
          '%) scale(' + scale + ')';
      }
      for (var j = this.feedEntries.length - 1; j >= 0; j--) {
        var entry = this.feedEntries[j];
        entry.remaining = Math.max(0, entry.remaining - dt);
        if (entry.remaining === 0) {
          entry.node.remove();
          this.feedEntries.splice(j, 1);
        } else {
          entry.node.style.opacity = String(Math.min(1, entry.remaining / 0.35));
        }
      }

      this.radarElapsed += dt;
      if (this.radarElapsed >= RADAR_INTERVAL) {
        // 不补画积压帧，确保雷达最多每秒刷新 12 次。
        this.radarElapsed = 0;
        this._drawMinimap();
      }
    }

    showBanner(title, subtitle, eyebrow = 'INCOMING TRANSMISSION', duration = 3) {
      this._text('banner-title', title);
      this._text('banner-subtitle', subtitle);
      this._text('banner-eyebrow', eyebrow);
      this.bannerRemaining = Math.max(0, number(duration, 3));
      this._timedVisibility(this.el['wave-banner'], this.bannerRemaining, 0.25);
    }

    toast(text, duration = 2) {
      this._text('toast', text);
      this.toastRemaining = Math.max(0, number(duration, 2));
      this._timedVisibility(this.el.toast, this.toastRemaining, 0.2);
    }

    showDowned(visible) {
      this.el.downed.hidden = !visible;
      if (!visible) this.el.rally.hidden = true;
    }

    hit(damage, position, headshot) {
      this.hitRemaining = HIT_LIFETIME;
      this.el.hitmarker.classList.toggle('head', Boolean(headshot));
      this.el.hitmarker.style.opacity = '1';

      var camera = this.game.world && this.game.world.camera;
      if (!camera || !position || typeof position.clone !== 'function') return;
      camera.updateMatrixWorld();
      var projected = position.clone();
      projected.applyMatrix4(camera.matrixWorldInverse);
      // 先排除相机背面的命中点，避免镜像伤害数字。
      if (projected.z >= 0) return;
      projected.copy(position).project(camera);
      if (![projected.x, projected.y, projected.z].every(Number.isFinite) ||
          Math.abs(projected.x) > 1 || Math.abs(projected.y) > 1 ||
          projected.z < -1 || projected.z > 1) return;

      // damage-numbers 是 inset:0 全屏容器，尺寸等价于视口；直读 innerWidth/Height，避免每发命中 getBoundingClientRect 强制同步布局。
      var width = window.innerWidth;
      var height = window.innerHeight;
      if (!(width > 0 && height > 0)) return;
      if (this.damageNumbers.length >= 16) this.damageNumbers.shift().node.remove();
      var node = document.createElement('span');
      node.className = 'damage-number' + (headshot ? ' head' : '');
      node.textContent = String(Math.max(0, Math.round(number(damage, 0))));
      node.style.animation = 'none';
      node.style.left = ((projected.x + 1) * 0.5 * width) + 'px';
      node.style.top = ((1 - projected.y) * 0.5 * height) + 'px';
      node.style.opacity = '1';
      node.style.transform = 'translate(-50%, -50%) scale(0.7)';
      this.el['damage-numbers'].appendChild(node);
      this.damageNumbers.push({ node: node, remaining: DAMAGE_LIFETIME });
    }

    kill(headshot, points, label) {
      if (this.feedEntries.length >= 4) this.feedEntries.shift().node.remove();
      var node = document.createElement('div');
      node.textContent = label || (headshot ? '爆头击杀' : '击杀感染者');
      node.style.animation = 'none';
      node.style.opacity = '1';
      if (headshot) node.style.borderRightColor = '#ffc985';
      if (label) node.style.borderRightColor = '#8fd0ff';
      var score = document.createElement('b');
      score.textContent = '+' + count(points);
      if (headshot) score.style.color = '#ffc985';
      if (label) score.style.color = '#8fd0ff';
      node.appendChild(score);
      this.el.killfeed.appendChild(node);
      this.feedEntries.push({ node: node, remaining: FEED_LIFETIME });
    }

    hurt() {
      this.hurtStrength = Math.min(1, this.hurtStrength + 0.65);
      this.el['damage-overlay'].style.opacity = String(this.hurtStrength);
    }

    result(won) {
      this._fillResult(Boolean(won), this.game);
      this.setScreen(won ? 'won' : 'lost');
    }

    reset() {
      this.bannerRemaining = 0;
      this.toastRemaining = 0;
      this.hitRemaining = 0;
      this.hurtStrength = 0;
      this.radarElapsed = 0;
      this.damageNumbers.length = 0;
      this.feedEntries.length = 0;
      this.el['damage-numbers'].textContent = '';
      this.el.killfeed.textContent = '';
      this.el.hitmarker.classList.remove('head');
      this.el.hitmarker.style.opacity = '0';
      this.el['damage-overlay'].style.opacity = '0';
      this.showBanner('', '', 'INCOMING TRANSMISSION', 0);
      this.toast('', 0);
      var initial = { totalWaves: this.game.totalWaves };
      this._updateHUD(initial);
      this._text('fps', '0 FPS');
      this._fillResult(true, initial);
      if (this.context) {
        this.context.clearRect(0, 0, this.el.minimap.width, this.el.minimap.height);
      }
    }

    _text(id, value) {
      var text = value == null ? '' : String(value);
      if (this.el[id].textContent !== text) this.el[id].textContent = text;
    }

    _timedVisibility(node, remaining, fadeTime) {
      node.hidden = remaining <= 0;
      node.style.opacity = String(Math.min(1, remaining / fadeTime));
    }

    _totalWaves(game) {
      return Math.max(1, count(number(game.totalWaves, 5)));
    }

    // 复活币 / 濒死读条环 / 归队传送窗口。
    _updateRevive(game, player) {
      var revive = (game.waveMode || {}).revive;
      var enabled = Boolean(revive && game.allowRevive);
      this.el['coins-panel'].hidden = !enabled;
      var coins = count(game.coins);
      if (enabled) {
        this._text('coins-value', coins);
        this.el['coins-panel'].classList.toggle('spent', coins === 0);
      }
      var downed = enabled && Boolean(player.downed);
      this.el.downed.hidden = !downed;
      if (downed) {
        var remaining = Math.max(0, number(player.downedRemaining, 0));
        var ratio = clamp(remaining / Math.max(0.001, number(revive.castTime, 60)), 0, 1);
        this.el['downed-ring'].style.setProperty('--p', String(ratio));
        this._text('downed-count', remaining >= 10 ? String(Math.ceil(remaining)) : remaining.toFixed(1));
        this._text('downed-hint', coins > 0 ?
          '按 E 消耗 1 枚复活币 · 在前线复活点归队' : '复活币耗尽 · 读条走完即失守');
      }
      var rally = Math.max(0, number(player.rallyWindow, 0));
      this.el.rally.hidden = !enabled || downed || rally <= 0;
      if (rally > 0) this._text('rally-count', Math.ceil(rally) + ' 秒');
    }

    // 小队面板：代号 / 指令（含 1.5 秒切换倒计时）/ 血条 / 阵亡重生倒计时。
    _updateSquad(game) {
      var squad = game.squad;
      this.el['squad-panel'].hidden = !squad;
      if (!squad) {
        if (this.squadBound) {
          this.el['squad-rows'].textContent = '';
          this.squadRows = [];
          this.squadBound = null;
        }
        return;
      }
      if (this.squadBound !== squad || this.squadRows.length !== squad.members.length) {
        this.squadBound = squad;
        this.el['squad-rows'].textContent = '';
        this.squadRows = squad.members.map(function (member) {
          var row = document.createElement('div');
          row.className = 'squad-row';
          var name = document.createElement('b');
          name.className = 'sq-name';
          name.textContent = member.def.name;
          var order = document.createElement('span');
          order.className = 'sq-order';
          var bar = document.createElement('div');
          bar.className = 'sq-hp';
          var fill = document.createElement('i');
          bar.appendChild(fill);
          row.appendChild(name);
          row.appendChild(order);
          row.appendChild(bar);
          this.el['squad-rows'].appendChild(row);
          return { row: row, order: order, fill: fill };
        }, this);
      }
      var labels = (window.DZ && DZ.Squad && DZ.Squad.ORDER_LABELS) || {};
      squad.members.forEach(function (m, i) {
        var r = this.squadRows[i];
        r.row.classList.toggle('selected', i === squad.selected);
        r.row.classList.toggle('dead', m.dead);
        r.row.classList.toggle('switching', !m.dead && Boolean(m.pendingOrder));
        var text;
        if (m.dead) text = '复活 ' + Math.max(0, Math.ceil(m.respawn)) + ' 秒';
        else if (m.pendingOrder) text = '→' + (labels[m.pendingOrder] || m.pendingOrder) + ' ' + Math.max(0, m.orderClock).toFixed(1) + ' 秒';
        else text = labels[m.order] || m.order;
        if (r.order.textContent !== text) r.order.textContent = text;
        var ratio = clamp(number(m.hp, 0) / Math.max(1, m.maxHp), 0, 1);
        var fillW = Math.round(ratio * 100) + '%';
        if (r.fillW !== fillW) { r.fillW = fillW; r.fill.style.width = fillW; }
      }, this);
    }

    // 雾散体黑雾：玩家身处雾中时视野被遮（§5），用屏幕暗角表达。
    _updateFogVeil(game, player) {
      var veil = this.el['fog-veil'];
      if (!veil) return;
      var effects = game.effects;
      var position = player && player.position;
      var density = effects && typeof effects.fogDensity === 'function' && position &&
        Number.isFinite(position.x) && Number.isFinite(position.z) ?
        effects.fogDensity(position) : 0;
      var opacity = clamp(density * 0.92, 0, 0.92);
      veil.hidden = opacity <= 0.01;
      var opacityStr = String(opacity);
      if (this._veilOpacity !== opacityStr) { this._veilOpacity = opacityStr; veil.style.opacity = opacityStr; }
    }

    // BOSS 血条：泰坦/巨型泰坦登场时显示，狂暴态（e.rage）变色（§8-④）。
    _updateBoss(game) {
      var boss = game.enemies && game.enemies.boss && !game.enemies.boss.dead ? game.enemies.boss : null;
      this.el['boss-bar'].hidden = !boss;
      if (!boss) return;
      var hp = Math.max(0, number(boss.hp, 0));
      var max = Math.max(1, number(boss.maxHp, hp || 1));
      this._text('boss-name', (boss.def && boss.def.name) || 'BOSS');
      this._text('boss-value', Math.ceil(hp) + ' / ' + Math.ceil(max));
      var pct = (hp / max * 100) + '%';
      if (this._bossPct !== pct) { this._bossPct = pct; this.el['boss-fill'].style.width = pct; }
      this.el['boss-bar'].classList.toggle('rage', Boolean(boss.rage));
    }

    _updateHUD(game) {
      var player = game.player || {};
      var weapons = game.weapons || {};
      var current = weapons.current || {};
      var health = clamp(number(player.health, 100), 0, 100);
      var index = Math.min(4, Math.max(0, count(weapons.index)));
      var total = this._totalWaves(game);
      var wave = clamp(count(game.wave), 0, total);
      var completed = clamp(count(game.completedWaves), 0, total);
      var enemies = game.enemies;
      var alive = enemies ? count(typeof enemies.aliveCount === 'function' ?
        enemies.aliveCount() : (enemies.list || []).filter((enemy) => !enemy.dead).length) : 0;
      var remaining = alive + count(enemies && enemies.pending);
      var active = game.wavePhase === 'active';

      this._text('health-value', Math.ceil(health));
      var healthPct = health + '%';
      if (this._healthPct !== healthPct) { this._healthPct = healthPct; this.el['health-fill'].style.width = healthPct; }
      this.healthPanel.classList.toggle('low', health <= 30);
      var healthNow = String(Math.ceil(health));
      if (this._healthNow !== healthNow) { this._healthNow = healthNow; this.healthBar.setAttribute('aria-valuenow', healthNow); }
      this._updateRevive(game, player);
      this._updateSquad(game);
      this._updateFogVeil(game, player);
      this._updateBoss(game);
      this._text('score-value', padded(game.score, 5));
      var waveText = padded(wave, 2) + ' ';
      if (this.waveNumber.nodeValue !== waveText) this.waveNumber.nodeValue = waveText;
      var totalText = '/ ' + padded(total, 2);
      if (this.waveTotal.textContent !== totalText) this.waveTotal.textContent = totalText;
      while (this.pips.length < total) {
        var pip = document.createElement('i');
        this.el['wave-pips'].appendChild(pip);
        this.pips.push(pip);
      }
      while (this.pips.length > total) this.pips.pop().remove();
      this.pips.forEach((pip, i) => {
        pip.classList.toggle('active', i < completed || (active && i === wave - 1));
      });
      if (completed >= total) {
        this._text('wave-status', '区域已肃清');
      } else if (active) {
        this._text('wave-status', '感染者来袭');
      } else if (game.wavePhase === 'intermission') {
        this._text('wave-status', '下一波 · ' + Math.ceil(Math.max(0, number(game.nextWaveIn, 0))) + ' 秒');
      } else {
        this._text('wave-status', '准备作战');
      }
      this._text('remaining-value', enemies ? '剩余 ' + remaining + ' 名感染者' : '等待敌人');
      this._text('radar-count', enemies ? '检测到 ' + alive + ' 个敌对信号' : '区域扫描中');
      this._text('weapon-name', current.name || (index === 0 ? 'AR-7 突击步枪' : '战术手枪'));
      var automatic = typeof current.automatic === 'boolean' ? current.automatic : index === 0;
      // M5 特殊武器 + 五槽：加特林弹药位显示剩余秒数、备弹 ∞；火箭筒标"单发"；军刀 ∞/近战；手雷按持数/上限。
      var gunType = current.type;
      var gatling = gunType === 'gatling';
      var knife = gunType === 'knife';
      var grenade = gunType === 'grenade';
      var ammo = gatling ? Math.max(0, Math.ceil(number(weapons.specialTimer, 0))) :
        knife ? '∞' : count(number(current.ammo, 30));
      var reserve = count(number(current.reserve, 180));
      this._text('weapon-mode', gunType === 'rocket' ? '单发' : knife ? 'MELEE' :
        grenade ? '投掷' : gunType === 'sniper' ? 'BOLT' : automatic ? 'AUTO' : 'SEMI');
      this._text('weapon-slots', (window.DZ.SLOT_LABELS || [])[index] || '');
      this._text('ammo-value', ammo);
      this._text('reserve-value', gatling ? '∞' : knife ? '—' : grenade ? String(count(number(current.capacity, 6))) : reserve);
      var ammoLabel = gatling ? '持续弹剩余 ' + ammo + ' 秒，备弹不限' :
        knife ? '军刀无耐久 · 普通感染者一挥必杀，泰坦/巨型泰坦 150，暴君 60' :
        grenade ? '持握手雷 ' + ammo + ' / ' + count(number(current.capacity, 6)) + ' · 弹药箱与补给箱各 +1' :
        '弹匣 ' + ammo + ' / ' + count(number(current.capacity, 30)) + '，备用弹药 ' + reserve;
      if (this._ammoLabel !== ammoLabel) { this._ammoLabel = ammoLabel; this.el['ammo-value'].setAttribute('aria-label', ammoLabel); }
      this.ammoPanel.classList.toggle('empty', typeof ammo === 'number' && ammo === 0);
      if (this._weaponIndex !== index) {
        this._weaponIndex = index;
        for (var i = 0; i < Math.min(5, this.weaponHints.length); i++) {
          this.weaponHints[i].style.color = i === index ? 'var(--lime)' : '';
          if (i === index) this.weaponHints[i].setAttribute('aria-current', 'true');
          else this.weaponHints[i].removeAttribute('aria-current');
        }
      }
      var spread = clamp(7 + Math.max(0, number(weapons.spread, 0)) * 180, 7, 40) + 'px';
      if (this._spread !== spread) { this._spread = spread; this.el.crosshair.style.setProperty('--spread', spread); }
      // 狙击开镜：隐藏准星与枪模（枪模由 weapons.update 收起），显示镜筒 overlay。
      var scoping = Boolean(player.scoping);
      if (this._scoping !== scoping) {
        this._scoping = scoping;
        this.el.crosshair.hidden = scoping;
        if (this.el.scope) this.el.scope.hidden = !scoping;
      }
      var reloadRemaining = Math.max(0, number(weapons.reloadRemaining, 0));
      var reloadDuration = Math.max(0, number(weapons.reloadDuration, 0));
      var reloadProgress = reloadRemaining > 0 && reloadDuration > 0 ?
        clamp(1 - reloadRemaining / reloadDuration, 0, 1) : 0;
      this.el['reload-indicator'].hidden = reloadRemaining <= 0;
      var reloadPct = (reloadProgress * 100) + '%';
      if (this._reloadPct !== reloadPct) { this._reloadPct = reloadPct; this.el['reload-progress'].style.width = reloadPct; }
      var reloadAria = String(Math.round(reloadProgress * 100));
      if (this._reloadAria !== reloadAria) { this._reloadAria = reloadAria; this.reloadBar.setAttribute('aria-valuenow', reloadAria); }
    }

    _formatTime(value) {
      var seconds = Math.max(0, Math.floor(number(value, 0)));
      return clamp(Math.floor(seconds / 60), 0, 99) + ':' + String(seconds % 60).padStart(2, '0');
    }

    _fillResult(won, game) {
      this._text('result-eyebrow', won ? 'MISSION COMPLETE' : 'SIGNAL LOST');
      this._text('result-title', won ? '防线已守住' : '信号已中断');
      var subtitle = document.createElement('span');
      subtitle.textContent = won ? 'YOU MADE IT.' : 'CONNECTION LOST.';
      this.el['result-title'].appendChild(subtitle);
      var deathWave = count(game.deathWave);
      this._text('result-description', won ?
        '信号重新接通。隔离区暂时安全了。' :
        (deathWave > 0 ? '阵亡于第 ' + deathWave + ' 波。' : '') + '防线已经失守，但任务尚未结束。重整装备，再次出发。');
      // §9 总分 = (击杀分 + 波次分) × 难度倍率 × 硬核加成；练习模式 finalScore 即原始分。
      this._text('result-score', count(number(game.finalScore, game.score)));
      // §9 最佳纪录：比较口径就是 finish 时落的 finalScore，localStorage 按模式分组。
      var bestMode = (game.waveMode && game.waveMode.key) || DZ.Settings.mode || 'giant';
      var best = DZ.best.load(bestMode);
      this._text('result-best', best ? String(count(best.score)) : '—');
      this.el['result-record'].hidden = !(game.newRecord && best);
      var total = this._totalWaves(game);
      this._text('result-wave', clamp(count(game.wave), 0, total) + ' / ' + total);
      this._text('result-kills', count(game.kills) + ' / ' + count(game.headshots));
      var kills = count(game.kills);
      var rate = kills > 0 ? Math.round(count(game.headshots) / kills * 100) : 0;
      this._text('result-headshot', rate + '%');
      this._text('result-coins', count(game.coinsUsed));
      this._text('result-time', this._formatTime(game.time));
      var giant = Boolean(game.waveMode && game.waveMode.allowCoins);
      this.el['result-coins-cell'].style.display = giant ? '' : 'none';
      this.el['result-breakdown'].hidden = !giant;
      // 队伍存活榜要在练习模式（无 squad）先隐藏，否则早退会让上一局的榜单留在面板上。
      var squad = game.squad;
      this.el['result-squad-board'].hidden = !squad;
      var list = this.el['result-squad-list'];
      list.textContent = '';
      if (!giant) return;
      var difficulty = number((game.difficultyConfig || {}).scoreMultiplier, 1);
      this.el['result-breakdown-text'].innerHTML =
        '(击杀分 <b>' + count(game.killScore) + '</b> + 波次分 <b>' + count(game.waveScoreTotal) +
        '</b>) × 难度 <b>×' + difficulty + '</b>' + (game.hardcore ? ' × 硬核 <b>×1.5</b>' : '') +
        ' = 总分 <b>' + count(number(game.finalScore, game.score)) + '</b>' +
        ' · 队友击杀 ' + count(game.squadKills) + '（按 60% 计入）';
      if (!squad) return;
      var board = squad.members.map(function (member) {
        return { name: member.def.name, time: number(member.aliveTime, 0) };
      }).sort(function (a, b) { return b.time - a.time; });
      var self = this;
      board.forEach(function (entry) {
        var li = document.createElement('li');
        var label = document.createElement('span');
        label.textContent = entry.name;
        var value = document.createElement('em');
        value.textContent = self._formatTime(entry.time);
        li.appendChild(label);
        li.appendChild(value);
        list.appendChild(li);
      });
    }

    _drawMinimap() {
      var ctx = this.context;
      var world = this.game.world;
      if (!ctx || !world) return;
      var canvas = this.el.minimap;
      var b = world.bounds || { minX: -24, maxX: 24, minZ: -24, maxZ: 24 };
      var spanX = Math.max(1, number(b.maxX - b.minX, 48));
      var spanZ = Math.max(1, number(b.maxZ - b.minZ, 48));
      var padding = 8;
      var width = canvas.width - padding * 2;
      var height = canvas.height - padding * 2;
      if (width <= 0 || height <= 0) return;
      // 长图（48×96）等比缩放后居中，横纵各留一条黑边，避免把地图拉成正方形。
      var scale = Math.min(width / spanX, height / spanZ);
      var offX = padding + (width - spanX * scale) / 2;
      var offZ = padding + (height - spanZ * scale) / 2;
      var mapX = (x) => offX + (x - b.minX) * scale;
      var mapZ = (z) => offZ + (z - b.minZ) * scale;
      var validPosition = (position) => position &&
        Number.isFinite(position.x) && Number.isFinite(position.z);

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#101c18';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      ctx.beginPath();
      ctx.rect(offX, offZ, spanX * scale, spanZ * scale);
      ctx.clip();
      ctx.strokeStyle = 'rgba(163, 190, 140, 0.12)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (var i = 1; i < 8; i++) {
        var x = offX + spanX * scale * i / 8;
        var z = offZ + spanZ * scale * i / 8;
        ctx.moveTo(x, offZ);
        ctx.lineTo(x, offZ + spanZ * scale);
        ctx.moveTo(offX, z);
        ctx.lineTo(offX + spanX * scale, z);
      }
      ctx.stroke();
      // 可行走顶面：车顶/甲板/平台用浅色块画出，读得出"这是一张有层次的图"。
      ctx.fillStyle = 'rgba(150, 172, 140, 0.2)';
      ctx.strokeStyle = 'rgba(178, 198, 156, 0.5)';
      (world.surfaces || []).forEach((s) => {
        if (![s.minX, s.maxX, s.minZ, s.maxZ].every(Number.isFinite)) return;
        var x = mapX(s.minX), z = mapZ(s.minZ);
        var w = mapX(s.maxX) - x, h = mapZ(s.maxZ) - z;
        if (w <= 0 || h <= 0) return;
        ctx.fillRect(x, z, w, h);
        ctx.strokeRect(x, z, w, h);
      });
      ctx.strokeStyle = 'rgba(163, 190, 140, 0.12)';

      ctx.fillStyle = '#3a483b';
      ctx.strokeStyle = '#627157';
      (world.obstacles || []).forEach((box) => {
        if (![box.minX, box.maxX, box.minZ, box.maxZ].every(Number.isFinite)) return;
        var x = mapX(box.minX);
        var z = mapZ(box.minZ);
        var w = mapX(box.maxX) - x;
        var h = mapZ(box.maxZ) - z;
        if (w <= 0 || h <= 0) return;
        ctx.fillRect(x, z, w, h);
        ctx.strokeRect(x, z, w, h);
      });
      ctx.strokeStyle = '#829275';
      (world.spawnPoints || []).forEach((position) => {
        if (!validPosition(position)) return;
        ctx.beginPath();
        ctx.arc(mapX(position.x), mapZ(position.z), 3.5, 0, Math.PI * 2);
        ctx.stroke();
      });
      // 当前阶段的前线复活点；归队传送窗口开启时高亮传送目标。
      var stage = window.DZ && DZ.WAVES ? DZ.WAVES.stageForWave(count(this.game.wave)) : 'A';
      ctx.strokeStyle = 'rgba(127, 214, 232, 0.8)';
      ctx.lineWidth = 1.5;
      ((world.revivePoints || {})[stage] || []).forEach((position) => {
        if (!validPosition(position)) return;
        ctx.strokeRect(mapX(position.x) - 3.5, mapZ(position.z) - 3.5, 7, 7);
      });
      ctx.lineWidth = 1;
      var player = this.game.player;
      if (player && number(player.rallyWindow, 0) > 0 && typeof this.game.rallyTarget === 'function') {
        var target = this.game.rallyTarget();
        if (validPosition(target)) {
          var tx = mapX(target.x), tz = mapZ(target.z);
          ctx.fillStyle = '#dcfa86';
          ctx.beginPath();
          ctx.moveTo(tx, tz - 5.5);
          ctx.lineTo(tx + 5.5, tz);
          ctx.lineTo(tx, tz + 5.5);
          ctx.lineTo(tx - 5.5, tz);
          ctx.closePath();
          ctx.fill();
        }
      }
      var effects = this.game.effects;
      ((effects && effects.drops) || []).forEach((drop) => {
        var position = drop.root && drop.root.position;
        if (!validPosition(position)) return;
        if (drop.weapon) {
          ctx.fillStyle = '#c18ff5';
          ctx.fillRect(mapX(position.x) - 3.5, mapZ(position.z) - 3.5, 7, 7);
          return;
        }
        ctx.fillStyle = drop.type === 'health' ? '#91e9a0' : '#eac17a';
        ctx.fillRect(mapX(position.x) - 2.5, mapZ(position.z) - 2.5, 5, 5);
      });
      // 波间补给箱：与击杀掉落同色系，稍大一圈便于区分。
      ((effects && effects.supplies) || []).forEach((supply) => {
        var position = supply.root && supply.root.position;
        if (!validPosition(position)) return;
        ctx.fillStyle = supply.kind === 'health' ? '#91e9a0' : '#eac17a';
        ctx.fillRect(mapX(position.x) - 3, mapZ(position.z) - 3, 6, 6);
      });
      ctx.fillStyle = '#ff796d';
      var enemies = this.game.enemies;
      ((enemies && enemies.list) || []).forEach((enemy) => {
        var position = enemy.root && enemy.root.position;
        if (enemy.dead || !validPosition(position)) return;
        ctx.beginPath();
        ctx.arc(mapX(position.x), mapZ(position.z), 2.5, 0, Math.PI * 2);
        ctx.fill();
      });
      // AI 队友：蓝点 + 选中环；阵亡画暗叉占位（复活中）。
      var squad = this.game.squad;
      if (squad) {
        squad.members.forEach(function (m, i) {
          var position = m.root && m.root.position;
          if (!validPosition(position)) return;
          var x = mapX(position.x), z = mapZ(position.z);
          if (m.dead) {
            ctx.strokeStyle = 'rgba(143, 208, 255, 0.35)';
            ctx.beginPath();
            ctx.moveTo(x - 2.5, z - 2.5); ctx.lineTo(x + 2.5, z + 2.5);
            ctx.moveTo(x + 2.5, z - 2.5); ctx.lineTo(x - 2.5, z + 2.5);
            ctx.stroke();
            return;
          }
          ctx.fillStyle = '#8fd0ff';
          ctx.beginPath();
          ctx.arc(x, z, 2.8, 0, Math.PI * 2);
          ctx.fill();
          if (i === squad.selected) {
            ctx.strokeStyle = '#eaf6ff';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(x, z, 5.2, 0, Math.PI * 2);
            ctx.stroke();
            ctx.lineWidth = 1;
          }
        });
      }
      // 雾散体黑雾覆盖区：该片雷达失效（§5），盖在敌点与友军之上。
      var clouds = (effects && effects.fogs) || [];
      clouds.forEach(function (cloud) {
        var alpha = Math.min(1, (cloud.maxLife - cloud.life) / 0.6, cloud.life / 1);
        if (alpha <= 0) return;
        var cx = mapX(cloud.position.x), cz = mapZ(cloud.position.z), cr = cloud.radius * scale;
        ctx.fillStyle = 'rgba(6, 10, 9, ' + (0.9 * alpha).toFixed(3) + ')';
        ctx.beginPath();
        ctx.arc(cx, cz, cr, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(150, 178, 158, 0.26)';
        ctx.beginPath();
        ctx.arc(cx, cz, cr, 0, Math.PI * 2);
        ctx.stroke();
      });
      ctx.restore();
      ctx.strokeStyle = 'rgba(180, 207, 150, 0.45)';
      ctx.lineWidth = 1;
      ctx.strokeRect(offX, offZ, spanX * scale, spanZ * scale);

      var player = this.game.player;
      if (!player || !validPosition(player.position)) return;
      ctx.save();
      ctx.translate(mapX(clamp(player.position.x, b.minX, b.maxX)),
        mapZ(clamp(player.position.z, b.minZ, b.maxZ)));
      // 雷达固定朝北；画布旋转方向与 Three.js 的 yaw 相反。
      ctx.rotate(-number(player.yaw, 0));
      ctx.beginPath();
      ctx.moveTo(0, -7);
      ctx.lineTo(5, 5);
      ctx.lineTo(0, 2);
      ctx.lineTo(-5, 5);
      ctx.closePath();
      ctx.fillStyle = '#dcfa86';
      ctx.strokeStyle = '#101c18';
      ctx.lineWidth = 1.5;
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }

  DZ.UI = UI;
}());
