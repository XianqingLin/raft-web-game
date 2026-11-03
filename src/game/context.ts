import * as THREE from 'three';
import { PlayerStats } from '../types/game';

/**
 * Shared player state shape (structurally implemented by Game.playerSystem.player).
 * Subsystem modules depend on this interface instead of the Game class,
 * which keeps the dependency graph acyclic.
 */
export interface PlayerState {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  yaw: number;
  pitch: number;
  speed: number;
  onGround: boolean;
  inWater: boolean;
  waterTime: number;
  stats: PlayerStats;
}
