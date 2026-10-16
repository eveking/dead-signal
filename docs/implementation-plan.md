# 巨人城模式 · 实现排期

依据：`docs/design-giant-city-30waves.md`（2026-10-12 全部决策已定稿）。
估算按单人理想开发日（pd）计，含自测；里程碑之间为硬依赖，里程碑内部任务可并行。
每个里程碑完成的判定方式统一：本地 `启动游戏.cmd` 起服 → `tests/browser.cjs` 冒烟（eval 断言 + shot 截图）通过设计文档对应小节的验收点。

## 总览

| 里程碑 | 内容 | 估算 | 前置 |
|---|---|---|---|
| M0 | 波次数据化 + 开局设置 ✅ 2026-10-12 | 2 pd | — |
| M1 | 复活币与濒死/传送流程 ✅ 2026-10-13 | 3 pd | M0 |
| M2 | 队友 squad + 仇恨系统 ✅ 2026-10-13 | 5 pd | M1 |
| M3 | 敌种注册表 + 6 种行为 + BOSS 状态机 ✅ 2026-10-13 | 6 pd | M2 |
| M4 | 地图重建（96×48 长图 / 可行走车顶 / 三路线）✅ M4a ✅ 2026-10-14 / M4b ✅ 2026-10-14 | 5 pd | M0（可与 M1–M3 并行或插入） |
| M4c | 箱顶栈道 + 跨通道横桥（M4 的追加项，非原排期内容）✅ 2026-10-15，备忘挂在 M4 节下 | 追加，不计入 27 pd | M4b |
| M5 | 补给点位 + 特殊武器 + BOSS 血条 ✅ 2026-10-15 | 3 pd | M3, M4 |
| M6 | 调平、性能、结算与打包 ✅ 2026-10-15 | 3 pd | M5 |
| M7 | 表现层欠债（BOSS 独立骨架）+ 最佳纪录 + 真机收尾 ✅ 2026-10-15 | 追加 4 pd，不计入 27 pd | M6 |
| W | 武器五槽改造（3 手雷 / 4 军刀 / 5 狙击；特殊武器改占狙击槽）✅ 2026-10-15 | 追加，不计入排期 | M7 |

合计 ≈ 27 pd（M7 追加 4 pd 后共 31 pd）。串行做约 5–6 周；若 M4 提前并行可压缩到 4 周左右。

## M0 · 波次数据化（2 pd）— 已完成 2026-10-12

对应文档 §2 §6 §10-6。

- `js/waves.js`（新）：30 波配置表（构成、刷怪点西/东/北/顶、批次数与间隔、BOSS 标记、特殊武器箱标记），`game.js` 删除硬编码 `waveSizes` 改为读取配置。
- 难度三档倍率表（HP/伤害/兵力/默认币数/得分倍率）接入配置层。
- 菜单开局设置 UI：难度选择 + 复活币 0–99 滑条（默认 30，0=硬核 ×1.5 标记）。
- 同屏上限、生成间隔改为按波配置驱动。

验收：控制台换 waveSizes 数据即改波次；第 15 波配置出 1 只"占位 BOSS"（复用现有敌种）即算数据层打通。

实现备忘（供 M1/M3/M4 接续）：

- 数据入口统一在 `DZ.WAVES`（TYPES / DIFFICULTY / GROUPS / MODES / queue / shuffle）与 `DZ.WaveRunner`（批次释放、生成间隔、同屏上限、BOSS 增援）；开局选择存在 `DZ.Settings = {mode, difficulty, coins}`，`Game.applySettings()` 派生 `waveMode / difficultyConfig / totalWaves / waveSizes`。
- 占位 BOSS＝步行者模型 × `type.scale`（泰坦 2.2 / 巨型泰坦 2.8），HP·伤害·分数取配置；M3 注册表落地后替换 `Enemies.spawn` 的 scale 分支即可。
- 未实现敌种（膨胀体/暴君/雾散体/裂魂者）在 `TYPES` 里标 `placeholder:true`，当前复用步行者外形 + 各自数值，波次表数据先行。
- 西/东/北/顶四组刷怪点现为 48×48 现图 `world.spawnPoints` 下标映射（`WAVES.GROUPS`），M4 换 96×48 长图时只改这一张映射表。
- 旧「隔离区 07 · 5 波练习」走 `dataDriven:false` 分支，保留原生成公式（HP 70+14/wave、fast 变体每 4 只一刷），玩法与验收前完全一致。
- 复活币：M0 只入库（`DZ.Settings.coins` / `game.coins`）与 UI 硬核标记，消费逻辑在 M1。
- 菜单在 ≤940px 高度下隐藏 intro/控制提示以容纳开局设置面板（styles.css 末尾追加段）。

## M1 · 复活币与濒死流程（3 pd）— 已完成 2026-10-13

对应 §4。依赖：仅需现有 48×48 图（复活点 A/B/C 先用占位坐标）。

- `player.js`：倒地进入濒死读条（`revive.castTime`，现为 60 秒；2026-10-15 由 3 秒上调）（不再直接 `finish(false)`）；读条中按确认键消耗 1 币 → 前线复活点重生（波 1–9=A，10–24=B，25–30=C）+ 50 HP + 5 秒无敌（免疫伤害与击退）；币 0 或读条走完 → 失败结算（显示到达波次）。
- F 传送：重生后 20 秒窗口（落地重置计时）内不限次数传向最近存活队友；M2 前队友不存在，先按"传向防守岗位点"实现接口，M2 接通。
- HUD：币数计数、濒死读条环、传送窗口倒计时与可用提示；小地图高亮传送目标。
- 濒死/复活/传送三组音效（`audio.js` 程序合成）。

验收：~~币 5 → 死 3 次复活、第 4 次失败~~（原文自相矛盾：5 币按 1 币 1 命应为 5 次复活）→ 按"1 币=1 次复活、耗尽即失败"实现，实测币 3 → 复活 3 次、第 4 次倒地失败；币 5 → 5 次复活同样通过；3 秒读条超时=失败；硬核 0 币时倒地即失败路径正确。

实现备忘（供 M2/M4 接续）：

- 关键参数全部在 `DZ.WAVES.MODES.giant.revive = {castTime:3, health:50, guard:5, rallyWindow:20}`；阶段划分 `DZ.WAVES.stageForWave(wave)`（1–9=A / 10–24=B / 25–30=C）。练习模式 `revive:null` + `allowCoins:false`，整套系统在旧模式下不启用（HUD 与倒地即败保持原行为）。
- 状态机在 `player.js`：`goDowned()` → `updateDowned()` → `tryRevive()` / `tryRally()`；`player.downed` 为真时 `damage()`、射击、移动输入全部旁路，相机降到 0.52 并倾斜 0.28 弧度。`Game.finish()` 负责清 `downed` 并隐藏遮罩。
- **M2 接缝**：`Game.rallyTarget()` 先查 `squad.nearestAlive(pos)`，没有 squad 时回落到 `world.defensePost`。M2 只要实现 `DZ.squad.nearestAlive()` 即可把 F 传送切到队友，无需改 `player.js`。
- **M4 接缝**：`world.revivePoints = {A:[两点], B:[两点], C:[两点]}` 与 `world.defensePost` 现为 48×48 占位坐标（地上青色方环标记），换 96×48 长图时只改这几个常量。`reviveSpot()` 在两点中选"最近存活敌人最远"的那个，落地前用 `world.canStand(0.42)` 微调。
- HUD：`ui._updateRevive()` 每帧驱动 `#coins-panel`（0 币加 `.spent` 变红）、`#downed`（`--p` 驱动的 conic-gradient 读条环 + 秒数）、`#rally` chip（剩余秒数向上取整）；小地图画当前阶段复活点方框，传送窗口开启时把目标点画成荧光菱形。
- 失败结算文案：`_fillResult` 用 `game.deathWave` 输出"阵亡于第 N 波"（波次开始前的间歇里倒地不会显示 0 波）。
- 键位：E 复活、F 归队，已加入 `controlKeys` 防止页面滚动；`index.html` 底部快捷键提示暂未加 E/F（M6 结算页统一梳理）。

## M2 · 队友与仇恨（5 pd）— 已完成 2026-10-13

对应 §4 小队+仇恨、§10-3/4。

- `js/squad.js`（新）：3 名队友（尖刀/盾卫/游骑兵），复用敌人人形建模换色；移动走流场；射线射击复用 `weapons.js` 的挡枪检测逻辑；HP、阵亡 5 秒后复活点重生。
- 指令状态机：守点（岗位点，追击≤10m）/ 跟随（贴玩家 4–8m）/ 自由（优先高威胁）；Tab 循环选中 + Q 切换，1.5s 生效；默认配置见 §4。
- 仇恨系统：怪物目标选择（距离反比 + 伤害记忆 40 分 5s 衰减 + 玩家 bias 15）；双流场（玩家场 + 当前仇恨目标场）或按怪重路由，45 只同屏下做 0.3s 节流。
- 队友自动拾取脚下补给；队友击杀计 60% 团队分、不计玩家爆头率。
- HUD/小地图友军蓝点、选中框、濒死时队友靠拢 AI。

验收：怪流约五五分流向玩家与队友；指定盾卫"跟随"后岗位空缺可观察仇恨重分配；玩家倒地时队友执行靠拢吸引。

实现备忘（供 M3/M4/M5 接续）：

