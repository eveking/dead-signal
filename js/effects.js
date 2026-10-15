(function () {
  'use strict';
  const DZ = window.DZ = window.DZ || {};
  if (!window.THREE) return;
  const T = THREE;

  DZ.Effects = class Effects {
    constructor(game) {
      this.game = game;
      this.drops = [];
      this.time = 0;
      this.particles = Array.from({ length: 180 }, () => ({ p: new T.Vector3(), v: new T.Vector3(), life: 0, maxLife: 1, size: 0.03, gravity: 8 }));
      this.cursor = 0;
      this.dummy = new T.Object3D();
      this.mesh = new T.InstancedMesh(new T.BoxGeometry(1, 1, 1), new T.MeshBasicMaterial(), this.particles.length);
      this.mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
      this.mesh.frustumCulled = false;
      for (let i = 0; i < this.particles.length; i++) {
        this.dummy.scale.setScalar(0); this.dummy.updateMatrix();
        this.mesh.setMatrixAt(i, this.dummy.matrix);
        this.mesh.setColorAt(i, new T.Color(0xe3b471));
      }
      game.world.scene.add(this.mesh);
      this.traces = Array.from({ length: 14 }, () => {
        const geometry = new T.BufferGeometry();
        geometry.setAttribute('position', new T.BufferAttribute(new Float32Array(6), 3));
        const line = new T.Line(geometry, new T.LineBasicMaterial({ color: 0xffe3a4, transparent: true, opacity: 0.7, depthWrite: false }));
        line.visible = false; line.frustumCulled = false;
        game.world.scene.add(line);
        return { line, life: 0 };
      });
      this.traceCursor = 0;
      this.dropBox = new T.BoxGeometry(0.57, 0.4, 0.4);
      this.symbolBox = new T.BoxGeometry(1, 1, 1);
      this.dropRing = new T.TorusGeometry(0.52, 0.016, 4, 28);
      this.dropMaterials = {
        health: new T.MeshStandardMaterial({ color: 0x568a64, emissive: 0x214c32, roughness: 0.65 }),
        ammo: new T.MeshStandardMaterial({ color: 0xa68646, emissive: 0x443719, roughness: 0.65 })
      };
      this.symbolMaterial = new T.MeshBasicMaterial({ color: 0xdafa98 });
      // M5 补给与特殊武器：补给箱独立于击杀掉落（同屏上限 8，寿命显示到波末/倒数秒）。
      this.supplies = [];
      this.supplyLimit = 8;
      this.supplyBox = new T.BoxGeometry(0.66, 0.46, 0.46);
      this.supplyRing = new T.TorusGeometry(0.6, 0.02, 4, 28);
      this.supplyMaterials = {
        health: new T.MeshStandardMaterial({ color: 0x4c7f5c, emissive: 0x2f7a45, roughness: 0.6 }),
        ammo: new T.MeshStandardMaterial({ color: 0x9c7c3c, emissive: 0x8a6a20, roughness: 0.6 })
      };
      this.weaponMaterial = new T.MeshStandardMaterial({ color: 0x46586e, emissive: 0x24344e, roughness: 0.55, metalness: 0.4 });
      // M3 雾散体黑雾：半透明体积团，规则先行（fogDensity 供视野/小地图/队友命中判定）。
      this.fogs = [];
      this.fogLimit = 12;
      this.fogShell = new T.IcosahedronGeometry(1, 2);
      this.fogDisc = new T.CircleGeometry(1, 28);
      this.blows = [];
      this.blowRing = new T.RingGeometry(0.86, 1, 32);
      this.warns = [];
    }

    // 只有巨人城模式在箱体上浮字显示剩余寿命；练习模式外观零变化（菜单换模式后 waveMode 会变，取实时值）。
    get labelMode() { return Boolean(this.game.waveMode && this.game.waveMode.supplies); }

    // 寿命浮字：96×40 canvas 贴到 Sprite 上，文本没变不重绘，每秒最多刷新一次。
    makeLabel() {
      const canvas = document.createElement('canvas');
      canvas.width = 96; canvas.height = 40;
      const texture = new T.CanvasTexture(canvas);
      const sprite = new T.Sprite(new T.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
      sprite.scale.set(0.62, 0.26, 1);
      sprite.position.y = 0.86;
      sprite.renderOrder = 900;
      return { canvas, ctx: canvas.getContext('2d'), texture, sprite, text: null };
    }

    setLabel(label, text) {
      if (!label || label.text === text) return;
      label.text = text;
      const ctx = label.ctx;
      ctx.clearRect(0, 0, 96, 40);
      ctx.font = 'bold 26px Consolas, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(8, 14, 11, 0.72)';
      ctx.fillRect(0, 0, 96, 40);
      ctx.strokeStyle = 'rgba(219, 250, 134, 0.5)';
      ctx.lineWidth = 2;
      ctx.strokeRect(1, 1, 94, 38);
      ctx.fillStyle = '#dcfa86';
      ctx.fillText(text, 48, 21);
      label.texture.needsUpdate = true;
    }

    removeLabel(label) {
      if (!label) return;
      label.sprite.material.dispose();
      label.texture.dispose();
    }

    fog(position, radius, life) {
      if (this.fogs.length >= this.fogLimit) this.removeFog(0);
      const root = new T.Group();
      const base = this.game.world.floorAt(position.x, position.z, position.y || 0);
      root.position.set(position.x, base, position.z);
      const material = new T.MeshBasicMaterial({ color: 0x0d1211, transparent: true, opacity: 0, depthWrite: false });
      // M6 表现（M3a 留的调平项）：体团 opacity 0.82→0.5，贴地层用径向 alphaMap 羽化边缘。
      // 规则层 fogDensity 不变——视野遮罩、小地图失效与队友减伤仍读同一个函数。
      const edgeMaterial = new T.MeshBasicMaterial({
        color: 0x0d1211, transparent: true, opacity: 0, depthWrite: false,
        alphaMap: this.fogEdgeTexture || (this.fogEdgeTexture = this.makeFogEdge())
      });
      const body = new T.Mesh(this.fogShell, material);
      body.position.y = radius * 0.42;
      body.scale.set(radius * 0.78, radius * 0.5, radius * 0.78);
      root.add(body);
      for (const [offset, size] of [[0.28, 0.62], [-0.3, 0.5]]) {
        const puff = new T.Mesh(this.fogShell, material);
        puff.position.set(radius * offset, radius * 0.52, radius * -offset * 0.7);
        puff.scale.setScalar(radius * size);
        root.add(puff);
      }
      const skirt = new T.Mesh(this.fogDisc, edgeMaterial);
      skirt.rotation.x = -Math.PI / 2;
      skirt.position.y = 0.04;
      skirt.scale.setScalar(radius);
      root.add(skirt);
      this.game.world.scene.add(root);
      this.fogs.push({ root, material, edgeMaterial, position: new T.Vector3(position.x, 0, position.z), radius, life, maxLife: life });
    }

    // 径向渐变贴地纹理：中心实心、外圈全透明，一次生成全场共用。
    makeFogEdge() {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 128;
      const ctx = canvas.getContext('2d');
      const grad = ctx.createRadialGradient(64, 64, 6, 64, 64, 62);
      grad.addColorStop(0, '#ffffff');
      grad.addColorStop(0.55, '#ffffff');
      grad.addColorStop(1, '#000000');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 128, 128);
      return new T.CanvasTexture(canvas);
    }

    removeFog(index) {
      const fog = this.fogs[index];
      this.game.world.scene.remove(fog.root);
      fog.material.dispose();
      if (fog.edgeMaterial) fog.edgeMaterial.dispose();
      this.fogs.splice(index, 1);
    }

    // 雾浓度 0..1：用于玩家视野遮挡、小地图失效与队友命中减伤。
    fogDensity(position) {
      let best = 0;
      for (const fog of this.fogs) {
        const fade = Math.min(1, (fog.maxLife - fog.life) / 0.6, fog.life / 1);
        if (fade <= 0) continue;
        const d = Math.hypot(position.x - fog.position.x, position.z - fog.position.z);
        if (d >= fog.radius) continue;
        best = Math.max(best, (1 - (d / fog.radius) ** 3) * fade);
      }
      return best;
    }

    boom(position, radius, color = 0xffb257, life = 0.45) {
      const base = this.game.world.floorAt(position.x, position.z, position.y || 0);
      const mesh = new T.Mesh(this.blowRing, new T.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, side: T.DoubleSide, depthWrite: false }));
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(position.x, base + 0.06, position.z);
      mesh.scale.setScalar(radius * 0.3);
      this.game.world.scene.add(mesh);
      this.blows.push({ mesh, life, maxLife: life, radius });
      const fire = new T.Vector3(position.x, base + 0.5, position.z);
      for (let i = 0; i < 26; i++) {
        const angle = Math.random() * Math.PI * 2, speed = 2 + Math.random() * radius * 2.2;
        this.particle(fire, new T.Vector3(Math.cos(angle) * speed, 3.4 + Math.random() * 3.5, Math.sin(angle) * speed),
          i % 3 ? 0xff8a3c : 0xffd37a, 0.06 + Math.random() * 0.07, 0.4 + Math.random() * 0.4);
      }
      for (let i = 0; i < 10; i++) {
        this.particle(fire, new T.Vector3((Math.random() - 0.5) * 3, 1.2 + Math.random() * 2, (Math.random() - 0.5) * 3),
          0x4a423b, 0.09, 0.8, 3.2);
      }
    }

    removeBlow(index) {
      const blow = this.blows[index];
      this.game.world.scene.remove(blow.mesh);
      blow.mesh.material.dispose();
      this.blows.splice(index, 1);
    }

    // BOSS 砸地红圈预警：贴地圆环 + 半透明填充，时长由调用方与技能前摇一致。
    warn(position, radius, duration) {
      const material = new T.MeshBasicMaterial({ color: 0xd2352a, transparent: true, opacity: 0.24, side: T.DoubleSide, depthWrite: false });
      const root = new T.Group();
      root.position.set(position.x, this.game.world.floorAt(position.x, position.z, position.y || 0) + 0.05, position.z);
      const fill = new T.Mesh(this.fogDisc, material);
      fill.rotation.x = -Math.PI / 2;
      const edge = new T.Mesh(this.blowRing, material);
      edge.rotation.x = -Math.PI / 2;
      edge.position.y = 0.012;
      root.add(fill, edge);
      root.scale.setScalar(radius);
      this.game.world.scene.add(root);
      this.warns.push({ root, material, life: duration, maxLife: duration });
    }

    removeWarn(index) {
      const warn = this.warns[index];
      this.game.world.scene.remove(warn.root);
      warn.material.dispose();
      this.warns.splice(index, 1);
    }

    particle(position, velocity, color, size, life, gravity = 8) {
      const index = this.cursor++ % this.particles.length;
      const p = this.particles[index];
      p.p.copy(position); p.v.copy(velocity); p.life = p.maxLife = life;
      p.size = size; p.gravity = gravity;
      this.mesh.setColorAt(index, new T.Color(color));
      this.mesh.instanceColor.needsUpdate = true;
    }

    burst(position, type = 'spark', amount = 8) {
      const palette = {
        blood: [0x9d4334, 0xc77e4a],
        spark: [0xffcc73, 0xffefa4],
        void: [0xc18ff5, 0x6f4fa0]
      };
      const colors = palette[type] || palette.spark;
      const chunky = type === 'blood';
      for (let i = 0; i < amount; i++) {
        const v = new T.Vector3((Math.random() - 0.5) * 4, Math.random() * 3.5, (Math.random() - 0.5) * 4);
        this.particle(position, v, i % 2 ? colors[0] : colors[1], chunky ? 0.045 + Math.random() * 0.06 : 0.02, 0.25 + Math.random() * 0.35);
      }
    }

    casing(camera) {
      const position = new T.Vector3(0.3, -0.15, -0.48).applyMatrix4(camera.matrixWorld);
      const velocity = new T.Vector3(1.5 + Math.random(), 1.6, 0.7).applyQuaternion(camera.quaternion);
      this.particle(position, velocity, 0xccab62, 0.033, 1.15, 9);
    }

    tracer(start, end) {
      const trace = this.traces[this.traceCursor++ % this.traces.length];
      const a = trace.line.geometry.attributes.position;
      a.setXYZ(0, start.x, start.y, start.z); a.setXYZ(1, end.x, end.y, end.z);
      a.needsUpdate = true;
      trace.life = 0.055;
      trace.line.visible = true;
      trace.line.material.opacity = 0.65;
    }

    // type: 'health' | 'ammo' | 'rocket' | 'gatling'；options.life 缺省读模式 dropLife（巨人城 20s、练习 35s）。
    drop(position, type, options = {}) {
      if (this.drops.length >= 12) this.removeDrop(0);
      const weapon = type === 'rocket' || type === 'gatling';
      const life = options.life != null ? options.life :
        (weapon ? Infinity : Math.max(1, (this.game.waveMode || {}).dropLife || 35));
      const root = new T.Group();
      const base = this.game.world.floorAt(position.x, position.z, position.y || 0);
      root.position.set(position.x, base + 0.48, position.z);
      const box = new T.Mesh(weapon ? this.supplyBox : this.dropBox, weapon ? this.weaponMaterial : this.dropMaterials[type]);
      root.add(box);
      const symbol = (x, y, z, w, h, d) => {
        const part = new T.Mesh(this.symbolBox, this.symbolMaterial);
        part.position.set(x, y, z); part.scale.set(w, h, d); root.add(part);
      };
      if (type === 'health') {
        symbol(0, 0, 0.211, 0.26, 0.075, 0.018);
        symbol(0, 0, 0.211, 0.075, 0.26, 0.02);
      } else if (weapon) {
        // 枪形剪影：火箭筒=长管+战斗部，加特林=三排短管。
        if (type === 'rocket') {
          symbol(0, 0.06, 0.21, 0.09, 0.09, 0.42);
          symbol(0, 0.06, 0.02, 0.14, 0.14, 0.08);
          symbol(0, -0.08, 0.14, 0.06, 0.12, 0.06);
        } else {
          for (const x of [-0.1, 0, 0.1]) symbol(x, 0.06, 0.2, 0.05, 0.05, 0.34);
          symbol(0, 0.06, 0.02, 0.26, 0.18, 0.1);
        }
      } else {
        for (const x of [-0.13, 0, 0.13]) symbol(x, 0, 0.211, 0.055, 0.24, 0.018);
      }
      const ring = new T.Mesh(this.dropRing, this.symbolMaterial);
      ring.rotation.x = -Math.PI / 2; ring.position.y = -0.35;
      root.add(ring);
      const label = this.labelMode ? this.makeLabel() : null;
      if (label) { root.add(label.sprite); this.setLabel(label, weapon || options.waveEnd ? '波末' : String(Math.ceil(life))); }
      this.game.world.scene.add(root);
      this.drops.push({ root, type, life, base, weapon, waveEnd: Boolean(options.waveEnd || weapon), label });
    }

    removeDrop(index) {
      const drop = this.drops[index];
      this.removeLabel(drop.label);
      this.game.world.scene.remove(drop.root);
      this.drops.splice(index, 1);
    }

    // 波末过期的箱（特殊武器箱/倒地掉落）：波次结算时未拾取即消失；普通击杀掉落仍走自然寿命。
    expireWaveDrops() {
      for (let i = this.drops.length - 1; i >= 0; --i) {
        if (this.drops[i].waveEnd) this.removeDrop(i);
      }
    }

    // M5 波间补给箱：固定点位点亮，弹药/医疗两种，同屏上限 8（超出丢最旧）。
    spawnSupply(point, kind) {
      if (this.supplies.length >= this.supplyLimit) this.removeSupply(0);
      const root = new T.Group();
      const base = this.game.world.floorAt(point.x, point.z, point.y || 0);
      root.position.set(point.x, base + 0.5, point.z);
      const box = new T.Mesh(this.supplyBox, this.supplyMaterials[kind]);
      root.add(box);
      const symbol = (x, y, z, w, h, d) => {
        const part = new T.Mesh(this.symbolBox, this.symbolMaterial);
        part.position.set(x, y, z); part.scale.set(w, h, d); root.add(part);
      };
      if (kind === 'health') {
        symbol(0, 0, 0.241, 0.3, 0.08, 0.018);
        symbol(0, 0, 0.241, 0.08, 0.3, 0.02);
      } else {
        for (const x of [-0.15, 0, 0.15]) symbol(x, 0, 0.241, 0.06, 0.26, 0.018);
      }
      const ring = new T.Mesh(this.supplyRing, this.symbolMaterial);
      ring.rotation.x = -Math.PI / 2; ring.position.y = -0.38;
      root.add(ring);
      const label = this.makeLabel();
      root.add(label.sprite);
      this.setLabel(label, '0');
      this.game.world.scene.add(root);
      this.supplies.push({ root, kind, base, label });
    }

    removeSupply(index) {
      const supply = this.supplies[index];
      this.removeLabel(supply.label);
      this.game.world.scene.remove(supply.root);
      this.supplies.splice(index, 1);
    }

    expireSupplies() {
      while (this.supplies.length) this.removeSupply(0);
    }

    update(dt) {
      this.time += dt;
      for (let i = 0; i < this.particles.length; ++i) {
        const p = this.particles[i];
        if (p.life > 0) {
          p.life = Math.max(0, p.life - dt);
          p.v.y -= p.gravity * dt;
          p.p.addScaledVector(p.v, dt);
          const floor = this.game.world.floorAt(p.p.x, p.p.z, p.p.y) + 0.025;
          if (p.p.y < floor) { p.p.y = floor; p.v.y *= -0.28; p.v.x *= 0.7; p.v.z *= 0.7; }
          this.dummy.position.copy(p.p);
          this.dummy.rotation.set(p.life * 8, p.life * 4, 0);
          this.dummy.scale.setScalar(p.size * Math.min(1, p.life * 5));
        } else this.dummy.scale.setScalar(0);
        this.dummy.updateMatrix();
        this.mesh.setMatrixAt(i, this.dummy.matrix);
      }
      this.mesh.instanceMatrix.needsUpdate = true;
      for (const t of this.traces) {
        t.life -= dt;
        t.line.visible = t.life > 0;
        t.line.material.opacity = Math.max(0, t.life * 12);
      }
      for (let i = this.fogs.length - 1; i >= 0; --i) {
        const fog = this.fogs[i];
        fog.life -= dt;
        if (fog.life <= 0) { this.removeFog(i); continue; }
        const fade = Math.min(1, (fog.maxLife - fog.life) / 0.6, fog.life / 1);
        fog.material.opacity = 0.5 * fade;
        if (fog.edgeMaterial) fog.edgeMaterial.opacity = 0.78 * fade;
        const breathe = 1 + Math.sin(this.time * 1.6 + i) * 0.03;
        fog.root.rotation.y += dt * 0.22;
        fog.root.scale.set(breathe, 1, breathe);
      }
      for (let i = this.blows.length - 1; i >= 0; --i) {
        const blow = this.blows[i];
        blow.life -= dt;
        if (blow.life <= 0) { this.removeBlow(i); continue; }
        const t = 1 - blow.life / blow.maxLife;
        blow.mesh.scale.setScalar(blow.radius * (0.3 + t * 1.1));
        blow.mesh.material.opacity = 0.85 * (1 - t);
      }
      for (let i = this.warns.length - 1; i >= 0; --i) {
        const warn = this.warns[i];
        warn.life -= dt;
        if (warn.life <= 0) { this.removeWarn(i); continue; }
        const t = 1 - warn.life / warn.maxLife;
        warn.material.opacity = 0.2 + t * 0.3 + Math.sin(this.time * 16) * 0.05;
      }
      const player = this.game.player;
      for (let i = this.drops.length - 1; i >= 0; --i) {
        const drop = this.drops[i];
        drop.life -= dt;
        drop.root.rotation.y += dt * 1.25;
        drop.root.position.y = drop.base + 0.47 + Math.sin(this.time * 3 + i) * 0.1;
        drop.root.visible = drop.life > 5 || Math.sin(this.time * 12) > 0;
        if (drop.life <= 0) { this.removeDrop(i); continue; }
        if (drop.label) {
          if (drop.waveEnd) this.setLabel(drop.label, '波末');
          else this.setLabel(drop.label, String(Math.max(1, Math.ceil(drop.life))));
        }
        const d = Math.hypot(player.position.x - drop.root.position.x, player.position.z - drop.root.position.z);
        // 补给跟着所在顶面浮动：脚底与补给不同层的玩家够不到。
        if (d > 1.45 || Math.abs(player.position.y - drop.base) > 1.2) continue;
        if (drop.weapon) {
          this.game.weapons.grantSpecial(drop.type);
          this.game.audio.pickup();
          this.removeDrop(i);
          continue;
        }
        if (drop.type === 'health' && player.health === 100) continue;
        if (drop.type === 'health') { player.heal(30); this.game.ui.toast('医疗补给 · 生命值 +30'); }
        else { this.game.weapons.addAmmo(60, 24); this.game.ui.toast('弹药补给 · 步枪 +60 / 手枪 +24'); }
        this.game.audio.pickup();
        this.removeDrop(i);
      }
      // 波间补给箱：玩家用与掉落一致的拾取半径；间歇期浮字显示下一波倒数，波进行中显示'波末'。
      for (let i = this.supplies.length - 1; i >= 0; --i) {
        const supply = this.supplies[i];
        supply.root.rotation.y += dt * 1.1;
        supply.root.position.y = supply.base + 0.49 + Math.sin(this.time * 2.6 + i) * 0.08;
        this.setLabel(supply.label, this.game.wavePhase === 'intermission' ?
          String(Math.max(1, Math.ceil(this.game.nextWaveIn))) : '波末');
        const d = Math.hypot(player.position.x - supply.root.position.x, player.position.z - supply.root.position.z);
        if (d > 1.45 || Math.abs(player.position.y - supply.base) > 1.2) continue;
        if (supply.kind === 'health') {
          if (player.health === 100) continue;
          player.heal(35);
          this.game.ui.toast('医疗箱 · 生命值 +35');
        } else {
          this.game.weapons.addAmmo(90, 36);
          this.game.ui.toast('弹药箱 · 步枪 +90 / 手枪 +36');
        }
        this.game.audio.pickup();
        this.removeSupply(i);
      }
    }

    reset() {
      while (this.drops.length) this.removeDrop(0);
      while (this.supplies.length) this.removeSupply(0);
      while (this.fogs.length) this.removeFog(0);
      while (this.blows.length) this.removeBlow(0);
      while (this.warns.length) this.removeWarn(0);
      for (const p of this.particles) p.life = 0;
      for (const t of this.traces) { t.life = 0; t.line.visible = false; }
      for (let i = 0; i < this.particles.length; i++) {
        this.dummy.scale.setScalar(0); this.dummy.updateMatrix(); this.mesh.setMatrixAt(i, this.dummy.matrix);
      }
      this.mesh.instanceMatrix.needsUpdate = true;
    }
  };
})();
