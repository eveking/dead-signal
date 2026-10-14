(function () {
  'use strict';
  const DZ = window.DZ = window.DZ || {};
  if (!window.THREE) return;
  const T = THREE;

  DZ.Weapons = class Weapons {
    constructor(game) {
      this.game = game;
      this.ray = new T.Raycaster();
      this.ray.far = 95;
      this.aim = new T.Vector2();
      this.muzzlePosition = new T.Vector3();
      this.view = new T.Group();
      game.world.camera.add(this.view);
      this.models = [this.buildModel(false), this.buildModel(true)];
      for (const model of this.models) this.view.add(model);
      this.reset();
      this.view.visible = false;
    }

    get current() { return this.items[this.index]; }

    reset() {
      this.items = [
        { type: 'rifle', name: 'AR-7 突击步枪', damage: 27, capacity: 30, ammo: 30, reserve: 180, interval: 0.105, reloadTime: 1.9, recoil: 0.014, accuracy: 0.004, automatic: true },
        { type: 'pistol', name: 'P-12 战术手枪', damage: 44, capacity: 12, ammo: 12, reserve: 72, interval: 0.28, reloadTime: 1.25, recoil: 0.03, accuracy: 0.002, automatic: false }
      ];
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

    buildModel(pistol) {
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
      if (pistol) {
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
      } else {
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
      }
      const muzzle = new T.Group();
      muzzle.position.set(0, pistol ? 0.015 : 0.014, pistol ? -0.47 : -1.07);
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
      this.models.forEach((model, index) => {
        model.visible = index === this.index;
        model.userData.muzzle.visible = false;
      });
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

    reload() {
      const gun = this.current;
      if (this.reloadRemaining > 0 || gun.ammo === gun.capacity || this.game.state !== 'playing') return;
      if (gun.reserve === 0) { this.game.ui.toast('备用弹药不足 · 切换武器或寻找补给'); return; }
      this.reloadRemaining = this.reloadDuration = gun.reloadTime;
      this.flashRemaining = 0;
      this.game.audio.reload();
    }

    addAmmo(rifle, pistol) {
      this.items[0].reserve = Math.min(420, this.items[0].reserve + rifle);
      this.items[1].reserve = Math.min(180, this.items[1].reserve + pistol);
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
      const muzzle = this.models[this.index].userData.muzzle;
      muzzle.getWorldPosition(this.muzzlePosition);
      this.game.effects.tracer(this.muzzlePosition, endpoint);
      this.game.effects.casing(camera);
      if (hit && hit.object.userData.enemy) {
        const headshot = Boolean(hit.object.userData.headshot);
        this.game.enemies.damage(hit.object.userData.enemy, gun.damage * (headshot ? 2 : 1), hit.point, this.ray.ray.direction, headshot, 0, gun.type);
      } else if (hit) this.game.effects.burst(hit.point, 'spark', 7);
      this.spread = Math.min(0.14, this.spread + (gun.type === 'rifle' ? 0.018 : 0.032));
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
      if (player.fireQueued || (player.shooting && this.current.automatic)) this.shoot();
      player.fireQueued = false;
      if (this.current.ammo === 0 && this.current.reserve > 0 && this.reloadRemaining === 0 && this.cooldown === 0) this.reload();
      const bob = player.moving && player.grounded ? Math.sin(player.stride) * 0.013 : Math.sin(this.game.time * 1.8) * 0.003;
      const reload = this.reloadRemaining > 0 ? Math.sin((1 - this.reloadRemaining / this.reloadDuration) * Math.PI) : 0;
      this.view.position.set(this.index === 0 ? 0.26 : 0.22, -0.27 + bob - reload * 0.2 - this.switchRemaining * 0.55, -0.4 + this.visualKick * 0.055);
      this.view.rotation.set(this.visualKick * 0.065 - reload * 0.35, -0.025, -reload * 0.35 - (player.sprinting ? 0.13 : 0));
      this.models[this.index].userData.muzzle.visible = this.flashRemaining > 0;
      this.models[this.index].userData.muzzle.rotation.z = this.game.time * 43;
      this.view.updateMatrixWorld(true);
    }
  };
})();