- **入口**：`DZ.Squad`（脚本顺序 `enemies.js` 之后、`weapons.js` 之前）；`game.squad` 仅在 `waveMode.allowSquad`（巨人城）时存在，练习模式为 `null` → 全部旧行为不变。成员 `game.squad.members[i]`，`m.id = i + 1`，与流场编号一致；`DZ.Squad.ORDER_LABELS` 供 HUD 文案复用。
- **友方目标抽象**：`DZ.allyUnits(game)` → `[{id, isPlayer, position, radius, takeDamage}]`（id 0 恒为玩家）。怪物持有 `e.targetId` 与 `e.aggro[unitId] = {value, at}`；`chooseTarget()` 分数 = `(d<15 ? (15-d)*2 : 0) + 记忆衰减(value*max(0,1-(now-at)/5)) + 玩家 bias 15`，`NEAREST_TYPES = {bomber, splitter}` 改用 `-d`（最近优先）。M3 新敌种只要声明是否进 `NEAREST_TYPES`（或迁到注册表的 `targetRule` 字段）即可复用。距离基准取 `(15-d)*2` 而非 `(15-d)`：否则 15m 内的最大基础分恰等于玩家 bias，怪物几乎永远不会转咬队友（实测分流 <10%）。
- **多流场**：`world.fields: Map<id, {dist, clock, cell}>` + `world.updateField(id, pos, dt)` / `world.nextStep(id, pos)` / `world.resetNavigation()`；id `0..3` 为友方单位场，`'g0'..'g2'` 为队友指令目标场，均按格子变化 0.3s 节流重建。M4 换 96×48 长图只需重建 grid/字段尺寸，接口不动。
- **岗位点**：`world.squadPosts[3]`（盾卫/游骑兵守点 + 尖刀初始位），与 `defensePost` 并列，M4 一并换成正式坐标。
- **击杀归属**：`enemies.damage(enemy, amount, point, direction, headshot, unitId=0)`。`unitId>0` → 得分 `round(score*0.6)`、`game.squadKills++`、不计入 `kills/headshots`、不驱动玩家掉落节奏，击杀信息走 `ui.kill(false, points, '队友名 · 队友击杀')`。
- **复活/传送接缝**：`squad.nearestAlive(pos)` 返回最近存活队友朝玩家一侧 1.3m 的落点，全灭返回 `null`（`player.tryRally()` 已按 null 提示，无需改 player.js）。队友阵亡 5 秒后按 `DZ.WAVES.stageForWave(wave)` 的复活点组重生，取离怪最远的一个并做 canStand 微调。
- **队友经济**：`m.ammo/m.reserve` 为真实弹药（换弹从备弹转移，打空则静默），补给点 `squad.pickups()` 只吃脚下 1.1m 内且玩家 2.2m 外的掉落（医疗 +35 / 备弹 +90），波末 `squad.resupply()` 回满。M5 特殊武器箱需在此处补分支。
- **M3 待接**：雾散体"队友命中 -50%"、裂魂者击退对队友生效、暴君横扫范围判定都要读 `game.squad.members`；击退写 `e.knock` 的现有路径不影响仇恨。
- **冒烟实测**（28 项断言全绿，临时脚本已删）：怪流分流在波 1 采样 25 只次中 36% 咬向队友（其余按 bias 归玩家，玩家不输出时不会反超）；盾卫切"跟随"后离岗 >10m、守点仅剩游骑兵；玩家濒死时三名队友全部收进 10m 圈。

## M3 · 敌种注册表与 BOSS（6 pd）— 已完成 2026-10-13（M3a 敌种重构 + M3b BOSS）

对应 §5 §6 §7、§10-1。最大块，拆两个子提交：

M3a 敌种重构（3 pd）：
- `enemies.js` 改为类型注册表：`{type, hp, speed, damage, behavior, score, spawnPoints}`，行为钩子 `think/move/attack/onDeath`。
- 迁入现有步行者/疾行者（含冲刺 6m CD4s）；自爆体（2.5m 起爆 3m 半径 60 伤、被射杀不爆、冲顶斜坡标记 spawn='顶'）；暴君（横扫 30、步枪减伤 20%、头 30% 体积双倍）；雾散体（6s 半径 6m 黑雾 8s，玩家视野遮挡 + 小地图该区域失效 + 队友命中 -50%）；裂魂者（击退 4m+0.5s 硬直、8m 闪现 CD8s）。
- 黑雾用半透明体积球/面片实现，先保证规则生效再优化表现。

M3b BOSS（3 pd）：
- 泰坦状态机：冲刺（0.8s 前摇、14m/s×10m、40 伤+击退 3m）、砸地（0.9s 红圈预警、5m 半径 50）、召唤（20s，15 波步行/疾行、20 波自爆/疾行）、践踏追击最远仇恨；头部双倍弱点。
- 巨型泰坦：15000 HP、冲刺可小幅转向、连砸、18s 召唤、60% 血震波（全场地击退 2m 无伤）、≤40% 狂暴（红自发光、速度 3.3、CD×0.6、砸 6.5m、召唤固定自爆）。
- 死亡掉落特殊武器箱挂钩 M5；29 波"分 4 批投放"由波次表 batch 字段驱动（M0 已留）。

验收：逐波配置跑 5/10/15/20/29/30 六波检查表（每敌种 3 条行为断言 + BOSS 技能 CD/伤害抽查）；狂暴触发与状态切换可复现。 → 达成：M3a 139 条 + M3b 67 条断言全绿，六波检查表覆盖 5/10（M3a）与 15/20/29/30（M3b）。

实现备忘（M3a，供 M3b/M4/M5/M6 接续）：

- **注册表入口**：`DZ.ENEMY_REGISTRY`（`enemies.js` 顶部，与 `DZ.WAVES.TYPES` 同 key）；实例化时 `e.def = Object.assign({}, TYPES[key], REGISTRY[key])`，走 `enemies.defOf(entry)`。登记字段：`radius / targetRule('aggro'|'nearest') / spawnPoints / melee{cooldown,windup}` + 技能参数 `dash / fuse / blast / rifleResist / sweep / fog / blink / shove`。行为钩子 `def.behavior.{think,move,attack,animate,onDeath}`，缺省回退 `defaultMove/defaultAttack/defaultAnimate`；`ctx` 是 `enemies.update` 复用的单例 `{dt, game, world, E, units, target, distance, direct}`。**M3b 的泰坦/巨型泰坦只在 REGISTRY 补 `state` 机 + 技能参数，不要动 update 主循环。**
- **仇恨**：M2 的 `NEAREST_TYPES` 常量已被 `def.targetRule` 取代（bomber/splitter = `nearest`，其余 `aggro` 打分）。BOSS 用第三种规则 `'threat'`（见 M3b 备忘，计划原文写的 `'furthest'` 已在实现时改名并扩展）。
- **击退**：统一走 `DZ.knockPosition(from, dir, distance, radius)`（0.25m 步进、撞墙即停）与 `DZ.allyUnits(game)` 的 `takeDamage/knockback`；`enemies.swing(e, damage, victims, distance, stagger)` 先击退后结算伤害，玩家与队友同一条路径（裂魂者 4m+0.5s、暴君横扫 0 击退、泰坦冲刺 3m、震波 2m 都复用它）。
- **黑雾**：`effects.fog(position, radius, life)` → `fogs[{root, material, position, radius, life, maxLife}]`，上限 `effects.fogLimit = 12`（超出丢最旧）。规则查询只有一个 `effects.fogDensity(pos) = (1-(d/r)^3)*fade`（fade 0.6s 淡入 / 1s 淡出）。三处消费：`ui._updateFogVeil`（DOM 遮罩，opacity = density×0.92）、`ui._drawMinimap`（雾区覆盖使敌点失效）、`squad.fogScale(pos)`（density>0.25 → 命中 ×0.5）。M4/M6 需要"雾内可见度/生成抑制"时继续读这一个函数。
- **'顶'投放**：白名单在 `def.spawnPoints`，`groupPoint(group, def)` 负责过滤，目前只有膨胀体登记了 `GROUND_GROUPS.concat(['顶'])`。M4 换 96×48 长图只改 `DZ.WAVES.GROUPS` 的下标映射。
- **伤害修正**：`enemies.damage(enemy, amount, point, direction, headshot, unitId, weapon)`；暴君为 `weapon==='rifle' && !headshot` → ×0.8。**判断点**：§5 同时写了"步枪减伤 20%"和"头部 30% 体积双倍"，取爆头优先（爆头仍 ×2，减伤只作用躯干），留给 M6 复核。
- **练习模式零变化**：`resolveStats` 的 legacy 分支返回 `{type:'walker', def:REGISTRY.walker}`，旧公式、fast 变体节奏（wave≥3 每 4 只）与配色都不变；`buildBody(enemy, shape)` 的颜色改为直读 `shape.skin/shape.cloth`（`FAST_COLORS` 在 `Object.assign` 时已覆盖同名键）。
- **冒烟实测**（139 条断言全绿，页内定步长推进）：§5 数值逐类核对（23 项）；难度倍率与 BOSS 血量/scale；练习模式公式与配色回归；冲刺触发区间 3.5–13m/位移 5.85m/CD 4s；膨胀体 2.5m 起爆、3m 60 伤、被射杀不爆不计分、对盾卫 42=60×(1-0.3)；暴君步枪 0.8×、爆头 ×2、2.8m 内多目标各 30（4.6m 盾卫不受）、CD 1.7s；雾散体 6s/半径 6/生命 8、密度曲线、视野遮罩、`fogScale` 0.5、小地图亮度 485→30、上限 12、消散；裂魂者闪现 4–12m 区间/位移 8.09m/落点 canStand/CD 8s、击退 4.00m+0.5s 硬直（玩家与队友同受，无敌期免疫）；`targetRule` 与伤害记忆抢仇恨及 5s 衰减回落；'顶'点 40 次采样 0 泄漏；第 5 波（18 兵）与第 10 波（26 兵、五类同场、不出暴君）实跑；5/10/15/20/29/30 六波兵力与 maxAlive/批次/BOSS 标记逐波核对。
- **留给 M6 调平**：暴君近战 CD 1.7s、泰坦/巨型泰坦接触近战 CD 2.0s、雾散体首团 6s（无开局折扣）；黑雾体积球 opacity 0.82 偏"实心"，M6 表现优化时降 opacity、加边缘羽化。

实现备忘（M3b，供 M4/M5/M6 接续）：

