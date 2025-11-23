
import { Point, Stick, SoftBodyObject, RigidBody3D, Vector3, Quaternion, Face } from '../types';

export class SoftBodySystem {
  objects: SoftBodyObject[] = [];
  rigidBodies: RigidBody3D[] = [];
  
  // Interaction Springs: HandID -> { point, anchorX, anchorY, stiffness }
  mouseSprings: Map<number, { point: Point, anchorX: number, anchorY: number }> = new Map();
  
  // 3D Interaction: HandID -> { bodyId, offset: Vector3, relativeRot: Quaternion }
  heldObjects: Map<number, { bodyId: string, offset: Vector3, initialHandRot: number, initialObjRot: Quaternion }> = new Map();

  // Physics params
  gravity = 0.5;
  drag = 0.95; 
  groundFriction = 0.8;
  
  // Simulation params
  solverIterations = 16; 
  stiffness = 1.0; 
  breakingThreshold = 10.0; 

  // Horn tracking
  horns: { id: string }[] = [];
  
  // Time for animation
  time: number = 0;

  reset() {
      this.objects = [];
      this.rigidBodies = [];
      this.mouseSprings.clear();
      this.heldObjects.clear();
      this.horns = [];
  }

  // --- 3D MATH HELPERS ---
  
  // Vector Math
  vAdd(a: Vector3, b: Vector3): Vector3 { return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }; }
  vSub(a: Vector3, b: Vector3): Vector3 { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
  vScale(a: Vector3, s: number): Vector3 { return { x: a.x * s, y: a.y * s, z: a.z * s }; }
  vLen(a: Vector3): number { return Math.sqrt(a.x*a.x + a.y*a.y + a.z*a.z); }
  vCross(a: Vector3, b: Vector3): Vector3 {
      return {
          x: a.y * b.z - a.z * b.y,
          y: a.z * b.x - a.x * b.z,
          z: a.x * b.y - a.y * b.x
      };
  }
  vNorm(a: Vector3): Vector3 {
      const l = this.vLen(a);
      return l > 0 ? this.vScale(a, 1/l) : {x:0, y:0, z:0};
  }
  
  // Quaternion Math
  qMult(q1: Quaternion, q2: Quaternion): Quaternion {
      return {
          x: q1.w * q2.x + q1.x * q2.w + q1.y * q2.z - q1.z * q2.y,
          y: q1.w * q2.y - q1.x * q2.z + q1.y * q2.w + q1.z * q2.x,
          z: q1.w * q2.z + q1.x * q2.y - q1.y * q2.x + q1.z * q2.w,
          w: q1.w * q2.w - q1.x * q2.x - q1.y * q2.y - q1.z * q2.z
      };
  }
  
  qFromAxisAngle(axis: Vector3, angle: number): Quaternion {
      const halfAngle = angle / 2;
      const s = Math.sin(halfAngle);
      return {
          x: axis.x * s,
          y: axis.y * s,
          z: axis.z * s,
          w: Math.cos(halfAngle)
      };
  }

  vRotate(v: Vector3, q: Quaternion): Vector3 {
      // Rotate vector v by quaternion q
      const ix = q.w * v.x + q.y * v.z - q.z * v.y;
      const iy = q.w * v.y + q.z * v.x - q.x * v.z;
      const iz = q.w * v.z + q.x * v.y - q.y * v.x;
      const iw = -q.x * v.x - q.y * v.y - q.z * v.z;

      return {
          x: ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y,
          y: iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z,
          z: iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x
      };
  }

  // --- GEOMETRY GENERATORS ---

  generateEllipsoid(rx: number, ry: number, rz: number, wSeg: number, hSeg: number, color: string) {
      const vertices: Vector3[] = [];
      const faces: Face[] = [];
      
      for(let i=0; i<=hSeg; i++) {
          const v = i / hSeg;
          const phi = v * Math.PI;
          for(let j=0; j<=wSeg; j++) {
              const u = j / wSeg;
              const theta = u * Math.PI * 2;
              
              const x = rx * Math.sin(phi) * Math.cos(theta);
              const y = ry * Math.cos(phi);
              const z = rz * Math.sin(phi) * Math.sin(theta);
              vertices.push({x,y,z});
          }
      }

      for(let i=0; i<hSeg; i++) {
          for(let j=0; j<wSeg; j++) {
              const p1 = i * (wSeg+1) + j;
              const p2 = p1 + (wSeg+1);
              const p3 = p1 + 1;
              const p4 = p2 + 1;
              
              // Quad split into 2 tris
              faces.push({ indices: [p1, p2, p3], color });
              faces.push({ indices: [p3, p2, p4], color });
          }
      }
      return { vertices, faces };
  }

  generateCone(radius: number, height: number, seg: number, color: string) {
      const vertices: Vector3[] = [];
      const faces: Face[] = [];
      
      // Base center
      vertices.push({x:0, y:0, z:0}); // 0
      // Tip
      vertices.push({x:0, y:-height, z:0}); // 1
      
      for(let i=0; i<seg; i++) {
          const theta = (i/seg) * Math.PI * 2;
          vertices.push({
              x: Math.cos(theta) * radius,
              y: 0,
              z: Math.sin(theta) * radius
          });
      }
      
      // Tip faces
      for(let i=0; i<seg; i++) {
          const curr = 2 + i;
          const next = 2 + (i + 1) % seg;
          faces.push({ indices: [1, next, curr], color });
      }
      return { vertices, faces };
  }

  // --- 3D SPAWNERS ---

  spawnDragon(x: number, y: number) {
      // Create Torso as the physics proxy
      // Ellipsoid: 80x50x60
      const mesh = this.generateEllipsoid(40, 25, 30, 12, 8, '#4ade80');
      
      this.rigidBodies.push({
          id: `dragon-${Date.now()}`,
          type: 'dragon',
          position: { x, y, z: 0 },
          rotation: { x: 0, y: 0, z: 0, w: 1 },
          scale: { x: 1, y: 1, z: 1 },
          velocity: { x: 0, y: 0, z: 0 },
          angularVelocity: { x: 0, y: 0, z: 0 },
          vertices: mesh.vertices,
          faces: mesh.faces,
          isHeld: false,
          snapTarget: null,
          snapTimer: 0,
          color: '#4ade80',
          glow: 0,
          dragonConfig: {
              jawAngle: 0,
              neckPhase: 0,
              wingPhase: 0,
              eyeColor: '#fcd34d',
              scale: 1.0
          }
      });
  }

  spawnCube3D(x: number, y: number) {
      const size = 60;
      const half = size / 2;
      
      const vertices = [
          { x: -half, y: -half, z: -half }, { x: half, y: -half, z: -half },
          { x: half, y: half, z: -half }, { x: -half, y: half, z: -half },
          { x: -half, y: -half, z: half }, { x: half, y: -half, z: half },
          { x: half, y: half, z: half }, { x: -half, y: half, z: half }
      ];

      const faces: Face[] = [
          { indices: [0, 1, 2, 3], color: 'rgba(0, 255, 255, 0.1)' }, // Front
          { indices: [5, 4, 7, 6], color: 'rgba(0, 255, 255, 0.1)' }, // Back
          { indices: [4, 0, 3, 7], color: 'rgba(0, 200, 255, 0.1)' }, // Left
          { indices: [1, 5, 6, 2], color: 'rgba(0, 200, 255, 0.1)' }, // Right
          { indices: [4, 5, 1, 0], color: 'rgba(0, 150, 255, 0.2)' }, // Top
          { indices: [3, 2, 6, 7], color: 'rgba(0, 150, 255, 0.2)' }  // Bottom
      ];

      this.rigidBodies.push({
          id: `cube-${Date.now()}`,
          type: 'cube',
          position: { x, y, z: 0 },
          rotation: { x: 0, y: 0, z: 0, w: 1 },
          scale: { x: 1, y: 1, z: 1 },
          velocity: { x: 0, y: 0, z: 0 },
          angularVelocity: { x: 0, y: 0, z: 0 },
          vertices,
          faces,
          isHeld: false,
          snapTarget: null,
          snapTimer: 0,
          color: '#06b6d4',
          glow: 0
      });
  }

  spawnPyramid3D(x: number, y: number) {
      const size = 70;
      const half = size / 2;
      const height = size;

      const vertices = [
          { x: -half, y: half, z: -half },  // Base FL
          { x: half, y: half, z: -half },   // Base FR
          { x: half, y: half, z: half },    // Base BR
          { x: -half, y: half, z: half },   // Base BL
          { x: 0, y: -half, z: 0 }          // Tip
      ];

      const faces: Face[] = [
          { indices: [0, 1, 4], color: 'rgba(236, 72, 153, 0.2)' },
          { indices: [1, 2, 4], color: 'rgba(236, 72, 153, 0.2)' },
          { indices: [2, 3, 4], color: 'rgba(236, 72, 153, 0.2)' },
          { indices: [3, 0, 4], color: 'rgba(236, 72, 153, 0.2)' },
          { indices: [3, 2, 1, 0], color: 'rgba(236, 72, 153, 0.1)' } // Base
      ];

      this.rigidBodies.push({
          id: `pyr-${Date.now()}`,
          type: 'pyramid',
          position: { x, y, z: 0 },
          rotation: { x: 0, y: 0, z: 0, w: 1 },
          scale: { x: 1, y: 1, z: 1 },
          velocity: { x: 0, y: 0, z: 0 },
          angularVelocity: { x: 0, y: 0, z: 0 },
          vertices,
          faces,
          isHeld: false,
          snapTarget: null,
          snapTimer: 0,
          color: '#ec4899',
          glow: 0
      });
  }

  spawnImageMesh(img: HTMLImageElement, cx: number, cy: number, maxWidth: number) {
      const aspectRatio = img.height / img.width;
      const width = Math.min(maxWidth, 400); 
      const height = width * aspectRatio;
      const cols = 15; 
      const rows = Math.floor(cols * aspectRatio);
      const cellW = width / cols;
      const cellH = height / rows;
      
      const points: Point[] = [];
      const sticks: Stick[] = [];
      
      for (let y = 0; y <= rows; y++) {
          for (let x = 0; x <= cols; x++) {
              points.push({
                  x: cx - width/2 + x * cellW,
                  y: cy - height/2 + y * cellH,
                  oldX: cx - width/2 + x * cellW,
                  oldY: cy - height/2 + y * cellH,
                  isPinned: false,
                  u: x / cols,
                  v: y / rows
              });
          }
      }
      
      const getP = (x: number, y: number) => points[y * (cols + 1) + x];
      
      for (let y = 0; y <= rows; y++) {
          for (let x = 0; x <= cols; x++) {
              const p = getP(x, y);
              if (x < cols) sticks.push({ p0: p, p1: getP(x + 1, y), length: cellW });
              if (y < rows) sticks.push({ p0: p, p1: getP(x, y + 1), length: cellH });
              if (x < cols && y < rows) {
                  const p1 = getP(x, y);
                  const p2 = getP(x + 1, y + 1);
                  sticks.push({ p0: p1, p1: p2, length: Math.sqrt(cellW*cellW + cellH*cellH), isHidden: true });
              }
          }
      }

      this.objects.push({
          id: `img-${Date.now()}`,
          type: 'image',
          points,
          sticks,
          color: '#fff',
          texture: img,
          isMesh: true
      });
  }

  spawnCar(cx: number, cy: number) {
    const points: Point[] = [];
    const sticks: Stick[] = [];
    const w = 120;
    const h = 40; 
    const roofH = 30;
    const bl = { x: cx - w/2, y: cy, oldX: cx - w/2, oldY: cy, isPinned: false, u:0, v:0 };
    const br = { x: cx + w/2, y: cy, oldX: cx + w/2, oldY: cy, isPinned: false, u:0, v:0 };
    const tl = { x: cx - w/2, y: cy - h, oldX: cx - w/2, oldY: cy - h, isPinned: false, u:0, v:0 };
    const tr = { x: cx + w/2, y: cy - h, oldX: cx + w/2, oldY: cy - h, isPinned: false, u:0, v:0 };
    const rl = { x: cx - w/4, y: cy - h - roofH, oldX: cx - w/4, oldY: cy - h - roofH, isPinned: false, u:0, v:0 };
    const rr = { x: cx + w/4, y: cy - h - roofH, oldX: cx + w/4, oldY: cy - h - roofH, isPinned: false, u:0, v:0 };
    points.push(bl, br, tl, tr, rl, rr);
    const link = (p1: Point, p2: Point, visible = true) => {
        const d = Math.hypot(p1.x-p2.x, p1.y-p2.y);
        sticks.push({ p0: p1, p1: p2, length: d, isHidden: !visible });
    };
    link(bl, br); link(br, tr); link(tr, tl); link(tl, bl);
    link(bl, tr, false); link(br, tl, false);
    link(tl, rl); link(tr, rr); link(rl, rr);
    link(rl, tr, false); link(rr, tl, false);
    const wheelRadius = 15;
    const addWheel = (x: number, y: number) => {
        const c = { x, y, oldX: x, oldY: y, isPinned: false, u:0, v:0, radius: wheelRadius };
        points.push(c);
        return c;
    };
    const w1 = addWheel(cx - w/2 + 20, cy + 15);
    const w2 = addWheel(cx + w/2 - 20, cy + 15);
    link(w1, bl, true); link(w1, tl, true); link(w1, br, false);
    link(w2, br, true); link(w2, tr, true); link(w2, bl, false);
    this.objects.push({
        id: `car-${Date.now()}`,
        type: 'car',
        points,
        sticks,
        color: '#3b82f6'
    });
  }

  spawnPlant(cx: number, cy: number) {
    const points: Point[] = [];
    const sticks: Stick[] = [];
    const base: Point = { x: cx, y: cy, oldX: cx, oldY: cy, isPinned: true, u:0, v:0 };
    points.push(base);
    let prev = base;
    const segments = 7;
    const segLen = 35;
    for(let i=1; i<=segments; i++) {
        const curve = (Math.random() - 0.5) * 10;
        const p: Point = { 
            x: cx + curve * i, 
            y: cy - i * segLen, 
            oldX: cx + curve * i, 
            oldY: cy - i * segLen, 
            isPinned: false, 
            u:0, v:0,
            color: '#22c55e'
        };
        points.push(p);
        sticks.push({ p0: prev, p1: p, length: segLen, color: '#22c55e', thickness: Math.max(1, 8 - i) });
        if (i > 1 && i < segments) {
            const dir = i % 2 === 0 ? 1 : -1;
            const leafLen = 40 - (i * 3);
            const lx = p.x + (leafLen * dir);
            const ly = p.y - 10;
            const leafP: Point = { 
                x: lx, y: ly, oldX: lx, oldY: ly, 
                isPinned: false, u:0, v:0,
                radius: 5,
                color: '#4ade80'
            };
            points.push(leafP);
            sticks.push({ p0: p, p1: leafP, length: Math.hypot(lx-p.x, ly-p.y), color: '#16a34a', thickness: 1 });
            if (prev) {
                sticks.push({ p0: prev, p1: leafP, length: Math.hypot(lx-prev.x, ly-prev.y), isHidden: true });
            }
        }
        prev = p;
    }
    const flowerCenter = prev;
    flowerCenter.color = '#fbbf24'; 
    flowerCenter.radius = 10;
    const petalCount = 6;
    const petalRadius = 25;
    for(let i=0; i<petalCount; i++) {
        const angle = (i / petalCount) * Math.PI * 2;
        const px = flowerCenter.x + Math.cos(angle) * petalRadius;
        const py = flowerCenter.y + Math.sin(angle) * petalRadius;
        const petal = { 
            x: px, y: py, oldX: px, oldY: py, 
            isPinned: false, u:0, v:0,
            color: '#f472b6', 
            radius: 8 
        };
        points.push(petal);
        sticks.push({ p0: flowerCenter, p1: petal, length: petalRadius, color: '#ec4899', thickness: 2 });
        if (i > 0) {
            const prevPetal = points[points.length - 2];
            const d = Math.hypot(px-prevPetal.x, py-prevPetal.y);
            sticks.push({ p0: prevPetal, p1: petal, length: d, isHidden: true });
        }
    }
    const lastPetal = points[points.length - 1];
    const firstPetal = points[points.length - petalCount];
    const d = Math.hypot(lastPetal.x-firstPetal.x, lastPetal.y-firstPetal.y);
    sticks.push({ p0: lastPetal, p1: firstPetal, length: d, isHidden: true });
    this.objects.push({
        id: `plant-${Date.now()}`,
        type: 'plant',
        points,
        sticks,
        color: '#22c55e'
    });
  }

  spawnCastle(cx: number, cy: number) {
      const points: Point[] = [];
      const sticks: Stick[] = [];
      const w = 100;
      const h = 100;
      const cols = 3;
      const rows = 3;
      const stepX = w / cols;
      const stepY = h / rows;
      for(let y=0; y<=rows; y++) {
          for(let x=0; x<=cols; x++) {
              points.push({
                  x: cx - w/2 + x * stepX,
                  y: cy - h + y * stepY,
                  oldX: cx - w/2 + x * stepX,
                  oldY: cy - h + y * stepY,
                  isPinned: y === rows, 
                  u:0, v:0
              });
          }
      }
      const getP = (x: number, y: number) => points[y * (cols+1) + x];
      for(let y=0; y<=rows; y++) {
          for(let x=0; x<=cols; x++) {
             if(x < cols) {
                 const p1 = getP(x,y); const p2 = getP(x+1,y);
                 sticks.push({ p0: p1, p1: p2, length: stepX });
             }
             if(y < rows) {
                 const p1 = getP(x,y); const p2 = getP(x,y+1);
                 sticks.push({ p0: p1, p1: p2, length: stepY });
             }
             if (x < cols && y < rows) {
                 const p1 = getP(x,y); const p2 = getP(x+1, y+1);
                 sticks.push({ p0: p1, p1: p2, length: Math.hypot(stepX, stepY), isHidden: true });
                 const p3 = getP(x+1,y); const p4 = getP(x, y+1);
                 sticks.push({ p0: p3, p1: p4, length: Math.hypot(stepX, stepY), isHidden: true });
             }
          }
      }
      const topY = 0;
      for(let x=0; x<=cols; x++) {
          const baseP = getP(x, 0);
          const batP = { 
              x: baseP.x, y: baseP.y - 20, 
              oldX: baseP.x, oldY: baseP.y - 20, 
              isPinned: false, u:0, v:0 
          };
          points.push(batP);
          sticks.push({ p0: baseP, p1: batP, length: 20 });
      }
      this.objects.push({
          id: `castle-${Date.now()}`,
          type: 'castle',
          points,
          sticks,
          color: '#94a3b8' 
      });
  }

  updateHorns(faceLandmarks: any[], isGestureActive: boolean, canvasWidth: number, canvasHeight: number) {
      const leftHornId = 'devil-horn-left';
      const rightHornId = 'devil-horn-right';
      let leftHorn = this.objects.find(o => o.id === leftHornId);
      let rightHorn = this.objects.find(o => o.id === rightHornId);
      if (!leftHorn) {
          leftHorn = { id: leftHornId, type: 'devil_horn', points: [], sticks: [], color: '#dc2626', growth: 0, config: { side: 'left' } };
          this.objects.push(leftHorn);
      }
      if (!rightHorn) {
          rightHorn = { id: rightHornId, type: 'devil_horn', points: [], sticks: [], color: '#dc2626', growth: 0, config: { side: 'right' } };
          this.objects.push(rightHorn);
      }
      
      if (!isGestureActive) {
          // INSTANT OFF
          leftHorn.growth = 0;
          rightHorn.growth = 0;
          return; 
      } else {
          // INSTANT POP-IN
          leftHorn.growth = 1.0;
          rightHorn.growth = 1.0;
      }

      const getPt = (idx: number) => ({
          x: (1 - faceLandmarks[idx].x) * canvasWidth,
          y: faceLandmarks[idx].y * canvasHeight
      });
      
      const foreheadLeft = getPt(105);
      const foreheadRight = getPt(334);
      
      const headWidth = Math.hypot(foreheadRight.x - foreheadLeft.x, foreheadRight.y - foreheadLeft.y);
      // STRICT SCALING: 0.18 proportional visual width approx
      // The drawer uses scale as pixels, so we pass exact pixels.
      const scale = headWidth * 0.4; 
      
      const angle = Math.atan2(foreheadRight.y - foreheadLeft.y, foreheadRight.x - foreheadLeft.x);
      
      // STRICT LOCKING - No smoothing, no oldX/oldY interpolation
      leftHorn.points = [ { x: foreheadRight.x, y: foreheadRight.y, oldX: foreheadRight.x, oldY: foreheadRight.y, isPinned:true, u:0, v:0 } ];
      leftHorn.config.baseAngle = angle; 
      leftHorn.config.scale = scale;
      
      rightHorn.points = [ { x: foreheadLeft.x, y: foreheadLeft.y, oldX: foreheadLeft.x, oldY: foreheadLeft.y, isPinned:true, u:0, v:0 } ];
      rightHorn.config.baseAngle = angle; 
      rightHorn.config.scale = scale;
  }

  // --- 3D INTERACTION ---

  handleInteraction3D(handId: number, x: number, y: number, z: number, isGrabbing: boolean, rotationAngle: number) {
    // 1. Reset generic interaction glow if not held
    this.rigidBodies.forEach(b => {
        if (!b.isHeld && b.glow < 0.5) b.glow = 0;
    });

    if (isGrabbing) {
        if (!this.heldObjects.has(handId)) {
            // TRY TO GRAB (PINCH or FIST)
            let closestDist = Infinity;
            let target: RigidBody3D | null = null;
            
            // Screen space hit test using volumetric collider radius
            for (const body of this.rigidBodies) {
                const dx = body.position.x - x;
                const dy = body.position.y - y;
                const dist = Math.sqrt(dx*dx + dy*dy);
                
                // Scale-based Volumetric Collider: Scale * 60 (base size) * 0.7 (radius factor) * 1.3 (margin)
                const size = Math.max(body.scale.x, body.scale.y, body.scale.z) * 60; 
                const colliderRadius = size * 0.7 * 1.3; 
                
                if (dist < colliderRadius && dist < closestDist) {
                    closestDist = dist;
                    target = body;
                }
            }

            if (target) {
                target.isHeld = true;
                target.snapTarget = null; // Break stack
                target.glow = 1.0;
                
                // Attach to hand
                this.heldObjects.set(handId, {
                    bodyId: target.id,
                    offset: { x: target.position.x - x, y: target.position.y - y, z: target.position.z - z },
                    initialHandRot: rotationAngle,
                    initialObjRot: target.rotation
                });
            }
        } else {
            // HOLDING / DRAGGING
            const hold = this.heldObjects.get(handId)!;
            const body = this.rigidBodies.find(b => b.id === hold.bodyId);
            if (body) {
                body.glow = 1.0; 
                
                // Position follow with spring smoothing
                const tx = x + hold.offset.x;
                const ty = y + hold.offset.y;
                const tz = z + hold.offset.z;

                body.position.x += (tx - body.position.x) * 0.4; 
                body.position.y += (ty - body.position.y) * 0.4;
                body.position.z += (tz - body.position.z) * 0.4;
                
                body.velocity = { x: 0, y: 0, z: 0 }; // Zero physics velocity while holding

                // Rotation Manipulation
                const deltaRot = rotationAngle - hold.initialHandRot;
                const qY = this.qFromAxisAngle({x:0, y:1, z:0}, deltaRot * 0.15); 
                body.rotation = this.qMult(body.rotation, qY);
                hold.initialHandRot = rotationAngle;
            }
        }
    } else {
        // RELEASE
        if (this.heldObjects.has(handId)) {
            const hold = this.heldObjects.get(handId)!;
            const body = this.rigidBodies.find(b => b.id === hold.bodyId);
            if (body) {
                body.isHeld = false;
                this.checkSnapping(body);
            }
            this.heldObjects.delete(handId);
        }

        // HOVER CHECK (Highlight receptor)
        // Global Hover Logic for Open Hand
        for (const body of this.rigidBodies) {
            const dx = body.position.x - x;
            const dy = body.position.y - y;
            const dist = Math.sqrt(dx*dx + dy*dy);
            const size = Math.max(body.scale.x, body.scale.y, body.scale.z) * 60;
            const colliderRadius = size * 0.7 * 1.3;

            if (dist < colliderRadius) {
                body.glow = Math.max(body.glow, 0.4); // Light up yellow/white
            }
        }
    }
  }

  checkSnapping(active: RigidBody3D) {
      const threshold = 50; 
      for (const other of this.rigidBodies) {
          if (other.id === active.id) continue;
          
          const dx = Math.abs(active.position.x - other.position.x);
          const dz = Math.abs(active.position.z - other.position.z);
          
          if (dx < threshold && dz < threshold) {
              const dy = other.position.y - active.position.y;
              const expectedDist = 60; 
              
              if (dy > 0 && dy < expectedDist + 40) {
                  active.snapTarget = other.id;
                  active.position.x = other.position.x;
                  active.position.z = other.position.z;
                  active.position.y = other.position.y - expectedDist;
                  active.rotation = other.rotation; 
                  active.velocity = {x:0,y:0,z:0};
                  active.glow = 1.0; 
                  other.glow = 0.5;
                  active.snapTimer = 20; 
                  break;
              }
          }
      }
  }

  handleInteraction(handId: number, x: number, y: number, isPinching: boolean) {
      if (isPinching) {
          if (!this.mouseSprings.has(handId)) {
              let minDist = 80;
              let candidate: Point | null = null;
              
              for (const obj of this.objects) {
                  if (obj.type === 'devil_horn') continue;
                  for (const p of obj.points) {
                      const dx = p.x - x;
                      const dy = p.y - y;
                      const dist = Math.sqrt(dx*dx + dy*dy);
                      if (dist < minDist) {
                          minDist = dist;
                          candidate = p;
                      }
                  }
              }
              if (candidate) {
                  this.mouseSprings.set(handId, { point: candidate, anchorX: x, anchorY: y });
              }
          }
          const spring = this.mouseSprings.get(handId);
          if (spring) {
              spring.anchorX = x;
              spring.anchorY = y;
          }
      } else {
          this.mouseSprings.delete(handId);
      }
  }

  crumple(x: number, y: number, radius: number, intensity: number) {
      for (const obj of this.objects) {
          if (obj.type === 'devil_horn') continue;
          for (const p of obj.points) {
              const dx = p.x - x;
              const dy = p.y - y;
              const distSq = dx*dx + dy*dy;
              if (distSq < radius * radius) {
                  const force = (1 - Math.sqrt(distSq)/radius) * intensity;
                  p.x += (Math.random() - 0.5) * 25 * force;
                  p.y += (Math.random() - 0.5) * 25 * force;
                  p.x -= dx * 0.1 * force;
                  p.y -= dy * 0.1 * force;
              }
          }
      }
  }

  fold(x: number, y: number, radius: number, velocity: {x: number, y: number}) {
      for (const obj of this.objects) {
          if (obj.type === 'devil_horn') continue;
          for (const p of obj.points) {
              const dx = p.x - x;
              const dy = p.y - y;
              const dist = Math.sqrt(dx*dx + dy*dy);
              if (dist < radius) {
                  const force = (1 - dist/radius);
                  p.x -= dx * 0.15 * force;
                  p.y -= dy * 0.15 * force;
                  p.x += velocity.x * 0.1 * force;
                  p.y += velocity.y * 0.1 * force;
              }
          }
      }
  }

  update(width: number, height: number) {
      this.time += 0.05;
      
      // --- 2D SOFT BODIES ---
      for (const obj of this.objects) {
          if (obj.type === 'devil_horn') continue;
          for (const p of obj.points) {
              if (p.isPinned) continue;
              let vx = (p.x - p.oldX) * this.drag;
              let vy = (p.y - p.oldY) * this.drag;
              p.oldX = p.x;
              p.oldY = p.y;
              p.x += vx;
              p.y += vy + this.gravity;
              if (p.y > height - 10) { p.y = height - 10; p.oldY = p.y + vy * this.groundFriction; }
              if (p.x < 10) { p.x = 10; p.oldX = p.x + vx * this.groundFriction; }
              if (p.x > width - 10) { p.x = width - 10; p.oldX = p.x + vx * this.groundFriction; }
              if (p.y < -300) { p.y = -300; } 
          }
          for (let i=0; i<this.solverIterations; i++) {
              for (let sIdx = obj.sticks.length - 1; sIdx >= 0; sIdx--) {
                  const s = obj.sticks[sIdx];
                  const dx = s.p1.x - s.p0.x;
                  const dy = s.p1.y - s.p0.y;
                  const dist = Math.sqrt(dx*dx + dy*dy);
                  if (dist > s.length * this.breakingThreshold) {
                      obj.sticks.splice(sIdx, 1);
                      continue;
                  }
                  const diff = s.length - dist;
                  const percent = (diff / dist) / 2 * this.stiffness;
                  const offX = dx * percent;
                  const offY = dy * percent;
                  if (!s.p0.isPinned) { s.p0.x -= offX; s.p0.y -= offY; }
                  if (!s.p1.isPinned) { s.p1.x += offX; s.p1.y += offY; }
              }
          }
      }
      this.mouseSprings.forEach((spring) => {
          const { point, anchorX, anchorY } = spring;
          const dx = anchorX - point.x;
          const dy = anchorY - point.y;
          point.x += dx * 0.2; 
          point.y += dy * 0.2;
      });

      // --- 3D RIGID BODIES ---
      const floorY = height;
      const cubeHalf = 30; // Half size approx
      
      for (const body of this.rigidBodies) {
          // Animation updates for dragon
          if (body.type === 'dragon' && body.dragonConfig) {
             body.dragonConfig.neckPhase = this.time;
             body.dragonConfig.jawAngle = Math.sin(this.time * 2) * 0.2 + 0.2; // Breathing motion
          }

          if (body.glow > 0) body.glow -= 0.05;

          if (body.isHeld) continue;

          if (body.snapTimer > 0) {
              body.snapTimer--;
              continue; // Skip physics if stabilizing
          }

          // Gravity
          if (body.snapTarget) {
              const target = this.rigidBodies.find(b => b.id === body.snapTarget);
              if (target) {
                  body.position.x = target.position.x;
                  body.position.z = target.position.z;
                  body.position.y = target.position.y - 60; 
                  body.rotation = target.rotation;
                  continue; 
              } else {
                  body.snapTarget = null; // Target gone, fall
              }
          }

          body.velocity.y += this.gravity;
          
          // Apply velocity
          body.position = this.vAdd(body.position, body.velocity);
          
          // Floor Collision
          if (body.position.y > floorY - cubeHalf) {
              body.position.y = floorY - cubeHalf;
              body.velocity.y *= -0.4; // Bounce
              body.velocity.x *= this.groundFriction;
              body.velocity.z *= this.groundFriction;
          }

          // Drag
          body.velocity = this.vScale(body.velocity, 0.98);
      }
  }

  draw(ctx: CanvasRenderingContext2D) {
      // 1. Draw 2D
      for (const obj of this.objects) {
          if (obj.isMesh && obj.texture) {
              this.drawMesh(ctx, obj);
          } else if (obj.type === 'plant') {
              this.drawPlant(ctx, obj);
          } else if (obj.type === 'devil_horn') {
              this.drawDevilHorn(ctx, obj);
          } else {
              this.drawWireframe(ctx, obj);
          }
      }
      
      // 2. Draw 3D Rigid Bodies
      // Sort by Z for simple painter's algorithm
      const sortedBodies = [...this.rigidBodies].sort((a, b) => b.position.z - a.position.z);
      
      for (const body of sortedBodies) {
          if (body.type === 'dragon') {
              this.drawDragon(ctx, body);
          } else {
              this.drawRigidBody3D(ctx, body);
          }
      }

      // Draw Interaction Springs
      ctx.strokeStyle = 'rgba(0, 255, 255, 0.4)';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]);
      this.mouseSprings.forEach(s => {
          ctx.beginPath();
          ctx.moveTo(s.point.x, s.point.y);
          ctx.lineTo(s.anchorX, s.anchorY);
          ctx.stroke();
      });
      ctx.setLineDash([]);
  }

  // Helper for internal projection used by both rigid body and dragon
  projectPoint(ctx: CanvasRenderingContext2D, v: Vector3, pos: Vector3, rot: Quaternion, f: number = 1000): {x:number, y:number, scale:number} | null {
      const cx = ctx.canvas.width / 2;
      const cy = ctx.canvas.height / 2;
      
      const r = this.vRotate(v, rot);
      const world = this.vAdd(r, pos);
      
      const dx = world.x - cx;
      const dy = world.y - cy;
      const dz = world.z;
      
      const depth = f + dz;
      if (depth < 10) return null;
      
      const scale = f / depth;
      return {
          x: cx + dx * scale,
          y: cy + dy * scale,
          scale
      };
  }

  drawDragon(ctx: CanvasRenderingContext2D, body: RigidBody3D) {
      if (!body.dragonConfig) return;

      const { jawAngle, neckPhase } = body.dragonConfig;
      
      // 1. Draw Body (Torso) using standard RigidBody logic but with Dragon specific shading
      this.drawRigidBody3D(ctx, body);

      // 2. Procedural Neck, Head, Tail
      const cx = ctx.canvas.width / 2;
      const cy = ctx.canvas.height / 2;
      const f = 1000;

      // Local Project Helper specifically for chained parts relative to body
      const projectRelative = (v: Vector3, parentPos: Vector3, parentRot: Quaternion) => {
          return this.projectPoint(ctx, v, parentPos, parentRot, f);
      };

      // --- NECK GENERATION ---
      const neckSegments = 8;
      const segLen = 12;
      let currPos = { x: 0, y: -20, z: -30 }; // Start at front-top of torso
      let prevScreen = projectRelative(currPos, body.position, body.rotation);

      // Neck spine points for drawing
      const spinePoints: {x:number, y:number, s:number}[] = [];
      if (prevScreen) spinePoints.push({x: prevScreen.x, y: prevScreen.y, s: prevScreen.scale});

      for(let i=0; i<neckSegments; i++) {
          // Sine wave animation for neck
          const sway = Math.sin(neckPhase + i * 0.5) * 5;
          const arch = -Math.sin((i / neckSegments) * Math.PI) * 10; // Arch up

          currPos = {
              x: currPos.x + sway,
              y: currPos.y - segLen + arch * 0.5,
              z: currPos.z - 5 // Slight forward tilt
          };

          const p = projectRelative(currPos, body.position, body.rotation);
          if (p) {
              // Draw Segment (Sphere-ish)
              const radius = 20 * (1 - i/neckSegments) + 10; // Taper
              ctx.beginPath();
              ctx.fillStyle = i % 2 === 0 ? '#22c55e' : '#16a34a'; // Striped scales
              ctx.arc(p.x, p.y, radius * p.scale, 0, Math.PI*2);
              ctx.fill();
              
              spinePoints.push({x: p.x, y: p.y, s: p.scale});
          }
      }

      // --- HEAD ---
      const headPosLocal = currPos;
      const headProj = projectRelative(headPosLocal, body.position, body.rotation);
      
      if (headProj) {
          const headScale = headProj.scale;
          const hX = headProj.x;
          const hY = headProj.y;

          ctx.save();
          ctx.translate(hX, hY);
          const lookSway = Math.sin(neckPhase) * 0.2;
          ctx.rotate(lookSway);
          ctx.scale(headScale, headScale);

          // Jaw (Lower)
          ctx.save();
          ctx.rotate(jawAngle); 
          ctx.fillStyle = '#14532d'; // Dark green
          ctx.beginPath();
          ctx.moveTo(-15, 10);
          ctx.lineTo(15, 10);
          ctx.lineTo(0, 40); // Pointy chin
          ctx.fill();
          // Teeth
          ctx.fillStyle = '#fff';
          ctx.beginPath();
          ctx.moveTo(-10, 10); ctx.lineTo(-8, 5); ctx.lineTo(-6, 10);
          ctx.moveTo(10, 10); ctx.lineTo(8, 5); ctx.lineTo(6, 10);
          ctx.fill();
          ctx.restore();

          // Skull (Upper)
          const headGrad = ctx.createLinearGradient(0, -20, 0, 20);
          headGrad.addColorStop(0, '#4ade80');
          headGrad.addColorStop(1, '#15803d');
          ctx.fillStyle = headGrad;
          
          ctx.beginPath();
          ctx.moveTo(-20, 10); 
          ctx.lineTo(20, 10);  
          ctx.lineTo(0, -40);  
          ctx.closePath();
          ctx.fill();

          // Eyes
          const drawEye = (ex: number, ey: number) => {
              ctx.beginPath();
              ctx.fillStyle = '#000'; // Socket
              ctx.ellipse(ex, ey, 6, 4, 0, 0, Math.PI*2);
              ctx.fill();
              
              // Glow
              ctx.shadowBlur = 10;
              ctx.shadowColor = '#fbbf24';
              ctx.fillStyle = '#fbbf24';
              ctx.beginPath();
              ctx.arc(ex, ey, 2, 0, Math.PI*2);
              ctx.fill();
              ctx.shadowBlur = 0;
          };
          drawEye(-8, -15);
          drawEye(8, -15);

          // Horns
          const drawHorn = (hx: number, hy: number, rot: number) => {
              ctx.save();
              ctx.translate(hx, hy);
              ctx.rotate(rot);
              ctx.fillStyle = '#d4d4d8'; // Bone
              ctx.beginPath();
              ctx.moveTo(-3, 0);
              ctx.lineTo(3, 0);
              ctx.quadraticCurveTo(0, -15, -10, -30); 
              ctx.lineTo(-3, 0);
              ctx.fill();
              ctx.restore();
          };
          drawHorn(-15, 0, -0.3);
          drawHorn(15, 0, 0.3);

          ctx.restore();
      }
  }

  drawRigidBody3D(ctx: CanvasRenderingContext2D, body: RigidBody3D) {
      // Perspective Projection
      const f = 1000; 
      const cx = ctx.canvas.width / 2;
      const cy = ctx.canvas.height / 2; 
      
      const project = (v: Vector3) => {
          const r = this.vRotate(v, body.rotation);
          const world = this.vAdd(r, body.position);
          
          const dx = world.x - cx;
          const dy = world.y - cy;
          const dz = world.z; 
          
          const depth = f + dz;
          if (depth < 10) return { x: world.x, y: world.y, scale: 0 }; 
          
          const scale = f / depth;
          return {
              x: cx + dx * scale,
              y: cy + dy * scale,
              scale
          };
      };

      const projVerts = body.vertices.map(project);
      
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';

      // Glow effect (Hover/Held feedback)
      if (body.glow > 0) {
          ctx.shadowBlur = 25 * body.glow;
          ctx.shadowColor = 'white';
      } else {
          ctx.shadowBlur = 0;
      }

      for (const face of body.faces) {
          const p0 = projVerts[face.indices[0]];
          const p1 = projVerts[face.indices[1]];
          const p2 = projVerts[face.indices[2]];
          
          const cross = (p1.x - p0.x) * (p2.y - p0.y) - (p2.x - p0.x) * (p1.y - p0.y);
          if (cross < 0 && body.type !== 'dragon') continue; 

          let brightness = 1.0;
          if (body.type === 'dragon') {
              const cx = (p0.x + p1.x + p2.x)/3;
              const distToCenter = Math.hypot(cx - ctx.canvas.width/2, (p0.y + p1.y + p2.y)/3 - ctx.canvas.height/2);
              brightness = Math.max(0.4, 1.0 - (distToCenter / 500));
          }

          ctx.fillStyle = face.color || body.color;
          ctx.strokeStyle = body.type === 'dragon' ? 'rgba(0,0,0,0.1)' : body.color;
          ctx.lineWidth = body.type === 'dragon' ? 1 : 2;
          
          ctx.beginPath();
          ctx.moveTo(p0.x, p0.y);
          for (let i = 1; i < face.indices.length; i++) {
              const p = projVerts[face.indices[i]];
              ctx.lineTo(p.x, p.y);
          }
          ctx.closePath();
          ctx.fill();
          
          if (body.type !== 'dragon') ctx.stroke();
      }
      ctx.shadowBlur = 0;
  }

  drawDevilHorn(ctx: CanvasRenderingContext2D, obj: SoftBodyObject) {
      if (!obj.points[0] || !obj.growth) return;
      const growth = obj.growth || 0;
      if (growth <= 0) return; 

      const base = obj.points[0];
      const scale = obj.config.scale || 100;
      const side = obj.config.side; 
      const sideMult = side === 'left' ? -1 : 1;
      const rot = obj.config.baseAngle || 0;

      ctx.save();
      ctx.translate(base.x, base.y);
      ctx.rotate(rot);

      const S = scale; 

      // Stylized Horn Shape
      ctx.beginPath();
      // Base width approx 0.6 * S
      ctx.moveTo(-S * 0.3 * sideMult, 0);
      
      const tipX = S * 0.4 * sideMult;
      const tipY = -S * 1.5;
      
      // Outer curve (Convex)
      ctx.quadraticCurveTo(
          S * 0.8 * sideMult, -S * 0.5, 
          tipX, tipY 
      );
      
      // Inner curve (Concave)
      ctx.quadraticCurveTo(
          S * 0.1 * sideMult, -S * 0.8,
          -S * 0.1 * sideMult, 0
      );
      
      ctx.closePath();

      // Style: Glossy Red / Devilish
      const grad = ctx.createLinearGradient(0, 0, tipX, tipY);
      grad.addColorStop(0, '#7f1d1d'); // Dark red base
      grad.addColorStop(0.4, '#dc2626'); // Red mid
      grad.addColorStop(0.8, '#ef4444'); // Bright red tip
      grad.addColorStop(1.0, '#fca5a5'); // Highlight tip

      ctx.fillStyle = grad;
      ctx.shadowColor = '#b91c1c';
      ctx.shadowBlur = 15;
      ctx.fill();
      ctx.shadowBlur = 0;

      // Rim Light / Gloss
      ctx.beginPath();
      ctx.moveTo(0, -S * 0.2);
      ctx.quadraticCurveTo(S * 0.4 * sideMult, -S * 0.6, tipX * 0.8, tipY * 0.8);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.stroke();

      ctx.restore();
  }

  drawPlant(ctx: CanvasRenderingContext2D, obj: SoftBodyObject) {
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (const s of obj.sticks) {
          if (s.isHidden) continue;
          ctx.beginPath();
          ctx.strokeStyle = s.color || obj.color;
          ctx.lineWidth = s.thickness || 3;
          ctx.moveTo(s.p0.x, s.p0.y);
          ctx.lineTo(s.p1.x, s.p1.y);
          ctx.stroke();
      }
      for (const p of obj.points) {
          if (p.color && p.color !== obj.color) {
              ctx.beginPath();
              ctx.fillStyle = p.color;
              if (p.color === '#4ade80') { 
                  ctx.ellipse(p.x, p.y, 15, 8, Math.PI/4, 0, Math.PI*2);
                  ctx.fill();
              } else {
                  const r = p.radius || 4;
                  ctx.arc(p.x, p.y, r, 0, Math.PI*2);
                  ctx.fill();
              }
          }
      }
  }

  drawWireframe(ctx: CanvasRenderingContext2D, obj: SoftBodyObject) {
      ctx.beginPath();
      ctx.strokeStyle = obj.color;
      ctx.lineWidth = obj.id.includes('horn') ? 4 : 3;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (const s of obj.sticks) {
          if (s.isHidden) continue;
          ctx.moveTo(s.p0.x, s.p0.y);
          ctx.lineTo(s.p1.x, s.p1.y);
      }
      ctx.stroke();
      if (obj.type === 'car') {
         ctx.fillStyle = 'rgba(59, 130, 246, 0.2)';
         ctx.fill();
      }
      if (obj.type === 'castle') {
         ctx.fillStyle = 'rgba(148, 163, 184, 0.2)';
         ctx.fill();
      }
      if (obj.type === 'car') {
          for(const p of obj.points) {
              if(p.radius) {
                  ctx.beginPath();
                  ctx.fillStyle = '#333';
                  ctx.arc(p.x, p.y, p.radius, 0, Math.PI*2);
                  ctx.fill();
                  ctx.strokeStyle = '#fff';
                  ctx.lineWidth = 2;
                  ctx.stroke();
              }
          }
      }
  }

  drawMesh(ctx: CanvasRenderingContext2D, obj: SoftBodyObject) {
      if (!obj.texture) return;
      let cols = 0;
      while(cols < obj.points.length && obj.points[cols].v === 0) cols++;
      if (cols === 0) return;
      for (let i = 0; i < obj.points.length - cols - 1; i++) {
          const pTL = obj.points[i];
          const pTR = obj.points[i + 1];
          const pBL = obj.points[i + cols];
          const pBR = obj.points[i + cols + 1];
          if (pTL.v !== pTR.v) continue;
          if (this.distSq(pTL, pTR) < 4000 && this.distSq(pTL, pBL) < 4000) {
             this.drawTexturedTriangle(ctx, obj.texture, pTL, pTR, pBL);
          }
          if (this.distSq(pTR, pBR) < 4000 && this.distSq(pBL, pBR) < 4000) {
             this.drawTexturedTriangle(ctx, obj.texture, pTR, pBR, pBL);
          }
      }
  }

  distSq(p1: Point, p2: Point) {
      const dx = p1.x - p2.x;
      const dy = p1.y - p2.y;
      return dx*dx + dy*dy;
  }

  drawTexturedTriangle(ctx: CanvasRenderingContext2D, img: HTMLImageElement, p0: Point, p1: Point, p2: Point) {
      const x0 = p0.u * img.width;  const y0 = p0.v * img.height;
      const x1 = p1.u * img.width;  const y1 = p1.v * img.height;
      const x2 = p2.u * img.width;  const y2 = p2.v * img.height;
      const u0 = p0.x; const v0 = p0.y;
      const u1 = p1.x; const v1 = p1.y;
      const u2 = p2.x; const v2 = p2.y;

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(u0, v0);
      ctx.lineTo(u1, v1);
      ctx.lineTo(u2, v2);
      ctx.closePath();
      ctx.clip();
      const delta = x0 * (y2 - y1) - x1 * (y2 - y0) + x2 * (y1 - y0);
      if (Math.abs(delta) < 0.001) { ctx.restore(); return; } 
      const deltaU = u0 * (y2 - y1) - u1 * (y2 - y0) + u2 * (y1 - y0);
      const deltaV = v0 * (y2 - y1) - v1 * (y2 - y0) + v2 * (y1 - y0);
      const a = deltaU / delta;
      const b = deltaV / delta;
      const deltaU2 = u0 * (x2 - x1) - u1 * (x2 - x0) + u2 * (x1 - x0);
      const deltaV2 = v0 * (x2 - x1) - v1 * (x2 - x0) + v2 * (x1 - x0);
      const c = deltaU2 / -delta;
      const d = deltaV2 / -delta;
      const e = u0 - a * x0 - c * y0;
      const f = v0 - b * x0 - d * y0;
      ctx.transform(a, b, c, d, e, f);
      ctx.drawImage(img, 0, 0);
      ctx.restore();
  }
}
