/**
 * Build 模块汇出口 —— 外部引用路径保持 './build' 不变。
 *
 * BuildSystem 仍是唯一对外类型；buoyancy / ghostPreview / playerSurface
 * 是模块内部拆分，不单独对外承诺。
 */

export { BuildSystem, createBuildSystem, type BuildSystemContext } from './buildSystem';
export { RaftBuoyancy } from './buoyancy';
export { BuildGhostPreview, type GhostSnapCoord } from './ghostPreview';