- **BOSS 状态机位置**：`enemies.js` 的 `BOSS_BEHAVIOR`（`think/move/attack/animate` 四钩子，titan 与 megaTitan 共用），阶段字段挂在 `e.skill = {phase, wind, dash, chargeCd, slamCd, slamsLeft, summonCd, quakeDone}`，只在 `def.boss` 时分配。阶段流转：`idle → chargeWind(0.8s) → charge → idle`、`idle → slamWind(0.9s) → [slamGap(0.5s) →] idle`；`bossPhaseTick()` 推进，`move()` 在 charge 期返回 `dash.vx/vz`、其余非 idle 期返回 0（前摇站桩），`attack()` 只在 idle 走 `defaultAttack`，charge 期用 `dash.hits:Set` 保证一次冲刺对同一目标只结算一次。**主循环 `update()` 未改动**，只在里面给 BOSS 投放 entry 追加 `summon: runner.cfg.summon`。
- **召唤表按波次注入**：`summon` 不写在注册表里，而是 `WaveRunner.cfg.summon` → `spawnAt(entry)` → `defOf(entry)` 用 `entry.summon` 覆盖（15 波步行+疾行、20 波自爆+疾行、30 波自爆 3 或疾行 4）。`enemies.summon(enemy, picks[index], ctx)` 在 BOSS 周围 5m 圈采样 10 次找可站立且不重叠点，全被占时退回 `groupPoint(null, def)`。狂暴时取 `def.rage.summonFixed`（固定 0 号表 = 自爆体），否则随机。
- **`targetRule='threat'`**：`chooseTarget()` 打分改为 `memory + d*0.01`——伤害记忆最深者优先，记忆全 0 时按 `d*0.01` 取**最远**目标（对应 §7"践踏追击最远仇恨"）。**判断点**：设计文档写"最远仇恨"、计划文档写 `'furthest'`，实现取"记忆优先、无记忆时最远"，M6 复核手感。记忆仍是 M2 那套：每次命中 +40、5s 线性衰减（不按伤害量）。
- **砸地预警圈**：`effects.warn(position, radius, duration)` → `warns[{root, material, life, maxLife}]`（红色 `fogDisc` 填充 + `blowRing` 边缘，opacity 随剩余时间脉动）；`effects.boom(position, radius, color=0xffb257, life=0.45)` 加了两个可选参数供震波用（`0xffd9a0`/0.7s）。M4/M5 要画任何地面预警都复用 `warn`。
- **震波/狂暴**：都写在 `BOSS_BEHAVIOR.think` 开头，按 HP 阈值一次性触发（`skill.quakeDone` 锁定；`e.rage` 置位后 `bossCd()`/`slamRadius()` 两个小函数把 CD×0.6、砸半径 6.5 读出来，`e.speed` 直接改 3.3，`animate` 里换 `skin/cloth/eye` 自发光色）。**判断点**：§7 未给震波周期，实现取"跨过 60% 阈值时释放一次"；连砸用一次 0.9s 预警 + 0.5s 间隔第二次（第二次在 slamGap 起始再补一个 0.5s 的红圈，玩家仍有反应窗口），M6 复核。
- **BOSS 与波次结算**：`WaveRunner.start()` 新增 `this.bossAlive`，`tick()` 的增援条件改为 `cfg.reinforce && (!cfg.boss || this.bossAlive)`——否则 15/20/30 波击杀 BOSS 后增援无限投放、波次永不结算。`enemies.damage()` 的死亡分支负责 `this.boss=null; runner.bossAlive=false`。
- **M5 接缝**：`enemies.onBossDeath = enemy => {}`（game 侧挂载，测试里 `hook` 用例验证：BOSS 死亡调用 1 次、普通敌种不调用）。15/20 波"泰坦必掉特殊武器箱"直接读这个回调的 `enemy.root.position`，不要再加新的死亡判定分支。
- **BOSS 半径**：`spawnAt()` 用 `def.radius * entry.bossScale`（泰坦 0.968 / 巨型泰坦 1.232）做 canStand 校验，M4 换图后 BOSS 的刷点净空要按这个半径重排；`e.stopAt/attackAt` 已随半径放大。
- **冒烟实测**（67 条断言全绿，与 M3a 的 139 条一起构成 5/10/15/20/29/30 六波检查表）：泰坦 6000 HP/scale 2.2/半径 0.968/§7 技能参数逐项核对；冲刺前摇 48 帧不位移、位移 9.80m、命中 40 伤 + 击退 3.00m、一次冲刺只结算一次、CD 12.00s；砸地红圈半径 5、持续 54 帧、50 伤、6.4m 圈外单位不受影响、CD 8.00s；召唤 15 波 2 步行+2 疾行、20 波 2 自爆+2 疾行、落点距 BOSS <9m、CD 20s 复位；`threat` 仇恨四段（无输出取最远 → 玩家 1 次命中锁定 → 尖刀 4 次命中反超 → 5.2s 衰减回最远）；巨型泰坦 15000 HP、冲刺 15.90m/50 伤/可转向、连砸 2 次含 slamGap 间隔、8s CD、60% 震波全场位移 2.00/2.07m 且零伤害、`quakeDone` 锁定不重复；狂暴 41% 不触发、39% 触发、移速 3.3、红自发光 a8281a、砸地半径 6.5、CD 4.80s、召唤固定 3 自爆、CD 10.45s（18×0.6 衰减后）；15 波实跑（自动投 BOSS、增援只在存活时入队 4/5、死后停止投放且波次可结算）；29 波实跑 25s（4 批次 0/5.0/10.1/15.1s、六类同场、峰值 45 不越上限、无 BOSS）；`onBossDeath` 钩子。
- **留给 M6 调平（M3b）**：BOSS 开局缓冲 `chargeCd 3s / slamCd 5s / summonCd = every×0.6`、接触近战 CD 2.0s 都是实现自定；BOSS 沿用 walker 模型 × scale，M4 之后需要独立骨架（践踏/抬臂/砸地的剪影区分）。→ 数值项 M6 已定稿；独立骨架欠债 **M7 已还**（见 M7 节）。



## M4 · 地图重建（5 pd）— 已完成 2026-10-14（M4a 几何 + 垂直移动 / M4b 高层玩法与战场规则）

对应 §3、§10-2/7。拆两个子提交：

M4a 几何与垂直移动（3 pd）：
- `world.js` 竞技场 48×48 → 96×48 长图：三段式布局（南出发区 / 中车厢+中央平台 / 北三通道口），西/东 8m 通道、掩体区复用集装箱资产。
- 火车实体：车厢长 ~26m、顶高 3.2m，两条 15° 斜坡**可行走**——碰撞系统从纯 XZ 升级为"站立高度面"（canStand/move 增加 y 支撑判定，跳跃/下坡/射击站位验证）。
- 刷怪点 西/东/北/顶 四组 + 复活点 A/B/C 正式坐标替换 M1 占位。
- 寻路网格 96×48 BFS 重建；车顶用独立流场层或禁止怪物上顶（v1 怪物不上车顶，自爆体冲顶走斜坡导航加权重）。
- 双图懒加载 + `useMap()` 切换；小地图按新尺度等比重绘。

M4b 高层玩法与战场规则（2 pd）：
- 队友高层岗位 + 友方高层导航（`squadPosts` 目前三席全在地面）；'顶'组自爆体真正沿斜坡冲顶（当前投在坡脚）。
- BOSS 刷点净空按 `radius × bossScale`（0.968 / 1.232）重排；巨型泰坦 §7 的 30m 战场限制。
- 背景/光照/雾与新尺度的氛围适配、静态阴影复烘；45 同屏性能实测；单文件版重打包。

验收（M4a）：96×48 长图与站立高度面碰撞、斜坡/车顶双向通行、玩家与队友垂直移动、西/东/北/顶四组刷怪点与 A/B/C 复活点正式坐标、小地图 48×96 缩放正确、45 只怪在地面流场无卡死绕圈。 → 达成：74 条断言全绿（M3a 139 条 + M3b 67 条同步回归通过，页面 0 异常）。

验收（M4b）：车顶队友射击位、自爆体冲顶、BOSS 净空与 30m 限制、完整 30 波长图体验 + 性能。 → 达成：82 条断言全绿（M3a 139 条 + M3b 67 条同步回归通过，页面 0 异常）；45 同屏定步长模拟 0.55ms/帧、含渲染 5.65ms/帧（软渲染机）。

实现备忘（M4a，供 M4b/M5/M6 接续）：

