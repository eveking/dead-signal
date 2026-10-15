(function () {
  'use strict';
  const DZ = window.DZ = window.DZ || {};
  if (!window.THREE) return;
  const T = THREE;

  // M5 特殊武器（§8）：拾取替换手枪槽，耗尽/放弃后换回拾取时快照的手枪。
  const SPECIALS = {
    rocket: { type: 'rocket', model: 'rocket', name: 'R-80 火箭筒', damage: 450, capacity: 1, ammo: 1, reserve: 3, interval: 0.3, reloadTime: 3.2, recoil: 0.05, accuracy: 0.002, automatic: false, explosive: { radius: 2.5, damage: 450 } },
    gatling: { type: 'gatling', model: 'gatling', name: 'M-56 加特林', damage: 43, capacity: 9999, ammo: 9999, reserve: 0, interval: 0.105, reloadTime: 1.25, recoil: 0.02, accuracy: 0.006, automatic: true, sustained: 30 }
  };

  DZ.Weapons = class Weapons {
    constructor(game) {
      this.game = game;
      this.ray = new T.Raycaster();
      this.ray.far = 95;
      this.aim = new T.Vector2();
      this.muzzlePosition = new T.Vector3();
      this.view = new T.Group();
      game.world.camera.add(this.view);
      this.models = {
        rifle: this.buildModel('rifle'),
        pistol: this.buildModel('pistol'),
        rocket: this.buildModel('rocket'),
        gatling: this.buildModel('gatling')
      };
      for (const model of Object.values(this.models)) this.view.add(model);
      this.reset();
      this.view.visible = false;
    }

    get current() { return this.items[this.index]; }
    get currentModel() { return this.models[this.current.model]; }
    // 加特林持枪减益（移速 -40%、禁跳）由 player.js 读取这一个口。
    get heavy() { return this.current.type === 'gatling'; }

    reset() {
      this.items = [
        { type: 'rifle', model: 'rifle', name: 'AR-7 突击步枪', damage: 27, capacity: 30, ammo: 30, reserve: 180, interval: 0.105, reloadTime: 1.9, recoil: 0.014, accuracy: 0.004, automatic: true },
        { type: 'pistol', model: 'pistol', name: 'P-12 战术手枪', damage: 44, capacity: 12, ammo: 12, reserve: 72, interval: 0.28, reloadTime: 1.25, recoil: 0.03, accuracy: 0.002, automatic: false }
      ];
      this.special = null;
      this.specialTimer = 0;
      this.index = 0;
      this.cooldown = 0;
      this.reloadRemaining = 0;
      this.reloadDuration = 0;
      this.spread = 0;
      this.visualKick = 0;
      this.flashRemaining = 0;
      this.switchRemaining = 0;
      this.applyVisibility();
    }

    buildModel(kind) {
      const root = new T.Group();
      const box = new T.BoxGeometry(1, 1, 1);
      const material = (color, metalness = 0.5) => new T.MeshStandardMaterial({ color, metalness, roughness: 0.45, depthTest: false, depthWrite: false });
      const dark = material(0x202a27), steel = material(0x53615a, 0.75), grip = material(0x30362c, 0.15);
      const tan = material(0x72795b, 0.15), glove = material(0x393d2e, 0.05);
      const marker = new T.MeshBasicMaterial({ color: 0xcbe994, depthTest: false, depthWrite: false });
      const part = (x, y, z, w, h, d, mat, rotation = 0) => {
        const mesh = new T.Mesh(box, mat);
        mesh.position.set(x, y, z); mesh.scale.set(w, h, d); mesh.rotation.x = rotation;
        mesh.renderOrder = 1000;
        mesh.frustumCulled = false;
        root.add(mesh); return mesh;
      };
      if (kind === 'pistol') {
        part(0, 0.015, -0.27, 0.095, 0.085, 0.36, steel);
        part(0, -0.04, -0.22, 0.09, 0.055, 0.25, dark);
        part(0, -0.15, -0.13, 0.085, 0.22, 0.11, grip, -0.2);
        part(0, -0.095, -0.23, 0.07, 0.018, 0.1, dark);
        part(0, -0.063, -0.279, 0.065, 0.07, 0.018, dark);
        part(0, 0.069, -0.413, 0.018, 0.027, 0.027, marker);
        part(0, 0.069, -0.12, 0.055, 0.025, 0.025, dark);
        for (let i = 0; i < 5; i++) part(0.049, 0.023, -0.11 - i * 0.018, 0.005, 0.05, 0.006, dark);
        part(0.018, -0.13, -0.1, 0.115, 0.09, 0.16, glove, -0.12);
        part(0.05, -0.28, 0.03, 0.13, 0.27, 0.2, tan, -0.4);
      } else if (kind === 'rifle') {
        part(0, 0, -0.33, 0.13, 0.13, 0.42, dark);
        part(0, 0.008, -0.65, 0.105, 0.11, 0.31, tan);
        part(0, -0.11, -0.35, 0.085, 0.22, 0.12, steel, 0.12);
        part(0, -0.105, -0.14, 0.09, 0.21, 0.1, grip, -0.25);
        part(0, 0, 0.02, 0.105, 0.09, 0.24, dark);
        part(0, -0.025, 0.15, 0.13, 0.19, 0.08, tan);
        part(0.075, 0, -0.24, 0.025, 0.046, 0.09, steel);
        part(0, 0.089, -0.39, 0.09, 0.023, 0.57, steel);
        for (let i = 0; i < 11; i++) part(0, 0.107, -0.14 - i * 0.045, 0.095, 0.018, 0.012, dark);
        for (let i = 0; i < 5; i++) part(0.055, 0.014, -0.53 - i * 0.045, 0.012, 0.055, 0.021, dark);
        part(0, 0.12, -0.66, 0.06, 0.12, 0.038, dark);
        part(0, 0.182, -0.66, 0.014, 0.021, 0.018, marker);
        part(0, 0.15, -0.2, 0.085, 0.1, 0.075, dark);
        part(0, 0.206, -0.22, 0.034, 0.014, 0.014, marker);
        part(0, 0.014, -0.88, 0.039, 0.041, 0.25, steel);
        part(0, 0.014, -1.013, 0.063, 0.06, 0.065, dark);
        part(-0.07, -0.08, -0.64, 0.15, 0.12, 0.18, glove, -0.1);
        part(-0.14, -0.19, -0.43, 0.15, 0.14, 0.39, tan, 0.3);
        part(0.025, -0.12, -0.13, 0.13, 0.085, 0.16, glove, -0.1);
        part(0.06, -0.25, 0.02, 0.14, 0.21, 0.23, tan, -0.5);
      } else if (kind === 'rocket') {
        // R-80：粗发射管 + 战斗部 + 瞄准具，炮口在弹头前。
        part(0, 0.02, -0.55, 0.115, 0.115, 0.8, dark);
        part(0, 0.02, -0.12, 0.15, 0.15, 0.14, steel);
        part(0, 0.02, -0.99, 0.075, 0.075, 0.2, tan);
        part(0, 0.02, -1.11, 0.045, 0.045, 0.06, marker);
        part(0, 0.105, -0.34, 0.03, 0.07, 0.05, steel);
        part(0, 0.1, -0.72, 0.026, 0.06, 0.09, dark);
        part(0, -0.115, -0.32, 0.07, 0.2, 0.1, grip, -0.22);
        part(0, -0.09, -0.62, 0.07, 0.14, 0.1, grip, -0.22);
        part(-0.075, 0.06, -0.5, 0.12, 0.08, 0.3, glove, -0.05);
        part(0.03, -0.16, -0.12, 0.14, 0.1, 0.2, tan, -0.55);
      } else {
        // M-56：六管旋置弹鼓 + 供弹箱，护木前伸。
        part(0, 0.03, -0.42, 0.19, 0.19, 0.46, dark);
        part(0, 0.03, -0.66, 0.155, 0.155, 0.16, steel);
        const spin = new T.Group();
        spin.position.set(0, 0.03, -0.85);
        for (let i = 0; i < 6; i++) {
          const angle = i * Math.PI / 3;
          const barrel = new T.Mesh(box, dark);
          barrel.scale.set(0.028, 0.028, 0.46);
          barrel.position.set(Math.cos(angle) * 0.062, Math.sin(angle) * 0.062, 0);
          barrel.renderOrder = 1000;
          spin.add(barrel);
        }
        root.add(spin);
        root.userData.spin = spin;
        part(0, -0.12, -0.36, 0.08, 0.2, 0.11, grip, -0.2);
        part(0, 0.06, -0.24, 0.14, 0.12, 0.1, tan);
        part(0.1, -0.05, -0.5, 0.1, 0.14, 0.26, tan, 0.1);
        part(-0.1, -0.02, -0.74, 0.12, 0.1, 0.2, glove, 0.05);
        part(0.02, -0.2, -0.1, 0.15, 0.22, 0.24, tan, -0.5);
      }
      const muzzle = new T.Group();
      const muzzleOffset = kind === 'pistol' ? [0, 0.015, -0.47] :
        kind === 'rocket' ? [0, 0.02, -1.16] : kind === 'gatling' ? [0, 0.03, -1.1] : [0, 0.014, -1.07];
      muzzle.position.set(muzzleOffset[0], muzzleOffset[1], muzzleOffset[2]);
      const flashMaterial = new T.MeshBasicMaterial({ color: 0xffe9a4, transparent: true, opacity: 0.92, blending: T.AdditiveBlending, depthTest: false, depthWrite: false });
      const core = new T.Mesh(new T.OctahedronGeometry(0.095), flashMaterial);
      core.scale.set(0.65, 0.65, 2.1); core.renderOrder = 1002;
      muzzle.add(core);
      for (let i = 0; i < 3; i++) {
        const spike = new T.Mesh(new T.PlaneGeometry(0.27, 0.043), new T.MeshBasicMaterial({ color: 0xffc368, transparent: true, opacity: 0.7, side: T.DoubleSide, blending: T.AdditiveBlending, depthTest: false, depthWrite: false }));
        spike.rotation.z = i * Math.PI / 3;
        spike.renderOrder = 1002; muzzle.add(spike);
      }
      root.add(muzzle); root.userData.muzzle = muzzle; muzzle.visible = false;
      root.renderOrder = 1000;
      return root;
    }

    applyVisibility() {
      const active = this.current ? this.current.model : 'rifle';
      for (const [key, model] of Object.entries(this.models)) {
        model.visible = key === active;
        model.userData.muzzle.visible = false;
      }
    }

    switchTo(index) {
      if (index === this.index || this.game.state !== 'playing') return;
      this.index = index;
      // 换枪取消装填，只有装填真正结束时才从备用弹药扣除。
      this.reloadRemaining = 0;
      this.reloadDuration = 0;
      this.flashRemaining = 0;
      this.switchRemaining = 0.22;
      this.cooldown = Math.max(this.cooldown, 0.22);
      this.game.player.fireQueued = false;
      this.applyVisibility();
    }

    // M5 拾取：替换手枪槽并快照当前手枪（耗尽/换回时弹药原样带回）；持枪中再拾新箱直接替换。
    grantSpecial(kind) {
      const def = SPECIALS[kind];
      if (!def) return false;
      if (!this.special) this.special = { kind, pistol: Object.assign({}, this.items[1]) };
      else this.special.kind = kind;
      this.items[1] = Object.assign({}, def);
      this.specialTimer = def.sustained || 0;
      this.index = 1;
      this.reloadRemaining = 0;
      this.reloadDuration = 0;
      this.flashRemaining = 0;
      this.switchRemaining = 0.22;
      this.cooldown = Math.max(this.cooldown, 0.22);
      this.game.player.fireQueued = false;
      this.applyVisibility();
      this.game.ui.toast(kind === 'rocket' ?
        '获得 R-80 火箭筒 · 替换手枪槽（4 发 · 装填 3.2 秒）' :
        '获得 M-56 加特林 · 30 秒持续弹 · 移速 -40% · 无法跳跃', 3);
      return true;
    }

    stowSpecial(message) {
      if (!this.special) return;
      this.items[1] = this.special.pistol;
      this.special = null;
      this.specialTimer = 0;
      this.reloadRemaining = 0;
      this.reloadDuration = 0;
      if (this.index === 1) {
        this.switchRemaining = 0.22;
        this.game.player.fireQueued = false;
        this.applyVisibility();
      }
      if (message) this.game.ui.toast(message, 2.5);
    }

    // 倒地掉落（§8）：当前特殊武器掉在倒地位置可重捡，波次结束未捡则消失。
    dropSpecial() {
      if (!this.special) return false;
      const kind = this.special.kind;
      const position = this.game.player.position.clone();
      this.stowSpecial();
      this.game.effects.drop(position, kind, { waveEnd: true });
      this.game.ui.toast('特殊武器掉落在地 · 拾取可重新装备', 2.5);
      return true;
    }

    reload() {
      const gun = this.current;
      if (this.reloadRemaining > 0 || gun.ammo === gun.capacity || this.game.state !== 'playing') return;
      if (gun.reserve === 0) {
        if (gun.type === 'rocket') this.stowSpecial('R-80 弹药耗尽 · 换回 P-12');
        else this.game.ui.toast('备用弹药不足 · 切换武器或寻找补给');
        return;
      }
      this.reloadRemaining = this.reloadDuration = gun.reloadTime;
      this.flashRemaining = 0;
      this.game.audio.reload();
    }

    addAmmo(rifle, pistol) {
      this.items[0].reserve = Math.min(420, this.items[0].reserve + rifle);
      // 持特殊武器时手枪槽被占用：补给记到快照上，换回手枪后到账。
      const pistolSlot = this.special ? this.special.pistol : this.items[1];
      pistolSlot.reserve = Math.min(180, pistolSlot.reserve + pistol);
    }

    shoot() {
      const gun = this.current;
      if (this.game.state !== 'playing' || this.reloadRemaining > 0 || this.cooldown > 0) return false;
      if (gun.ammo === 0) { this.reload(); return false; }
      gun.ammo--;
      this.cooldown = gun.interval;
      this.flashRemaining = 0.045;
      this.visualKick = 1;
      const movingSpread = this.game.player.moving ? 0.009 : 0;
      const spread = gun.accuracy + movingSpread + this.spread * 0.12;
      const angle = Math.random() * Math.PI * 2, radius = Math.sqrt(Math.random()) * spread;
      this.aim.set(Math.cos(angle) * radius, Math.sin(angle) * radius);
      const camera = this.game.world.camera;
      camera.updateMatrixWorld(true);
      this.ray.setFromCamera(this.aim, camera);
      // 将掩体和怪物一起取最近交点，不能先测怪物，否则子弹会穿墙。
      this.game.world.scene.updateMatrixWorld(true);
      const targets = this.game.world.blockers.concat(this.game.enemies.hitTargets());
      const hit = this.ray.intersectObjects(targets, false)[0];
      const endpoint = hit ? hit.point : this.ray.ray.at(85, new T.Vector3());
      const muzzle = this.currentModel.userData.muzzle;
      muzzle.getWorldPosition(this.muzzlePosition);
      this.game.effects.tracer(this.muzzlePosition, endpoint);
      this.game.effects.casing(camera);
      if (gun.type === 'rocket') {
        // R-80：直射命中点（或 45m 射线终点）立即起爆，2.5m 半径 450 只算敌人。
        // 命中机体时爆点落到该敌人脚下：泰坦体型躯干高出同层阈值 2.2m，用命中点会把被打中的目标自己筛掉。
        const body = hit && hit.object.userData.enemy;
        const point = body ? body.root.position.clone() : hit ? hit.point : this.ray.ray.at(45, new T.Vector3());
        this.game.enemies.explode(point, gun.explosive.radius, gun.explosive.damage);
      } else if (hit && hit.object.userData.enemy) {
        const headshot = Boolean(hit.object.userData.headshot);
        this.game.enemies.damage(hit.object.userData.enemy, gun.damage * (headshot ? 2 : 1), hit.point, this.ray.ray.direction, headshot, 0, gun.type);
      } else if (hit) this.game.effects.burst(hit.point, 'spark', 7);
      this.spread = Math.min(0.14, this.spread + (gun.type === 'rifle' || gun.type === 'gatling' ? 0.018 : 0.032));
      this.game.player.recoil(gun.recoil);
      this.game.audio.shot(gun.type);
      return true;
    }

    update(dt) {
      this.cooldown = Math.max(0, this.cooldown - dt);
      this.flashRemaining = Math.max(0, this.flashRemaining - dt);
      this.switchRemaining = Math.max(0, this.switchRemaining - dt);
      this.visualKick *= Math.exp(-18 * dt);
      this.spread *= Math.exp(-5 * dt);
      if (this.reloadRemaining > 0) {
        this.reloadRemaining = Math.max(0, this.reloadRemaining - dt);
        if (this.reloadRemaining === 0) {
          const amount = Math.min(this.current.capacity - this.current.ammo, this.current.reserve);
          this.current.ammo += amount;
          this.current.reserve -= amount;
        }
      }
      const player = this.game.player;
      // M-56 持续弹只按持枪时间走表：切回步枪不计加特林消耗。
      if (this.special && this.current.type === 'gatling' && this.game.state === 'playing') {
        this.specialTimer -= dt;
        if (this.specialTimer <= 0) { this.stowSpecial('M-56 弹链打空 · 换回 P-12'); }
      }
      if (player.fireQueued || (player.shooting && this.current.automatic)) this.shoot();
      player.fireQueued = false;
      if (this.current.ammo === 0 && this.current.reserve > 0 && this.reloadRemaining === 0 && this.cooldown === 0) this.reload();
      // 火箭筒弹鼓与备弹全空（装填也无法继续）时自动换回手枪。
      if (this.special && this.current.type === 'rocket' && this.current.ammo === 0 &&
          this.current.reserve === 0 && this.reloadRemaining === 0) {
        this.stowSpecial('R-80 弹药耗尽 · 换回 P-12');
      }
      const bob = player.moving && player.grounded ? Math.sin(player.stride) * 0.013 : Math.sin(this.game.time * 1.8) * 0.003;
      const reload = this.reloadRemaining > 0 ? Math.sin((1 - this.reloadRemaining / this.reloadDuration) * Math.PI) : 0;
      const viewX = this.current.model === 'rifle' ? 0.26 : this.current.model === 'pistol' ? 0.22 :
        this.current.model === 'rocket' ? 0.19 : 0.15;
      this.view.position.set(viewX, -0.27 + bob - reload * 0.2 - this.switchRemaining * 0.55, -0.4 + this.visualKick * 0.055);
      this.view.rotation.set(this.visualKick * 0.065 - reload * 0.35, -0.025, -reload * 0.35 - (player.sprinting ? 0.13 : 0));
      const gunModel = this.currentModel;
      gunModel.userData.muzzle.visible = this.flashRemaining > 0;
      gunModel.userData.muzzle.rotation.z = this.game.time * 43;
      // 加特林枪管：开火时高速旋转，平时慢转。
      const spin = gunModel.userData.spin;
      if (spin) spin.rotation.z += dt * (player.shooting && this.current.automatic && this.cooldown <= 0 ? 26 : 3);
      this.view.updateMatrixWorld(true);
    }
  };
})();
