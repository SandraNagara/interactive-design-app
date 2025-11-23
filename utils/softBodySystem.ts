
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

  // --- 3D SPAWNERS ---

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

  spawnCat(cx: number, cy: number) {
    const points: Point[] = [];
    const sticks: Stick[] = [];
    const addP = (x: number, y: number) => {
        const p = { x, y, oldX: x, oldY: y, isPinned: false, u:0, v:0 };
        points.push(p);
        return p;
    };
    const addS = (p1: Point, p2: Point) => {
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        sticks.push({ p0: p1, p1: p2, length: Math.sqrt(dx*dx + dy*dy) });
    };
    const radius = 60;
    const segments = 12;
    const center = addP(cx, cy);
    const rimPoints: Point[] = [];
    for (let i=0; i<segments; i++) {
        const theta = (i/segments) * Math.PI * 2;
        const p = addP(cx + Math.cos(theta)*radius, cy + Math.sin(theta)*radius);
        rimPoints.push(p);
        addS(center, p);
        if(i > 0) addS(rimPoints[i-1], p);
    }
    addS(rimPoints[segments-1], rimPoints[0]);
    this.objects.push({ 
        id: Math.random().toString(),
        type: 'generic',
        points, 
        sticks, 
        color: '#d946ef'
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
      const growthSpeed = 0.05;
      if (isGestureActive) {
          if (leftHorn.growth! < 1.0) leftHorn.growth! += growthSpeed;
          if (rightHorn.growth! < 1.0) rightHorn.growth! += growthSpeed;
      }
      const getPt = (idx: number) => ({
          x: (1 - faceLandmarks[idx].x) * canvasWidth,
          y: faceLandmarks[idx].y * canvasHeight
      });
      const headTop = getPt(10);
      const foreheadLeft = getPt(105);
      const foreheadRight = getPt(334);
      const headWidth = Math.hypot(foreheadRight.x - foreheadLeft.x, foreheadRight.y - foreheadLeft.y);
      const scale = headWidth * 1.5; 
      const dx = foreheadRight.x - foreheadLeft.x;
      const dy = foreheadRight.y - foreheadLeft.y;
      const angle = Math.atan2(dy, dx); 
      leftHorn.points = [ { x: foreheadRight.x, y: foreheadRight.y, oldX:0, oldY:0, isPinned:true, u:0, v:0 } ];
      leftHorn.config.baseAngle = angle - Math.PI / 3; 
      leftHorn.config.scale = scale;
      rightHorn.points = [ { x: foreheadLeft.x, y: foreheadLeft.y, oldX:0, oldY:0, isPinned:true, u:0, v:0 } ];
      rightHorn.config.baseAngle = angle - Math.PI + Math.PI / 3; 
      rightHorn.config.scale = scale;
  }

  // --- 3D INTERACTION ---

  handleInteraction3D(handId: number, x: number, y: number, z: number, isPinching: boolean, rotationAngle: number) {
    if (isPinching) {
        if (!this.heldObjects.has(handId)) {
            // Find closest object in 3D screen space
            let closestDist = 100;
            let target: RigidBody3D | null = null;
            
            // Simple Raycast-like check: distance on screen plane
            for (const body of this.rigidBodies) {
                const dx = body.position.x - x;
                const dy = body.position.y - y;
                const dist = Math.sqrt(dx*dx + dy*dy);
                if (dist < closestDist) {
                    closestDist = dist;
                    target = body;
                }
            }

            if (target) {
                target.isHeld = true;
                target.snapTarget = null; // Break existing snap
                target.glow = 1.0;
                // Store initial offsets to keep hold smooth
                this.heldObjects.set(handId, {
                    bodyId: target.id,
                    offset: { x: target.position.x - x, y: target.position.y - y, z: target.position.z - z },
                    initialHandRot: rotationAngle,
                    initialObjRot: target.rotation // Would need conversion to Euler Y to apply properly, keeping simple for now
                });
            }
        } else {
            // DRAG
            const hold = this.heldObjects.get(handId)!;
            const body = this.rigidBodies.find(b => b.id === hold.bodyId);
            if (body) {
                // Position update (Spring-like lerp)
                const tx = x + hold.offset.x;
                const ty = y + hold.offset.y;
                // For Z, we use hand Z.
                const tz = z + hold.offset.z;

                // Smooth follow
                body.position.x += (tx - body.position.x) * 0.3;
                body.position.y += (ty - body.position.y) * 0.3;
                body.position.z += (tz - body.position.z) * 0.3;
                
                body.velocity = { x: 0, y: 0, z: 0 }; // Zero physics velocity while holding

                // Rotation: Add Delta of hand rotation to object
                // We map 2D hand rotation (twist) to Y-axis rotation
                // NOTE: This resets rotation if we aren't careful.
                // Better: Delta rotation.
                const deltaRot = rotationAngle - hold.initialHandRot;
                // Reset initial to avoid continuous spinning
                // hold.initialHandRot = rotationAngle; // Uncomment for continuous
                
                // Simple Y-axis spin based on wrist angle
                // Create a quaternion for the Y axis rotation
                const qY = this.qFromAxisAngle({x:0, y:1, z:0}, deltaRot * 0.1); // Sensitivity
                body.rotation = this.qMult(body.rotation, qY);
                hold.initialHandRot = rotationAngle; // Accumulate
            }
        }
    } else {
        // RELEASE
        if (this.heldObjects.has(handId)) {
            const hold = this.heldObjects.get(handId)!;
            const body = this.rigidBodies.find(b => b.id === hold.bodyId);
            if (body) {
                body.isHeld = false;
                // Check Stacking
                this.checkSnapping(body);
            }
            this.heldObjects.delete(handId);
        }
    }
  }

  checkSnapping(active: RigidBody3D) {
      // Find a body strictly below this one
      // Since Y is down in canvas, "below" means target.y > active.y ? No, visually below.
      // In 3D world: Y usually Up. In this canvas: Y is Down.
      // So "Object on Floor" has High Y. "Object in Air" has Low Y.
      // If we stack A on B, A is "above" B physically, so A.y < B.y.
      
      const threshold = 50; // Horizontal snapping forgiveness

      for (const other of this.rigidBodies) {
          if (other.id === active.id) continue;
          
          const dx = Math.abs(active.position.x - other.position.x);
          const dz = Math.abs(active.position.z - other.position.z);
          
          // Check if horizontally aligned
          if (dx < threshold && dz < threshold) {
              // Check vertical relation. Active should be roughly 1 unit 'above' Other.
              // active.y should be less than other.y
              const dy = other.position.y - active.position.y;
              
              // Expected distance is roughly (half_height_A + half_height_B)
              const expectedDist = 60; // Assuming uniform size for now (60 unit cubes)
              
              if (dy > 0 && dy < expectedDist + 40) {
                  // SNAP!
                  active.snapTarget = other.id;
                  active.position.x = other.position.x;
                  active.position.z = other.position.z;
                  active.position.y = other.position.y - expectedDist;
                  active.rotation = other.rotation; // Align rotation for neat stacks
                  active.velocity = {x:0,y:0,z:0};
                  active.glow = 1.0; // Visual feedback
                  other.glow = 0.5;
                  
                  // Stabilization
                  active.snapTimer = 20; // Frames to freeze physics
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
          if (body.glow > 0) body.glow -= 0.05;

          if (body.isHeld) continue;

          if (body.snapTimer > 0) {
              body.snapTimer--;
              continue; // Skip physics if stabilizing
          }

          // Gravity
          // Only apply if not snapped (or check if snap support is still valid)
          if (body.snapTarget) {
              // Check if snap target still exists/is valid
              const target = this.rigidBodies.find(b => b.id === body.snapTarget);
              if (target) {
                  // Follow target
                  body.position.x = target.position.x;
                  body.position.z = target.position.z;
                  body.position.y = target.position.y - 60; // Hardcoded stack height
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
          // Simple Plane at Y = height - size/2
          // Note: In canvas, Y increases downwards.
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
      // We need to sort by Z for painter's algo.
      // Since positive Z is depth (away), we draw largest Z first?
      // No, standard coord: Z+ is out of screen? Or into?
      // My spawn sets Z=0. Projection assumes +Z is depth? 
      // Let's assume +Z is INTO screen for this simple implementation.
      // So high Z drawn first (background), low Z last (foreground).
      const sortedBodies = [...this.rigidBodies].sort((a, b) => b.position.z - a.position.z);
      
      for (const body of sortedBodies) {
          this.drawRigidBody3D(ctx, body);
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

  drawRigidBody3D(ctx: CanvasRenderingContext2D, body: RigidBody3D) {
      // Perspective Projection
      const f = 1000; // Focal length
      const cx = ctx.canvas.width / 2;
      const cy = ctx.canvas.height / 2; // Actually we want relative to body pos? 
      // Wait, standard projection: x' = x * (f/z).
      // Our world coordinates are screen-aligned (0,0 top-left).
      // We need a "Camera" center. Let's assume camera is at screen center, z = -f.
      
      const project = (v: Vector3) => {
          // 1. Rotate vertex by Body Rotation
          const r = this.vRotate(v, body.rotation);
          // 2. Translate by Body Position
          const world = this.vAdd(r, body.position);
          
          // 3. Project to Screen
          // Relative to camera center
          const dx = world.x - cx;
          const dy = world.y - cy;
          const dz = world.z; // Z=0 is screen plane
          
          const depth = f + dz;
          if (depth < 10) return { x: world.x, y: world.y, scale: 0 }; // Behind cam
          
          const scale = f / depth;
          return {
              x: cx + dx * scale,
              y: cy + dy * scale,
              scale
          };
      };

      // Transform all vertices
      const projVerts = body.vertices.map(project);
      
      // Draw Faces
      // Naive backface culling or Z-sorting of faces?
      // For simple cubes, drawing all faces with transparency looks "Techy".
      
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';

      // Glow effect
      if (body.glow > 0) {
          ctx.shadowBlur = 20 * body.glow;
          ctx.shadowColor = 'white';
      } else {
          ctx.shadowBlur = 0;
      }

      for (const face of body.faces) {
          const p0 = projVerts[face.indices[0]];
          const p1 = projVerts[face.indices[1]];
          const p2 = projVerts[face.indices[2]];
          
          // Check winding order for backface culling?
          // (x1-x0)(y2-y0) - (x2-x0)(y1-y0)
          const cross = (p1.x - p0.x) * (p2.y - p0.y) - (p2.x - p0.x) * (p1.y - p0.y);
          if (cross < 0) continue; // Cull back faces

          ctx.fillStyle = face.color || body.color;
          ctx.strokeStyle = body.color;
          
          ctx.beginPath();
          ctx.moveTo(p0.x, p0.y);
          for (let i = 1; i < face.indices.length; i++) {
              const p = projVerts[face.indices[i]];
              ctx.lineTo(p.x, p.y);
          }
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
      }
      ctx.shadowBlur = 0;
  }

  drawDevilHorn(ctx: CanvasRenderingContext2D, obj: SoftBodyObject) {
      if (!obj.points[0] || !obj.growth) return;
      const base = obj.points[0];
      const scale = obj.config.scale || 100;
      const sideMult = obj.config.side === 'left' ? -1 : 1;
      const growth = obj.growth;

      if (growth < 0.05) return;

      const start = { x: base.x, y: base.y };
      const cp1 = { x: base.x + (60 * scale / 100 * sideMult), y: base.y - (20 * scale / 100) };
      const cp2 = { x: base.x + (70 * scale / 100 * sideMult), y: base.y - (100 * scale / 100) };
      const end = { x: base.x + (30 * scale / 100 * sideMult), y: base.y - (140 * scale / 100) };

      const getBezierPoint = (t: number) => {
          const mt = 1 - t;
          const mt2 = mt * mt;
          const mt3 = mt2 * mt;
          const t2 = t * t;
          const t3 = t2 * t;
          return {
              x: start.x * mt3 + 3 * cp1.x * mt2 * t + 3 * cp2.x * mt * t2 + end.x * t3,
              y: start.y * mt3 + 3 * cp1.y * mt2 * t + 3 * cp2.y * mt * t2 + end.y * t3
          };
      };

      const getNormal = (t: number) => {
          const mt = 1 - t;
          const dC = {
              x: 3*mt*mt*(cp1.x-start.x) + 6*mt*t*(cp2.x-cp1.x) + 3*t*t*(end.x-cp2.x),
              y: 3*mt*mt*(cp1.y-start.y) + 6*mt*t*(cp2.y-cp1.y) + 3*t*t*(end.y-cp2.y)
          };
          const len = Math.sqrt(dC.x*dC.x + dC.y*dC.y);
          return { x: -dC.y / len, y: dC.x / len };
      };

      const segments = 24; 
      const leftPath: {x:number, y:number}[] = [];
      const rightPath: {x:number, y:number}[] = [];
      const centerPath: {x:number, y:number}[] = [];
      const maxT = growth; 

      for (let i = 0; i <= segments; i++) {
          const t = (i / segments) * maxT;
          const center = getBezierPoint(t);
          const normal = getNormal(t);
          const taper = (1 - (t / 1.0)); 
          const radius = (35 * scale / 100) * (taper * taper + 0.2 * taper); 
          leftPath.push({ x: center.x + normal.x * radius, y: center.y + normal.y * radius });
          rightPath.push({ x: center.x - normal.x * radius, y: center.y - normal.y * radius });
          centerPath.push(center);
      }

      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      ctx.shadowBlur = 25 * growth;
      ctx.shadowColor = '#dc2626'; 
      ctx.fillStyle = '#7f1d1d';
      
      ctx.beginPath();
      ctx.moveTo(leftPath[0].x, leftPath[0].y);
      for (const p of leftPath) ctx.lineTo(p.x, p.y);
      ctx.lineTo(centerPath[centerPath.length-1].x, centerPath[centerPath.length-1].y);
      for (let i = rightPath.length - 1; i >= 0; i--) ctx.lineTo(rightPath[i].x, rightPath[i].y);
      ctx.closePath();
      ctx.fill();

      ctx.globalCompositeOperation = 'source-over';
      ctx.shadowBlur = 0;

      const grad = ctx.createLinearGradient(start.x, start.y, end.x, end.y);
      grad.addColorStop(0.0, '#450a0a'); 
      grad.addColorStop(0.4, '#991b1b'); 
      grad.addColorStop(0.8, '#ef4444'); 
      grad.addColorStop(1.0, '#fca5a5'); 

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(leftPath[0].x, leftPath[0].y);
      for (const p of leftPath) ctx.lineTo(p.x, p.y);
      ctx.lineTo(centerPath[centerPath.length-1].x, centerPath[centerPath.length-1].y);
      for (let i = rightPath.length - 1; i >= 0; i--) ctx.lineTo(rightPath[i].x, rightPath[i].y);
      ctx.closePath();
      ctx.fill();

      ctx.strokeStyle = 'rgba(0,0,0,0.3)';
      ctx.lineWidth = 4;
      ctx.filter = 'blur(4px)';
      ctx.stroke();
      ctx.filter = 'none';

      ctx.beginPath();
      for (let i = 0; i < centerPath.length - 2; i++) {
          const c = centerPath[i];
          const n = getNormal((i/segments)*maxT);
          const shift = (10 * scale / 100);
          const hx = c.x + n.x * (sideMult * shift * 0.5);
          const hy = c.y + n.y * (sideMult * shift * 0.5);
          
          if (i===0) ctx.moveTo(hx, hy);
          else ctx.lineTo(hx, hy);
      }
      ctx.lineCap = 'round';
      ctx.lineWidth = 6 * scale / 100;
      ctx.strokeStyle = 'rgba(255, 200, 200, 0.4)'; 
      ctx.stroke();
      
      ctx.lineWidth = 2 * scale / 100;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)'; 
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