- **站立高度面**：`world.surfaces = [{minX,maxX,minZ,maxZ,y,kind:'flat'|'ramp',ramp?}]`，由 `platform(minX,maxX,minZ,maxZ,top,material,thickness)` 与 `slope(minX,maxX,zLow,zHigh,top,material)` 生成（斜坡带 `ramp(x,z)` 闭包，`floorAt` 按 z 线性插值）。`STEP_UP = 0.42` 是唯一的"迈得上去"判据：`floorAt(x,z)` 只返回不超过 `fromY + STEP_UP` 的最高顶面，所以 0.35m 中央平台能直接踩、3.2m 车厢顶从地面看是墙。
- **三个查询口**：`canStand(x, z, radius = 0.43, fromY = 0)`（边界 → obstacle AABB → 中心 + `radius*0.72` 四点采样逐个比 `floorAt`）、`move(position, dx, dz, radius, fromY = position.y)`（逐轴试走，能走通才写回）、`settleY(position)`（贴台面）。视线/技能直线判定用高度感知的 `segmentClear(a, b, radius)`，内部 `fromY = min(a.y, b.y)`。**M4b 加任何新的可站立结构只调 `platform/slope`，不要往 `obstacles` 里塞。**
- **地面单位规则**（§5 高台安全的实现核心）：怪物 `world.move(p, …, e.radius, 0)` 显式传 `fromY = 0`，玩家与队友不传（用自身 y）。于是斜坡与车顶对怪物是墙、对友方是路，与导航网格的结论天然一致（`resetNavigation()` 用 `canStand(x, z, 0.56)` 即 fromY 0 建 48×96 网格，车厢/斜坡 footprint 全标不可通行）。**M4b 要让自爆体上顶，改的就是这一处**（给它 `fromY = position.y` 或走"冲顶"专用导航层），别动别的怪。
- **投放落点保护**：`enemies.spawnAt(position, entry)` 先校验 `canStand(radius)` + 与存活单位不重叠，失败时按黄金角向外螺旋 20 次采样，仍失败退回 `groupPoint(null, def)`——保证任何怪都不会被 `settleY` 抬进 3.2m 顶面里（实测 12 只地面怪 25 秒 0 只登顶、最近距离 4.32m、玩家 0 受击）。
- **垂直门槛**：`defaultAttack` 里 `target.y - e.y > 1.02` 直接不打；`area()` / `detonate()` 跳过 `|u.y - p.y| > 2.2` 的单位。实测 3.2m 地板挡住砸地 AoE、同层 AoE 仍照常结算（没误加豁免）。M5 的火箭筒 2.5m 半径伤害直接复用 `area()` 的高度门。
- **双图缓存**：`world.bags = {practice, giant}`，每个 bag 自带 `{group, obstacles, surfaces, blockers, spawnPoints, spawnGroups, revivePoints, bounds, background, fogDensity, menuCam, playerStart, squadStart, squadPosts, defensePost, menuDecor, dust}`；`useMap(modeKey)` 换引用并把旧 Group 物理 `scene.remove`、新 Group `scene.add`、`shadowMap.needsUpdate = true`。构造时按 `DZ.Settings.mode` 只建当前图（懒加载）。调用点三处：`game.js` 的 `newGame()`、`game.js` 的模式切换、`ui.js` 的菜单选项。**M4b 加地图级资产只需在 `buildGiant(bag)` 里写进 bag，不要新增全局字段。**
- **`world.spawnGroups` 取代 `DZ.WAVES.GROUPS`**：波次数据只登记组名（西/东/北/顶），点位由各套地图自带；`enemies.groupPoint(group, def)` 读 `world.spawnGroups` 并按 `def.spawnPoints` 白名单过滤。巨人城四组各 2 点（'顶'当前在坡脚 ±6.5, 0, 25.5），练习图沿用旧 6 点与旧下标语义（西=0,3／顶=5），所以 5 波模式行为零变化（`surfaces.length === 0`、地面恒 y=0、48×48 导航、出生/复活/岗位坐标逐项比对通过）。
- **小地图**：`ui._drawMinimap()` 用 `world.bounds` + `padding = 8` 算 `scale = min(w/spanX, h/spanZ)` 并居中 letterbox，长图在 180×180 画布上是 82×164 的竖条（实测宽高比 0.506），练习图仍是 1:1。任何新的按坐标取像素的测试/工具都应像 `tmp-m3a.cjs` 的 `px()` 那样镜像这段公式，别再引 `world.half`（已删）。
- **标识朝向**：`label()` 的 PlaneGeometry 正面朝 +Z、材质 `DoubleSide`，背面会显示**镜像文字**——面向读者的标识不要加 `rotation: Math.PI`。本轮修掉 WEST/EAST GATE、CENTRAL PLATFORM、RAMP 01/02 五处；只有"从墙外/从南墙内侧读"的 STAGING AREA、REVIVE A 保留 π。
- **冒烟实测**（74 条断言全绿，页内定步长推进）：高度面数值 5 项（车顶/甲板 3.2、平台 0.35、坡 z=18 → 1.60、两坡对称、坡间仍是地面）；通行判定 6 项（0.35 可踩、3.2 站不上、同层可走、车头实心、西/北通道口可通行、墙挡路）；导航 48×96 与四组刷怪点入网；垂直移动 15 项（沿西坡走上甲板 → 东行 → 北上车顶 → 反向走回地面，全程每帧 Δy ≤ 0.033；跳跃峰值 1.079m 且不会被自动抬上甲板；车顶开火命中地面敌人 80/53；被击出边缘先保留 3.2m 再自由落体到 0）；高台安全 6 项（见上）；45 只 30 秒流场（0 出界、0 NaN、35/35 持续推进、近战外最长停滞 4s、有怪抵达 0.35m 平台、全程 y ≤ 0.42）；小地图 3 项；练习图 15 项零变化；双图切换 9 项（两套都缓存、旧图出场景、场景根 21↔17 无残留、切回复用同一份缓存且高度/导航完好）。
- **留给 M4b/M6**：车厢顶与斜坡目前只有"能走"的几何，没有高层专属玩法位；`defensePost`/`squadPosts` 三席全在地面；BOSS 刷点净空仍按普通半径排（M3b 备忘里已标注）；光照是 `buildGiantLights` 的一束方向光 + 半球光，阴影相机 `40×66` 覆盖全场，M4b 若加黑雾压制或夜景要重烘。

实现备忘（M4b，供 M5/M6 接续）：

- **两套导航层**：`world.nav`（地面层，M4a 那套 `canStand(x,z,0.56)` fromY 0）与 `world.navAlly = buildAllyNav()`（友方层）。友方层先按 `floorAt` 取每格台面高度 `floors[i]`，`open = canStand(NAV_RADIUS, y)`，源点 = `canStand(NAV_RADIUS, 0)`（地面本来就踩得到的格），BFS 只沿 `|Δfloor| ≤ STEP_UP` 的边扩散，因此斜坡→装载甲板→车顶是唯一的登顶链路，悬崖永远不连通。**两层都用 `NAV_RADIUS = 0.56`**（常量在 `world.js` 顶部）：旧练习图没有高度面，两层必须逐格等价，这是"两套模式共存零变化"的硬条件（实测练习图 0 格差异；巨人城地面层不可达 1203 格、友方层 443 格）。
- **流场绑网格**：`world.field(id, grid)` 建的 `f` 带 `grid`，`updateField(id, position, dt, grid)` 与 `nextStep(id, position)` 都从 `f.grid` 取 `w/h/minX/minZ/blocked/queue/floors/maxStep`。id 约定不变：`0..3` = 怪物目标流场（nav）、`'g0'..'g2'` = 队友岗位流场（navAlly）、`'e'+targetId` = 冲顶自爆体流场（navAlly）。**边规则在两处都要守**：`updateField` 的 BFS 扩散与 `nextStep` 的梯度挑选都查 `|Δfloors| ≤ maxStep`，只在一处加会出现"隔壁格绕斜坡才够得着、梯度却指向悬崖"的假短路（实测队友会顶着甲板壁原地抖动）。
- **`canStand` 的踩面修正（M4b 关键）**：`limit` 从 `fromY + STEP_UP` 改成 `Math.max(fromY, floorAt(x,z)) + STEP_UP`，中心格单独先判 `floorAt(x,z) > fromY + STEP_UP` 即拒。原因：斜坡每米升 0.267m，四点采样的前方 0.3m 就比脚底高 0.48m > 0.42，旧判据会把坡道当成墙，任何单位（含玩家）都上不了坡。改后语义是"先踏上目标面，再看四周有没有更高的墙"，地面单位规则不受影响——`fromY = 0` 时目标面 > 0.42 依旧直接拒，3.2m 车顶对怪物仍是墙（实测 45 同屏 60s 内冲顶以外的怪 0 只上顶、玩家 0 受击）。
- **队友高层岗位**：`bag.squadPosts` 第三席改成 `(0, 3.2, -2)`（火车车顶，§4 游骑兵默认位），`createMember` 仍用 `settleY` 把成员放在岗位本身，所以开局游骑兵直接在车顶；`squad.moveMember` 走 `'g'+index` on navAlly，`m.goal.y = world.floorAt(goal.x, goal.z)` 让支撑面随图现算。阵亡重生后实测沿"西通道 → 南出发区 → 西斜坡 → 甲板 → 车顶"自行返岗（约 23s、路程 >15m）。**F 传送**：`squad.nearestAlive()` 现在返回带 y 的坐标（在队友侧方 1.3m 同层），`player.land()` 用 `position.y` 作 `fromY`，所以能传上 3.2m 车顶而不是掉到车厢底下。（2026-10-15 追加：该席已挪到 `(0, 3.2, -7.5)`，原因见下方"箱顶栈道"备忘。）
- **冲顶自爆体**：`def.topRush`（只有 bomber 登记）+ `entry.group === '顶'` 才置 `e.topRush`（`spawn()` 里），非顶组投放完全不变。三处差异：移动 `world.move(p, …, e.radius, e.topRush ? p.y : 0)`（其余怪仍传 0）、寻路 `nextStep('e'+targetId)` on navAlly、选目标 `chooseTarget` 里 `u.position.y > 1.2` 时 `score += 40`（同层偏好，实测车顶队友会抢走冲顶个体的仇恨）。**判断点**：`+40` 是经验值，量级与 `nearest` 规则的 `-d` 相当，M6 复核"冲顶个体该不该优先撞高层队友而不是就近地面目标"。另外 `bomber.think` 里加了 `e.topRush && target.y - e.y > 1.6 → 不起爆`，否则冲顶个体会在坡脚对着车顶玩家提前引信（`detonate/area` 本来就有 2.2m 同层门，不会误伤地面）。
- **BOSS 净空与战场**：净空半径沿用 M3b 的 `def.radius × entry.bossScale`（0.968 / 1.232），M4b 只重排了点位——南组 `spawnGroups['南'] = [(-6,0,30), (6,0,30)]`，巨型泰坦 `spawnPoints: ['南']` + `arenaGroup: '南'`，泰坦仍走西/东/北。`bag.bossArena = {minX:-22, maxX:22, minZ:14, maxZ:44}`（§7 决战段，南北正好 30m，含南组两点与 C 阶段复活点）；`spawn()` 只在 `entry.group === def.arenaGroup` 时挂 `e.arena`，移动后 `clamp` 到框内。**判断点**：① 测试直刷（不带 group）永远 `arena === null`，所以 tmp-m3b 的"冲刺位移 ≈16m"断言不受影响；② 玩家站在战场以北（z < 14）会把巨型泰坦钉在边界上原地打转，v1 接受（BOSS 不越界是 §7 的硬要求），M6 若要手感可改成"玩家脱离战场超过 N 秒才解除限制"。30 波数据 `groups` 已由 `['北']` 改 `['南']`，15/20 波泰坦不受限。
- **氛围与阴影**：`buildGiantLights` 的平行光阴影取景 `46×148`（`left/right ±46, top/bottom ±74, far 160`）覆盖 96m 长图，`shadowMap.autoUpdate = false` + 换图 `needsUpdate = true`（静态复烘）；点光数组新增 `(0, 7.2, 18)` 暖色作业灯照斜坡/装载甲板。雾仍是 `FogExp2` 0.0115，`useMap` 按 bag 换 `background/fogDensity`。M5 加补给点亮光、M6 加夜景都要重烘一次。
- **冒烟实测**（82 条断言全绿，页内定步长推进）：navAlly 规格/超集关系/车顶·斜坡·甲板格只友方可达/车头残骸顶面对谁都不可达/换图清流场 9 项；游骑兵车顶射击位 8 项（开局即在 3.2m、狙杀地面目标 80→0、耗弹 8→3、不离顶、地面怪 90/90 不掉血）；阵亡重生自行返岗 6 项；冲顶爬升 9 项（坡脚起步、中途经过 0.5–3.1m、走南端两条斜坡而非穿墙、车顶起爆对车顶玩家 60 伤、起爆后仍在顶面）；地面照常威胁 5 项（顶/西组标记、车顶无人时贴地、两只都贴脸起爆、高层队友抢仇恨）；BOSS 净空 10 项（0.968/1.232、三组 60 次采样 0 泄漏、白名单）；§7 战场 10 项（30m 纵深、绑定、战场外玩家仍触发冲刺、16m 冲刺被边界截住、追击北方玩家 20s 0 越界、仇恨不被战场改写、手刷 BOSS 与 15/20 波泰坦不受限）；30 波长图链路 7 项；练习模式零变化 9 项；氛围 5 项；45 同屏性能 4 项。
- **留给 M5/M6**：M5 的补给点位要避开 `bossArena`（否则 30 波 BOSS 踩点）；`squadPosts` 只有第三席在高处，若 M5 要给队友加高层专属指令需同步 `ui` 的岗位提示；火箭筒 2.5m AoE 记得沿用 `area()` 的 2.2m 同层门；冲顶自爆体在 navAlly 上每只一张流场（0.3s 节流），M6 若做 InstancedMesh/LOD 别把 `'e'+id` 流场并入地面层。

