# 已移除功能登记表 (FEATURES_OFF)

为缩减 engine.ts 拆分前的工作量,以下功能被临时移除。每个功能对应一次独立 commit,
恢复时可用 `git show <commit>` 查看完整原始代码,或直接 cherry-pick 后按新架构重新接线。

| 功能 | 移除 Commit | 移除日期 | 原始代码位置 |
|---|---|---|---|
| 成就系统 | `90c4c17` | 2026-11-03 | `src/game/achievements.ts`, `src/components/AchievementToast.tsx` |
| 剧情/地标/信号阵列 | 本 commit | 2026-11-03 | `src/game/landmarks.ts`, `src/data/storyLandmarks.ts`, `src/components/StoryJournalModal.tsx`, `src/components/RadarWidget.tsx` |

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
- 数据: `storyLandmarks.ts` 的 `STORY_LOCATIONS`;注意 `MERCHANT_ITEMS` 已迁至
  `src/data/merchant.ts` (商人系统保留),恢复时 story 专属货物 power_cell /
  locator_node 加回 merchant.ts
- 物品/配方: `power_cell` / `locator_node` 物品定义、`craft_signal_receiver` /
  `craft_locator_antenna` 配方、两个建筑定义 (itemsAndRecipes.ts)
- mesh: models.ts 的 `createSignalReceiverMesh` / `createLocatorAntennaMesh`
- 接线: engine 的 signalArray 状态机 (tuneSignalFrequency /
  insertPowerCellIntoReceiver / updateSignalArrayPlacementState)、
  GameCallbacks 的 `onSignalArrayChange` / `onOpenStoryJournal`
- UI: RadarWidget (雷达盘)、StoryJournalModal (日志/导航)、HUD 的雷达开关与
  Story 按钮、App 的 KeyJ 快捷键
