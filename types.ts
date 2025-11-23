
export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  hue: number;
}

export interface VisualizerState {
  isLoaded: boolean;
  brightness: number;
  fps: number;
  particleCount: number;
  error: string | null;
}

export interface Point {
  x: number;
  y: number;
  oldX: number;
  oldY: number;
  isPinned: boolean;
  u: number; // Texture U coordinate (0-1)
  v: number; // Texture V coordinate (0-1)
  mass?: number; // Default 1
  radius?: number; // For rendering (e.g. flower center)
  color?: string; // Optional specific point color
}

export interface Stick {
  p0: Point;
  p1: Point;
  length: number;
  isHidden?: boolean; // For diagonal structural supports that shouldn't be drawn
  color?: string; // Optional specific stick color (e.g. green stem)
  thickness?: number;
}

export type ObjectType = 'generic' | 'car' | 'plant' | 'castle' | 'horn' | 'devil_horn' | 'image';

export interface SoftBodyObject {
  id: string;
  type: ObjectType;
  points: Point[];
  sticks: Stick[];
  color: string;
  texture?: HTMLImageElement; // The image source
  isMesh?: boolean; // Flag to identify image meshes
  growth?: number; // 0.0 to 1.0 for animation
  config?: any; // Store extra procedural data (side, offsets, etc)
}

// --- 3D TYPES ---

export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

export interface Quaternion {
  x: number;
  y: number;
  z: number;
  w: number;
}

export interface Face {
  indices: number[]; // Vertex indices
  color?: string;
}

export interface RigidBody3D {
  id: string;
  type: 'cube' | 'pyramid';
  position: Vector3;
  rotation: Quaternion;
  scale: Vector3;
  velocity: Vector3;
  angularVelocity: Vector3;
  vertices: Vector3[]; // Local space vertices
  faces: Face[];
  isHeld: boolean;
  snapTarget: string | null; // ID of object we are snapped to
  snapTimer: number; // For stabilization delay
  color: string;
  glow: number; // 0-1 for interaction feedback
}