实现备忘（2026-10-15 追加：集装箱顶栈道 + 跨中央通道横桥）：

用户诉求"刷怪点的集装箱顶部加桥梁，可以从中间走过去"。四项定稿决策：横向跨通道连两侧（2 座，不做第 3 座南段横桥）、沿用南端两条 15° 斜坡上桥（不加北端额外坡道）、桥面 3.5m（实现取 3.6m，见下）、箱顶可站、不改队友与导航现有逻辑（接受近似）。

- **三条底层判定（这是本功能的真改动点，其余都是几何）**：
  - `floorAt(x, z, footY = Infinity)` 加第三参"脚底高度"：只在 `v ≤ footY + STEP_UP` 的面里取最高，**默认 `Infinity` 保留旧的全局最高面语义**，所以没传参的旧调用点（`markSpawnPoints/markRevivePoints/defensePost` 等）逐字节不变。桥下 `floorAt(..., 0) === 0`、不传参 `=== 3.6`，这就是"薄板是天花板不是墙"的判据来源。
  - 新增 `blocksAt(x, z, footY)`：一个面挡路的条件是"顶面高于 `footY + STEP_UP` **且** 板底 `bottom < footY + HEAD_CLEAR(=1.65)`"。`surfaces` 因此新增 `bottom` 字段：`platform()` 记 `top - thickness`，`slope()` 与箱顶 lid 记 `bottom: 0`（坡道和箱体从地面起就是实体，M4a 语义不变），桥 `bottom = 3.36` → 对地面单位是空气。`canStand` 的四向采样全部改走 `blocksAt`，`settleY` 传 `position.y` 当脚底。
  - `obstacles` 新增可选 `top`（可行走箱顶的盖板高度）：`canStand` 里 `fromY + STEP_UP >= o.top` 就跳过该障碍。于是 `container(x, z, w, h, d, mat, text, walkTop)` 的第 8 参打开箱顶——lid 面 `y = h + 0.16`、`bottom: 0`，脚底已在 3.36 的单位不再被侧壁挡住，`fromY = 0` 的怪照旧撞墙。**地面单位规则一行没动**，`nav` 地面层仍把箱/车顶标为不可通行，`navAlly` 自动覆盖新的整张高层网络。
- **`HEAD_CLEAR = 1.65` 与 `bridge()` 的几何**：桥面 0.24 薄板 + 0.55 护栏 + 防滑横纹 + `options.bearings` 桥墩（压在车顶钢板上）+ `options.name` 标识（沿 X 的桥 `rotation: 0`、沿 Z 的 `Math.PI/2`，沿用 M4a 的标识朝向结论）。
- **桥面为什么是 3.6 不是 3.5**：唯一台阶判据 `STEP_UP = 0.42`，车厢顶/装载甲板 3.2 → 3.5 差 0.3 能走，但箱顶 lid 有 3.36/3.46/3.51 三档，3.46 与 3.5 只差 0.04 会共面闪 z-fighting，3.51 又高于桥面变成反向台阶。取 3.6 让"车顶→桥"是 0.4m 台阶、"桥→箱顶"恒为向下 ≤0.24m，两个方向都在判据内。栈道面 3.62（比横桥高 2cm）纯粹为了接缝不共面。
- **点位（`buildGiantBridges()`，紧跟 `buildGiantCover()` 调用）**：西带栈道 `x -14.1..-11.9` 分 z `-11.5..-2`（W-1）与 `6..17`（W-2）；东带 `x 11.9..14.1` 分 z `-11.4..-10.2` 与 `-2..19`（E-2）；两座横桥 `x -12..12` 落在 z `-13.5..-11.5`（W1）与 `-3.5..-1.5`（W2）。六只掩体箱（`buildGiantCover`）第 8 参全部 `true`。
- **两个必须记住的坑**：① 纵向栈道必须完整盖住同侧箱与箱之间的空隙——留断口就是 3.4m 深的死槽，掉下去 `STEP_UP` 0.42 爬不回来（W-1/W-2 之间 z -2..6 的缺口是横桥 W2 接管的路径，不是断口）。② 横桥会从车顶上方跨过，游骑兵岗位 `(0, 3.2, -2)` 正好在 CROSSBRIDGE W2 的 footprint 里，`floorAt(footY=3.2)` 会把他抬上 3.6 桥面 → 岗位挪到两带之间的 `(0, 3.2, -7.5)`。
- **调用点补脚底高度**：`player.js` 重力与击退两处 `floorAt(..., this.position.y)`；`effects.js` 六处贴地调用传源高度（`position.y || 0` / `point.y || 0` / `p.p.y`），否则桥下的血雾/粒子/补给箱会被抬到桥面上；`squad.js` 的 `m.goal.y = world.floorAt(x, z, p.y)` 用队友自身高度。
- **冒烟实测**（页内定步长，`index.html` 与单文件版各跑一遍）：桥下 `floorAt(...,0)=0` 而不传参 3.6；箱顶 lid 3.36/3.46/3.51 可站、`fromY=0` 不可上；车顶全局最高仍 3.2 且地面单位不可上；`nav` 地面层封闭 / `navAlly` 箱顶开放；玩家四层（0 / 3.2 / 3.36 / 3.6）稳定站立、走出边界转自由落体；`segmentClear` 证明站桥面不是无敌点（地面射手能打到你）；高台链路 南斜坡→装载甲板→车顶→横桥→西带栈道→最北箱 全程不下坡；练习图 `surfaces.length === 0` 不变（`walkTop` 是 opt-in）；1500 帧波 13 模拟 0.18ms/帧、0 悬空/NaN 敌人。
- **单文件版同步方式（改了做法，后续沿用）**：`DEAD-SIGNAL-单文件版.html` 内联了压缩版 three.js（单行几十万字符），**不能整文件重拼**。按 `  <script>` / `  </script>` 行定位 11 个块（第 1 块是 three.js，跳过），其余 10 块与 `js/waves|world|audio|player|effects|enemies|squad|weapons|ui|game.js` 一一对应，逐行比对后整块替换（行内 splice，倒序应用避免索引漂移）。本轮只有 world/player/effects/squad 四块陈旧，替换后 10 块 diff 归零、body 与 styles.css 段 diff 归零。

## M5 · 补给与特殊武器（3 pd）— 已完成 2026-10-15（随 M6 一起提交 045faf3）

对应 §8、§10-9。

- 波间补给：4 固定点位轮换点亮（弹药×2+医疗×2），15s 窗口，同屏上限 8；击杀掉落寿命 35s→20s。
- 特殊武器替换手枪槽：R-80 火箭筒（4 发、2.5m 半径 450、装填 3.2s）、M-56 加特林（30s 持续弹、DPS×1.6、移速 -40%、禁跳）；死亡掉地可重捡、波终未捡消失；固定波 8/24/29 开局刷中央平台 + 15/20 泰坦必掉。
- BOSS 血条 HUD（泰坦/巨型泰坦，狂暴变色）。

验收：8 波开箱→换加特林→29 波怪潮体验；火箭筒对暴君/泰坦 AoE 伤害正确；补给点位轮换记录。

→ 达成：96 条 M5 断言全绿（tmp-m5.cjs，含 practiceZero 练习模式零变化 13 条）；同步回归 M3a 139、M3b 67、M4b 81/82（唯一未达是 perf45"45 同屏含渲染 <40ms"环境门：本机今日软件渲染抖动，用 `git show HEAD` 原版单文件同条件 A/B 实测 76–79ms vs M5 构建 79–83ms，无 M5 引入的渲染回归）。单文件版已重打包并在页内复跑 M5 全绿。

实现备忘（M5，供 M6 接续）：

