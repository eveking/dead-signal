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
| M4 | 地图重建（96×48 长图 / 可行走车顶 / 三路线）🟡 M4a ✅ 2026-10-14，M4b 待做 | 5 pd | M0（可与 M1–M3 并行或插入） |
| M5 | 补给点位 + 特殊武器 + BOSS 血条 | 3 pd | M3, M4 |
| M6 | 调平、性能、结算与打包 | 3 pd | M5 |

合计 ≈ 27 pd。串行做约 5–6 周；若 M4 提前并行可压缩到 4 周左右。

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

- `player.js`：倒地进入 3 秒濒死读条（不再直接 `finish(false)`）；读条中按确认键消耗 1 币 → 前线复活点重生（波 1–9=A，10–24=B，25–30=C）+ 50 HP + 5 秒无敌（免疫伤害与击退）；币 0 或读条走完 → 失败结算（显示到达波次）。
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
- **留给 M6 调平（M3b）**：BOSS 开局缓冲 `chargeCd 3s / slamCd 5s / summonCd = every×0.6`、接触近战 CD 2.0s 都是实现自定；BOSS 沿用 walker 模型 × scale，M4 之后需要独立骨架（践踏/抬臂/砸地的剪影区分）。



## M4 · 地图重建（5 pd）— M4a 已完成 2026-10-14（几何 + 垂直移动），M4b 待做

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

验收（M4b）：车顶队友射击位、自爆体冲顶、BOSS 净空与 30m 限制、完整 30 波长图体验 + 性能。

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

## M5 · 补给与特殊武器（3 pd）

对应 §8、§10-9。

- 波间补给：4 固定点位轮换点亮（弹药×2+医疗×2），15s 窗口，同屏上限 8；击杀掉落寿命 35s→20s。
- 特殊武器替换手枪槽：R-80 火箭筒（4 发、2.5m 半径 450、装填 3.2s）、M-56 加特林（30s 持续弹、DPS×1.6、移速 -40%、禁跳）；死亡掉地可重捡、波终未捡消失；固定波 8/24/29 开局刷中央平台 + 15/20 泰坦必掉。
- BOSS 血条 HUD（泰坦/巨型泰坦，狂暴变色）。

验收：8 波开箱→换加特林→29 波怪潮体验；火箭筒对暴君/泰坦 AoE 伤害正确；补给点位轮换记录。

## M6 · 调平、性能、结算与打包（3 pd）

对应 §9、§10-8。

- 计分接入：击杀表分、波次 300+无复活 100、BOSS 分、难度/硬核倍率、队友 60% 折算。
- 结算面板：到达波次、爆头率、币耗、用时、队伍存活榜；失败界面保留击杀分。
- 性能：敌人 InstancedMesh 或距离 LOD，45 同屏 + 黑雾 + 阴影稳定 60fps（低配 1.5 pixelRatio 策略沿用）。
- 三难度数值表落地复测（高级/噩梦兵力取整）。
- 重建 `DEAD-SIGNAL-单文件版.html` 打包；`tests/browser.cjs` 增加全 30 波快进冒烟脚本。

验收：完整通一次 30 波（可用调试跳波），普通难度总时长目标 60–75 分钟；单文件版双击可玩。

## 里程碑外的备忘

- ~~现有 5 波模式是否保留~~ **已确认（2026-10-12）**：保留为"短图练习模式"，菜单二选一——`巨人城 · 30 波防守`（新主模式，走 M0–M6 全套）/ `隔离区 07 · 5 波练习`（现有 48×48 图与玩法原样保留，不加队友与复活币）。M0 的开局设置 UI 需包含模式选择；M4 地图重建不动旧图资产，两套场景共存按模式加载。
- 黑雾对后处理的影响、加特林旋转模型属于表现层，任何里程碑内不阻塞规则验收。
- 风险最高两项：M4 的 Y 轴碰撞改造与 M2 的仇恨/流场多目标——若受阻，先在 48×48 图做规则版、把 M4 顺延为最后一块拼图（不改变验收标准）。
