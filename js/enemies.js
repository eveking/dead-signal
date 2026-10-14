(function () {
  'use strict';
  const DZ = window.DZ = window.DZ || {};
  if (!window.THREE) return;
  const T = THREE;

  // 友方目标抽象：id 0=玩家（仇恨 bias +15），1..3=AI 队友；id 同时是流场字段编号。
  // knockback 由 M3 的裂魂者/BOSS 击退使用，玩家与队友各自实现硬直与贴墙滑行。
  DZ.allyUnits = function (game) {
    const units = [{
      id: 0, isPlayer: true, position: game.player.position, radius: 0.38,
      takeDamage: amount => game.player.damage(amount),
      knockback: (dx, dz, distance, stagger) => game.player.knockback(dx, dz, distance, stagger)
    }];
    if (game.squad) {
      for (const m of game.squad.members) {
        if (m.dead) continue;
        units.push({
          id: m.id, position: m.root.position, radius: m.radius,
          takeDamage: amount => m.takeDamage(amount),
          knockback: (dx, dz, distance, stagger) => game.squad.knockback(m, dx, dz, distance, stagger)
        });
      }
    }
    return units;
  };

  // 击退按 ≈0.25m 步进推进，撞墙即停，避免把单位塞进掩体。
  DZ.knockPosition = function (world, position, dirX, dirZ, distance, radius) {
    const len = Math.hypot(dirX, dirZ);
    if (!len || distance <= 0) return;
    const ux = dirX / len, uz = dirZ / len;
    const steps = Math.max(1, Math.round(distance / 0.25));
    const step = distance / steps;
    for (let i = 0; i < steps; i++) {
      const px = position.x, pz = position.z;
      world.move(position, ux * step, uz * step, radius);
      if (position.x === px && position.z === pz) return;
    }
  };

  // §5 外形模板：只决定视觉体积，命中盒由注册表的 radius 决定。
  const SHAPES = {
    walker: { skin: 0x768568, cloth: 0x37473c },
    runner: { skin: 0x8c7350, cloth: 0x67452f, torso: 0.9, leg: 1.08, head: 0.92 },
    bomber: { skin: 0xa89a52, cloth: 0x5f5730, torso: 1.28, belly: 0.46, head: 0.8, arm: 0.85, eye: 0xffd37a, glow: 0xff8a3c },
    tyrant: { skin: 0x718d4e, cloth: 0x3c5231, torso: 1.5, arm: 1.4, leg: 1.18, head: 1.55, horn: true, eye: 0xffa94a },
    fogger: { skin: 0xbcc7b4, cloth: 0x465c56, torso: 1.05, cloak: true, head: 1.05, eye: 0xd8fff0, glow: 0x8fe6c4 },
    splitter: { skin: 0x9a74a6, cloth: 0x3b2c46, torso: 0.92, arm: 1.15, blade: true, head: 0.95, eye: 0xe6c9ff, glow: 0xc18ff5 },
    titan: { skin: 0x6f6046, cloth: 0x4a3d2b, torso: 1.22, arm: 1.3, leg: 1.12, head: 1.2, horn: true, eye: 0xff9c4a },
    megaTitan: { skin: 0x7a5a48, cloth: 0x4d3527, torso: 1.32, arm: 1.4, leg: 1.18, head: 1.25, horn: true, eye: 0xff7a4a }
  };

  // 旧 48×48 图（练习模式）的 fast 变体配色，M3 不改旧模式外观。
  const FAST_COLORS = { skin: 0x8c7350, cloth: 0x67452f };

  const GROUND_GROUPS = ['西', '东', '北'];

  function defaultMove(e, ctx) {
    const p = e.root.position, t = ctx.target.position;
    if (ctx.distance <= e.stopAt && e.direct) return [0, 0];
    // 冲顶自爆体改用友方导航层的同名流场（'e'+目标 id），地面层里没有通往车顶的路。
    const step = e.direct ? t : ctx.world.nextStep(e.topRush ? 'e' + e.targetId : e.targetId, p);
    const tx = step.x - p.x, tz = step.z - p.z;
    const len = Math.hypot(tx, tz);
    if (len < 0.02) return [0, 0];
    return [tx / len * e.speed, tz / len * e.speed];
  }

  function defaultAttack(e, ctx) {
    // 近战只打得到与自身脚底接近同层的单位：站在车顶对地面怪物是安全的。
    if (ctx.distance > e.attackAt || ctx.target.position.y - e.root.position.y > 1.02) return;
    if (!ctx.world.segmentClear(e.root.position, ctx.target.position, 0.12)) return;
    ctx.E.swing(e, e.damage, [ctx.target]);
  }

  function defaultAnimate(e, ctx, walk) {
    e.limbs[0].rotation.x = e.attack > 0 ? -1.4 : -0.35 + walk;
    e.limbs[2].rotation.x = e.attack > 0 ? -1.6 : -0.35 - walk;
    e.limbs[1].rotation.x = -walk;
    e.limbs[3].rotation.x = walk;
    e.head.rotation.z = Math.sin(e.age * 2 + e.phase) * 0.07;
  }

  // §7 泰坦 / 巨型泰坦共用状态机：数值全部来自注册表 def，巨型泰坦只是参数增强 + 震波 / 狂暴。
  // 阶段：idle → chargeWind（抬臂 0.8s）→ charge → idle；idle → slamWind（红圈 0.9s）→ [slamGap →] idle。
  function bossCd(e, value) {
    return value * (e.rage && e.def.rage ? e.def.rage.cdScale : 1);
  }

  function slamRadius(e) {
    return e.rage && e.def.rage ? e.def.rage.slamRadius : e.def.slam.radius;
  }

  const BOSS_BEHAVIOR = {
    think(e, ctx) {
      const def = e.def, sk = e.skill, game = ctx.game;
      if (def.rage && !e.rage && e.hp <= e.maxHp * def.rage.at) {
        e.rage = true;
        e.speed = def.rage.speed;
        game.ui.toast('巨型泰坦进入狂暴');
        game.audio.growl();
      }
      if (def.quake && !sk.quakeDone && e.hp <= e.maxHp * def.quake.at) {
        sk.quakeDone = true;
        ctx.E.quake(e, def.quake.knockback, ctx);
      }
      if (sk.phase !== 'idle') {
        bossPhaseTick(e, ctx);
        return;
      }
      if (def.summon) {
        sk.summonCd -= ctx.dt;
        if (sk.summonCd <= 0) {
          const picks = def.summon.picks;
          const index = e.rage && def.rage ? def.rage.summonFixed : Math.floor(Math.random() * picks.length);
          sk.summonCd = bossCd(e, def.summon.every);
          ctx.E.summon(e, picks[index], ctx);
        }
      }
      sk.chargeCd = Math.max(0, sk.chargeCd - ctx.dt);
      sk.slamCd = Math.max(0, sk.slamCd - ctx.dt);
      if (sk.slamCd <= 0 && ctx.distance <= slamRadius(e) * 0.92) {
        sk.phase = 'slamWind';
        sk.wind = def.slam.windup;
        sk.slamsLeft = def.slam.repeats || 1;
        game.effects.warn(e.root.position, slamRadius(e), def.slam.windup);
        return;
      }
      if (sk.chargeCd <= 0 && ctx.distance >= def.charge.min && ctx.distance <= def.charge.max && e.direct) {
        sk.phase = 'chargeWind';
        sk.wind = def.charge.windup;
      }
    },
    move(e, ctx) {
      const sk = e.skill;
      if (sk.phase === 'charge') return [sk.dash.vx, sk.dash.vz];
      if (sk.phase !== 'idle') return [0, 0];
      return defaultMove(e, ctx);
    },
    attack(e, ctx) {
      const sk = e.skill;
      if (sk.phase === 'charge') {
        const p = e.root.position;
        for (const u of ctx.units) {
          if (sk.dash.hits.has(u.id)) continue;
          // 冲刺同样只撞同一层的单位：车顶边缘的玩家不该被地面车厢板上的泰坦撞穿。
          if (Math.abs(u.position.y - p.y) > 2.2) continue;
          if (Math.hypot(u.position.x - p.x, u.position.z - p.z) > e.radius + u.radius + 0.3) continue;
          sk.dash.hits.add(u.id);
          u.knockback(u.position.x - p.x, u.position.z - p.z, e.def.charge.knockback, 0.35);
          u.takeDamage(e.def.charge.damage);
        }
        return;
      }
      if (sk.phase !== 'idle') return;
      defaultAttack(e, ctx);
    },
    animate(e, ctx, walk) {
      const sk = e.skill, def = e.def;
      defaultAnimate(e, ctx, walk);
      if (sk.phase === 'chargeWind' || sk.phase === 'charge') {
        const k = sk.phase === 'charge' ? 1 : 1 - sk.wind / def.charge.windup;
        e.limbs[0].rotation.x = -1.2 - k * 1.2;
        e.limbs[1].rotation.x = -1.2 - k * 1.2;
      } else if (sk.phase === 'slamWind' || sk.phase === 'slamGap') {
        const k = sk.phase === 'slamGap' ? 1 : 1 - sk.wind / def.slam.windup;
        e.limbs[0].rotation.x = -2.7 * k;
        e.limbs[1].rotation.x = -2.7 * k;
      }
      if (e.rage) {
        e.skin.emissive.setHex(0xa8281a);
        e.cloth.emissive.setHex(0x6e150f);
        if (e.eyeMaterial) e.eyeMaterial.color.setHex(0xff4a2a);
      }
    }
  };

  // 非 idle 阶段的推进：前摇计时、冲刺位移与转向、连砸间隔。
  function bossPhaseTick(e, ctx) {
    const def = e.def, sk = e.skill, game = ctx.game;
    if (sk.phase === 'chargeWind') {
      sk.wind -= ctx.dt;
      if (sk.wind > 0) return;
      const p = e.root.position, t = ctx.target.position;
      const dx = t.x - p.x, dz = t.z - p.z, len = Math.hypot(dx, dz) || 1;
      sk.dash = { dx: dx / len, dz: dz / len, angle: Math.atan2(dx, dz),
        vx: dx / len * def.charge.speed, vz: dz / len * def.charge.speed,
        left: def.charge.distance, hits: new Set() };
      sk.phase = 'charge';
      game.audio.growl();
      return;
    }
    if (sk.phase === 'charge') {
      const d = sk.dash;
      if (def.charge.turn) {
        // 小幅转向：以初始朝向为基准，最多偏 turn 弧度。
        const t = ctx.target.position, p = e.root.position;
        const want = Math.atan2(t.x - p.x, t.z - p.z);
        let diff = ((want - d.angle + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
        diff = Math.max(-def.charge.turn, Math.min(def.charge.turn, diff));
        d.vx = Math.sin(d.angle + diff) * def.charge.speed;
        d.vz = Math.cos(d.angle + diff) * def.charge.speed;
      }
      d.left -= def.charge.speed * ctx.dt;
      if (d.left <= 0) {
        sk.dash = null;
        sk.phase = 'idle';
        sk.chargeCd = bossCd(e, def.charge.cooldown);
      }
      return;
    }
    if (sk.phase === 'slamWind') {
      sk.wind -= ctx.dt;
      if (sk.wind <= 0) bossSlam(e, ctx);
      return;
    }
    if (sk.phase === 'slamGap') {
      sk.wind -= ctx.dt;
      if (sk.wind <= 0) bossSlam(e, ctx);
    }
  }

  function bossSlam(e, ctx) {
    const def = e.def, sk = e.skill;
    ctx.E.area(e, slamRadius(e), def.slam.damage, ctx);
    sk.slamsLeft--;
    if (sk.slamsLeft > 0) {
      sk.phase = 'slamGap';
      sk.wind = def.slam.gap;
      ctx.game.effects.warn(e.root.position, slamRadius(e), def.slam.gap);
      return;
    }
    sk.phase = 'idle';
    sk.slamCd = bossCd(e, def.slam.cooldown);
  }


  // M3a 敌种注册表：数值来自 DZ.WAVES.TYPES（§5），这里登记行为钩子与规则参数。
  const REGISTRY = {
    walker: {
      radius: 0.44, targetRule: 'aggro', spawnPoints: GROUND_GROUPS,
      melee: { cooldown: 1.1, windup: 0.34 }
    },
    runner: {
      radius: 0.42, targetRule: 'aggro', spawnPoints: GROUND_GROUPS,
      melee: { cooldown: 1.1, windup: 0.34 },
      // 直线冲刺 6m、CD 4s（§5）：进入 3.5–13m 且视线通畅时触发，12m/s 冲完 6m。
      dash: { cooldown: 4, distance: 6, speed: 12, min: 3.5, max: 13 },
      behavior: {
        think(e, ctx) {
          e.dashCd = Math.max(0, e.dashCd - ctx.dt);
          if (e.dash) {
            e.dash.left -= e.def.dash.speed * ctx.dt;
            if (e.dash.left <= 0) e.dash = null;
            return;
          }
          if (e.dashCd > 0 || ctx.distance < e.def.dash.min || ctx.distance > e.def.dash.max || !e.direct) return;
          const dx = ctx.target.position.x - e.root.position.x, dz = ctx.target.position.z - e.root.position.z;
          const len = Math.hypot(dx, dz) || 1;
          e.dash = { vx: dx / len * e.def.dash.speed, vz: dz / len * e.def.dash.speed, left: e.def.dash.distance };
          e.dashCd = e.def.dash.cooldown;
        },
        move(e, ctx) {
          if (!e.dash) return defaultMove(e, ctx);
          return [e.dash.vx, e.dash.vz];
        }
      }
    },
    bomber: {
      radius: 0.5, targetRule: 'nearest', spawnPoints: GROUND_GROUPS.concat(['顶', '南']),
      // 只有从"顶"组投放的个体才启用冲顶：改走友方导航层、优先咬高层目标（§3 车顶争夺）。
      topRush: true,
      melee: { cooldown: 1.1, windup: 0.34 },
      fuse: { range: 2.5, time: 0.45 },
      blast: { radius: 3, damage: 60 },
      behavior: {
        // 接近 2.5m 起爆；被射杀不爆炸（死亡走 onDeath，不进 detonate）。
        think(e, ctx) {
          if (e.fuse <= 0) {
            if (ctx.distance > e.def.fuse.range) return;
            // 冲顶个体要炸的是车顶，隔着车厢底板起爆只会炸空，继续爬坡。
            if (e.topRush && ctx.target.position.y - e.root.position.y > 1.6) return;
            e.fuse = e.def.fuse.time;
            return;
          }
          e.fuse -= ctx.dt;
          if (e.fuse <= 0) ctx.E.detonate(e, ctx);
        },
        move(e, ctx) {
          if (e.fuse <= 0) return defaultMove(e, ctx);
          const mv = defaultMove(e, ctx);
          return [mv[0] * 0.5, mv[1] * 0.5];
        },
        animate(e, ctx, walk) {
          defaultAnimate(e, ctx, walk);
          if (e.fuse > 0) {
            if (e.belly) e.belly.scale.setScalar(e.bellyScale * (1 + Math.sin(ctx.game.time * 34) * 0.18));
            e.glowMat.emissive.setHex(0xff8a3c).multiplyScalar(1 + e.fuse);
          }
        }
      }
    },
    tyrant: {
      radius: 0.75, targetRule: 'aggro', spawnPoints: GROUND_GROUPS,
      rifleResist: 0.2,
      melee: { cooldown: 1.7, windup: 0.55 },
      // 横扫 30：以自身为圆心命中圈内所有友方单位，可一巴掌拍穿整队。
      sweep: { reach: 2.8 },
      behavior: {
        attack(e, ctx) {
          const p = e.root.position, world = ctx.world;
          // 按圈内每个单位分别判定，不看当前仇恨目标：仇恨被队友抢走时照样能拍到我脸上的玩家。
          const victims = ctx.units.filter(u =>
            Math.hypot(u.position.x - p.x, u.position.z - p.z) <= e.def.sweep.reach + u.radius &&
            world.segmentClear(p, u.position, 0.12));
          if (!victims.length) return;
          ctx.E.swing(e, e.damage, victims);
        },
        animate(e, ctx, walk) {
          const swing = e.attack > 0;
          e.limbs[0].rotation.x = swing ? -0.6 - (1 - e.attack / e.melee.windup) * 1.2 : -0.3 + walk;
          e.limbs[1].rotation.x = swing ? -0.6 - (1 - e.attack / e.melee.windup) * 1.2 : -walk;
          e.limbs[2].rotation.x = walk;
          e.limbs[3].rotation.x = -walk;
        }
      }
    },
    fogger: {
      radius: 0.46, targetRule: 'aggro', spawnPoints: GROUND_GROUPS,
      melee: { cooldown: 1.1, windup: 0.34 },
      fog: { every: 6, radius: 6, life: 8 },
      behavior: {
        think(e, ctx) {
          e.fogCd -= ctx.dt;
          if (e.fogCd > 0) return;
          e.fogCd = e.def.fog.every;
          ctx.game.effects.fog(e.root.position, e.def.fog.radius, e.def.fog.life);
        }
      }
    },
    splitter: {
      radius: 0.44, targetRule: 'nearest', spawnPoints: GROUND_GROUPS,
      melee: { cooldown: 1.1, windup: 0.34 },
      // 命中附带击退 4m + 0.5s 硬直；8m 闪现突进 CD 8s（§5）。
      blink: { cooldown: 8, distance: 8, min: 4, max: 12, keep: 2.2 },
      shove: { distance: 4, stagger: 0.5 },
      behavior: {
        think(e, ctx) {
          e.blinkCd = Math.max(0, e.blinkCd - ctx.dt);
          if (e.blinkCd > 0) return;
          if (ctx.distance < e.def.blink.min || ctx.distance > e.def.blink.max) return;
          const landing = ctx.E.blinkLanding(e, ctx.target.position);
          if (!landing) return;
          ctx.game.effects.burst(e.root.position, 'void', 10);
          e.root.position.set(landing.x, 0, landing.z);
          e.blinkCd = e.def.blink.cooldown;
          e.pathClock = 0;
          e.direct = ctx.world.segmentClear(e.root.position, ctx.target.position, 0.48);
        },
        attack(e, ctx) {
          if (ctx.distance > e.attackAt || ctx.target.position.y - e.root.position.y > 1.02) return;
          if (!ctx.world.segmentClear(e.root.position, ctx.target.position, 0.12)) return;
          ctx.E.swing(e, e.damage, [ctx.target], e.def.shove.distance, e.def.shove.stagger);
        }
      }
    },
    titan: {
      radius: 0.44, targetRule: 'threat', spawnPoints: GROUND_GROUPS,
      melee: { cooldown: 2, windup: 0.5 },
      // §7 泰坦：冲刺 12s（0.8s 抬臂前摇、14m/s×10m、40 伤+击退 3m）、砸地 8s（0.9s 红圈、5m 半径 50 伤）。
      charge: { cooldown: 12, windup: 0.8, speed: 14, distance: 10, damage: 40, knockback: 3, min: 4, max: 26 },
      slam: { cooldown: 8, windup: 0.9, radius: 5, damage: 50 },
      behavior: BOSS_BEHAVIOR
    },
    megaTitan: {
      radius: 0.44, targetRule: 'threat', spawnPoints: ['南'],
      // §7 决战战场限制在火车南段开阔区：仅从"南"组刷出时生效，测试直刷不受限。
      arenaGroup: '南',
      melee: { cooldown: 2, windup: 0.5 },
      charge: { cooldown: 12, windup: 0.8, speed: 14, distance: 16, damage: 50, knockback: 3, min: 4, max: 30, turn: 0.4 },
      slam: { cooldown: 8, windup: 0.9, radius: 5, damage: 50, repeats: 2, gap: 0.5 },
      quake: { at: 0.6, knockback: 2 },
      // 狂暴 ≤40%：速度 3.3、技能 CD×0.6、砸地 5m→6.5m、召唤固定自爆体。
      rage: { at: 0.4, speed: 3.3, cdScale: 0.6, slamRadius: 6.5, summonFixed: 0 },
      behavior: BOSS_BEHAVIOR
    }
  };

  DZ.ENEMY_REGISTRY = REGISTRY;

  DZ.Enemies = class Enemies {
    constructor(game) {
      this.game = game;
      this.list = [];
      this.spawnTimer = 0;
      this.wave = 1;
      this.serial = 0;
      this.boss = null;
      this.runner = new DZ.WaveRunner(game.waveMode, game.difficulty);
      this.cube = new T.BoxGeometry(1, 1, 1);
      this.headGeometry = new T.IcosahedronGeometry(0.265, 1);
      this.bellyGeometry = new T.IcosahedronGeometry(0.265, 1);
      this.shadowGeometry = new T.CircleGeometry(0.53, 16);
      this.shadowMaterial = new T.MeshBasicMaterial({ color: 0x142018, transparent: true, opacity: 0.28, depthWrite: false });
      this.ctx = { game, world: game.world, units: null, target: null, distance: 0, E: this, dt: 0 };
    }

    startWave(wave) {
      this.wave = wave;
      this.boss = null;
      this.runner.start(wave - 1);
    }

    // 待生成数（含批次未投放与 BOSS 增援）由波次运行器统一维护。
    get pending() {
      return this.runner.pending;
    }

    aliveCount() { return this.list.reduce((n, e) => n + Number(!e.dead), 0); }

    hitTargets() {
      const targets = [];
      for (const e of this.list) if (!e.dead) targets.push(...e.targets);
      return targets;
    }

    defOf(entry) {
      if (!this.runner.dataDriven || !entry || !entry.type) return null;
      const type = DZ.WAVES.TYPES[entry.type] || DZ.WAVES.TYPES.walker;
      const def = REGISTRY[entry.type] || REGISTRY.walker;
      // 召唤表按波次配置（§7 泰坦 15/20 波构成不同），随 entry 注入而不是写死在注册表。
      return Object.assign({}, type, def, entry.summon ? { summon: entry.summon } : null);
    }

    // entry：{type, bossScale, fast}；dataDriven 时数值来自敌种表 × 难度倍率，否则沿用旧波次公式。
    resolveStats(entry, wave) {
      if (!this.runner.dataDriven) {
        const fast = entry && entry.fast;
        return {
          hp: 70 + (wave - 1) * 14, speed: (1.72 + wave * 0.19) * (fast ? 1.22 : 1),
          damage: 9 + wave * 2, score: 100, scale: 1, fast: Boolean(fast),
          type: 'walker', def: REGISTRY.walker
        };
      }
      const def = this.defOf(entry);
      const diff = this.runner.difficulty;
      const scale = def.boss ? (entry.bossScale || def.scale || 2.2) : 1;
      return {
        hp: Math.round(def.hp * diff.hp), speed: def.speed,
        damage: Math.round(def.damage * diff.damage), score: def.score,
        scale, fast: false, boss: Boolean(def.boss), def, type: def.key
      };
    }

    buildBody(enemy, shape) {
      const root = enemy.root;
      const skin = new T.MeshStandardMaterial({ color: shape.skin, roughness: 0.92, emissive: 0x000000 });
      const cloth = new T.MeshStandardMaterial({ color: shape.cloth, roughness: 0.93, emissive: 0x000000 });
      enemy.skin = skin;
      enemy.cloth = cloth;
      const torso = shape.torso || 1, arm = shape.arm || 1, leg = shape.leg || 1, head = shape.head || 1;
      const part = (x, y, z, w, h, d, material = cloth, parent = root) => {
        const mesh = new T.Mesh(this.cube, material);
        mesh.position.set(x, y, z); mesh.scale.set(w, h, d);
        mesh.userData.enemy = enemy;
        mesh.receiveShadow = true;
        parent.add(mesh); enemy.targets.push(mesh);
        return mesh;
      };
      part(0, 1.24, 0, 0.62 * torso, 0.71, 0.38 * torso);
      part(0, 0.88, 0, 0.48 * torso, 0.23, 0.34 * torso);
      part(0, 1.23, 0.202 * torso, 0.39 * Math.min(torso, 1.15), 0.39, 0.04, skin);
      part(0, 1.65, 0, 0.17 * head, 0.2, 0.17 * head, skin);
      const headMesh = new T.Mesh(this.headGeometry, skin);
      headMesh.position.set(0, 1.87, 0.02);
      headMesh.scale.set(0.93 * head, 1.12 * head, 0.94 * head);
      headMesh.userData.enemy = enemy; headMesh.userData.headshot = true;
      root.add(headMesh); enemy.targets.push(headMesh); enemy.head = headMesh;
      const eyeMaterial = new T.MeshBasicMaterial({ color: shape.eye || 0xf5b668 });
      enemy.eyeMaterial = eyeMaterial;
      for (const side of [-1, 1]) {
        // 眼睛挂在头部子级：头部体积变化（暴君 30%）时五官自动跟随。
        const eye = new T.Mesh(this.cube, eyeMaterial);
        eye.position.set(side * 0.102, 0.036, 0.25); eye.scale.set(0.075, 0.035, 0.023);
        headMesh.add(eye);
        if (shape.horn) {
          const horn = new T.Mesh(this.cube, cloth);
          horn.position.set(side * 0.2, 0.16, -0.02); horn.scale.set(0.08, 0.28, 0.08);
          horn.rotation.z = side * 0.5;
          horn.userData.enemy = enemy;
          headMesh.add(horn);
        }
        const armGroup = new T.Group(); armGroup.position.set(side * 0.42 * torso, 1.47, 0);
        root.add(armGroup);
        part(0, -0.21, 0, 0.22 * arm, 0.5, 0.22 * arm, cloth, armGroup);
        part(0, -0.57, 0.04, 0.17 * arm, 0.34, 0.17 * arm, skin, armGroup);
        if (shape.blade) {
          const blade = new T.Mesh(this.cube, eyeMaterial);
          blade.position.set(0, -0.7, 0.16); blade.scale.set(0.05, 0.42, 0.02); blade.rotation.x = 0.4;
          armGroup.add(blade);
        }
        enemy.limbs.push(armGroup);
        const legGroup = new T.Group(); legGroup.position.set(side * 0.18 * torso, 0.86, 0);
        root.add(legGroup);
        part(0, -0.38, 0, 0.22 * leg, 0.74, 0.25 * leg, cloth, legGroup);
        part(0, -0.77, 0.045, 0.24 * leg, 0.15, 0.34, cloth, legGroup);
        enemy.limbs.push(legGroup);
      }
      if (shape.cloak) {
        const cape = new T.MeshStandardMaterial({ color: shape.cloth, roughness: 0.96, transparent: true, opacity: 0.85 });
        enemy.cape = cape;
        part(0, 1.06, -0.24 * torso, 0.68 * torso, 1.02, 0.1, cape);
      }
      if (shape.belly) {
        const glow = new T.MeshStandardMaterial({ color: shape.skin, roughness: 0.8, emissive: shape.glow || 0x000000, emissiveIntensity: 0.7 });
        const belly = new T.Mesh(this.bellyGeometry, glow);
        belly.position.set(0, 1.02, 0.1);
        belly.scale.setScalar(shape.belly);
        belly.userData.enemy = enemy;
        root.add(belly); enemy.targets.push(belly);
        enemy.belly = belly; enemy.bellyScale = shape.belly; enemy.glowMat = glow;
      } else if (shape.glow) {
        enemy.glowMat = skin;
      }
      const shadow = new T.Mesh(this.shadowGeometry, this.shadowMaterial);
      shadow.rotation.x = -Math.PI / 2;
      shadow.position.y = 0.027;
      shadow.scale.setScalar(enemy.radius / 0.44);
      root.add(shadow);
      enemy.shadow = shadow;
    }

    spawn(position, wave = this.wave, entry = null) {
      const stats = this.resolveStats(entry || { fast: wave >= 3 && this.serial % 4 === 0 }, wave);
      const def = stats.def;
      // 旧模式的 fast 变体沿用 M2 之前的配色，保证练习模式外观零变化。
      const shape = Object.assign({}, SHAPES[stats.type] || SHAPES.walker,
        stats.fast ? FAST_COLORS : null);
      const root = new T.Group();
      root.position.copy(position);
      this.game.world.settleY(root.position);
      const enemy = {
        id: this.serial++, root, targets: [], limbs: [], dead: false, deathTime: 0,
        hp: stats.hp, maxHp: stats.hp,
        speed: stats.speed, damage: stats.damage, score: stats.score,
        radius: def.radius * stats.scale, scale: stats.scale,
        stopAt: 1.14 + (def.radius * stats.scale - 0.44), attackAt: 1.14 + def.radius * stats.scale,
        cooldown: 0.55, attack: 0, flash: 0, age: 0, born: 0.45,
        pathClock: Math.random() * 0.2, direct: false, phase: Math.random() * Math.PI * 2,
        knock: new T.Vector3(), fast: stats.fast, type: stats.type, boss: Boolean(stats.boss),
        targetId: 0, aggro: {}, def, behavior: def.behavior || {}, melee: def.melee,
        dashCd: 0, dash: null, fuse: 0, fogCd: def.fog ? def.fog.every : 0, blinkCd: 0,
        // 冲顶自爆（'顶'组投放）改用友方导航层；战场限制只给从'南'组刷出的巨型泰坦。
        topRush: Boolean(def.topRush && entry && entry.group === '顶'),
        arena: def.arenaGroup && entry && entry.group === def.arenaGroup ? this.game.world.bossArena : null,
        // BOSS 技能阶段机；开局给 3s/5s 缓冲，避免刷新瞬间糊脸。
        rage: false, skill: def.boss ? {
          phase: 'idle', wind: 0, dash: null, chargeCd: 3, slamCd: 5, slamsLeft: 0,
          summonCd: def.summon ? def.summon.every * 0.6 : 0, quakeDone: false
        } : null
      };
      // BOSS（泰坦 2.2 / 巨型泰坦 2.8）沿用步行者模型 × scale。
      root.scale.setScalar(stats.scale);
      this.buildBody(enemy, shape);
      this.game.world.scene.add(root);
      this.list.push(enemy);
      if (enemy.boss) {
        this.boss = enemy;
        this.runner.bossAlive = true;
      }
      root.updateMatrixWorld(true);
      return enemy;
    }

    groupPoint(group, def) {
      const world = this.game.world;
      const groups = world.spawnGroups || {};
      const allowed = (def && def.spawnPoints) || GROUND_GROUPS;
      const use = group && allowed.indexOf(group) >= 0 ? [group] : allowed;
      const pool = [];
      for (const g of use) for (const p of groups[g] || []) pool.push(p);
      if (!pool.length) pool.push(...(world.spawnPoints || []));
      const player = this.game.player.position;
      const candidates = pool.filter(p => Math.hypot(p.x - player.x, p.z - player.z) > 12);
      const set = candidates.length ? candidates : pool;
      return set[Math.floor(Math.random() * set.length)].clone();
    }

    spawnAt(position, entry) {
      // BOSS 半径按注册表 × scale，微调用它才能避免巨型泰坦卡进掩体。
      const def = this.defOf(entry);
      const radius = Math.max(0.48, def ? def.radius * ((def.boss && entry.bossScale) || 1) : 0.44);
      const clear = spot => this.game.world.canStand(spot.x, spot.z, radius) &&
        !this.list.some(e => !e.dead && e.root.position.distanceToSquared(spot) < 1);
      if (!clear(position)) {
        // 落点被高台/其他单位占住时向外螺旋找地面点，绝不把怪直接放进 3.2m 顶面里。
        let found = null;
        for (let i = 0; i < 20 && !found; i++) {
          const angle = i * 2.399963 + Math.random();
          const distance = 1.1 + i * 0.55;
          const next = position.clone().add(new T.Vector3(Math.cos(angle) * distance, 0, Math.sin(angle) * distance));
          if (clear(next)) found = next;
        }
        position = found || this.groupPoint(null, def);
      }
      return this.spawn(position, this.wave, entry);
    }

    spawnNext() {
      const entry = this.runner.take();
      if (!entry) return false;
      if (entry.legacy) { this.spawnNextLegacy(); return true; }
      this.spawnAt(this.groupPoint(entry.group, this.defOf(entry)), entry);
      this.runner.pending--;
      this.spawnTimer = Math.max(0.15, this.runner.cfg.interval);
      return true;
    }

    spawnNextLegacy() {
      const player = this.game.player.position;
      const points = this.game.world.spawnPoints;
      const candidates = points.filter(p => Math.hypot(p.x - player.x, p.z - player.z) > 12);
      const selected = candidates.length ? candidates : points;
      let position = selected[Math.floor(Math.random() * selected.length)].clone();
      for (let i = 0; i < 12; i++) {
        const next = position.clone().add(new T.Vector3((Math.random() - 0.5) * 2.8, 0, (Math.random() - 0.5) * 2.8));
        if (this.game.world.canStand(next.x, next.z, 0.48) && !this.list.some(e => !e.dead && e.root.position.distanceToSquared(next) < 1)) {
          position = next; break;
        }
      }
      // 旧模式：wave>=3 起每 4 只出一个 fast 变体，保持原玩法不变。
      this.spawn(position, this.wave, { fast: this.wave >= 3 && this.serial % 4 === 0 });
      this.runner.pending--;
    }

    damage(enemy, amount, point, direction, headshot, unitId = 0, weapon = '') {
      if (enemy.dead) return;
      // 暴君受步枪伤害 -20%；爆头仍然双倍（头部占 30% 体积，命中率不因减伤而豁免）。
      if (enemy.def && enemy.def.rifleResist && weapon === 'rifle' && !headshot) {
        amount *= 1 - enemy.def.rifleResist;
      }
      enemy.hp = Math.max(0, enemy.hp - amount);
      enemy.flash = 0.13;
      enemy.knock.copy(direction).setY(0).normalize().multiplyScalar(headshot ? 3.7 : 2.5);
      // 伤害记忆：+40 分，5 秒线性衰减；重复命中把剩余值滚存后重新计时。
      const now = this.game.time;
      const mem = enemy.aggro[unitId];
      const kept = mem ? mem.value * Math.max(0, 1 - (now - mem.at) / 5) : 0;
      enemy.aggro[unitId] = { value: kept + 40, at: now };
      this.game.effects.burst(point, 'blood', headshot ? 12 : 7);
      this.game.ui.hit(amount, point, headshot);
      this.game.audio.hit(headshot);
      if (enemy.hp > 0) return;
      enemy.dead = true;
      enemy.deathTime = 0.65;
      if (enemy.behavior.onDeath) enemy.behavior.onDeath(enemy, this.ctx);
      if (enemy.boss) {
        this.boss = null;
        this.runner.bossAlive = false;
        // M5 特殊武器箱：15/20 波泰坦击杀必掉，钩子由 game 侧挂载。
        if (this.onBossDeath) this.onBossDeath(enemy);
      }
      if (unitId === 0) {
        const points = Math.round((enemy.score || 100) * (headshot ? 1.5 : 1));
        this.game.score += points;
        this.game.kills++;
        if (headshot) this.game.headshots++;
        this.game.ui.kill(headshot, points);
        if (this.game.kills % 5 === 0) this.game.effects.drop(enemy.root.position, 'health');
        else if (this.game.kills % 3 === 0) this.game.effects.drop(enemy.root.position, 'ammo');
      } else {
        // 队友击杀：60% 团队分，不计玩家击杀数与爆头率，不驱动玩家掉落节奏。
        const member = this.game.squad && this.game.squad.members[unitId - 1];
        const points = Math.round((enemy.score || 100) * 0.6);
        this.game.score += points;
        this.game.squadKills++;
        this.game.ui.kill(false, points, `${member ? member.def.name : '队友'} · 队友击杀`);
      }
    }

    // 仇恨评分：15m 内距离反比 + 伤害记忆 40 分（5s 线性衰减）+ 玩家 bias 15；
    // 注册表 targetRule='nearest' 的敌种（膨胀体/裂魂者）直接追最近单位；
    // 'threat'（BOSS 践踏）追伤害记忆最深者，记忆全为 0 时按距离取最远的目标。
    chooseTarget(enemy, units) {
      const p = enemy.root.position, now = this.game.time;
      const rule = (enemy.def && enemy.def.targetRule) || 'aggro';
      let best = units[0], bestScore = -Infinity;
      for (const u of units) {
        const d = Math.hypot(u.position.x - p.x, u.position.z - p.z);
        const mem = enemy.aggro[u.id];
        const memory = mem ? mem.value * Math.max(0, 1 - (now - mem.at) / 5) : 0;
        let score = rule === 'nearest' ? -d
          : rule === 'threat' ? memory + d * 0.01
            : (d < 15 ? (15 - d) * 2 : 0) + memory + (u.isPlayer ? 15 : 0);
        // 冲顶自爆体优先咬高层目标：同层加成足以盖过十几米的地面队友。
        if (enemy.topRush && u.position.y > 1.2) score += 40;
        if (score > bestScore) { bestScore = score; best = u; }
      }
      enemy.targetId = best.id;
    }

    unitById(units, id) {
      for (const u of units) if (u.id === id) return u;
      return units[0];
    }

    swing(enemy, amount, victims, knock = 0, stagger = 0) {
      if (enemy.cooldown > 0) return false;
      enemy.cooldown = enemy.melee.cooldown;
      enemy.attack = enemy.melee.windup;
      const p = enemy.root.position;
      for (const u of victims) {
        // 先击退后伤害：命中同帧 player.damage 会开启 0.45s 无敌窗，反序会让裂魂者的 4m 击退失效。
        if (knock > 0) {
          u.knockback(u.position.x - p.x, u.position.z - p.z, knock, stagger);
        }
        u.takeDamage(amount);
      }
      this.game.audio.growl();
      return true;
    }

    // 膨胀体起爆：3m 半径 60 伤，对玩家与队友同值；不算击杀、不给分。
    detonate(enemy, ctx) {
      const blast = enemy.def.blast, p = enemy.root.position;
      ctx.game.effects.boom(p, blast.radius);
      ctx.game.audio.explosion();
      for (const u of ctx.units) {
        if (u.position === p) continue;
        if (Math.abs(u.position.y - p.y) > 2.2) continue;
        if (Math.hypot(u.position.x - p.x, u.position.z - p.z) > blast.radius + u.radius) continue;
        u.takeDamage(blast.damage);
      }
      enemy.fuse = 0;
      enemy.dead = true;
      enemy.deathTime = 0.2;
    }

    // BOSS 砸地：以自身为圆心的圆形 AoE，与膨胀体起爆同一套距离判定（不查视线）。
    area(enemy, radius, damage, ctx) {
      const p = enemy.root.position;
      ctx.game.effects.boom(p, radius);
      ctx.game.audio.explosion();
      for (const u of ctx.units) {
        // 砸地/起爆只波及同一层的单位：3.2m 车厢板挡住车顶上的玩家。
        if (Math.abs(u.position.y - p.y) > 2.2) continue;
        if (Math.hypot(u.position.x - p.x, u.position.z - p.z) > radius + u.radius) continue;
        u.takeDamage(damage);
      }
    }

    // 巨型泰坦震波：全场地击退，不造成伤害（§7）。
    quake(enemy, distance, ctx) {
      const p = enemy.root.position;
      ctx.game.effects.boom(p, 16, 0xffd9a0, 0.7);
      ctx.game.audio.explosion();
      for (const u of ctx.units) u.knockback(u.position.x - p.x, u.position.z - p.z, distance, 0);
    }

    // BOSS 召唤：优先在 BOSS 周围 5m 圈找落点，全被占时退回该敌种的随机刷点。
    summon(enemy, entries, ctx) {
      const world = this.game.world, p = enemy.root.position;
      for (const entry of entries) {
        const def = this.defOf(entry);
        let spot = null;
        for (let i = 0; i < 10 && !spot; i++) {
          const angle = Math.random() * Math.PI * 2;
          const x = p.x + Math.cos(angle) * 5, z = p.z + Math.sin(angle) * 5;
          if (!world.canStand(x, z, def.radius)) continue;
          if (this.list.some(e => !e.dead && Math.hypot(e.root.position.x - x, e.root.position.z - z) < e.radius + def.radius)) continue;
          spot = { x, z };
        }
        for (let i = 0; i < entry.count; i++) {
          this.spawnAt(spot ? new T.Vector3(spot.x, 0, spot.z) : this.groupPoint(null, def), entry);
        }
      }
      ctx.game.ui.toast(`${enemy.def.name} 召唤感染者`);
      ctx.game.audio.growl();
    }

    // 裂魂者闪现落点：沿接近方向回退，取第一个可站立且不与其他怪重叠的位置。
    blinkLanding(enemy, targetPosition) {
      const world = this.game.world, p = enemy.root.position;
      const dx = targetPosition.x - p.x, dz = targetPosition.z - p.z;
      const len = Math.hypot(dx, dz) || 1;
      const jump = Math.min(enemy.def.blink.distance, Math.max(0, len - enemy.def.blink.keep));
      if (jump < 1.5) return null;
      for (let f = 1; f > 0.2; f -= 0.1) {
        const x = p.x + dx / len * jump * f, z = p.z + dz / len * jump * f;
        if (!world.canStand(x, z, enemy.radius)) continue;
        if (this.list.some(e => e !== enemy && !e.dead && Math.hypot(e.root.position.x - x, e.root.position.z - z) < enemy.radius + e.radius)) continue;
        return { x, z };
      }
      return null;
    }

    update(dt) {
      const game = this.game, world = game.world;
      const units = DZ.allyUnits(game);
      for (const u of units) world.updateField(u.id, u.position, dt);
      // 冲顶自爆体另开一张友方层流场（id 前缀 'e'），否则地面层里没有通往车顶的格子。
      for (const e of this.list) {
        if (!e.topRush || e.dead) continue;
        world.updateField('e' + e.targetId, this.unitById(units, e.targetId).position, dt, world.navAlly);
      }
      const squad = game.squad;
      const runner = this.runner;
      runner.tick(dt);
      if (runner.cfg && runner.cfg.boss && !runner.bossSpawned) {
        runner.bossSpawned = true;
        const type = DZ.WAVES.TYPES[runner.cfg.bossType];
        const group = (runner.cfg.groups || ['北'])[0];
        // entry 带上投放组：冲顶自爆与巨型泰坦战场都按组启用。
        const entry = { type: runner.cfg.bossType, bossScale: type.scale, summon: runner.cfg.summon, group };
        this.spawnAt(this.groupPoint(group, this.defOf(entry)), entry);
      }
      this.spawnTimer -= dt;
      const cap = runner.dataDriven && runner.cfg ? (runner.cfg.maxAlive || 30) : 30;
      if (this.spawnTimer <= 0 && this.aliveCount() < cap) {
        if (this.spawnNext()) { /* 间隔由 spawnNext 按波配置设定 */ }
      }
      const ctx = this.ctx;
      ctx.units = units; ctx.dt = dt;
      for (let i = this.list.length - 1; i >= 0; --i) {
        if (game.state !== 'playing') break;
        const e = this.list[i];
        ctx.e = e;
        e.age += dt;
        if (e.dead) {
          e.deathTime -= dt;
          e.root.rotation.x = -(1 - Math.max(0, e.deathTime / 0.65)) * Math.PI * 0.47;
          e.root.scale.setScalar(e.scale * Math.max(0.001, e.deathTime / 0.65));
          if (e.deathTime <= 0) this.remove(i);
          continue;
        }
        e.flash = Math.max(0, e.flash - dt);
        e.skin.emissive.setHex(e.flash > 0 ? 0x8f2418 : 0x000000);
        e.cloth.emissive.setHex(e.flash > 0 ? 0x6d2014 : 0x000000);
        if (e.born > 0) {
          e.born = Math.max(0, e.born - dt);
          e.root.scale.setScalar(e.scale * Math.max(0.02, 1 - e.born / 0.45));
          continue;
        }
        e.cooldown = Math.max(0, e.cooldown - dt);
        e.attack = Math.max(0, e.attack - dt);
        const p = e.root.position;
        ctx.target = this.unitById(units, e.targetId);
        let dx = ctx.target.position.x - p.x, dz = ctx.target.position.z - p.z;
        ctx.distance = Math.hypot(dx, dz);
        e.root.rotation.y = Math.atan2(dx, dz);
        e.pathClock -= dt;
        if (e.pathClock <= 0) {
          this.chooseTarget(e, units);
          const next = this.unitById(units, e.targetId);
          if (next !== ctx.target) {
            ctx.target = next;
            dx = next.position.x - p.x; dz = next.position.z - p.z;
            ctx.distance = Math.hypot(dx, dz);
            e.root.rotation.y = Math.atan2(dx, dz);
          }
          e.direct = world.segmentClear(p, ctx.target.position, 0.48);
          e.pathClock = 0.3 + (e.id % 3) * 0.04;
        }
        if (e.behavior.think) e.behavior.think(e, ctx);
        if (e.dead) continue;
        const mv = e.behavior.move ? e.behavior.move(e, ctx) : defaultMove(e, ctx);
        let mx = mv[0], mz = mv[1];
        // 怪物互相分离，防止挤成一个碰撞体；地图碰撞始终由同一个移动函数处理。
        const separate = (opx, opz, orad) => {
          const ox = p.x - opx, oz = p.z - opz;
          const sep = (e.radius + orad) / 0.88;
          const d2 = ox * ox + oz * oz;
          if (d2 > 0.0001 && d2 < sep * sep) {
            const d = Math.sqrt(d2), push = (sep - d) * 2.7 / d;
            mx += ox * push; mz += oz * push;
          }
        };
        for (const other of this.list) {
          if (other === e || other.dead) continue;
          separate(other.root.position.x, other.root.position.z, other.radius);
        }
        if (squad) {
          for (const m of squad.members) {
            if (!m.dead) separate(m.root.position.x, m.root.position.z, m.radius);
          }
        }
        // 地面单位规则：脚底基准恒为 0，斜坡/车顶的 3.2m 顶面对怪物是墙（§5 高台安全）。
        // 冲顶自爆体是唯一的例外：以自己的脚底为基准，才沿得上去斜坡。
        world.move(p, (mx + e.knock.x) * dt, (mz + e.knock.z) * dt, e.radius, e.topRush ? p.y : 0);
        if (e.arena) {
          // §7 决战战场：巨型泰坦被压在火车南段 30m 内，越界就贴边滑行（不传送、不打断技能）。
          p.x = T.MathUtils.clamp(p.x, e.arena.minX, e.arena.maxX);
          p.z = T.MathUtils.clamp(p.z, e.arena.minZ, e.arena.maxZ);
        }
        world.settleY(p);
        e.knock.multiplyScalar(Math.exp(-10 * dt));
        if (e.behavior.attack) e.behavior.attack(e, ctx); else defaultAttack(e, ctx);
        const walk = Math.sin(e.age * e.speed * 4 + e.phase) * Math.min(0.5, Math.hypot(mx, mz) * 0.22);
        if (e.behavior.animate) e.behavior.animate(e, ctx, walk); else defaultAnimate(e, ctx, walk);
      }
    }

    remove(index) {
      const enemy = this.list[index];
      this.game.world.scene.remove(enemy.root);
      enemy.skin.dispose(); enemy.cloth.dispose();
      if (enemy.eyeMaterial) enemy.eyeMaterial.dispose();
      if (enemy.cape) enemy.cape.dispose();
      if (enemy.glowMat && enemy.glowMat !== enemy.skin) enemy.glowMat.dispose();
      this.list.splice(index, 1);
    }

    reset() {
      while (this.list.length) this.remove(0);
      this.spawnTimer = 0;
      this.serial = 0;
      this.boss = null;
      this.runner.cfg = null;
      // 菜单装饰怪在没有波次运行时生成，必须退回旧公式分支。
      this.runner.dataDriven = false;
      this.runner.queue = [];
      this.runner.pending = 0;
      this.runner.bossAlive = false;
    }
  };
})();
