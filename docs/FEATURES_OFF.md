# 已移除功能登记表 (FEATURES_OFF)

为缩减 engine.ts 拆分前的工作量,以下功能被临时移除。每个功能对应一次独立 commit,
恢复时可用 `git show <commit>` 查看完整原始代码,或直接 cherry-pick 后按新架构重新接线。

| 功能 | 移除 Commit | 移除日期 | 原始代码位置 |
|---|---|---|---|
| 成就系统 | `90c4c17` | 2026-11-03 | `src/game/achievements.ts`, `src/components/AchievementToast.tsx` |
| 剧情/地标/信号阵列 | 本 commit | 2026-11-03 | `src/game/landmarks.ts`, `src/data/storyLandmarks.ts`, `src/components/StoryJournalModal.tsx`, `src/components/RadarWidget.tsx` |
| 多人模式 | 本 commit | 2026-11-03 | `src/game/multiplayer.ts`, `server.ts`, 见 §3 |
| 程序化岛屿与采集 | 无独立 commit（2026-11-04 工作区删除） | 2026-11-04 | `src/game/systems/environment/islands.ts`，见 §4 |
| 钓鱼 | 无独立 commit（2026-11-04 工作区删除） | 2026-11-04 | `src/game/systems/fishing.ts`，见 §5 |
| 漂流商人与交易 | 无独立 commit（2026-11-04 工作区删除） | 2026-11-04 | `src/game/systems/merchant.ts`, `src/data/merchant.ts`, `src/ui/components/MerchantModal.tsx`，见 §6 |
| 碎片压缩机 | 无独立 commit（2026-11-04 工作区删除） | 2026-11-04 | `src/ui/components/CompactorModal.tsx`，见 §7 |

---

## 1. 成就系统 (Achievements)

**移除理由**: 移除时发现该系统已处于半失效状态 —— engine 只接了存档读写和解锁
toast,但没有任何 `achievementManager.track*()` 调用,里程碑永远不会累计,成就
实际上无法解锁。恢复时应同时补上埋点调用。

**玩法规格**:
- 10 项成就,基于 `PlayerMilestones` 计数器: 捕鱼数、木筏板块数、总建筑数、
  存活天数、挂钩残骸数、烹饪餐数、净水次数、击退鲨鱼次数、海岛采集数、合成物品数
- 里程碑持久化在 localStorage (`raft_3d_milestones_v1` / `raft_3d_achievements_v1`)
- 解锁时弹 toast + 播放 `soundManager.playAchievementUnlocked()` 音效
- 该音效方法保留在 soundManager 中(击杀鲨鱼的 fanfare 仍在使用)

**恢复要点**:
- 类型: `types/game.ts` 中的 `Achievement` / `AchievementCategory` / `PlayerMilestones`
- 接线: engine 构造函数中 new AchievementManager(callback);在捕鱼/建造/天数推进
  等事件处补 track 调用;saveWorld/loadWorld 写读 `milestones` + `unlockedAchievementIds`
- UI: App.tsx 挂 AchievementToast 组件 + `onAchievementUnlocked` 回调

## 2. 剧情/地标/信号阵列 (Story / Landmarks / Signal Array)

**移除理由**: 与建造、交互、存档系统纠缠深,是拆分 engine.ts 前最大的纠缠源。

**玩法规格**:
- 8 个 3D 剧情地标散布海上 (Sunken Beacon, Leviathan Wreck, Redwood Atoll,
  Scrap City, Biodome Colony, Trench Spire, Glacier Station, Last Haven),
  各有可交互的装置 (控制台/开关/反应堆) 和 Lore 日志收集
- 信号阵列链路: 建造 `signal_receiver` → 商人处购买 power_cell 插入 →
  建造 3 座 `locator_antenna` → 雷达上线 (RadarWidget 指向当前调频目标,
  HUD 出现 Story[J] 按钮和 Journal 快捷键)
- 频率调谐: 每个地标一个 MHz 频率,调对后雷达锁定该地标
- 地标甲板参与玩家脚下高度判定 (原 engine 的 `calculateSurfaceHeight` 曾查询
  `landmarkManager.getHeightAt`)

**存档兼容**: 旧存档中的 `signalArray` / `unlockedLoreIds` / `completedLocationIds`
字段会被安全忽略 (loadWorld 不再读取),无需迁移。

