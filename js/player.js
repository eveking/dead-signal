(function () {
  'use strict';
  const DZ = window.DZ = window.DZ || {};
  if (!window.THREE) return;
  const T = THREE;

  DZ.Player = class Player {
    constructor(game) {
      this.game = game;
      this.position = new T.Vector3();
      this.keys = new Set();
      this.reset();
      const controlKeys = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ShiftLeft', 'ShiftRight', 'KeyR', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'KeyP', 'KeyE', 'KeyF', 'Tab', 'KeyQ'];
      document.addEventListener('keydown', event => {
        if (game.state !== 'playing') return;
        if (controlKeys.includes(event.code)) event.preventDefault();
        this.keys.add(event.code);
        if (event.repeat) return;
        if (event.code === 'Space') this.jumpQueued = true;
        if (event.code === 'KeyR') game.weapons.reload();
        if (event.code === 'Digit1') game.weapons.switchTo(0);
        if (event.code === 'Digit2') game.weapons.switchTo(1);
        if (event.code === 'Digit3') game.weapons.switchTo(2);
        if (event.code === 'Digit4') game.weapons.switchTo(3);
        if (event.code === 'Digit5') game.weapons.switchTo(4);
        if (event.code === 'KeyP') game.pause();
        if (event.code === 'KeyE') this.tryRevive();
        if (event.code === 'KeyF') this.tryRally();
      });
      document.addEventListener('keyup', event => this.keys.delete(event.code));
      document.addEventListener('mousemove', event => {
        if (game.state !== 'playing' || document.pointerLockElement !== game.world.renderer.domElement) return;
        // 开镜灵敏度 ×0.38（约 4 倍镜的手感换算）。
        const s = this.scoping ? 0.0007 : 0.00185;
        this.yaw -= event.movementX * s;
        this.pitch = T.MathUtils.clamp(this.pitch - event.movementY * s, -1.48, 1.48);
      });
      document.addEventListener('mousedown', event => {
        if (game.state !== 'playing' || this.downed) return;
        if (document.pointerLockElement !== game.world.renderer.domElement) return;
        if (event.button === 0) { this.shooting = true; this.fireQueued = true; }
        // 狙击右键按住开镜：由武器定义的 scopes 决定哪把枪能开镜，装填中不允许。
        if (event.button === 2 && game.weapons.canScope) this.scoping = true;
      });
      document.addEventListener('mouseup', event => {
        if (event.button === 0) this.shooting = false;
        if (event.button === 2) this.scoping = false;
      });
      game.world.renderer.domElement.addEventListener('contextmenu', event => event.preventDefault());
    }

    reset() {
      const start = this.game.world.playerStart || new T.Vector3(0, 0, 14);
      this.position.copy(start);
      this.game.world.settleY(this.position);
      this.health = 100;
      this.yaw = 0;
      this.pitch = 0;
      this.kick = 0;
      this.velocityY = 0;
      this.grounded = true;
      this.moving = false;
      this.sprinting = false;
      this.stride = 0;
      this.invulnerable = 0;
      this.stagger = 0;
      this.downed = false;
      this.downedRemaining = 0;
      this.rallyWindow = 0;
      this.scoping = false;
      this.clearInput();
    }

    clearInput() {
      this.keys.clear();
      this.shooting = false;
      this.fireQueued = false;
      this.jumpQueued = false;
    }

    update(dt) {
      this.invulnerable = Math.max(0, this.invulnerable - dt);
      if (this.downed) { this.updateDowned(dt); return; }
      this.stagger = Math.max(0, this.stagger - dt);
      this.rallyWindow = Math.max(0, this.rallyWindow - dt);
      this.kick *= Math.exp(-9 * dt);
      let x = Number(this.keys.has('KeyD')) - Number(this.keys.has('KeyA'));
      let z = Number(this.keys.has('KeyS')) - Number(this.keys.has('KeyW'));
      // 硬直（裂魂者击退 / BOSS 震波）：0.5 秒内失去移动与跳跃，仍可转视角。
      if (this.stagger > 0) { x = 0; z = 0; this.jumpQueued = false; }
      this.moving = x !== 0 || z !== 0;
      this.sprinting = this.moving && (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')) && !this.shooting && !this.scoping;
      // M5 加特林减益（§8）：持枪期间走/跑同乘 ×0.6，禁止跳跃；切回步枪即解除。
      // 武器五槽改造：持刀 +15% 移速（speedMul 由武器定义给出）；狙击开镜 ×0.55 且禁跑/禁跳。
      const heavy = this.game.weapons.heavy;
      const speed = (this.sprinting ? 7.3 : 4.5) * (heavy ? 0.6 : 1) *
        this.game.weapons.speedMul * (this.scoping ? 0.55 : 1);
      const length = Math.hypot(x, z) || 1;
      x = x / length * speed * dt;
      z = z / length * speed * dt;
      const cos = Math.cos(this.yaw), sin = Math.sin(this.yaw);
      this.game.world.move(this.position, x * cos + z * sin, -x * sin + z * cos, 0.38);
      // 脚底支撑面：平地/中央平台/车顶/斜坡都用同一个高度，落地判定不再写死 y=0。
      const floor = this.game.world.floorAt(this.position.x, this.position.z, this.position.y);
      if (this.jumpQueued && this.grounded && !heavy && !this.scoping) {
        this.velocityY = 6.2;
        this.grounded = false;
      }
      this.jumpQueued = false;
      // 走下台沿（车顶、甲板、平台）时转入自由落体，避免瞬间贴地。
      if (this.grounded && this.position.y > floor + 0.02) this.grounded = false;
      this.velocityY -= 17 * dt;
      this.position.y += this.velocityY * dt;
      if (this.position.y <= floor) {
        this.position.y = floor;
        this.velocityY = 0;
        this.grounded = true;
      }
      this.stride += dt * (this.moving && this.grounded ? speed * 2.5 : 2);
      this.syncCamera(dt);
    }

    syncCamera(dt = 0) {
      const camera = this.game.world.camera;
      const bob = this.moving && this.grounded ? Math.sin(this.stride) * 0.025 : 0;
      camera.position.copy(this.position);
      camera.position.y += (this.downed ? 0.52 : 1.68) + bob;
      camera.rotation.set(T.MathUtils.clamp(this.pitch + this.kick, -1.5, 1.5), this.yaw, this.downed ? 0.28 : 0, 'YXZ');
      camera.fov = dt ? T.MathUtils.lerp(camera.fov, this.scoping ? 16 : this.sprinting ? 81 : 75, 1 - Math.exp(-8 * dt)) : 75;
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld(true);
    }

    recoil(amount) { this.kick = Math.min(0.15, this.kick + amount); }

    damage(amount) {
      const game = this.game;
      if (game.state !== 'playing' || this.invulnerable > 0 || this.downed) return;
      // 短暂无敌窗避免同一帧被重叠的怪物瞬间击杀。
      this.invulnerable = 0.45;
      this.health = Math.max(0, this.health - amount);
      game.audio.hurt();
      game.ui.hurt();
      if (this.health === 0) this.goDowned();
    }

    heal(amount) { this.health = Math.min(100, this.health + amount); }

    // 击退（裂魂者命中 4m / BOSS 冲刺 3m / 巨型泰坦震波 2m）：贴墙滑行 + 硬直，无敌期间免疫。
    knockback(dx, dz, distance, stagger = 0) {
      const game = this.game;
      if (game.state !== 'playing' || this.downed || this.invulnerable > 0) return;
      DZ.knockPosition(game.world, this.position, dx, dz, distance, 0.38);
      // 被推出台沿时保留高度自由落体（打进车顶下方同理），仍站在同层或更高顶面才贴地。
      const floor = game.world.floorAt(this.position.x, this.position.z, this.position.y);
      this.velocityY = 0;
      if (this.position.y > floor + 0.02) {
        this.grounded = false;
      } else {
        this.position.y = floor;
        this.grounded = true;
      }
      this.stagger = Math.max(this.stagger, stagger);
      this.recoil(0.05);
      this.syncCamera();
    }

    get reviveConfig() { return this.game.waveMode.revive; }

    // 倒地：有币则进入濒死读条（时长取 revive.castTime）；无币（含硬核 0 币开局）或不启用复活币的模式直接失败。
    goDowned() {
      const game = this.game;
      const config = this.reviveConfig;
      if (!config || !game.allowRevive) { game.finish(false); return; }
      if (game.coins <= 0) { game.finish(false); return; }
      this.downed = true;
      this.scoping = false;
      this.downedRemaining = config.castTime;
      this.rallyWindow = 0;
      this.clearInput();
      this.velocityY = 0;
      game.weapons.dropSpecial();
      game.weapons.view.visible = false;
      game.audio.downed();
      game.ui.showDowned(true);
    }

    updateDowned(dt) {
      this.clearInput();
      this.moving = this.sprinting = false;
      this.downedRemaining = Math.max(0, this.downedRemaining - dt);
      if (this.downedRemaining === 0) { this.game.finish(false); return; }
      this.syncCamera(dt);
    }

    // 当前阶段的前线复活点里选离活敌最远的一个，避免重生即被贴脸。
    reviveSpot() {
      const world = this.game.world;
      const stage = DZ.WAVES.stageForWave(this.game.wave);
      const points = world.revivePoints[stage] || world.revivePoints.A;
      const enemies = this.game.enemies.list.filter(e => !e.dead);
      let best = points[0], bestClear = -1;
      for (const point of points) {
        let nearest = Infinity;
        for (const e of enemies) nearest = Math.min(nearest, e.root.position.distanceTo(point));
        if (nearest > bestClear) { bestClear = nearest; best = point; }
      }
      return best;
    }

    land(position) {
      const world = this.game.world;
      // 落点高度跟着来源走：投奔车顶队友时要在 3.2m 顶面找站位，而不是掉到车厢底下。
      this.position.set(position.x, Number.isFinite(position.y) ? position.y : 0, position.z);
      for (let i = 0; i < 10; i++) {
        if (world.canStand(this.position.x, this.position.z, 0.42, this.position.y)) break;
        this.position.x += (Math.random() - 0.5) * 2;
        this.position.z += (Math.random() - 0.5) * 2;
      }
      world.settleY(this.position);
      this.velocityY = 0;
      this.grounded = true;
      this.syncCamera();
    }

    tryRevive() {
      const game = this.game;
      if (!this.downed || game.coins <= 0) return;
      game.coins--;
      game.coinsUsed++;
      // 本波耗币标记：波次结算时该波失去"无复活 +100"（§9）。
      game.waveCoins++;
      const config = this.reviveConfig;
      this.downed = false;
      this.downedRemaining = 0;
      this.health = config.health;
      this.invulnerable = config.guard;
      this.rallyWindow = config.rallyWindow;
      this.land(this.reviveSpot());
      game.weapons.view.visible = true;
      game.audio.revive();
      game.ui.showDowned(false);
      game.ui.toast(`已消耗 1 枚复活币 · 剩余 ${game.coins} 枚 · 无敌 ${config.guard} 秒 · 按 F 归队`, 3.4);
    }

    // F 归队传送：窗口内不限次数，每次落地重置 20 秒并重新获得无敌。
    tryRally() {
      const game = this.game;
      if (game.state !== 'playing' || this.downed) return;
      if (!this.reviveConfig || !game.allowRevive) return;
      if (this.rallyWindow <= 0) { game.ui.toast('归队传送未开启 · 需在复活点重生后的 20 秒内', 2.4); return; }
      const target = game.rallyTarget();
      if (!target) { game.ui.toast('没有可投奔的队友', 2); return; }
      const config = this.reviveConfig;
      this.land(target);
      this.rallyWindow = config.rallyWindow;
      this.invulnerable = config.guard;
      game.audio.teleport();
      game.ui.toast('已传送归队 · 落地无敌 ' + config.guard + ' 秒', 2);
    }
  };
})();
