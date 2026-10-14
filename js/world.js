(function () {
  'use strict';
  const DZ = window.DZ = window.DZ || {};
  if (!window.THREE) return;
  const T = THREE;

  // 脚下一步内允许抬升的高度：中央平台（0.35m）可以直接走上去，车厢/甲板（3.2m）只能靠斜坡上。
  const STEP_UP = 0.42;
  // 导航格子的通行半径：地面层与友方层共用，保证没有高度面时两层完全等价。
  const NAV_RADIUS = 0.56;

  DZ.World = class World {
    defMaterial(color, roughness = 0.85, metalness = 0.1) {
      return new T.MeshStandardMaterial({ color, roughness, metalness });
    }

    constructor(container) {
      this.scene = new T.Scene();
      this.camera = new T.PerspectiveCamera(75, innerWidth / innerHeight, 0.055, 260);
      this.camera.rotation.order = 'YXZ';
      this.scene.add(this.camera);
      this.renderer = new T.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
      this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
      this.renderer.setSize(innerWidth, innerHeight);
      this.renderer.outputColorSpace = T.SRGBColorSpace;
      this.renderer.toneMapping = T.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.12;
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = T.PCFSoftShadowMap;
      // 静态阴影只在换图时烘一次；怪物使用廉价的地面投影，避免逐帧重画整张阴影图。
      this.renderer.shadowMap.autoUpdate = false;
      container.appendChild(this.renderer.domElement);
      this.cube = new T.BoxGeometry(1, 1, 1);
      this.mat = {
        concrete: this.defMaterial(0x62685b), dark: this.defMaterial(0x303f35),
        steel: this.defMaterial(0x5b6559, 0.6, 0.6), rust: this.defMaterial(0x946b42),
        yellow: this.defMaterial(0xbaab64), pale: this.defMaterial(0x8f9980),
        black: this.defMaterial(0x202924), orange: this.defMaterial(0xa26038),
        green: this.defMaterial(0x586f54), roof: this.defMaterial(0x414d42)
      };
      this.paint = new T.MeshStandardMaterial({ color: 0xc5bc81, transparent: true, opacity: 0.6, roughness: 1 });
      // 两套地图按模式懒加载、各自独立缓存；构建期间 this.group/this.obstacles 指向当前 bag。
      this.maps = new Map();
      this.bag = null;
      this.group = new T.Group();
      this.obstacles = [];
      this.surfaces = [];
      this.blockers = [];
      this.bounds = { minX: -24, maxX: 24, minZ: -24, maxZ: 24 };
      this.dust = null;
      this.useMap(DZ.Settings && DZ.Settings.mode === 'practice' ? 'practice' : 'giant');
      this.menuView(0);
      this.scene.updateMatrixWorld(true);
      addEventListener('resize', () => {
        this.camera.aspect = innerWidth / innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(innerWidth, innerHeight);
      });
    }

    ensureMap(modeKey) {
      const key = modeKey === 'practice' ? 'practice' : 'giant';
      if (this.maps.has(key)) return this.maps.get(key);
      const bag = {
        key, group: new T.Group(), obstacles: [], surfaces: [], blockers: [],
        spawnPoints: [], spawnGroups: {}, revivePoints: {}
      };
      this.bag = bag;
      this.group = bag.group;
      this.obstacles = bag.obstacles;
      this.surfaces = bag.surfaces;
      this.blockers = bag.blockers;
      if (key === 'giant') this.buildGiant(bag); else this.buildPractice(bag);
      this.bounds = bag.bounds;
      bag.nav = this.buildNav();
      bag.navAlly = this.buildAllyNav();
      bag.group.updateMatrixWorld(true);
      this.bag = null;
      this.maps.set(key, bag);
      return bag;
    }

    // 切图时把另一套彻底移出 scene：visible=false 的子物体仍会被烘进静态阴影图。
    useMap(modeKey) {
      const bag = this.ensureMap(modeKey);
      if (this.bag === bag) return bag;
      if (this.bag) this.scene.remove(this.bag.group);
      this.bag = bag;
      this.group = bag.group;
      this.obstacles = bag.obstacles;
      this.surfaces = bag.surfaces;
      this.blockers = bag.blockers;
      this.spawnPoints = bag.spawnPoints;
      this.spawnGroups = bag.spawnGroups;
      this.revivePoints = bag.revivePoints;
      this.defensePost = bag.defensePost;
      this.bossArena = bag.bossArena;
      this.squadPosts = bag.squadPosts;
      this.squadStart = bag.squadStart;
      this.playerStart = bag.playerStart;
      this.menuDecor = bag.menuDecor;
      this.bounds = bag.bounds;
      this.nav = bag.nav;
      this.navAlly = bag.navAlly;
      this.dust = bag.dust;
      this.scene.background = new T.Color(bag.background);
      this.scene.fog = new T.FogExp2(bag.background, bag.fogDensity);
      this.scene.add(bag.group);
      this.resetNavigation();
      this.renderer.shadowMap.needsUpdate = true;
      return bag;
    }

    box(x, y, z, w, h, d, material, collision = false, shadow = true) {
      const mesh = new T.Mesh(this.cube, material);
      mesh.position.set(x, y, z);
      mesh.scale.set(w, h, d);
      mesh.castShadow = shadow;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      if (collision) {
        this.obstacles.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 });
        this.blockers.push(mesh);
      }
      return mesh;
    }

    // 可行走顶面：只挡视线（blocker）不挡平面通行，阻挡交给 floorAt 的台阶高度规则。
    platform(minX, maxX, minZ, maxZ, top, material, thickness = 0.3) {
      const mesh = this.box((minX + maxX) / 2, top - thickness / 2, (minZ + maxZ) / 2,
        maxX - minX, thickness, maxZ - minZ, material);
      this.blockers.push(mesh);
      this.surfaces.push({ minX, maxX, minZ, maxZ, y: top, kind: 'flat' });
      return mesh;
    }

    // 斜坡：zLow 端贴地、zHigh 端升到 top，表面是线性高度面（15° 时水平投影约 12m 抬 3.2m）。
    slope(minX, maxX, zLow, zHigh, top, material) {
      const run = Math.abs(zLow - zHigh);
      const angle = Math.atan2(top, run);
      const length = run / Math.cos(angle);
      const thickness = 0.42;
      const midZ = (zLow + zHigh) / 2;
      // zLow 在南侧（z 较大）时坡面朝 +z 下沉，对应 rotation.x 为正。
      const sign = zLow > zHigh ? 1 : -1;
      const mesh = new T.Mesh(this.cube, material);
      mesh.scale.set(maxX - minX, thickness, length);
      mesh.rotation.x = angle * sign;
      mesh.position.set((minX + maxX) / 2,
        top / 2 - Math.cos(angle) * thickness / 2,
        midZ - Math.sin(angle) * thickness / 2 * sign);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      this.blockers.push(mesh);
      for (const x of [minX + 0.14, maxX - 0.14]) {
        const rail = new T.Mesh(this.cube, this.mat.dark);
        rail.scale.set(0.16, 0.62, length);
        rail.position.set(x - (minX + maxX) / 2, thickness / 2 + 0.28, 0);
        mesh.add(rail);
      }
      for (let t = 0.08; t < 0.98; t += 0.075) {
        const grip = new T.Mesh(this.cube, this.mat.black);
        grip.scale.set((maxX - minX) * 0.9, 0.04, 0.1);
        grip.position.set(0, thickness / 2 + 0.02, length / 2 - t * length);
        mesh.add(grip);
      }
      this.surfaces.push({
        minX, maxX, minZ: Math.min(zLow, zHigh), maxZ: Math.max(zLow, zHigh),
        kind: 'ramp', y: top,
        ramp(x, z) { return T.MathUtils.clamp(top * (zLow - z) / (zLow - zHigh), 0, top); }
      });
      return mesh;
    }

    cylinder(x, y, z, radius, length, material, horizontal = false) {
      const mesh = new T.Mesh(new T.CylinderGeometry(radius, radius, length, 12), material);
      mesh.position.set(x, y, z);
      if (horizontal) mesh.rotation.z = Math.PI / 2;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      return mesh;
    }

    label(text, x, y, z, w, h, options = {}) {
      const canvas = document.createElement('canvas');
      canvas.width = 1024;
      canvas.height = 256;
      const ctx = canvas.getContext('2d');
      if (options.background) { ctx.fillStyle = options.background; ctx.fillRect(0, 0, 1024, 256); }
      ctx.fillStyle = options.color || '#d2d9b7';
      ctx.font = 'bold 145px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, 512, 137, 970);
      const texture = new T.CanvasTexture(canvas);
      texture.colorSpace = T.SRGBColorSpace;
      const mesh = new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshBasicMaterial({ map: texture, transparent: !options.background, side: T.DoubleSide, depthWrite: false }));
      mesh.position.set(x, y, z);
      mesh.rotation.y = options.rotation || 0;
      this.group.add(mesh);
      return mesh;
    }

    // ── 站立高度面 ────────────────────────────────────────────────
    floorAt(x, z) {
      let h = 0;
      for (const s of this.surfaces) {
        if (x < s.minX || x > s.maxX || z < s.minZ || z > s.maxZ) continue;
        const v = s.kind === 'ramp' ? s.ramp(x, z) : s.y;
        if (v > h) h = v;
      }
      return h;
    }

    surfaceY(position, offset = 0) {
      return this.floorAt(position.x, position.z) + offset;
    }

    canStand(x, z, radius = 0.43, fromY = 0) {
      const b = this.bounds;
      if (x < b.minX + radius || x > b.maxX - radius || z < b.minZ + radius || z > b.maxZ - radius) return false;
      for (const o of this.obstacles) {
        const dx = x - Math.max(o.minX, Math.min(o.maxX, x));
        const dz = z - Math.max(o.minZ, Math.min(o.maxZ, z));
        if (dx * dx + dz * dz < radius * radius) return false;
      }
      // 脚底先落在目标顶面上：脚下高度只取 max(来源, 目标)，斜坡每步只升高一点点，
      // 若按来源高度限位就会被自己的坡度当成墙。
      const here = this.floorAt(x, z);
      if (here > fromY + STEP_UP) return false;
      // 四周采样：脚底要被高出台阶限位的顶面顶住，就当撞上了墙/车厢侧壁。
      const k = radius * 0.72;
      const limit = Math.max(fromY, here) + STEP_UP;
      for (const [sx, sz] of [[k, 0], [-k, 0], [0, k], [0, -k]]) {
        if (this.floorAt(x + sx, z + sz) > limit) return false;
      }
      return true;
    }

    // fromY 显式传 0 就是"地面单位"规则：只能踏上 STEP_UP 以内的顶面，斜坡与车顶不对怪物开放。
    move(position, dx, dz, radius, fromY = position.y || 0) {
      const b = this.bounds;
      const limitX = (b.maxX - b.minX) / 2 - radius;
      const limitZ = (b.maxZ - b.minZ) / 2 - radius;
      const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
      const x = T.MathUtils.clamp(position.x + dx, cx - limitX, cx + limitX);
      if (this.canStand(x, position.z, radius, fromY)) position.x = x;
      const z = T.MathUtils.clamp(position.z + dz, cz - limitZ, cz + limitZ);
      if (this.canStand(position.x, z, radius, fromY)) position.z = z;
    }

    // 视线/贴地通道检测：以线两端较低的脚底高度为准，站在车顶不会被地面怪物"看穿"车厢。
    segmentClear(a, b, radius = 0.47) {
      const fromY = Math.min(a.y || 0, b.y || 0);
      const distance = Math.hypot(b.x - a.x, b.z - a.z);
      const steps = Math.ceil(distance / 0.4);
      for (let i = 1; i < steps; i++) {
        const t = i / steps;
        if (!this.canStand(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t, radius, fromY)) return false;
      }
      return true;
    }

    // 把单位贴到所在顶面的高度上（玩家用带重力的版本，怪物/队友直接吸附）。
    settleY(position) {
      position.y = this.floorAt(position.x, position.z);
      return position.y;
    }

    buildNav() {
      const b = this.bounds;
      const w = Math.round(b.maxX - b.minX);
      const h = Math.round(b.maxZ - b.minZ);
      const blocked = new Uint8Array(w * h);
      for (let z = 0; z < h; z++) for (let x = 0; x < w; x++) {
        blocked[z * w + x] = this.canStand(b.minX + x + 0.5, b.minZ + z + 0.5, NAV_RADIUS) ? 0 : 1;
      }
      // 仇恨系统需要多个目标流场（玩家 + 队友群 + 队友各自的目标点），按 id 缓存、各自 0.3s 节流。
      return { w, h, minX: b.minX, minZ: b.minZ, blocked, queue: new Int16Array(w * h) };
    }

    // 友方导航层：允许沿台阶爬升（斜坡→装载甲板→车顶），但绝不许跨越悬崖。
    // 怪物仍走 buildNav 的地面层，高台对它们依旧是墙。
    buildAllyNav() {
      const b = this.bounds;
      const w = Math.round(b.maxX - b.minX), h = Math.round(b.maxZ - b.minZ), size = w * h;
      const open = new Uint8Array(size), floors = new Float32Array(size);
      const reachable = new Uint8Array(size), queue = new Int16Array(size);
      let read = 0, write = 0;
      for (let z = 0; z < h; z++) for (let x = 0; x < w; x++) {
        const i = z * w + x;
        const cx = b.minX + x + 0.5, cz = b.minZ + z + 0.5;
        const y = this.floorAt(cx, cz);
        floors[i] = y;
        // 通行半径与地面层一致（0.56）：没有高度面的旧图上两层必须完全等价。
        if (!this.canStand(cx, cz, NAV_RADIUS, y)) continue;
        open[i] = 1;
        // 只有地面层可达的格子作为源点，高台必须靠台阶链连出来。
        if (this.canStand(cx, cz, NAV_RADIUS, 0)) { reachable[i] = 1; queue[write++] = i; }
      }
      while (read < write) {
        const i = queue[read++], x = i % w, z = Math.floor(i / w);
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, nz = z + dz;
          if (nx < 0 || nx >= w || nz < 0 || nz >= h) continue;
          const ni = nz * w + nx;
          if (!open[ni] || reachable[ni] || Math.abs(floors[ni] - floors[i]) > STEP_UP) continue;
          reachable[ni] = 1;
          queue[write++] = ni;
        }
      }
      const blocked = new Uint8Array(size);
      for (let i = 0; i < size; i++) blocked[i] = reachable[i] ? 0 : 1;
      // 把高度与边规则带到运行时：nextStep 也要按同一套台阶限位挑格子，否则单位会顶着悬崖流场走。
      return { w, h, minX: b.minX, minZ: b.minZ, blocked, queue: new Int16Array(size), floors, maxStep: STEP_UP };
    }

    resetNavigation() { this.fields = new Map(); }

    // 流场绑定各自的导航层：怪物用 only-ground 的 nav，友方与冲顶单位用 navAlly。
    field(id, grid = this.nav, create = true) {
      let f = this.fields.get(id);
      if (!f && create) {
        f = { grid, dist: new Int16Array(grid.w * grid.h).fill(-1), clock: 0, cell: -1 };
        this.fields.set(id, f);
      }
      return f;
    }

    cell(position, nav = this.nav) {
      const x = T.MathUtils.clamp(Math.floor(position.x - nav.minX), 0, nav.w - 1);
      const z = T.MathUtils.clamp(Math.floor(position.z - nav.minZ), 0, nav.h - 1);
      return z * nav.w + x;
    }

    updateField(id, position, dt, grid = this.nav) {
      const nav = grid;
      const f = this.field(id, nav);
      f.clock -= dt;
      const target = this.cell(position, nav);
      if (f.clock > 0 && target === f.cell) return;
      f.clock = 0.3;
      f.cell = target;
      let seed = target;
      if (nav.blocked[seed]) {
        let best = Infinity;
        for (let i = 0; i < nav.blocked.length; ++i) {
          if (nav.blocked[i]) continue;
          const d = (i % nav.w - target % nav.w) ** 2 + (Math.floor(i / nav.w) - Math.floor(target / nav.w)) ** 2;
          if (d < best) { best = d; seed = i; }
        }
      }
      // 一张共享流场替代每只怪物单独寻路，45 只怪物同屏也只需一次广度优先搜索。
      const distances = f.dist;
      distances.fill(-1);
      distances[seed] = 0;
      let read = 0, write = 0;
      nav.queue[write++] = seed;
      while (read < write) {
        const i = nav.queue[read++], x = i % nav.w, z = Math.floor(i / nav.w);
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, nz = z + dz;
          if (nx < 0 || nx >= nav.w || nz < 0 || nz >= nav.h) continue;
          const ni = nz * nav.w + nx;
          if (nav.blocked[ni] || distances[ni] >= 0) continue;
          // 友方层带高度：流场只能沿 buildAllyNav 认可的台阶边扩散，否则梯度会把单位推向悬崖。
          if (nav.floors && Math.abs(nav.floors[ni] - nav.floors[i]) > nav.maxStep) continue;
          distances[ni] = distances[i] + 1;
          nav.queue[write++] = ni;
        }
      }
    }

    nextStep(id, position) {
      const f = this.fields.get(id);
      if (!f) return { x: position.x, z: position.z };
      const nav = f.grid || this.nav;
      const distances = f.dist;
      const cell = this.cell(position, nav), x = cell % nav.w, z = Math.floor(cell / nav.w);
      let best = cell, score = distances[cell];
      if (score < 0) score = 32767;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, nz = z + dz;
        if (nx < 0 || nx >= nav.w || nz < 0 || nz >= nav.h) continue;
        const index = nz * nav.w + nx;
        if (distances[index] < 0) continue;
        // 梯度也要守台阶限位：隔壁格子可能绕斜坡才够得着，直接走过去就是撞悬崖。
        if (nav.floors && Math.abs(nav.floors[index] - nav.floors[cell]) > nav.maxStep) continue;
        if (distances[index] < score) { best = index; score = distances[index]; }
      }
      return { x: nav.minX + best % nav.w + 0.5, z: nav.minZ + Math.floor(best / nav.w) + 0.5 };
    }

    // ── 刷怪点 / 复活点标记（两套图共用）────────────────────────────
    markSpawns(points) {
      for (const p of points) {
        const glow = new T.MeshBasicMaterial({ color: 0xc6ec8a, transparent: true, opacity: 0.32, side: T.DoubleSide, depthWrite: false });
        const ring = new T.Mesh(new T.RingGeometry(1.1, 1.25, 32), glow);
        ring.rotation.x = -Math.PI / 2;
        ring.position.copy(p);
        ring.position.y = this.floorAt(p.x, p.z) + 0.025;
        this.group.add(ring);
        const y = this.floorAt(p.x, p.z) + 0.02;
        this.box(p.x, y, p.z, 0.15, 0.02, 1.4, this.mat.yellow, false, false);
        this.box(p.x, y, p.z, 1.4, 0.02, 0.15, this.mat.yellow, false, false);
      }
    }

    markRevivePoints(points) {
      const pad = new T.MeshBasicMaterial({ color: 0x7fd6e8, transparent: true, opacity: 0.24, side: T.DoubleSide, depthWrite: false });
      for (const list of Object.values(points)) {
        for (const p of list) {
          const ring = new T.Mesh(new T.RingGeometry(0.7, 0.86, 24), pad);
          ring.rotation.x = -Math.PI / 2;
          ring.position.set(p.x, this.floorAt(p.x, p.z) + 0.024, p.z);
          this.group.add(ring);
        }
      }
    }

    container(x, z, w, h, d, mat, text) {
      this.box(x, h / 2, z, w, h, d, mat, true);
      this.box(x, h + 0.08, z, w + 0.1, 0.16, d + 0.1, this.mat.dark);
      for (const side of [-1, 1]) {
        for (let i = 0.2; i < w; i += 0.36) this.box(x - w / 2 + i, h / 2, z + side * (d / 2 + 0.025), 0.07, h - 0.2, 0.09, mat);
        for (let i = 0.2; i < d; i += 0.48) this.box(x + side * (w / 2 + 0.025), h / 2, z - d / 2 + i, 0.09, h - 0.2, 0.07, mat);
        this.box(x + side * (w / 2 - 0.12), h / 2, z + d / 2 + 0.1, 0.15, h, 0.16, this.mat.dark);
      }
      this.label(text, x, h * 0.62, z + d / 2 + 0.13, w * 0.85, 0.58);
      this.label('07', x + w / 2 + 0.1, h * 0.6, z, d * 0.45, h * 0.46, { rotation: Math.PI / 2, color: '#bac6a0' });
    }

    crate(x, z, size) {
      const m = this.mat;
      this.box(x, size / 2, z, size, size, size, m.rust, true);
      for (const dx of [-size * 0.37, size * 0.37]) {
        this.box(x + dx, size / 2, z + size / 2 + 0.012, 0.1, size, 0.025, m.dark);
        this.box(x + dx, size + 0.012, z, 0.1, 0.025, size, m.dark);
      }
    }

    barrels(list) {
      const m = this.mat;
      for (const [x, z] of list) {
        this.cylinder(x, 0.7, z, 0.47, 1.4, m.rust);
        this.obstacles.push({ minX: x - 0.47, maxX: x + 0.47, minZ: z - 0.47, maxZ: z + 0.47 });
        this.blockers.push(this.group.children[this.group.children.length - 1]);
        this.cylinder(x, 0.96, z, 0.48, 0.11, m.black);
        this.cylinder(x, 0.38, z, 0.48, 0.11, m.black);
      }
    }

    groundPlane(size, repeat) {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 256;
      const c = canvas.getContext('2d');
      c.fillStyle = '#767b68'; c.fillRect(0, 0, 256, 256);
      for (let i = 0; i < 14000; i++) {
        const v = 85 + Math.random() * 60;
        c.fillStyle = `rgba(${v},${v + 3},${v - 9},.3)`;
        c.fillRect(Math.random() * 256, Math.random() * 256, 1 + Math.random() * 2, 1);
      }
      c.strokeStyle = '#454e4340'; c.lineWidth = 1;
      c.strokeRect(0.5, 0.5, 255, 255);
      const texture = new T.CanvasTexture(canvas);
      texture.wrapS = texture.wrapT = T.RepeatWrapping;
      texture.repeat.set(repeat, repeat);
      texture.colorSpace = T.SRGBColorSpace;
      texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
      const ground = new T.Mesh(new T.PlaneGeometry(size, size), new T.MeshStandardMaterial({ map: texture, roughness: 0.97 }));
      ground.rotation.x = -Math.PI / 2;
      ground.receiveShadow = true;
      this.group.add(ground);
      this.blockers.push(ground);
      return ground;
    }

    buildDust(count, spanX, spanZ) {
      const points = new Float32Array(count * 3);
      for (let i = 0; i < points.length; i += 3) {
        points[i] = (Math.random() - 0.5) * spanX;
        points[i + 1] = Math.random() * 13;
        points[i + 2] = (Math.random() - 0.5) * spanZ;
      }
      const geo = new T.BufferGeometry();
      geo.setAttribute('position', new T.BufferAttribute(points, 3));
      const dust = new T.Points(geo, new T.PointsMaterial({ color: 0xe1e7ad, size: 0.045, transparent: true, opacity: 0.48, depthWrite: false }));
      this.group.add(dust);
      return dust;
    }

    // ── 隔离区 07 · 48×48 练习图（M4 之前原样保留）───────────────────
    buildPractice(bag) {
      const m = this.mat;
      bag.bounds = { minX: -24, maxX: 24, minZ: -24, maxZ: 24 };
      bag.background = 0x859281;
      bag.fogDensity = 0.019;
      bag.menuCam = { pos: [29, 18.5, 31], look: [-2.5, 1, -4.5], fov: 56 };
      bag.playerStart = new T.Vector3(0, 0, 14);
      bag.squadStart = new T.Vector3(-2.4, 0, 11);
      bag.menuDecor = [[-2.5, 2, 0.45], [4, -4, 1.3], [-16, 12, -0.4], [5, 17, 0.1]];
      bag.spawnPoints = [new T.Vector3(-20, 0, -19), new T.Vector3(0, 0, -21),
        new T.Vector3(20, 0, -18), new T.Vector3(-21, 0, 12),
        new T.Vector3(21, 0, 13), new T.Vector3(0, 0, 21)];
      // 练习图沿用 waves.js 时代的下标分组：西/东/北/顶。
      bag.spawnGroups = {
        西: [bag.spawnPoints[0], bag.spawnPoints[3]],
        东: [bag.spawnPoints[2], bag.spawnPoints[4]],
        北: [bag.spawnPoints[1]],
        顶: [bag.spawnPoints[5]]
      };
      bag.revivePoints = {
        A: [new T.Vector3(-5, 0, 18), new T.Vector3(5, 0, 18)],
        B: [new T.Vector3(-3, 0, 4), new T.Vector3(3, 0, 4)],
        C: [new T.Vector3(-6, 0, -12), new T.Vector3(6, 0, -12)]
      };
      bag.defensePost = new T.Vector3(0, 0, 6);
      bag.squadPosts = [new T.Vector3(-15, 0, -9), new T.Vector3(0, 0, 4), new T.Vector3(15.5, 0, -7.5)];

      {
        this.group.add(new T.HemisphereLight(0xdce6c8, 0x3c4834, 2.25));
        const sun = new T.DirectionalLight(0xffe7b0, 3.15);
        sun.position.set(-18, 35, 12);
        sun.castShadow = true;
        Object.assign(sun.shadow.camera, { left: -36, right: 36, top: 36, bottom: -36, near: 1, far: 90 });
        sun.shadow.mapSize.set(2048, 2048);
        sun.shadow.bias = -0.0006;
        sun.shadow.normalBias = 0.06;
        this.group.add(sun);
        const gateLight = new T.PointLight(0xd2ff88, 22, 13, 2);
        gateLight.position.set(0, 4, -19);
        this.group.add(gateLight);
      }

      this.groundPlane(160, 22);
      for (const x of [-17, 17]) this.box(x, 0.012, 0, 0.12, 0.015, 43, this.paint, false, false);
      for (let z = -17; z <= 20; z += 3) this.box(0, 0.014, z, 0.12, 0.018, 1.3, this.paint, false, false);
      for (const z of [-12, 12]) {
        this.box(0, 0.016, z, 12, 0.018, 0.13, this.paint, false, false);
        for (let i = 0; i < 9; i++) this.box(-5.4 + i * 1.35, 0.016, z + 0.9, 0.7, 0.018, 0.8, this.paint, false, false);
      }

      this.box(0, 2.4, -24.6, 50, 4.8, 1.2, m.concrete, true);
      this.box(0, 2.4, 24.6, 50, 4.8, 1.2, m.concrete, true);
      this.box(-24.6, 2.4, 0, 1.2, 4.8, 48, m.concrete, true);
      this.box(24.6, 2.4, 0, 1.2, 4.8, 48, m.concrete, true);
      for (let i = -24; i <= 24; i += 6) {
        this.box(i, 2.6, -23.93, 0.35, 5.2, 0.35, m.pale);
        this.box(i, 2.6, 23.93, 0.35, 5.2, 0.35, m.pale);
        this.box(-23.93, 2.6, i, 0.35, 5.2, 0.35, m.pale);
        this.box(23.93, 2.6, i, 0.35, 5.2, 0.35, m.pale);
      }
      for (const z of [-24, 24]) this.box(0, 5.05, z, 48, 0.09, 0.12, m.black);
      for (const x of [-24, 24]) this.box(x, 5.05, 0, 0.12, 0.09, 48, m.black);
      this.container(-10, -4.5, 5.3, 3.3, 11, m.orange, 'CARGO / 024');
      this.container(10.5, -0.5, 5.5, 3.35, 10, m.green, 'B-07');
      this.container(14, -13.8, 10, 3.2, 4, m.steel, 'QUARANTINE');
      this.container(-14, -16, 9, 3.2, 4, m.green, '07 / HAZARD');
      this.box(-7, 0.67, 9, 5, 1.34, 1.1, m.concrete, true);
      this.box(6.5, 0.67, 11, 4, 1.34, 1.1, m.concrete, true);
      this.box(1.5, 0.67, -8, 4.5, 1.34, 1.1, m.concrete, true);
      for (const [x, z] of [[-7, 9], [6.5, 11], [1.5, -8]]) {
        this.box(x, 1.37, z, 4, 0.1, 1.18, m.yellow);
        for (let k = -1; k <= 1; k++) this.box(x + k * 1.1, 0.68, z + 0.56, 0.4, 0.85, 0.02, m.yellow, false, false);
      }
      this.crate(-15, 8, 1.6);
      this.crate(-17, 7, 1.3);
      this.crate(16.2, 8.5, 1.7);
      this.crate(-3.8, -16.5, 1.55);
      this.crate(-5.3, -17.5, 1.4);
      this.barrels([[18, -7], [19.1, -7], [-17, 0], [-18, 0.3]]);
      this.markSpawns(bag.spawnPoints);
      this.markRevivePoints(bag.revivePoints);
      for (const [i, p] of bag.spawnPoints.slice(0, 3).entries()) this.label('ENTRY 0' + (i + 1), p.x, 2.3, -23.9, 3.4, 0.65);
      this.label('DANGER  /  KEEP OUT', 0, 3.5, 23.91, 9, 1, { rotation: Math.PI, color: '#d7c58c' });
      this.label('SECTOR 07', 23.91, 3.5, 3, 9, 1.3, { rotation: -Math.PI / 2 });

      this.box(0, 6.5, -30, 38, 13, 9, m.dark);
      this.box(0, 13.1, -30, 39, 0.3, 10, m.roof);
      for (let x = -18; x < 19; x += 1.3) this.box(x, 7, -25.43, 0.08, 11, 0.16, m.steel);
      for (const x of [-12, 0, 12]) {
        this.box(x, 4.2, -25.25, 6.8, 7.8, 0.3, m.black);
        for (let j = 0; j < 16; ++j) this.box(x, 0.4 + j * 0.48, -25.05, 6.6, 0.03, 0.06, m.steel);
        this.box(x, 8.35, -24.95, 7.4, 0.22, 0.6, m.yellow);
      }
      this.label('SECTOR 07', 1, 10.5, -25.25, 16, 2.4, { color: '#c9d3b2' });
      this.label('BIOHAZARD / RESTRICTED ACCESS', 1, 8.9, -24.93, 12, 0.5, { color: '#bea776' });
      for (const x of [-17, 18]) {
        this.cylinder(x, 10, -30, 0.8, 21, m.steel);
        this.cylinder(x, 13.7, -30, 0.86, 0.7, m.rust);
        this.cylinder(x, 19.7, -30, 0.86, 0.7, m.rust);
      }
      this.box(-32, 4, -5, 13, 8, 27, m.dark);
      this.box(33, 5.5, -7, 15, 11, 22, m.steel);
      for (let i = 0; i < 5; i++) {
        this.box(25.45, 8, -15 + i * 3.4, 0.08, 2.2, 2.1, m.black);
        this.box(-25.45, 5.5, -14 + i * 4, 0.08, 1.6, 2.3, m.pale);
      }
      this.cylinder(-25.4, 7, 0, 0.32, 45, m.rust);
      for (const x of [-21, 21]) {
        for (const z of [-20, 20]) {
          this.cylinder(x, 4.5, z, 0.09, 9, m.dark);
          this.box(x, 8.9, z, 1.4, 0.2, 0.6, m.black);
          this.box(x, 8.77, z, 1.22, 0.03, 0.5, new T.MeshBasicMaterial({ color: 0xf5efb9 }), false, false);
        }
      }
      for (let i = 0; i < 13; i++) {
        const x = -65 + i * 10;
        this.box(x, 5 + (i % 4) * 1.5, -57 - (i % 3) * 5, 6 + i % 3, 10 + (i % 4) * 3, 7, m.dark);
      }
      const cablePoints = [];
      for (let i = 0; i <= 24; ++i) cablePoints.push(new T.Vector3(-24 + i * 2, 11 - Math.sin(i / 24 * Math.PI) * 2.8, -19));
      this.group.add(new T.Line(new T.BufferGeometry().setFromPoints(cablePoints), new T.LineBasicMaterial({ color: 0x283b29 })));
      bag.dust = this.buildDust(210, 48, 48);
    }

    // ── 巨人城 · 96×48 长图（§3 三段式）─────────────────────────────
    buildGiant(bag) {
      const m = this.mat;
      bag.bounds = { minX: -24, maxX: 24, minZ: -48, maxZ: 48 };
      bag.background = 0x7d8a7c;
      bag.fogDensity = 0.0115;
      bag.menuCam = { pos: [26, 15, 50], look: [-2, 2.5, 26], fov: 58 };
      bag.playerStart = new T.Vector3(0, 0, 36);
      bag.squadStart = new T.Vector3(-6, 0, 32);
      bag.menuDecor = [[-4, 30, 0.45], [5, 26, 1.3], [-13, 36, -0.4], [11, 39, 0.1]];
      // 三条进攻路线的入口：西/东墙各开一个通道口，北墙中间是 25 波后启用的第三路。
      bag.spawnGroups = {
        西: [new T.Vector3(-21, 0, -32), new T.Vector3(-21, 0, -22)],
        东: [new T.Vector3(21, 0, -32), new T.Vector3(21, 0, -22)],
        北: [new T.Vector3(-4, 0, -45), new T.Vector3(4, 0, -45)],
        顶: [new T.Vector3(-6.5, 0, 25.5), new T.Vector3(6.5, 0, 25.5)],
        // 巨型泰坦战场（南段开阔区）：两个刷点都在战场范围内，且离火车/掩体 ≥1.3m。
        南: [new T.Vector3(-6, 0, 30), new T.Vector3(6, 0, 30)]
      };
      bag.spawnPoints = ['西', '东', '北', '顶', '南'].reduce((all, g) => all.concat(bag.spawnGroups[g]), []);
      bag.revivePoints = {
        A: [new T.Vector3(-7, 0, 38), new T.Vector3(7, 0, 38)],
        B: [new T.Vector3(-3.5, 0, -21.5), new T.Vector3(3.5, 0, -21.5)],
        C: [new T.Vector3(-2.5, 0, 22), new T.Vector3(2.5, 0, 22)]
      };
      bag.defensePost = new T.Vector3(0, 0.35, -26);
      // §7 巨型泰坦决战战场：火车南段开阔区，南北正好 30m（含斜坡脚下与出发区前沿）。
      bag.bossArena = { minX: -22, maxX: 22, minZ: 14, maxZ: 44 };
      // 尖刀守西通道口、盾卫守中央平台南缘、游骑兵守火车车顶（§4 默认岗位，需要 navAlly 才上得去）。
      bag.squadPosts = [new T.Vector3(-20.5, 0, -26), new T.Vector3(-3, 0.35, -23), new T.Vector3(0, 3.2, -2)];

      this.buildGiantLights();
      this.groundPlane(240, 34);
      this.buildGiantWalls();
      this.buildGiantPlatform();
      this.buildGiantTrain();
      this.buildGiantCover();
      this.buildGiantStaging();
      this.markSpawns(bag.spawnPoints);
      this.markRevivePoints(bag.revivePoints);
      this.buildGiantBackdrop();
      bag.dust = this.buildDust(340, 48, 96);
    }

    buildGiantLights() {
      const m = this.mat;
      this.group.add(new T.HemisphereLight(0xd9e4c6, 0x3a4633, 2.1));
      const sun = new T.DirectionalLight(0xffe3a8, 3.05);
      sun.position.set(-34, 52, 28);
      sun.castShadow = true;
      // 96m 纵深 + 侧向仓库：阴影取景框按整张长图放宽，南北两端才都有落地阴影。
      Object.assign(sun.shadow.camera, { left: -46, right: 46, top: 74, bottom: -74, near: 1, far: 160 });
      sun.shadow.mapSize.set(2048, 2048);
      sun.shadow.bias = -0.0007;
      sun.shadow.normalBias = 0.07;
      this.group.add(sun);
      for (const [x, y, z, color, intensity, distance] of [
        [0, 4.6, -45, 0xd2ff88, 26, 15], [-23.6, 4.6, -29, 0xd2ff88, 20, 13], [23.6, 4.6, -29, 0xd2ff88, 20, 13],
        [0, 4.6, -28, 0xffd9a0, 24, 20], [0, 4.6, 36, 0xa8d8ff, 20, 18],
        // 火车南端作业灯：斜坡与装载甲板是冲顶/上顶的主战场，需要独立的暖光读清高低差。
        [0, 7.2, 18, 0xffcf92, 30, 26]
      ]) {
        const light = new T.PointLight(color, intensity, distance, 2);
        light.position.set(x, y, z);
        this.group.add(light);
      }
      // 地面标线：两条通道中心线 + 平台与出发区的停车位框。
      for (const x of [-20, 20]) this.box(x, 0.012, -6, 0.12, 0.015, 74, this.paint, false, false);
      for (let z = -40; z <= 40; z += 4) for (const x of [-20, 20]) this.box(x, 0.014, z, 0.12, 0.018, 1.4, this.paint, false, false);
    }

    buildGiantWalls() {
      const m = this.mat;
      const wall = (x, z, w, d) => this.box(x, 2.4, z, w, 4.8, d, m.concrete, true);
      // 北墙中间留 12m 宽的北通道口，西/东墙各留 8m 宽的通道口。
      wall(-16, -48.6, 20, 1.2);
      wall(16, -48.6, 20, 1.2);
      wall(0, 48.6, 50, 1.2);
      wall(-24.6, -41, 1.2, 16);
      wall(-24.6, 12, 1.2, 74);
      wall(24.6, -41, 1.2, 16);
      wall(24.6, 12, 1.2, 74);
      for (let z = -46; z <= 46; z += 8) {
        this.box(-23.93, 2.6, z, 0.35, 5.2, 0.35, m.pale);
        this.box(23.93, 2.6, z, 0.35, 5.2, 0.35, m.pale);
      }
      for (let x = -22; x <= 22; x += 8) {
        this.box(x, 2.6, -47.93, 0.35, 5.2, 0.35, m.pale);
        this.box(x, 2.6, 47.93, 0.35, 5.2, 0.35, m.pale);
      }
      for (const z of [-48, 48]) this.box(0, 5.05, z, 50, 0.09, 0.12, m.black);
      for (const x of [-24, 24]) this.box(x, 5.05, 0, 0.12, 0.09, 97, m.black);
      // 三个通道口：侧柱 + 门楣 + 洞内暗面，读起来像"怪物从这里进来"。
      const gate = (x, z, alongX) => {
        const span = alongX ? 12 : 8;
        const t = 1.6;
        if (alongX) {
          for (const side of [-1, 1]) this.box(x + side * (span / 2 + 0.6), 2.7, z, 1.2, 5.4, 2.2, m.pale, true);
          this.box(x, 5.4, z, span + 3.2, 0.6, 2.4, m.yellow);
          this.box(x, 2.3, z - 0.9, span, 4.6, 0.5, m.black, false, false);
        } else {
          for (const side of [-1, 1]) this.box(x, 2.7, z + side * (span / 2 + 0.6), 2.2, 5.4, 1.2, m.pale, true);
          this.box(x, 5.4, z, 2.4, 0.6, span + 3.2, m.yellow);
          this.box(x + (x > 0 ? -0.9 : 0.9), 2.3, z, 0.5, 4.6, span, m.black, false, false);
        }
      };
      gate(0, -48.6, true);
      gate(-24.6, -29, false);
      gate(24.6, -29, false);
      this.label('NORTH GATE / 03', 0, 3.6, -47.9, 8, 0.9, { rotation: 0, color: '#c9d3b2' });
      this.label('WEST GATE / 01', -23.9, 3.6, -20, 8, 0.9, { rotation: Math.PI / 2, color: '#c9d3b2' });
      this.label('EAST GATE / 02', 23.9, 3.6, -20, 8, 0.9, { rotation: -Math.PI / 2, color: '#c9d3b2' });
      this.label('STAGING AREA / 出发区', 0, 3.5, 47.9, 12, 1.2, { rotation: Math.PI, color: '#d7c58c' });
    }

    buildGiantPlatform() {
      const m = this.mat;
      // 中央平台：0.35m 高的集结台，可以直接走上去，四根断柱是绕泰坦冲刺的掩体。
      this.platform(-8, 8, -36, -20, 0.35, m.concrete, 0.4);
      for (const x of [-8, 8]) this.box(x, 0.37, -28, 0.34, 0.05, 16, m.yellow, false, false);
      for (const z of [-36, -20]) this.box(0, 0.37, z, 16, 0.05, 0.34, m.yellow, false, false);
      for (let i = 0; i < 5; i++) this.box(-5 + i * 2.5, 0.365, -28.6, 1.6, 0.04, 0.16, m.black, false, false);
      for (const [x, z] of [[-6, -34], [6, -34], [-6, -22], [6, -22]]) {
        this.box(x, 1.65, z, 1.05, 2.6, 1.05, m.pale, true);
        this.box(x, 0.28, z, 1.5, 0.56, 1.5, m.concrete);
        this.box(x, 3.02, z, 1.24, 0.14, 1.24, m.dark);
        this.box(x, 2.2, z + 0.56, 0.5, 0.12, 0.02, m.yellow, false, false);
      }
      this.label('CENTRAL PLATFORM', 0, 2.2, -19.85, 9, 0.6, { color: '#b6c39c' });
      this.box(-12, 0.67, -40, 5, 1.34, 1.1, m.concrete, true);
      this.box(12, 0.67, -40, 4, 1.34, 1.1, m.concrete, true);
      this.box(0, 0.67, -43, 6, 1.34, 1.1, m.concrete, true);
    }

    buildGiantTrain() {
      const m = this.mat;
      // 车厢：车顶 3.2m 可行走，地面被台阶高度规则挡住——想上顶必须走南端两条 15° 斜坡。
      this.platform(-4, 4, -14, 10, 3.2, m.steel, 2.5);
      this.box(0, 0.35, -2, 7.4, 0.7, 23.6, m.black);
      for (const side of [-1, 1]) {
        for (let z = -13.4; z <= 9.4; z += 0.92) this.box(side * 4.04, 1.85, z, 0.07, 2.3, 0.22, m.dark, false, false);
        for (let z = -11.5; z <= 8; z += 3.1) this.box(side * 4.1, 2.35, z, 0.05, 0.95, 1.5, m.black, false, false);
        this.box(side * 4.02, 3.16, -2, 0.1, 0.12, 23.8, m.rust, false, false);
      }
      for (let z = -12; z <= 8; z += 4) this.box(0, 3.05, z, 8.06, 0.2, 0.5, m.dark, false, false);
      for (const [x, z] of [[-3.2, -9], [3.2, -6], [-3.2, 1], [3.2, 5]]) this.box(x, 3.3, z, 0.8, 0.16, 0.8, m.black, false, false);
      for (const x of [-3.7, 3.7]) this.box(x, 3.23, -2, 0.26, 0.05, 23.4, m.yellow, false, false);
      this.label('T-00 FREIGHT / 车顶禁入', 0, 2.4, 10.15, 7, 0.55, { color: '#d7c58c' });
      // 车头残骸：实心障碍，不可上顶。
      this.box(0, 1.9, -17.6, 7.2, 3.8, 6.4, m.dark, true);
      this.box(0, 4.2, -17.6, 3.6, 0.9, 3.2, m.black);
      this.cylinder(0, 5.1, -19.8, 0.55, 2.4, m.rust);
      this.cylinder(0, 4.6, -15.4, 0.9, 0.5, m.steel, true);
      for (const x of [-3.6, 3.6]) this.box(x, 0.9, -17.6, 0.5, 1.4, 5.6, m.rust);
      // 南端装载甲板 + 两条斜坡（x 与车顶边缘相接，坡顶与甲板同高）；甲板做实体，避免踏出坡顶后凌空。
      this.platform(-9, 9, 10, 12, 3.2, m.steel, 3.2);
      for (const x of [-9, 9]) this.box(x, 3.4, 11, 0.3, 0.5, 2, m.yellow);
      this.slope(-9, -4, 24, 12, 3.2, m.steel);
      this.slope(4, 9, 24, 12, 3.2, m.steel);
      for (const [x, z] of [[-11, 16], [11, 16], [-11, 6], [11, 6]]) this.cylinder(x, 0.9, z, 0.32, 1.8, m.rust);
      this.label('RAMP 01', -6.5, 1.1, 24.2, 3.2, 0.5, { color: '#c3d0a8' });
      this.label('RAMP 02', 6.5, 1.1, 24.2, 3.2, 0.5, { color: '#c3d0a8' });
    }

    buildGiantCover() {
      const m = this.mat;
      // 掩体区：车厢两侧的集装箱带，通道内侧留 8m 射界。
      this.container(-13, 2, 4, 3.3, 9, m.orange, 'CARGO / 024');
      this.container(13, -6, 4, 3.35, 9, m.green, 'B-07');
      this.container(-13, -14, 4, 3.2, 6, m.steel, 'QUARANTINE');
      this.container(13, -14, 4, 3.2, 6, m.green, '07 / HAZARD');
      this.container(-13, 20, 4, 3.3, 7, m.green, 'SUPPLY 07');
      this.container(13, 22, 4, 3.3, 7, m.orange, 'HAZARD MAT');
      this.crate(-17, -8, 1.6);
      this.crate(17.2, 4, 1.5);
      this.crate(-17.5, 12, 1.35);
      this.crate(17.5, -22, 1.6);
      this.crate(-10, 26, 1.4);
      this.barrels([[-18.5, -2.5], [18.5, 9], [-19, 16], [19, -16], [-19.5, 34], [19.5, 30]]);
      // 通道里的低掩体：1.34m 高，蹲点后能挡住裂魂者的贴脸路线。
      this.box(-20.5, 0.67, -12, 4, 1.34, 1.1, m.concrete, true);
      this.box(20.5, 0.67, -10, 4, 1.34, 1.1, m.concrete, true);
      this.box(-20.5, 0.67, 6, 3, 1.34, 1.1, m.concrete, true);
      this.box(20.5, 0.67, 18, 3, 1.34, 1.1, m.concrete, true);
      for (const [x, z] of [[-20.5, -12], [20.5, -10], [-20.5, 6], [20.5, 18]]) {
        this.box(x, 1.37, z, 2.6, 0.1, 1.18, m.yellow);
      }
    }

    buildGiantStaging() {
      const m = this.mat;
      // 出发区：玩家与队友的出生点，也是复活点 A 所在的后方集结场。
      for (let z = 30; z <= 44; z += 3.5) this.box(0, 0.016, z, 30, 0.018, 0.14, this.paint, false, false);
      for (const x of [-11, 11]) this.box(x, 0.016, 37, 0.14, 0.018, 14, this.paint, false, false);
      for (let i = 0; i < 7; i++) this.box(-9 + i * 3, 0.016, 43.6, 0.9, 0.018, 1.1, this.paint, false, false);
      for (const x of [-15, 15]) this.box(x, 0.5, 33, 1.2, 1, 8, m.concrete, true);
      const crate = new T.MeshStandardMaterial({ color: 0x6d7a5f, roughness: 0.9 });
      for (const [x, z] of [[-4, 45], [4, 45], [-13, 41], [13, 41]]) this.box(x, 0.6, z, 2.2, 1.2, 1.4, crate, true);
      this.label('REVIVE A', -7, 1.4, 47.85, 4, 0.5, { rotation: Math.PI, color: '#7fd6e8' });
      this.label('REVIVE A', 7, 1.4, 47.85, 4, 0.5, { rotation: Math.PI, color: '#7fd6e8' });
    }

    buildGiantBackdrop() {
      const m = this.mat;
      this.box(0, 7.5, -56, 60, 15, 12, m.dark);
      this.box(0, 15.6, -56, 61, 0.3, 13, m.roof);
      for (let x = -29; x < 30; x += 1.4) this.box(x, 8, -49.45, 0.08, 12, 0.16, m.steel);
      for (const x of [-15, 0, 15]) {
        this.box(x, 5, -49.2, 8.4, 9, 0.3, m.black);
        for (let j = 0; j < 18; ++j) this.box(x, 0.5 + j * 0.5, -48.95, 8.2, 0.03, 0.06, m.steel);
        this.box(x, 9.9, -48.8, 9, 0.24, 0.6, m.yellow);
      }
      this.label('SECTOR 07 / 巨人城废墟', 0, 12.6, -49.3, 26, 3.2, { color: '#c9d3b2' });
      this.label('BIOHAZARD / RESTRICTED ACCESS', 0, 10.4, -48.85, 16, 0.6, { color: '#bea776' });
      for (const x of [-26, 26]) {
        this.cylinder(x, 11, -56, 0.9, 23, m.steel);
        this.cylinder(x, 15.2, -56, 0.96, 0.8, m.rust);
        this.cylinder(x, 21.4, -56, 0.96, 0.8, m.rust);
      }
      // 两侧的长条仓库，把 96m 的纵深"包"起来。
      for (const side of [-1, 1]) {
        this.box(side * 34, 6, -22, 16, 12, 40, m.dark);
        this.box(side * 34, 12.4, -22, 17, 0.4, 41, m.roof);
        this.box(side * 33, 5, 24, 14, 10, 22, m.steel);
        for (let z = -40; z <= 8; z += 4) {
          this.box(side * 25.5, 8, z, 0.08, 2.4, 2.2, m.black);
          this.box(side * 26.4, 6.5, z - 2, 0.5, 1.8, 0.5, m.rust);
        }
      }
      for (const x of [-21, 21]) {
        for (const z of [-44, -6, 34]) {
          this.cylinder(x, 5, z, 0.1, 10, m.dark);
          this.box(x, 9.9, z, 1.4, 0.2, 0.6, m.black);
          this.box(x, 9.77, z, 1.22, 0.03, 0.5, new T.MeshBasicMaterial({ color: 0xf5efb9 }), false, false);
        }
      }
      for (let i = 0; i < 15; i++) {
        const x = -72 + i * 10;
        this.box(x, 5 + (i % 4) * 1.5, -74 - (i % 3) * 6, 6 + i % 3, 10 + (i % 4) * 3, 7, m.dark);
      }
      const cable = [];
      for (let i = 0; i <= 32; ++i) cable.push(new T.Vector3(-24 + i * 1.5, 12 - Math.sin(i / 32 * Math.PI) * 3.2, -46));
      this.group.add(new T.Line(new T.BufferGeometry().setFromPoints(cable), new T.LineBasicMaterial({ color: 0x283b29 })));
    }

    menuView(time) {
      const cam = (this.bag && this.bag.menuCam) || { pos: [29, 18.5, 31], look: [-2.5, 1, -4.5], fov: 56 };
      this.camera.position.set(cam.pos[0] + Math.sin(time * 0.045) * 2, cam.pos[1], cam.pos[2]);
      this.camera.lookAt(cam.look[0], cam.look[1], cam.look[2]);
      this.camera.fov = cam.fov;
      this.camera.updateProjectionMatrix();
    }

    update(dt) {
      if (this.dust) this.dust.rotation.y += dt * 0.003;
    }

    render() { this.renderer.render(this.scene, this.camera); }
  };
})();