**恢复要点**:
- 地标几何与交互: `landmarks.ts` 的 LandmarkManager (含 `interact` /
  `checkInteraction` / `getHeightAt` / `update`)
- 数据: `storyLandmarks.ts` 的 `STORY_LOCATIONS`;旧 `MERCHANT_ITEMS` 已随商人系统
  删除 (见 §6),恢复剧情时需要重新决定 power_cell / locator_node 的获取途径
- 物品/配方: `power_cell` / `locator_node` 物品定义、`craft_signal_receiver` /
  `craft_locator_antenna` 配方、两个建筑定义 (itemsAndRecipes.ts)
- mesh: models.ts 的 `createSignalReceiverMesh` / `createLocatorAntennaMesh`
- 接线: engine 的 signalArray 状态机 (tuneSignalFrequency /
  insertPowerCellIntoReceiver / updateSignalArrayPlacementState)、
  GameCallbacks 的 `onSignalArrayChange` / `onOpenStoryJournal`
- UI: RadarWidget (雷达盘)、StoryJournalModal (日志/导航)、HUD 的雷达开关与
  Story 按钮、App 的 KeyJ 快捷键

## 3. 多人模式 (Multiplayer)

**移除理由**: 游戏定位改为单人玩法。但架构层面保留"多人友好"的设计约束
(见下),后期重做多人模式时不需要推翻现有代码,只需在其上新增网络层。

**原架构** (完整原始代码见 `git show` 本 commit 的父提交):
- 服务器 `server.ts`: express + ws,按 roomId 维护房间状态 (`clients` Map +
  `WorldSaveData`),防抖写入 `saves/world_<roomId>.json`;REST API
  `GET/POST /api/world/:roomId`;所有游戏逻辑在客户端,服务器只做消息中继 +
  世界持久化 (客户端权威架构)
- 客户端 `src/game/multiplayer.ts` MultiplayerClient: WebSocket 连接
  `/ws?room=&id=&name=&color=`,断线 3.5s 重连;维护 remotePlayers Map + 远程
  玩家 THREE mesh (models.ts 的 `createRemotePlayerMesh` /
  `updateRemotePlayerModel`,已一并移除);消息协议 `init` / `player:move(d)` /
  `structure:place(d|demolish(ed)|update(d))` / `shark:defeat(ed)` /
  `player:joined|left`
- 接线点 (均已移除): engine 构造 MultiplayerClient + onWorldSync (本地存档与
  服务器世界按 timestamp 较新者胜) + 每帧 50ms 节流 broadcastLocalMovement;
  build.ts 放置/拆除广播;shark.ts 击杀广播 + 远程击杀触发血皮肤
  (`applyBloodSkin`,已删);saveWorld 同步 POST 到服务器房间;engine.switchRoom
- UI: HUD 幸存者徽章下拉、PauseMenu 服务器状态卡 (名字/房间码输入)、
  App 的 multiplayerStatus / remotePlayers state
- 类型: `RemotePlayer` (已删)、`WorldSaveData.roomId` 字段 (已删,旧存档中
  残留的 roomId 加载时被忽略)

**保留的"多人友好"设计约束** (重做多人时在此基础上扩展):
- 系统化拆分 + 显式 context 依赖 (PlayerState 接口等),系统不反向依赖 engine
- 事件总线 core/events.ts — 网络同步天然是"本地事件 → 广播"的订阅关系
- 可序列化世界状态: `WorldSaveData` / `SerializedStructure` (稳定 id + 格子
  坐标 gx/gy/gz + data),本身即网络快照格式
- 模拟与渲染分离,逻辑在各系统 update(dt) 内完成

**恢复要点** (重做时按需选型,不建议照搬旧实现):
- 旧实现为客户端权威、无插值缓冲、无预测回滚,且网络层直接持有 THREE 场景;
  重做时应做纯数据网络层 + 渲染订阅,权威方案 (服务器权威 vs 主机权威) 重新评估
- 需要恢复: 服务器 (可复活 server.ts 或独立进程)、MultiplayerClient (纯数据化)、
  `RemotePlayer` 类型、远程玩家 mesh (models.ts 第 5 节)、engine/build/shark
  广播接线、UI 徽章;`ws` / `express` 依赖随删除一并移除,恢复时重新安装
