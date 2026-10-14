(function () {
  'use strict';
  const DZ = window.DZ = window.DZ || {};
  if (!window.THREE) return;
  const T = THREE;

  // §4 小队默认配置：DPS 比率为玩家基准（≈120 有效 DPS）折算，数值微调留给 M6 调平。
  const ROSTER = [
    { key: 'blade', name: '尖刀', weapon: '步枪', hp: 120, speed: 3.8, order: 'free', threatFirst: true,
      armor: 0x3d5a80, cloth: 0x263a52, accent: 0xe8973f,
      magazine: 30, reserve: 180, reloadTime: 2.0, fireInterval: 0.55, damage: 13, range: 22 },
    { key: 'shield', name: '盾卫', weapon: '步枪+近战', hp: 180, speed: 3.0, order: 'hold', reduction: 0.3,
      armor: 0x2e6f6a, cloth: 0x24463f, accent: 0x9fb8ab,
      magazine: 24, reserve: 120, reloadTime: 2.3, fireInterval: 0.7, damage: 10, range: 18,
      melee: { damage: 26, cooldown: 1.4, reach: 2.2 } },
    { key: 'ranger', name: '游骑兵', weapon: '狙击', hp: 90, speed: 3.4, order: 'hold', threatFirst: true,
      armor: 0x4a6491, cloth: 0x31465e, accent: 0x8fd0ff,
      magazine: 8, reserve: 40, reloadTime: 2.6, fireInterval: 1.35, damage: 26, range: 38 }
  ];

  const ORDERS = ['hold', 'follow', 'free'];
  const ORDER_LABELS = { hold: '守点', follow: '跟随', free: '自由' };
  const HIGH_THREAT = new Set(['bomber', 'fogger', 'splitter']);
  const RESPAWN_TIME = 5;
  const SWITCH_TIME = 1.5;
  const LEASH = 10;

  DZ.Squad = class Squad {
    constructor(game) {
      this.game = game;
      this.members = ROSTER.map((def, index) => this.createMember(def, index));
      this.selected = 0;
      this.ray = new T.Raycaster();
      this.origin = new T.Vector3();
      this.aimPoint = new T.Vector3();
      this.onKey = event => {
        if (game.state !== 'playing' || event.repeat) return;
        if (event.code === 'Tab') {
          event.preventDefault();
          this.selected = (this.selected + 1) % this.members.length;
          const m = this.members[this.selected];
          game.ui.toast(`${m.def.name} · ${ORDER_LABELS[m.order]}（Q 切换指令，${SWITCH_TIME} 秒生效）`, 2.2);
        } else if (event.code === 'KeyQ') this.cycleOrder();
      };
      document.addEventListener('keydown', this.onKey);
    }

    cycleOrder() {
      const m = this.members[this.selected];
      if (m.dead || m.pendingOrder) return;
      const next = ORDERS[(ORDERS.indexOf(m.order) + 1) % ORDERS.length];
      m.pendingOrder = next;
      m.orderClock = SWITCH_TIME;
    }

    createMember(def, index) {
      const root = new T.Group();
      const start = def.order === 'hold'
        ? this.game.world.squadPosts[index].clone()
        : this.game.world.squadStart.clone();
      this.game.world.settleY(start);
      root.position.copy(start);
      const armor = new T.MeshStandardMaterial({ color: def.armor, roughness: 0.85 });
      const cloth = new T.MeshStandardMaterial({ color: def.cloth, roughness: 0.9 });
      const accent = new T.MeshStandardMaterial({ color: def.accent, roughness: 0.7 });
      const skin = new T.MeshStandardMaterial({ color: 0xb9a184, roughness: 0.9 });
      const dark = new T.MeshStandardMaterial({ color: 0x232d28, roughness: 0.6, metalness: 0.4 });
      const limbs = [];
      const cube = new T.BoxGeometry(1, 1, 1);
      const part = (x, y, z, w, h, d, material, parent = root) => {
        const mesh = new T.Mesh(cube, material);
        mesh.position.set(x, y, z); mesh.scale.set(w, h, d);
        mesh.receiveShadow = true;
        parent.add(mesh);
        return mesh;
      };
      part(0, 1.24, 0, 0.6, 0.71, 0.36, cloth);
      part(0, 1.3, 0.19, 0.44, 0.5, 0.05, armor);
      part(0, 0.88, 0, 0.46, 0.23, 0.32, cloth);
      part(0, 1.62, 0, 0.2, 0.16, 0.2, armor);
      part(0, 1.63, 0.09, 0.16, 0.06, 0.05, accent);
      const head = part(0, 1.8, 0, 0.22, 0.26, 0.22, skin);
      head.rotation.x = 0.06;
      for (const side of [-1, 1]) {
        const arm = new T.Group(); arm.position.set(side * 0.4, 1.45, 0);
        root.add(arm);
        part(0, -0.21, 0, 0.2, 0.5, 0.2, cloth, arm);
        part(0, -0.56, 0.02, 0.16, 0.3, 0.16, skin, arm);
        limbs.push(arm);
        const leg = new T.Group(); leg.position.set(side * 0.17, 0.86, 0);
        root.add(leg);
        part(0, -0.38, 0, 0.21, 0.74, 0.24, cloth, leg);
        part(0, -0.77, 0.04, 0.23, 0.14, 0.32, dark, leg);
        limbs.push(leg);
      }
      // 手持武器：步枪/狙击外形区分，盾卫左臂加装近战盾板。
      const gun = new T.Group(); gun.position.set(0.14, -0.5, 0.16); gun.rotation.x = -0.25;
      limbs[0].add(gun);
      part(0, 0, -0.3, 0.08, 0.11, 0.5, dark, gun);
      part(0, -0.02, -0.62, 0.05, 0.05, 0.34, dark, gun);
      if (def.key === 'ranger') part(0, 0.11, -0.34, 0.05, 0.06, 0.18, accent, gun);
      if (def.key === 'shield') part(-0.1, -0.1, -0.2, 0.06, 0.72, 0.5, armor, limbs[1]);
      const pad = new T.Mesh(new T.RingGeometry(0.52, 0.66, 24), new T.MeshBasicMaterial({ color: def.accent, transparent: true, opacity: 0.55, side: T.DoubleSide, depthWrite: false }));
      pad.rotation.x = -Math.PI / 2; pad.position.y = 0.03;
      root.add(pad);
      const label = this.nameLabel(def, index);
      label.position.y = 2.42;
      root.add(label);
      this.game.world.scene.add(root);
      const m = {
        def, id: index + 1, index, root, armor, cloth, accent, limbs, pad, label,
        hp: def.hp, maxHp: def.hp, dead: false, respawn: 0, stagger: 0,
        order: def.order, pendingOrder: null, orderClock: 0,
        ammo: def.magazine, reserve: def.reserve, reload: 0, fireCd: 0, meleeCd: 0,
        target: null, targetClock: 0, goal: new T.Vector3().copy(start),
        flash: 0, age: Math.random() * 10, phase: index * 1.7, moving: false, radius: 0.42
      };
      m.takeDamage = amount => this.damage(m, amount);
      return m;
    }

    nameLabel(def, index) {
      const canvas = document.createElement('canvas');
      canvas.width = 256; canvas.height = 64;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#' + def.accent.toString(16).padStart(6, '0');
      ctx.font = 'bold 40px "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(def.name, 128, 34);
      const texture = new T.CanvasTexture(canvas);
      texture.colorSpace = T.SRGBColorSpace;
      const mesh = new T.Mesh(new T.PlaneGeometry(1, 0.25), new T.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false }));
      mesh.userData.selected = index;
      return mesh;
    }

    update(dt) {
      if (this.game.state !== 'playing') return;
      for (const m of this.members) {
        m.flash = Math.max(0, m.flash - dt);
        m.stagger = Math.max(0, m.stagger - dt);
        m.armor.emissive.setHex(m.flash > 0 ? 0x8f2418 : 0x000000);
        m.label.quaternion.copy(this.game.world.camera.quaternion);
        const selectedNow = m.index === this.selected;
        m.pad.material.opacity = m.dead ? 0.12 : selectedNow ? 0.9 : 0.5;
        m.pad.scale.setScalar(selectedNow ? 1.22 : 1);
        if (m.orderClock > 0) {
          m.orderClock = Math.max(0, m.orderClock - dt);
          if (m.orderClock === 0 && m.pendingOrder) {
            m.order = m.pendingOrder;
            m.pendingOrder = null;
            m.target = null;
          }
        }
        if (m.dead) {
          m.root.rotation.x = Math.max(-1.25, m.root.rotation.x - dt * 2.4);
          m.respawn -= dt;
          if (m.respawn <= 0) this.respawn(m);
          continue;
        }
        m.fireCd = Math.max(0, m.fireCd - dt);
        m.meleeCd = Math.max(0, m.meleeCd - dt);
        if (m.reload > 0) {
          m.reload = Math.max(0, m.reload - dt);
          if (m.reload === 0) {
            const need = m.def.magazine - m.ammo;
            const amount = Math.min(need, m.reserve);
            m.ammo += amount;
            m.reserve -= amount;
          }
        }
        this.behave(m, dt);
        this.moveMember(m, dt);
        this.engage(m);
        this.pickups(m);
      }
    }

    behave(m, dt) {
      const game = this.game, player = game.player;
      m.targetClock -= dt;
      const downed = player.downed;
      if (m.target && (m.target.dead || m.targetClock <= 0)) m.target = null;
      if (!m.target && m.targetClock <= 0) {
        m.target = this.pickTarget(m, downed);
        m.targetClock = 0.25;
      }
      m.targetClock = Math.max(m.targetClock, 0);
      const post = game.world.squadPosts[m.index];
      if (downed) {
        // 玩家濒死：全员靠拢吸引火力（§4）。
        const angle = m.index * 2.1 + game.time * 0.4;
        m.goal.set(player.position.x + Math.cos(angle) * 3.5, 0, player.position.z + Math.sin(angle) * 3.5);
        return;
      }
      if (m.order === 'hold') {
        if (!m.target) { m.goal.copy(post); return; }
        const tp = m.target.root.position;
        const d = Math.hypot(tp.x - post.x, tp.z - post.z);
        if (d <= 2.4) { m.goal.copy(post); return; }
        // 站到岗位与目标之间：离目标 5m，且不越出岗位 10m 半径。
        const dx = post.x - tp.x, dz = post.z - tp.z;
        const len = Math.hypot(dx, dz);
        m.goal.set(tp.x + dx / len * 5, 0, tp.z + dz / len * 5);
        const over = Math.hypot(m.goal.x - post.x, m.goal.z - post.z);
        if (over > LEASH - 1) {
          const gx = tp.x - post.x, gz = tp.z - post.z;
          const gl = Math.hypot(gx, gz) || 1;
          m.goal.set(post.x + gx / gl * (LEASH - 1), 0, post.z + gz / gl * (LEASH - 1));
        }
        return;
      }
      if (m.order === 'follow') {
        const dx = m.root.position.x - player.position.x, dz = m.root.position.z - player.position.z;
        const d = Math.hypot(dx, dz);
        if (d > 8 || d < 0.01) m.goal.set(player.position.x + (d < 0.01 ? 4 : dx / d * 6), 0, player.position.z + (d < 0.01 ? 0 : dz / d * 6));
        else if (d < 4) m.goal.set(player.position.x + dx / d * 6.5, 0, player.position.z + dz / d * 6.5);
        else m.goal.copy(m.root.position);
        return;
      }
      // 自由：主动推进清剿。
      if (m.target) {
        const tp = m.target.root.position;
        const dx = m.root.position.x - tp.x, dz = m.root.position.z - tp.z;
        const d = Math.hypot(dx, dz) || 1;
        if (d > 6.5) m.goal.set(tp.x + dx / d * 6, 0, tp.z + dz / d * 6);
        else m.goal.copy(m.root.position);
      } else {
        const dx = m.root.position.x - player.position.x, dz = m.root.position.z - player.position.z;
        const d = Math.hypot(dx, dz) || 1;
        m.goal.set(player.position.x + dx / d * 5.5, 0, player.position.z + dz / d * 5.5);
      }
    }

    pickTarget(m, downed) {
      const game = this.game, player = game.player;
      const mp = m.root.position;
      let radius, anchor;
      if (downed) { radius = 22; anchor = mp; }
      else if (m.order === 'hold') { anchor = game.world.squadPosts[m.index]; radius = LEASH; }
      else if (m.order === 'follow') { anchor = player.position; radius = 20; }
      else { anchor = mp; radius = 30; }
      let best = null, bestScore = Infinity;
      const followPlayerAggro = m.order === 'follow' && !downed;
      for (const e of game.enemies.list) {
        if (e.dead) continue;
        if (followPlayerAggro && e.targetId !== 0) continue;
        const ep = e.root.position;
        const dAnchor = Math.hypot(ep.x - anchor.x, ep.z - anchor.z);
        if (dAnchor > radius) continue;
        const dSelf = Math.hypot(ep.x - mp.x, ep.z - mp.z);
        let score = dSelf;
        if (m.def.threatFirst && HIGH_THREAT.has(e.type)) score -= 14;
        if (score < bestScore) { bestScore = score; best = e; }
      }
      if (followPlayerAggro && !best) {
        // 玩家没有被咬住时退回常规选怪，避免游骑兵全程发呆。
        for (const e of game.enemies.list) {
          if (e.dead) continue;
          const ep = e.root.position;
          if (Math.hypot(ep.x - anchor.x, ep.z - anchor.z) > radius) continue;
          const dSelf = Math.hypot(ep.x - mp.x, ep.z - mp.z);
          let score = dSelf;
          if (m.def.threatFirst && HIGH_THREAT.has(e.type)) score -= 14;
          if (score < bestScore) { bestScore = score; best = e; }
        }
      }
      return best;
    }

    moveMember(m, dt) {
      const world = this.game.world, p = m.root.position;
      let mx = 0, mz = 0;
      if (m.stagger > 0) { m.moving = false; return; }
      const dx = m.goal.x - p.x, dz = m.goal.z - p.z;
      const d = Math.hypot(dx, dz);
      // 目标点只存 XZ，支撑高度按当前地图顶面现算，岗位在中央平台（0.35m）上也不会贴地。
      m.goal.y = world.floorAt(m.goal.x, m.goal.z);
      if (d > 0.45) {
        // 友方走 navAlly：斜坡与车顶对队友开放，怪物仍被地面层挡在高台之外。
        const fieldId = 'g' + m.index;
        world.updateField(fieldId, m.goal, dt, world.navAlly);
        const step = world.segmentClear(p, m.goal, 0.5) ? m.goal : world.nextStep(fieldId, p);
        const sx = step.x - p.x, sz = step.z - p.z;
        const sl = Math.hypot(sx, sz);
        if (sl > 0.02) { mx = sx / sl * m.def.speed; mz = sz / sl * m.def.speed; }
      }
      for (const other of this.members) {
        if (other === m || other.dead) continue;
        const ox = p.x - other.root.position.x, oz = p.z - other.root.position.z;
        const d2 = ox * ox + oz * oz;
        if (d2 > 0.0001 && d2 < 0.9) {
          const dist = Math.sqrt(d2), push = (0.95 - dist) * 3;
          mx += ox / dist * push; mz += oz / dist * push;
        }
      }
      m.moving = Math.hypot(mx, mz) > 0.3;
      world.move(p, mx * dt, mz * dt, m.radius);
      world.settleY(p);
      const face = m.target ? m.target.root.position : (m.moving ? m.goal : null);
      if (face) {
        const fx = (face.x || 0) - p.x, fz = (face.z || 0) - p.z;
        if (fx || fz) m.root.rotation.y = Math.atan2(fx, fz);
      }
      m.age += dt;
      const walk = Math.sin(m.age * m.def.speed * 4 + m.phase) * (m.moving ? 0.42 : 0.04);
      m.limbs[0].rotation.x = -0.35 + walk;
      m.limbs[1].rotation.x = -walk;
      m.limbs[2].rotation.x = walk;
      m.limbs[3].rotation.x = -walk;
    }

    engage(m) {
      const game = this.game;
      if (m.stagger > 0) return;
      const e = m.target;
      if (!e || e.dead) return;
      const def = m.def, p = m.root.position, ep = e.root.position;
      const dist = Math.hypot(ep.x - p.x, ep.z - p.z);
      if (def.melee && dist < def.melee.reach && m.meleeCd === 0) {
        m.meleeCd = def.melee.cooldown;
        const dir = new T.Vector3(ep.x - p.x, 0, ep.z - p.z).normalize();
        const hitPoint = new T.Vector3(ep.x, ep.y + 1.1, ep.z);
        game.enemies.damage(e, def.melee.damage * this.fogScale(ep), hitPoint, dir, false, m.id, 'melee');
        game.effects.burst(hitPoint, 'spark', 5);
      }
      if (dist > def.range || m.fireCd > 0 || m.reload > 0) return;
      if (m.ammo <= 0) { if (m.reserve > 0) this.startReload(m); return; }
      this.origin.set(p.x, p.y + 1.45, p.z);
      const headY = ep.y + 1.1 * (e.scale || 1);
      this.aimPoint.set(ep.x, headY, ep.z);
      const dir = this.aimPoint.clone().sub(this.origin);
      const shot = dir.length();
      if (shot < 0.3) return;
      dir.normalize();
      const spread = def.key === 'ranger' ? 0.004 : 0.02;
      dir.x += (Math.random() - 0.5) * spread;
      dir.y += (Math.random() - 0.5) * spread;
      dir.normalize();
      this.ray.set(this.origin, dir);
      this.ray.far = shot + 3;
      game.world.scene.updateMatrixWorld(true);
      const targets = game.world.blockers.concat(game.enemies.hitTargets());
      const hit = this.ray.intersectObjects(targets, false)[0];
      m.fireCd = def.fireInterval;
      m.ammo--;
      if (hit) {
        game.effects.tracer(this.origin, hit.point);
        const victim = hit.object.userData.enemy;
        if (victim && !victim.dead) {
          game.enemies.damage(victim, def.damage * this.fogScale(victim.root.position), hit.point, dir, false, m.id, def.key === 'ranger' ? 'sniper' : 'rifle');
        } else if (!victim) game.effects.burst(hit.point, 'spark', 3);
      }
      if (m.ammo === 0) this.startReload(m);
    }

    // 雾散体黑雾：队友在雾里命中目标伤害 -50%（玩家视野被遮但不减伤，§5）。
    fogScale(position) {
      return this.game.effects.fogDensity(position) > 0.25 ? 0.5 : 1;
    }

    // 击退（裂魂者命中 / BOSS 冲刺与震波）：贴墙滑行 + 硬直停火。
    knockback(m, dx, dz, distance, stagger = 0) {
      if (m.dead) return;
      DZ.knockPosition(this.game.world, m.root.position, dx, dz, distance, m.radius);
      this.game.world.settleY(m.root.position);
      m.stagger = Math.max(m.stagger, stagger);
    }

    startReload(m) {
      if (m.reload > 0 || m.ammo === m.def.magazine || m.reserve <= 0) return;
      m.reload = m.def.reloadTime;
    }

    pickups(m) {
      const game = this.game, drops = game.effects.drops;
      const player = game.player.position;
      for (let i = drops.length - 1; i >= 0; --i) {
        const drop = drops[i];
        const dp = drop.root.position;
        const d = Math.hypot(dp.x - m.root.position.x, dp.z - m.root.position.z);
        // 玩家够得着的补给让玩家先拿，避免嘴下抢食。
        if (d > 1.1 || Math.hypot(dp.x - player.x, dp.z - player.z) < 2.2) continue;
        if (drop.type === 'health') {
          if (m.hp >= m.maxHp) continue;
          m.hp = Math.min(m.maxHp, m.hp + 35);
        } else {
          if (m.reserve >= m.def.reserve) continue;
          m.reserve = Math.min(m.def.reserve, m.reserve + 90);
          if (m.ammo === 0 && m.reload === 0) this.startReload(m);
        }
        game.audio.pickup();
        game.effects.removeDrop(i);
      }
    }

    damage(m, amount) {
      if (m.dead) return;
      m.hp = Math.max(0, m.hp - amount * (1 - (m.def.reduction || 0)));
      m.flash = 0.13;
      if (m.hp > 0) return;
      m.dead = true;
      m.respawn = RESPAWN_TIME;
      m.target = null;
      m.root.rotation.x = 0;
      this.game.ui.toast(`${m.def.name} 阵亡 · ${RESPAWN_TIME} 秒后在复活点重生`, 2.5);
    }

    respawn(m) {
      const game = this.game, world = game.world;
      const stage = DZ.WAVES.stageForWave(game.wave);
      const points = world.revivePoints[stage] || world.revivePoints.A;
      const enemies = game.enemies.list.filter(e => !e.dead);
      let best = points[0], bestClear = -1;
      for (const point of points) {
        let nearest = Infinity;
        for (const e of enemies) nearest = Math.min(nearest, e.root.position.distanceTo(point));
        if (nearest > bestClear) { bestClear = nearest; best = point; }
      }
      m.root.position.set(best.x + (Math.random() - 0.5) * 1.5, 0, best.z + (Math.random() - 0.5) * 1.5);
      for (let i = 0; i < 8; i++) {
        if (world.canStand(m.root.position.x, m.root.position.z, 0.46)) break;
        m.root.position.x += (Math.random() - 0.5) * 2;
        m.root.position.z += (Math.random() - 0.5) * 2;
      }
      m.hp = m.maxHp;
      m.ammo = m.def.magazine;
      m.reserve = m.def.reserve;
      m.reload = 0;
      m.dead = false;
      m.respawn = 0;
      m.root.rotation.x = 0;
      m.goal.copy(m.root.position);
    }

    nearestAlive(position) {
      let best = null, bestD = Infinity;
      for (const m of this.members) {
        if (m.dead) continue;
        const d = m.root.position.distanceTo(position);
        if (d < bestD) { bestD = d; best = m; }
      }
      if (!best) return null;
      // 落点落在队友朝玩家一侧 1.3m 处，避免与队友重叠；高度跟随队友所在顶面（车顶归队要落上车顶）。
      const p = best.root.position;
      const dx = p.x - position.x, dz = p.z - position.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.01) return new T.Vector3(p.x + 1.3, p.y, p.z);
      return new T.Vector3(p.x - dx / d * 1.3, p.y, p.z - dz / d * 1.3);
    }

    // 波间补给：队友弹匣与备弹回满（玩家治疗/加弹在 game.update 波末结算）。
    resupply() {
      for (const m of this.members) {
        m.ammo = m.def.magazine;
        m.reserve = m.def.reserve;
        m.reload = 0;
      }
    }

    dispose() {
      document.removeEventListener('keydown', this.onKey);
      for (const m of this.members) {
        this.game.world.scene.remove(m.root);
        for (const mat of [m.armor, m.cloth, m.accent]) mat.dispose();
        m.pad.material.dispose();
        m.label.material.map.dispose();
        m.label.material.dispose();
      }
      this.members = [];
    }
  };

  DZ.Squad.ORDER_LABELS = ORDER_LABELS;
})();