- **模式开关全部走 `waveMode`**：`GIANT_MODE = { dropLife: 20, supplies: true }`、练习 `{ dropLife: 35, supplies: false }`。掉落寿命、浮字、波间补给、特殊箱一律读 `game.waveMode.dropLife / .supplies`，练习模式行为逐字节不变（practiceZero 13 条守门）。`effects.labelMode` 是**实时 getter**（不是构造期快照），菜单切模式后不必重建 effects。
- **4 固定补给点位**（`world.js` giant bag `supplyPoints`）：中央平台 ×2（-4.5,-24 / 4.5,-32）、**车身东侧平地 (7,4)**、出发区 (0,46)。两个判断点：① 原方案的车顶点 (0,4) 实测 `canStand=false`（floorAt=3.2 但徒步不可达），补给位必须是玩家能走到的格，故改到车侧地面；② 出发区点取 z=46，因为 `bossArena.maxZ=44`，30 波巨型泰坦踩不到补给位。类型每波随机洗牌分配（弹药×2+医疗×2），同屏上限 8（`effects.supplyLimit`），波末 `expireSupplies()/expireWaveDrops()` 统一过期。
- **拾取经济只有一个入口**：补给箱 = `weapons.addAmmo(90, 36)`（自然吃 420/180 上限）+ 医疗 35；旧击杀掉落仍是 60/24 + 医疗 30，两套数字分开断言。拾取门：水平 `d ≤ 1.45` 且 `|player.y - base| ≤ 1.2`（base 用 `world.floorAt`，车顶箱要站车顶才捡得到）。
- **特殊武器 = 手枪槽 + 一次性快照**：`weapons.grantSpecial(kind)` 首次把当前手枪 `Object.assign({}, items[1])` 存进 `this.special.pistol`，之后 `stowSpecial()/dropSpecial()` 都还原这份快照（期间 addAmmo 到手枪的量不回填，判断点已断言）。火箭/加特林耗尽或主动放弃自动回手枪。队友拾取走 `squad.pickups(m)` 的 `if (d.weapon) continue` 分支——**队友永远不吃特殊武器箱**（§4）。
- **玩家倒地掉枪**：`player.goDowned()` 调 `weapons.dropSpecial()`，箱子落身旁 0.5m 内、`waveEnd:true`（波末消失），爬起来踩回去可重新装备；练习模式没有濒死流程，不掉。
- **火箭筒两个关键判断点**：① 实现为**hitscan + 立即起爆**（不是飞行弹体）：`shoot()` 里对命中点 `enemies.explode(point, 2.5, 450)`，装填走既有 reload 机制（capacity 1 / reserve 3 / reloadTime 3.2s，耗尽自动开装、装完 1 发）。② **命中机体时爆点下移到该敌人脚下**（`hit.object.userData.enemy → enemy.root.position`）：泰坦 2.2 倍体型躯干在 ~2.9m，沿用 `area()` 的 2.2m 同层门会把直射目标自己筛掉（实测 0 伤害），落脚下后同层门语义与"只伤地面邻怪"都不变（车顶目标 450→0 断言在案）。火箭不吃暴君步枪减伤（weapon 传 'rocket'）。
- **加特林数值链**：`43 × (1/0.105) ≈ 410 DPS ≈ 步枪 257 × 1.6`；30s 持续弹用 `weapons.specialTimer`（HUD 弹药位显示 ceil(specialTimer)、备弹位 '∞'）；`weapons.heavy` getter → `player.js` 移速 `(sprinting?7.3:4.5)*0.6` 且 `jumpQueued` 被吞（实测 4.50→2.70 m/s、切回步枪同帧解除禁跳，velocityY 阈值 >5.5 起步）。
- **投放波次表**（waves.js 数据，`specialBox/specialWeapon`）：8/24=gatling、15/20/29=rocket。开局箱在 `game.startWave()`（`cfg.specialBox && !cfg.boss`）刷 `world.specialBoxPoint`（中央平台 (0,-28)）；15/20 泰坦必掉走 `enemies.onBossDeath` 接缝（M3b 留的），落点=泰坦死亡位置；30 波巨型泰坦不带 specialBox 不掉箱；`game.newGame()` 里挂接。
- **BOSS 血条**：`ui._updateBoss()` 读 `enemies.boss`，死亡/离场即 `hidden`；狂暴变色只有巨型泰坦（§7，`e.rage` 由 `BOSS_BEHAVIOR.think` 在 hp≤40% 置位，think 有 0.45s 出生动画门，测试要 step≥40 帧）。小地图新增补给（绿/琥珀 6px）与特殊武器箱（紫 7px）图例。
- **ui.update 位置（本里程碑踩过坑）**：曾把 `ui.update(dt)` 移出 `game.update()` 到 rAF 循环节流，导致 M3a/M4b 依赖"步进即刷 UI"的断言全红，已还原——**M6 若重做这个优化，必须同步给 tests/*.cjs 提供显式 `g.ui.update(dt)` 钩子**。
- **单文件打包**：拼接脚本一律用 `replace(str, () => content)` 函数形式——字符串形式会把内联 three.min.js 里的 `$&/$`/$'` 当捕获模式展开，实测往 bundle 里注入 `</body>` 直接砸烂解析（HEAD 版无此问题）。
- **留给 M6 的调平项**：补给数量/点位密度（现在 4 点各 1 箱，M6 可按难度倍率增减）；加特林 30s 全程 DPS 实弹耗与步枪对照手感复核；火箭 4 发对泰坦 450×4 vs 6000 血的清场节奏；`perf45` 渲染门在 InstancedMesh/LOD 落地后重新校准阈值；难度倍率（hard/nightmare）目前只作用敌人，不改补给/箱量，M6 决定是否随难度。

## M6 · 调平、性能、结算与打包（3 pd）— 已完成 2026-10-15

对应 §9、§10-8。

- 计分接入：击杀表分、波次 300+无复活 100、BOSS 分、难度/硬核倍率、队友 60% 折算。
- 结算面板：到达波次、爆头率、币耗、用时、队伍存活榜；失败界面保留击杀分。
- 性能：**距离 LOD**（弃 InstancedMesh，理由见备忘）+ 黑雾表现层减负 + 新性能门重校准。
- 三难度数值表落地复测（高级/噩梦兵力取整）。
- `tests/tmp-m6.cjs`（12 case / 117 条断言，含**全 30 波快进冒烟 `fullRun30`**）；重建 `DEAD-SIGNAL-单文件版.html`（行块 splice 打包法）。

验收：完整通一次 30 波（可用调试跳波），普通难度总时长目标 60–75 分钟；单文件版双击可玩。
  → **节奏目标已于 2026-10-15 定稿改口径为"普通难度 30–45 分钟"，兵力/血量数值表与间奏一律不动**（推导见下方"节奏"条目）。其余验收项达成。

→ 达成：tmp-m6 117 条全绿（开发页与单文件页各跑一遍，单文件页 117/117）；同步回归 **M3a 139 / M3b 67 / M4b 82 / M5 95 = 383 条全绿**，两页控制台 0 报错（只有 three r160 的 min 版弃用警告）。30 波长图链路实测：`won / 30 / 30`、24601 帧定步长（模拟 13.7 分钟战斗）、峰值同屏 45 不越界、15/20/30 三次 BOSS 全部刷出并击杀、每波 4 箱补给、波次分 12000 与击杀分逐笔吻合。唯一与原文有出入的是节奏：按血量预算建模只有 21–35 分钟，已与你确认把目标口径改到 30–45 分钟、不动数值表（见下方"节奏"条目）。

实现备忘（M6）：

- **计分链路只有一个入口**：击杀分写在 `enemies.damage()` 的死亡分支——`unitId === 0` 走 `round(score × (headshot ? 1.5 : 1))` 并同时累加 `kills/headshots`；`unitId !== 0`（队友）走 `round(score × 0.6)`，**不记 kills/headshots、不驱动每 5 杀医疗 / 每 3 杀弹药掉落**。`game.killScore` 与逐笔累加在 30 波实跑里分毫不差（174734/174734）。波次分写在 `game.update()` 的结算分支：`waveMode.waveScore(300) + (waveCoins === 0 ? noReviveBonus(100) : 0)`，`waveCoins` 在 `startWave()` 清零、`player.tryRevive()` 里 +1。总分只有一处乘法：`game.finish()` 的 `mult = waveMode.scoreMultiplied ? difficultyConfig.scoreMultiplier × (hardcore ? 1.5 : 1) : 1`，`finalScore = round(score × mult)`。练习模式三个字段（`waveScore 250 / noReviveBonus 0 / scoreMultiplied false`）就把 §9 整条规则从练习图里摘干净，`practiceZero` 5 条守门。
- **爆头优先于暴君减伤（M3a 留下的复核项，结论：保留现状）**：`rifleResist 0.2` 只在 `weapon === 'rifle' && !headshot` 生效，×2 发生在 `weapons.js`（`gun.damage × (headshot ? 2 : 1)`），减伤发生在 `enemies.damage()`。实测步枪 27 → 躯干 **21.6**、爆头 **54**；暴君 500 血 → 躯干 24 发、纯爆头 10 发。判定成立且方向正确（爆头永远不比躯干更差），不改代码。
- **threat「记忆优先、无记忆最远」结论：保留**。§7 原文只说"最远仇恨"，实现是 `memory + d × 0.01`（40 分伤害记忆 > 任何距离差）。实测：无记忆时选 20m 处、有记忆时 3m 处的近身单位反超——正是"打了 BOSS 它就盯你"的手感，比纯最远更可解释，写进本节作为定稿。
- **冲顶自爆体的 +40 同层偏好结论：保留**。实测车顶有队友时，'顶'组自爆体 3 次全部改咬高层队友（普通自爆体 0 次，仍打玩家）。这不是 bug：地面怪照旧被玩家吸走，冲顶个体专门处理高台，两条线不打架。
- **BOSS 开局缓冲与技能窗口定稿**（M3b 自定值，本轮逐项实测）：`chargeCd 3s / slamCd 5s / summonCd = every × 0.6 = 12s`；接触近战 CD 泰坦/巨型泰坦 2.0s（普通 1.1、暴君 1.7）；震波**只在跌破 60% 血时结算一次**（`skill.quakeDone` 锁定，实测 0→1→1），狂暴在 40% 触发（速度 3.3、CD×0.6、砸地 5m→6.5m）；连砸一次 2 下、实测间隔 **0.517s**，收尾 `slamCd` 回到 `bossCd(8)`（狂暴态 4.8，实测 4.43 是空跑帧扣的）。全部维持，不再动。
- **雾散体参数维持** `every 6 / radius 6 / life 8`（无开局折扣）；黑雾表现层改的是不透明度的**双层分工**：体团 `opacity` 上限 0.82→**0.5**，贴地 skirt **0.78** 并换成径向 `alphaMap` 羽化（`makeFogEdge()`），看着比单层更"有厚度"、overdraw 更少。
- **补给/箱量不随难度**（M5 抛出的问题，结论：不变）。三难度 `spawnWaveSupplies()` 都点 4 箱（弹药×2+医疗×2），hard/nightmare 只放大敌人。理由：补给位是固定点位池（4 点、上限 8），加量会逼 M4b 的 `bossArena` 与点位重排，而难度已经通过 2.2× 血量和 1.35× 兵力给了压力。
- **加特林/火箭对 BOSS 的节奏（实测，作为调平依据而非改动）**：加特林 30s 全程 **285 发 / 12255 理论伤**——单挑泰坦（6000）够、单挑巨型泰坦（15000）**不够**，必须留步枪收尾；火箭 `450 × 4 = 1800`，泰坦需 14 发、巨型泰坦需 34 发，所以它是"破阵/清群"手段而不是 BOSS 杀器。两处都符合 §7 的意图，数值表不动。
- **性能方案：距离 LOD，不是 InstancedMesh**。三个硬约束决定了选型——① 每只有独立 `skin/cloth/eye` 材质实例做暴君闪烁与狂暴变色，② 走路/冲刺/砸地是逐怪骨骼式动画，③ 射线命中要 `hitTargets()` 返回真实 Mesh（LOD 只关 `e.detail` 与 `e.shadow`，命中盒 40 个不随档位变化，已断言）。InstancedMesh 要同时放弃这三项。实现：`lodNear 26 / lodFar 52`，非 BOSS 每 0.35s 依相机**水平**距离重算，0 档全开 / 1 档收装饰 / 2 档再收地面投影，BOSS `lodLevel` 恒 -1。测试把两阈值置 1e9 即关闭 LOD 做 A/B。
- **新性能门口径（`perfLodAB` 6 条）**：45 同屏（档位分布实测 23/11/11）+ 6 团黑雾 + 静态阴影同场。① 纯模拟 `g.update` **<8ms/帧**（实测 LOD 2.55 / 全细节 2.62）；② 带渲染帧 **<160ms 且 LOD ≤ 全细节 ×1.1**（实测 LOD 20.1 / 全细节 25.1）。绘制量对照必须**冻在同一帧**（`world.render()` 只读 `renderer.info`）：A/B 各自推进模拟的话，粒子/尸体/位移噪声会盖过 LOD 省的几百个三角形——实测这样会得到"LOD 反而多 1%"的假负结果。冻结后是 **25014 vs 25922 三角形（省 3.5%）、1382 vs 1454 draw call**。
- **绝对帧时不能当 60fps 证据**：本机是 SwiftShader 软渲染 + `document.hidden === true`（内部浏览器窗口不可见），空场景单次 `render()` 就从 11ms 涨到 53ms。所以门限取"160ms + A/B 相对"而不是"16.7ms"，断言 info 里固定打印 `document.hidden`，并且 A/B 交替跑三轮各取最小值（抖动能到 1.5×）。真 GPU/可见窗口的 60fps 结论要另测。
- **`fullRun30` 的取样口径**：`g.update(1/30)` 定步长 + 间奏压到 0.2s + **每 600 帧全清一次**（早期版本每 12 帧全清，结果同屏峰值只有 2、队友 0 击杀，"45 同屏不越界"和"队友 60% 折算"两条断言全测不到东西）。改节奏后：峰值 45、玩家 800 杀 / 队友 119 杀、六敌种全上场、`killScore` 与逐笔记账吻合。
- **结算面板**：`ui._fillResult()` 输出 到达波次 `N / 30`、击杀/爆头 `N / N`、爆头率 `round(headshots/kills×100)`（kills=0 → 0%）、币耗、`_formatTime` 用时、计分明细串 `(击杀分 <b>N</b> + 波次分 <b>N</b>) × 难度 <b>×m</b>[ × 硬核 <b>×1.5</b>] = 总分 <b>N</b> · 队友击杀 N（按 60% 计入）`、队伍存活时长榜（按 `member.aliveTime` 久→短）。失败文案用 `deathWave`（只在 `finish(false)` 赋值）并保留击杀分。
- **本轮修掉的一个真实 bug**：`_fillResult()` 在 `!giant`（练习模式）早退，而队伍存活榜的可见性处理写在早退**之后**，导致练习局结算面板残留上一局的榜单。已把 `result-squad-board` 的 `hidden` 与列表清空提到早退之前（`js/ui.js:549` 附近）。这是 `practiceZero` 断言逼出来的，不是测试问题。
- **单文件打包法（替代 M5 的 replace 拼接）**：`DEAD-SIGNAL-单文件版.html` 内联 67 万字符的 three.min.js 单行，任何 `replace(str, content)` 字符串形式都会把内容里的 `$&` 当捕获模式展开，实测会注入 `</body>` 砸烂解析。改为**行数组定位 + 倒序 splice**：以 `  <script>` / `  </script>` 独立行定位 11 组块（第 1 组是 three，永不改写），后 10 组按 index.html head 顺序对应 `waves/world/audio/player/effects/enemies/squad/weapons/ui/game.js`，另加 `<style>`（← `styles.css`）与 DOM 段（`<body>` 起、到第一个 `<script>` 止，因为单文件版把脚本搬到了 body 尾部）。写完后重新读回自校验：块数、three 块 FNV hash 逐字节不变、每块以源文件首尾行匹配、`</body>` 唯一。同步完成后再跑一次是 NOOP（幂等）。
- **测试环境已从 CDP 换到内部浏览器**（本轮指示）：`tests/browser.cjs` + `:9223` 专用 Chrome 那条路弃用（`.chrome-dbg/` 空转，可删）。页内通路是 `http://127.0.0.1:8080/…?v=<bust>` → 注入 `__load(file, global)`（`fetch('/tests/<file>.cjs', { cache: 'no-store' })`，用 `new Function('require', …)` 重建 HELPERS/CASES，`require` 必须是**返回 fake 的函数**而不是 fake 本身）+ `__go(file, global, names)` 顺序跑 case 写 `window.__P`，再用独立 evaluate 轮询读数（MCP 单次调用 15s 超时，长 case 必须 `setTimeout` 后台启动）。**页面 reload 会销毁 harness，要重新注入**；注入脚本必须整段发送，截断会被权限分类器拦下。
- **节奏（M6 复核结论 + 2026-10-15 定稿）**：30 波对不上原 60–75 分钟目标——normal 难度全 30 波共 **945 只 / 总血量 121,100**，投放窗口 499s、间奏 29×15=435s；步枪 257 DPS 打满 7.9 分钟，55% 有效 DPS 约 14.3 分钟，加上间奏也只有 ~22 分钟（悲观真人 25% 效率估到 30–45 分钟）。这是设计目标与 §5/§6 已定稿兵力/血量表之间的冲突，不是实现缺陷。**你的拍板：数值表与间奏都不动，目标口径改成"普通难度 30–45 分钟"**，所以本节只留测量结论、不留待办。当时列过的备选（若日后要拉长再回来选，均已否决）：① `intermission 15→30s` + 拉开投放间隔；② `DIFFICULTY.normal.hp 1→1.6` 或 21 波后分段加成；③ 延长到 40 波。注意 `resolveStats` 的血量是 `round(def.hp × diff.hp)`，改倍率会覆盖全 30 波并被 `difficultyTuning` 18 条立刻抓到取整不一致。
- **留给后续（若有 M7/真机测试）**：真 GPU + 可见窗口的 60fps 复测（本门限是软渲染后台窗口的保守值）；真人 30 波计时，用来验证"30–45 分钟"这个新口径。`tmp-m6.cjs` 里 `perfLodAB` 的三轮 A/B 在慢机上单次要跑 3–5 分钟，若进 CI 需要拆成 draw-stat 与 timing 两条。

## M7 · 表现层欠债、最佳纪录与真机收尾（4 pd）— 已完成 2026-10-15

对应 §9（最佳纪录，不做完整排行榜）+ M3b 遗留的 BOSS 模型欠债（本文档 M3 节"留给 M6 调平"末行）。

### BOSS 独立骨架（js/enemies.js）

- **建模分支**：`buildBody()` 首行 `if (enemy.boss) { this.buildBossBody(enemy, shape); return; }`，walker 系完全不走这条路径。`SHAPES.titan/megaTitan` 换独立配色（skin/cloth/plate + horns 1/2、mega 加背刺）。
- **骨架结构（判断点）**：新增 `lean` 俯仰骨 Group（挂在 root 下、y=0.98），胸甲/宽肩甲/驼背/头/角全部挂它——**animate 的前倾只写 `lean.rotation.x`，绝不碰 `root.position/rotation.x`**（root.rotation.x 归死亡动画在用）。四肢仍是 `limbs` 四枢轴（push 顺序先腿后臂）+ `head` 引用，M3b 起的断言结构不破。`enemy.bossRig = { lean, legL, legR, armL, armR, head }` 供调试取用。
- **命中件（判断点）**：`part()` 造的躯干件（胸/头/上臂/前臂/拳）进 `hitTargets()` 且留在躯干包络内，`hitTargets()` 只增不减；眼/头冠/巨角/背刺/脚掌等装饰走 `decor()` 只进 `e.detail`——BOSS `lodLevel` 恒 -1，detail 分组语义照旧安全。头件保留 `userData.headshot`。
- **动画状态机**：`BOSS_BEHAVIOR.animate` 全重写，对齐 `skill.phase` 与 `sk.wind`，只改旋转：idle 践踏步态（高抬腿，gait 随 `|walk|` 淡入）、chargeWind 双臂后摆上抬（k 由 `1 - sk.wind/def.charge.windup` 驱动）、charge 前倾 0.62 + 高频刨地、slamWind/slamGap 单腿上抬 + 双臂过顶、impact 落地跺压。`sk.impact = 0.3` 是新增的落地计时（`bossSlam()` 置位、animate 每帧自减消费），spawn 初始化 `impact: 0`。
- **狂暴换色**：保留 animate 内 `e.skin/e.cloth/e.eyeMaterial` 的 setHex 路径（tmp-m3b rage 断言锁精确色 0xa8281a/0x6e150f/0xff4a2a），新增 `e.plate.emissive.setHex(0x4d130d)` 同步烧红胸板；`remove()` 里补 `plate.dispose()`。
- **数值判定零改动**：15000 血、bossArena 30m、净空 1.232 等全部原样，tmp-m3b 的 charge/slam/megaSkills/rage 六组断言在开发页与单文件页均全绿。

### 最佳纪录（§9，localStorage）

- **入口 `DZ.best`（js/game.js，Game 类之前）**：`key(mode) = 'dead-signal.best.' + mode`（giant/practice 各一条），entry 结构 `{ score, wave, difficulty, time, date }`；`submit()` 只在 `entry.score > previous.score` 时写入并返回 `{ previous, isNew }`，localStorage 抛异常（隐私模式）静默吞掉。
- **落盘时机**：`finish()` 里 finalScore 算完之后，`score = finalScore`（含难度/硬核倍率后的总分，不是裸击杀分），mode 取 `waveMode.key || Settings.mode`；`bestRecord/bestEntry/newRecord` 三个字段在 constructor 与 newGame 双处重置。
- **UI（判断点）**：结算面板新增"历史最佳"格 + `result-record` 新纪录徽标，填充代码写在 `_fillResult()` 的 `!giant` 早退**之前**（M6 的练习模式残留 bug 教训）；主菜单 `menu-best` 条在 `setScreen('menu')` 与 `refreshSettingsUi()` 两个入口刷新，切模式即换纪录。

### 真机收尾与回归

- **视觉冒烟（单文件页，截图存 tests/tmp-m7-*.jpg）**：titan 践踏动态（宽肩小头双角剪影，与 walker 明确区分）、slamWind 双臂过顶、chargeWind 抬臂前倾、megaTitan 狂暴全场烧红（emissive a8281a 实测在图）。内置浏览器面板不可见导致 `take_screenshot` 拿不到 surface，改走页内 `toDataURL` + 临时 8081 接收服务落盘（脚本用完已删）。
- **回归（开发页与单文件页双份，全绿）**：tmp-m3a 139 / tmp-m3b 67 / tmp-m4b 82 / tmp-m5 **95**（排期备忘写的 96 是笔误，两套页面实测断言数都是 95）/ tmp-m6 117；C 步最佳纪录 7 条断言（落盘字段、结算显示、低分不破、高分刷新、practice 独立 key、菜单显示、切模式换纪录）双页全过。控制台无游戏侧 error。
- **打包**：`DEAD-SIGNAL-单文件版.html` 用行块 splice 法重打（three 块 FNV hash 不变、10 个 JS 块 + style + DOM 段逐块 MATCH、`</body>` 唯一、二次跑幂等 NOOP）。
- **仍遗留（不阻塞）**：M6 备忘里的"真 GPU + 可见窗口 60fps 复测"与"真人 30 波计时验证 30–45 分钟口径"两项需要真人真机，本轮未覆盖。

## W · 武器五槽改造（追加，不计入排期）— 已完成 2026-10-15

对应决策（2026-10-15 拍板）：1 步枪、2 手枪不变；3 手雷、4 军刀、5 狙击枪。① 手雷初始 4 / 上限 6；② 开镜要移速惩罚；③ 狙击要开镜；④ 手雷对 BOSS 减半；⑤ 双模式都吃五槽；⑥⑦ 按推荐（军刀弧内小怪必杀、特殊武器改占 5 号狙击槽）。

### 槽位与输入（js/weapons.js / js/player.js）

- 五槽顺序固定 `rifle,pistol,grenade,knife,sniper`，数字键 1–5 直切（`Digit1–5` → `switchTo(0–4)`），复用 0.22s 切枪硬直。`DZ.SLOT_LABELS` 提供 HUD 槽位文案。
- 开镜（判断点）：`mousedown` 按钮 2 且 `weapons.canScope`（= 武器定义 `scopes` 为真且不处于装填）才置 `player.scoping`；`mouseup`/`switchTo`/`reset`/`goDowned` 全部清零。开镜效果集中在两处：`syncCamera` FOV `16`（对照 sprint 81 / 常态 75），mousemove 灵敏度 `0.0007`（常态 0.00185）；移速乘子 `(scoping ? 0.55 : 1)` 且禁疾跑禁跳。
- 持刀增益：`get speedMul()` 读武器定义字段（knife 为 `1.15`，其余 `1`），player 移速公式直接相乘；加特林 `heavy ×0.6` 逻辑不变。
- 武器定义收敛（2026-10-16）：七把枪的静态数据集中在 `js/weapons.js` 顶部的 `WEAPONS` 注册表并导出 `DZ.WEAPONS`，行为与呈现都靠字段表达——`fire`（hitscan/melee/throw）、`scopes`/`heavy`/`speedMul`、`headshotInstakill`、`dryMsg`/`sustained`/`pickupToast`、`viewX`/`spreadStep`、`mode`/`ammoStyle`、`sound`（音效配方，audio 直接播）。HUD、音效、移速、开镜四处不再按 `type` 字符串分支。

### 手雷（3）

- 投掷链：`shoot()` 对手雷走 `throwGrenade()`（抛物线初速 `dir*13 + up 4.4`、间隔 0.9s、空投只给 0.25s 硬直 + toast，不落武器）。`effects.grenades` 池上限 12，重力 16、落地 `floorAt+0.09` 反弹（vy×-0.32/水平×0.62）、引信 1.1s 到点 `enemies.explode(p, 5, 350, 'grenade')`。
- 经济（判断点）：**波间不自动补**——game.js 的 `addAmmo(60, 24)` 老式两参调用刻意不给手雷；只有弹药箱 `+1`（未满时）。数值复核：对无 BOSS 目标中心 350、半径 5m。
- 对 BOSS 减半（④）：`enemies.damage()` 内 `weapon==='grenade' && enemy.boss → amount*=0.5`，放在暴君步枪减伤之后、爆头倍率与狙击必杀之外互不影响。

### 军刀（4）

- 弧线斩：`melee()` 判定 `dot(归一化 xz 方向) >= cos(arc)`，arc=1.0 即 ±57.3°（不是 ±arc/2，曾按半角写导致 40° 目标被判不出圈）。射程 2.6m、间隔 0.55s；普通小怪直接 `hp+1` 必杀，泰坦/巨型泰坦 150、暴君 60（按 `e.type==='tyrant'`，`e.def.type` 不存在）。
- 挥砍表现 `effects.slash`（RingGeometry 圈 1.6→2.3 缩放淡出）；HUD 弹药位显示 `∞`。

### 狙击 M-21（5）

- 面板：弹体 250 / 间隔 1.3s / 弹匣 5 / 备弹 25 / 装填 2.6s；爆头规则（判断点，shoot() 内）：`sniper && headshot && !enemy.boss → enemy.hp+1` 一击必杀，BOSS 保留 ×2 头倍率（=500），躯干恒 250。开镜时散布 `accuracy + movingSpread + spread*0.05`（腰射 ×0.12）。
- 备弹上限 40：所有入弹走 `addAmmo(…, sniper, …)` 统一 `Math.min(40, …)`。

### 特殊武器改占 5 号槽（⑦）

- M5 的加特林/火箭筒不再替换手枪槽：`grantSpecial/stowSpecial` 快照对象由 `special.pistol` 迁移为 `special.sniper`（items[4] 整槽冻结、补给路由到快照），文案 "替换狙击槽"/"换回 M-21"，耗尽提示同步（'M-56 弹链打空 · 换回 M-21'）。手枪从此永久安全。
- `addAmmo(rifle, pistol, sniper, grenade)` 四参（NaN 防护：`sniper && sniperSlot.reserve != null`，兼容 game.js:319 两参老调用）。

### HUD 与表现（js/ui.js / index.html / styles.css / js/audio.js）

- `weapon-mode` 读武器定义 `mode`（单发/MELEE/投掷/BOLT/AUTO/SEMI），弹药位与备弹位与 aria 说明按 `ammoStyle`（magazine/held/infinity/timer）四种画法分支；`weapon-slots` 取 `DZ.SLOT_LABELS[index]`；空仓红字只对 `typeof ammo==='number'` 生效（军刀不亮）。开镜 overlay `#scope`（径向渐变镜筒 + .v/.h 十字线），`ui.update` 里与 `crosshair.hidden` 互斥切换（依赖全局 `[hidden]{display:none!important}`）。三把新枪各有 buildModel 视图模型与 muzzleOffsets 条目；七把枪的开火音统一为 `DZ.WEAPONS[type].sound` 层数组，由 `audio.shot()` 播放（2026-10-16 补齐此前缺音的火箭筒与加特林）。帮助页/暂停页文案改 1–5 与 RMB 开镜。

### 测试与回归

- 新增 `tests/tmp-w.cjs`（4 case / 53 断言：slotsHud/grenadeKit/knifeKit/sniperKit）。页内定步长驱动，沿用 browser-sim-stepping 约定。
- **测试侧教训（写死在 helper 里）**：① `aimAt` 的 pitch 必须 `atan2(v.y - eye, horiz)`——本代码库 `rotation.x` 正值抬头，符号写反时打 4.3m 高的泰坦头会把弹道按到地面（伤害 0）；② 瞄头前必须 `player.kick = 0`，上一发狙击后坐 0.05 就足以把 12–14m 的头判定盒整个抬掉（实测 kick 0.045 全脱靶）；③ 走廊上方有箱顶栈道拦高弹道，BOSS 爆头用 `aimClear` 逐级拉近找净空射击线；④ `runMetered` 测速前清场（活体暴君/泰坦的击退会把开镜 2.475m 打断成 1.39m）。
- tmp-m5 快照断言改为狙击槽语义 + 封顶 40 口径（`w.addAmmo(0,0,36)` 记到 `special.sniper`，40 封顶）。
- 全量回归（开发页 + 单文件页双份全绿）：tmp-w 53 / tmp-m5 96（supplyCycle 医疗/弹药分支导致 95–96 浮动，非回归）/ tmp-m6 117 / tmp-m3a 139 / tmp-m3b 67 / tmp-m4b 82；控制台仅 three r160 弃用警告。
- **旧套件在页内 harness 的接缝**：m3a/m3b 的 case 不自带 boot，须先 `__M3.boot('giant')`（m3a）或逐 case `setup(15)`（m3b）/按原 node runner 参数表 `setup(wave, opts)`（m4b），否则 resolveStats 走 dataDriven=false 回退 walker、`M.spot` 为空。

### 打包

- `DEAD-SIGNAL-单文件版.html` 行块 splice 重打：本次 12 段中 8 段替换（style/DOM/audio/player/effects/enemies/weapons/ui），three 块 FNV `40840b5` 不变、`</body>` 唯一、二次运行 12/12 MATCH（幂等），总行数 5754。打包脚本为一次性 `tests/tmp-pack.cjs`，跑完即删。

## 里程碑外的备忘

- ~~现有 5 波模式是否保留~~ **已确认（2026-10-12）**：保留为"短图练习模式"，菜单二选一——`巨人城 · 30 波防守`（新主模式，走 M0–M6 全套）/ `隔离区 07 · 5 波练习`（现有 48×48 图与玩法原样保留，不加队友与复活币）。M0 的开局设置 UI 需包含模式选择；M4 地图重建不动旧图资产，两套场景共存按模式加载。
- 黑雾对后处理的影响、加特林旋转模型属于表现层，任何里程碑内不阻塞规则验收。
- 风险最高两项：M4 的 Y 轴碰撞改造与 M2 的仇恨/流场多目标——若受阻，先在 48×48 图做规则版、把 M4 顺延为最后一块拼图（不改变验收标准）。