- 存档: 现在 saveWorld 只写 localStorage (storage.ts);多人存档当时走服务器
  房间 JSON,恢复时另行设计

## 4. 程序化岛屿与采集 (Procedural Islands & Gathering)

**移除日期**: 2026-11-04（本次工作区修改，无独立移除 commit）

**移除理由**: 当前岛屿完全由程序化几何体生成。后续希望直接使用外部岛屿模型，
因此先移除整套旧实现，不在旧地形系统上继续投入。届时重新设计模型加载、碰撞与
交互，而不是原样恢复程序化建模代码。

**移除范围**:
- `IslandSystem`、程序化岛屿模型、地形高度采样与资源节点
- 游戏定义中的默认岛屿配置
- 玩家与建筑系统的岛屿地形高度分支
- 准星岛屿资源采集、采集提示与 `playGather()` 音效

**保留内容**: `coconut` / `berry` / `egg` / `feather` 等物品 ID 和定义仍保留，
用于兼容已有存档及现有物品体系。依赖岛屿采集的自然获取入口目前已关闭；
重新引入岛屿模型时，再决定哪些资源和交互随新场景恢复。

## 5. 钓鱼 (Fishing)

**移除日期**: 2026-11-04（本次工作区修改，无独立移除 commit）

**移除理由**: 当前阶段先缩减玩法范围，钓鱼系统整体移除，后续需要时按新玩法重新设计。

**移除范围**:
- `FishingSystem` 及浮漂、鱼线、气泡、水花和跃鱼表现
- 抛竿、等待、鱼靠近、咬钩、收线与渔获结算
- `fishing_rod` 物品、鱼竿配方、第一人称鱼竿模型和鱼竿耐久消耗
- 钓鱼专用音效与工具切换/左键交互接线

**保留内容**: `raw_fish` / `cooked_fish` 物品及烧烤、鲨鱼饵等相关配方保留，
以兼容旧存档并避免额外删除食物体系；目前生鱼没有正常的自然获取来源，
仅旧存档中的存货或后续新增来源可以使用。通用收线音效仍被钩索和建筑使用，未删除。

## 6. 漂流商人与交易 (Merchant & Barter)

**移除日期**: 2026-11-04（本次工作区修改，无独立移除 commit）

**移除理由**: 当前阶段继续缩减玩法与场景内容，移除漂流商人 NPC、交易面板和经济接线。

**移除范围**:
- `MerchantSystem` / `MerchantEntity`、默认商人位置和程序化商人筏模型
- `MerchantItem` 类型、交易商品目录、`buyMerchantItem` 交易结算和 Raft 门面命令
- `MerchantModal`、HUD 商人按钮、近距离交易提示和相关 React 状态
- 仅服务于商人面板的 E 键动作；其他交互提示改为仅显示左键

**保留内容**: 原商品 `titanium_ingot` / `ironwood` 的物品 ID 和定义为兼容旧存档
而保留，其商人购买来源已关闭；`metal_ingot` / `shark_bait` 仍有各自配方。
未来若恢复经济系统，应重新设计获取与消费循环，不默认沿用旧商人目录。
(注: 当时保留的压缩机与 `salvaged_scrap_block` 已于 2026-11-04 随压缩机功能一并移除，见 §7)

## 7. 碎片压缩机 (Debris Compactor)

**移除日期**: 2026-11-04（本次工作区修改，无独立移除 commit）

**移除理由**: 压缩机是漂流商人交易体系（§6）的唯一上游产出设施，其产物
`salvaged_scrap_block` 本就"暂时没有交易消费途径"。商人移除后压缩机成为
无下游消费的孤立玩法，随经济循环一并移除。

**移除范围**:
- `debris_compactor` 建筑类型、定义、配方与液压机 3D 模型
- `salvaged_scrap_block` 物品及定义（压缩机是其唯一来源）
- `StationSystem` 的料斗装载状态（compactorLoadedJunk）、投料与锻造方法
- `CompactorModal` 弹窗、HUD 建造面板入口与交互提示
- Raft 门面的 `feedCompactorJunk` / `forgeCompactorBlock` 命令与
  `onOpenCompactor` 回调、`CompactorState` 类型

**恢复要点**: 压缩机逻辑自包含（数据/系统/表现/四层接线均已清理），恢复时
按 §6 的新经济设计一并重建获取与消费循环，不单独恢复。
