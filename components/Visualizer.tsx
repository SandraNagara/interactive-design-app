
import React, { useEffect, useRef, useState } from 'react';
import { HandLandmarker, FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
import { ParticleSystem } from '../utils/particleSystem';
import { SoftBodySystem } from '../utils/softBodySystem';

interface VisualizerProps {
  onClose: () => void;
}

type VisualizerMode = 'object' | 'particles' | 'all';

const CONNECTIONS = [
  [0,1], [1,2], [2,3], [3,4], 
  [0,5], [5,6], [6,7], [7,8], 
  [0,9], [9,10], [10,11], [11,12], 
  [0,13], [13,14], [14,15], [15,16], 
  [0,17], [17,18], [18,19], [19,20], 
  [5,9], [9,13], [13,17], [0,17] 
];

export const Visualizer: React.FC<VisualizerProps> = ({ onClose }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [status, setStatus] = useState<string>('Initializing Vision Models...');
  const [stats, setStats] = useState({ fps: 0, brightness: 0, particles: 0, bloom: 1.0 });
  const [gesture, setGesture] = useState<string>('NONE');
  const [hasImage, setHasImage] = useState(false);
  const [mode, setMode] = useState<VisualizerMode>('all');

  const requestRef = useRef<number>(0);
  const previousTimeRef = useRef<number>(0);
  const bloomIntensityRef = useRef(1.0);
  const lightSensitivityRef = useRef(1.0);
  const modeRef = useRef<VisualizerMode>('all');
  
  // Systems
  const particleSystemRef = useRef(new ParticleSystem());
  const softBodyRef = useRef(new SoftBodySystem());
  
  const landmarkerRef = useRef<HandLandmarker | null>(null);
  const faceLandmarkerRef = useRef<FaceLandmarker | null>(null);
  const prevLandmarksRef = useRef<any[]>([]);

  // Censor effect helper canvas
  const censorCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const calculateBrightness = (ctx: CanvasRenderingContext2D, width: number, height: number): number => {
    try {
      const sampleSize = 40; 
      const sx = Math.floor((width - sampleSize) / 2);
      const sy = Math.floor((height - sampleSize) / 2);
      const frame = ctx.getImageData(sx, sy, sampleSize, sampleSize);
      const data = frame.data;
      let total = 0;
      for (let i = 0; i < data.length; i += 4) {
        total += (data[i] + data[i + 1] + data[i + 2]) / 3;
      }
      return (total / (data.length / 4)) / 255;
    } catch (e) { return 0; }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0] && canvasRef.current) {
        const reader = new FileReader();
        reader.onload = (event) => {
            const img = new Image();
            img.onload = () => {
                softBodyRef.current.spawnImageMesh(
                    img, 
                    canvasRef.current!.width / 2, 
                    canvasRef.current!.height / 2,
                    300
                );
                setHasImage(true);
            };
            img.src = event.target?.result as string;
        };
        reader.readAsDataURL(e.target.files[0]);
    }
  };

  const handleResetObjects = () => {
    softBodyRef.current.reset();
    setHasImage(false);
  };

  const cycleMode = () => {
    const modes: VisualizerMode[] = ['all', 'object', 'particles'];
    const nextIndex = (modes.indexOf(modeRef.current) + 1) % modes.length;
    const nextMode = modes[nextIndex];
    setMode(nextMode);
    modeRef.current = nextMode;
  };

  // --- Visual Effects Helpers ---

  const censorFace = (ctx: CanvasRenderingContext2D, face: any) => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    
    for(const p of face) {
        const sx = (1 - p.x) * ctx.canvas.width; 
        const sy = p.y * ctx.canvas.height;
        if(sx < minX) minX = sx;
        if(sx > maxX) maxX = sx;
        if(sy < minY) minY = sy;
        if(sy > maxY) maxY = sy;
    }
    
    const w = maxX - minX;
    const h = maxY - minY;
    const pad = w * 0.2;
    const x = minX - pad/2;
    const y = minY - pad/2;
    const fw = w + pad;
    const fh = h + pad;

    const pixelSize = 15;
    
    if (!censorCanvasRef.current) {
        censorCanvasRef.current = document.createElement('canvas');
    }
    const cCanvas = censorCanvasRef.current;
    if (cCanvas.width < fw || cCanvas.height < fh) {
        cCanvas.width = Math.max(fw, 100);
        cCanvas.height = Math.max(fh, 100);
    }
    const cCtx = cCanvas.getContext('2d');
    if(!cCtx) return;

    cCtx.clearRect(0, 0, fw, fh);
    cCtx.drawImage(ctx.canvas, x, y, fw, fh, 0, 0, fw / pixelSize, fh / pixelSize);
    
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(cCanvas, 0, 0, fw / pixelSize, fh / pixelSize, x, y, fw, fh);
    ctx.imageSmoothingEnabled = true;

    ctx.fillStyle = 'white';
    ctx.font = 'bold 12px monospace';
    ctx.fillText('ACCESS DENIED', x + 5, y + fh + 15);
  };

  const drawHalo = (ctx: CanvasRenderingContext2D, face: any) => {
      const p = face[10];
      const cx = (1 - p.x) * ctx.canvas.width; 
      const cy = p.y * ctx.canvas.height - 80;

      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      ctx.shadowBlur = 40;
      ctx.shadowColor = '#fcd34d';
      ctx.strokeStyle = 'rgba(255, 255, 200, 0.9)';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.ellipse(cx, cy, 100, 30, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = 'rgba(253, 224, 71, 0.1)';
      ctx.fill();
      const time = performance.now() * 0.005;
      for(let i=0; i<6; i++) {
        const angle = time + i * (Math.PI * 2 / 6);
        const sx = cx + Math.cos(angle) * 100;
        const sy = cy + Math.sin(angle) * 30;
        ctx.beginPath();
        ctx.fillStyle = '#fff';
        ctx.arc(sx, sy, 4, 0, Math.PI*2);
        ctx.fill();
      }
      ctx.fillStyle = 'rgba(255, 255, 200, 0.05)';
      ctx.beginPath();
      ctx.moveTo(cx - 80, cy);
      ctx.lineTo(cx + 80, cy);
      ctx.lineTo(cx + 150, cy + 400);
      ctx.lineTo(cx - 150, cy + 400);
      ctx.fill();
      ctx.restore();
  };

  useEffect(() => {
    let isActive = true;

    const setupVision = async () => {
      try {
        const vision = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm"
        );
        if (!isActive) return;
        
        const landmarker = await HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: `https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`,
            delegate: "GPU"
          },
          runningMode: "VIDEO",
          numHands: 2
        });
        landmarkerRef.current = landmarker;

        const faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task`,
            delegate: "GPU"
          },
          runningMode: "VIDEO",
          numFaces: 1
        });
        faceLandmarkerRef.current = faceLandmarker;

        setStatus('Starting Camera...');
        startCamera();
      } catch (err) {
        setStatus(`Error: ${(err as Error).message}`);
      }
    };

    setupVision();

    const handleKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (key === 'q') onClose();
      if (key === 'i') fileInputRef.current?.click();
      if (key === 'm') cycleMode();
      if (key === 'c') handleResetObjects();
      
      if (e.key === '+') lightSensitivityRef.current += 0.1;
      if (e.key === '-') lightSensitivityRef.current = Math.max(0.1, lightSensitivityRef.current - 0.1);

      // Object Spawning
      if (canvasRef.current) {
          const cx = canvasRef.current.width / 2;
          const cy = canvasRef.current.height / 2;
          if (e.key === '1') softBodyRef.current.spawnCar(cx, cy + 100);
          if (e.key === '2') softBodyRef.current.spawnPlant(cx, cy + 150);
          if (e.key === '3') softBodyRef.current.spawnCastle(cx, cy + 150);
          if (e.key === '4') softBodyRef.current.spawnCube3D(cx, cy - 200); // Spawn in air
          if (e.key === '5') softBodyRef.current.spawnPyramid3D(cx, cy - 200);
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      isActive = false;
      window.removeEventListener('keydown', handleKeyDown);
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
      if (videoRef.current && videoRef.current.srcObject) {
        const tracks = (videoRef.current.srcObject as MediaStream).getTracks();
        tracks.forEach(t => t.stop());
      }
      landmarkerRef.current?.close();
      faceLandmarkerRef.current?.close();
    };
  }, [onClose]);

  const startCamera = async () => {
    if (!videoRef.current) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 1280, height: 720, frameRate: { ideal: 60 } }
      });
      videoRef.current.srcObject = stream;
      videoRef.current.addEventListener("loadeddata", predictWebcam);
      setStatus('Active');
    } catch (err) {
      setStatus('Camera Access Denied');
    }
  };

  const predictWebcam = () => {
    if (!videoRef.current || !canvasRef.current || !landmarkerRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    }

    const startTimeMs = performance.now();
    let handResults;
    let faceResults;

    try {
      handResults = landmarkerRef.current.detectForVideo(video, startTimeMs);
      if (faceLandmarkerRef.current) {
          faceResults = faceLandmarkerRef.current.detectForVideo(video, startTimeMs);
      }
    } catch (e) { console.error(e); }

    // DRAW BACKGROUND (Mirrored)
    ctx.save();
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    ctx.restore();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)'; 
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const currentBrightness = calculateBrightness(ctx, canvas.width, canvas.height) * lightSensitivityRef.current;
    const ps = particleSystemRef.current;
    const sb = softBodyRef.current;

    const hands = handResults?.landmarks || [];
    const face = faceResults?.faceLandmarks && faceResults.faceLandmarks.length > 0 ? faceResults.faceLandmarks[0] : null;
    
    let globalGesture = 'NONE';
    const allowObjects = modeRef.current === 'all' || modeRef.current === 'object';
    const allowParticles = modeRef.current === 'all' || modeRef.current === 'particles';

    if (hands.length === 2 && face) {
        const h1 = hands[0];
        const h2 = hands[1];
        const nose = face[1]; 
        if (h1[0].y < nose.y && h2[0].y < nose.y) {
            globalGesture = 'HALO';
            if (allowObjects) drawHalo(ctx, face); 
        }
    }

    hands.forEach((landmarks, handIndex) => {
        const prevLandmarks = prevLandmarksRef.current[handIndex];
        
        const wrist = landmarks[0];
        const thumbTip = landmarks[4];
        const indexTip = landmarks[8];
        const middleTip = landmarks[12];
        const ringTip = landmarks[16];
        const pinkyTip = landmarks[20];
        
        const indexPip = landmarks[6];
        const middlePip = landmarks[10];
        const ringPip = landmarks[14];
        const pinkyPip = landmarks[18];

        const isExtended = (tip: any, pip: any) => 
            Math.hypot(tip.x - wrist.x, tip.y - wrist.y) > Math.hypot(pip.x - wrist.x, pip.y - wrist.y);
        const isCurled = (tip: any, pip: any) => !isExtended(tip, pip);

        const indexOpen = isExtended(indexTip, indexPip);
        const middleOpen = isExtended(middleTip, middlePip);
        const ringOpen = isExtended(ringTip, ringPip);
        const pinkyOpen = isExtended(pinkyTip, pinkyPip);
        
        const pinchDist = Math.hypot(thumbTip.x - indexTip.x, thumbTip.y - indexTip.y);
        
        let handGesture = 'GENERIC';

        if (isCurled(indexTip, indexPip) && middleOpen && isCurled(ringTip, ringPip) && isCurled(pinkyTip, pinkyPip)) {
            handGesture = 'MIDDLE_FINGER';
        }
        else if (!indexOpen && !middleOpen && !ringOpen && !pinkyOpen) {
            handGesture = 'FIST';
        }
        else if (pinchDist < 0.05) {
            handGesture = 'PINCH';
        }
        else if (indexOpen && middleOpen && !ringOpen && !pinkyOpen) {
            handGesture = 'VICTORY'; 
        }
        else if (indexOpen && middleOpen && ringOpen && pinkyOpen) {
            handGesture = 'OPEN_PALM';
        }

        if (globalGesture !== 'HALO') {
             if (handGesture === 'MIDDLE_FINGER') globalGesture = 'CENSOR';
             else if (handGesture === 'VICTORY' && globalGesture !== 'CENSOR') globalGesture = 'HORNS';
             else if (handGesture === 'FIST' && globalGesture !== 'CENSOR' && globalGesture !== 'HORNS') globalGesture = 'FIST';
             else if (handGesture === 'PINCH' && globalGesture === 'NONE') globalGesture = 'PINCH';
             else if (handGesture === 'OPEN_PALM' && globalGesture === 'NONE') globalGesture = 'FOLD';
        }

        // --- COORDINATE MAPPING ---
        const palm = landmarks[9];
        // 1. Position
        const cx = (1 - palm.x) * canvas.width; // Mirrored X
        const cy = palm.y * canvas.height;
        // 2. Depth (Relative Z from MediaPipe approx)
        const cz = (palm.z || 0) * 100; // Scale arbitrary

        // 3. Rotation (Wrist Twist)
        // Vector from Wrist to Index MCP (proximal knuckle)
        // This gives general hand orientation
        const vecX = (landmarks[5].x - wrist.x);
        const vecY = (landmarks[5].y - wrist.y);
        // Angle in radians. Note: landmarks are normalized, but angle is roughly valid in 2D plane.
        // We mirror X direction for correct rotation feel
        const rotation = Math.atan2(vecY, -vecX);

        let velocity = { x: 0, y: 0 };
        if (prevLandmarks) {
            const prevX = (1 - prevLandmarks[9].x) * canvas.width;
            const prevY = prevLandmarks[9].y * canvas.height;
            velocity.x = cx - prevX;
            velocity.y = cy - prevY;
        }

        if (allowObjects) {
            if (handGesture === 'MIDDLE_FINGER' && face) {
                censorFace(ctx, face);
            }

            // 3D INTERACTION
            // We pass mirrored coords, and computed rotation
            sb.handleInteraction3D(handIndex, cx, cy, cz, handGesture === 'PINCH', rotation);

            // 2D Soft Body Interactions
            if (handGesture === 'FIST') {
                sb.crumple(cx, cy, 180, 1.5);
                ctx.strokeStyle = 'rgba(255, 50, 50, 0.4)';
                ctx.beginPath(); ctx.arc(cx, cy, 80, 0, Math.PI*2); ctx.stroke();
            }
            if (handGesture === 'PINCH') {
                const pinchX = (1 - (thumbTip.x + indexTip.x) / 2) * canvas.width;
                const pinchY = (thumbTip.y + indexTip.y) / 2 * canvas.height;
                sb.handleInteraction(handIndex, pinchX, pinchY, true);
            } else {
                sb.handleInteraction(handIndex, 0, 0, false);
            }

            if (handGesture === 'OPEN_PALM') {
                sb.fold(cx, cy, 220, velocity);
            }
        } else {
            sb.handleInteraction(handIndex, 0, 0, false);
        }

        if (allowParticles && handGesture === 'OPEN_PALM') {
            ps.emit(cx, cy, currentBrightness, velocity, 'cloud');
        }

        // Skeleton
        ctx.save();
        ctx.lineWidth = 3;
        let strokeCol = '#00ff00';
        if (handGesture === 'FIST') strokeCol = 'red';
        if (handGesture === 'MIDDLE_FINGER') strokeCol = '#ff00ff';
        if (handGesture === 'VICTORY') strokeCol = 'orange';
        if (handGesture === 'OPEN_PALM') strokeCol = 'cyan';
        ctx.strokeStyle = strokeCol;
        for (const [start, end] of CONNECTIONS) {
            const p1 = landmarks[start];
            const p2 = landmarks[end];
            ctx.beginPath();
            ctx.moveTo((1 - p1.x) * canvas.width, p1.y * canvas.height);
            ctx.lineTo((1 - p2.x) * canvas.width, p2.y * canvas.height);
            ctx.stroke();
        }
        ctx.restore();
    });
    
    if (allowObjects && face) {
        const isHornsActive = (globalGesture === 'HORNS');
        sb.updateHorns(face, isHornsActive, canvas.width, canvas.height);
    }

    prevLandmarksRef.current = hands;
    setGesture(globalGesture);
    
    if (allowObjects) {
        sb.update(canvas.width, canvas.height);
        sb.draw(ctx);
    }

    ps.update(); 
    if (allowParticles) {
        ps.draw(ctx, bloomIntensityRef.current);
    }

    const now = performance.now();
    const fps = Math.round(1000 / (now - (previousTimeRef.current || now) || 1));
    previousTimeRef.current = now;
    if (now % 200 < 17) {
      setStats({
        fps,
        brightness: Math.round(currentBrightness * 100),
        particles: ps.particles.length,
        bloom: parseFloat(bloomIntensityRef.current.toFixed(1))
      });
    }
    requestRef.current = requestAnimationFrame(predictWebcam);
  };

  return (
    <div className="relative w-full h-screen bg-black overflow-hidden">
      <input 
        type="file" 
        ref={fileInputRef} 
        onChange={handleImageUpload} 
        className="hidden" 
        accept="image/*"
      />
      <video ref={videoRef} className="absolute opacity-0 pointer-events-none" autoPlay playsInline muted />
      <canvas ref={canvasRef} className="absolute top-0 left-0 w-full h-full object-cover" />
      
      {/* HUD - Stats */}
      <div className="absolute top-4 left-4 pointer-events-none select-none z-30">
        <div className="bg-black/60 backdrop-blur-sm border-l-2 border-green-500 p-4 text-xs font-mono text-green-400 shadow-[0_0_15px_rgba(0,255,0,0.2)]">
          <div className="mb-2 text-white font-bold tracking-widest">SYSTEM MONITOR</div>
          <div className="grid grid-cols-2 gap-x-8 gap-y-1">
            <span>FPS:</span> <span className="text-white">{stats.fps}</span>
            <span>OBJS:</span> <span className="text-white">{softBodyRef.current.objects.length + softBodyRef.current.rigidBodies.length}</span>
            <span>MODE:</span> <span className="text-cyan-400 font-bold uppercase">{mode}</span>
            <span>GESTURE:</span> <span className="text-yellow-400 font-bold">{gesture}</span>
            <span>LIGHT:</span> <span className="text-white">{stats.brightness}%</span>
          </div>
        </div>
      </div>

      {/* HUD - Gesture Overlay */}
      <div className="absolute top-1/2 right-4 transform -translate-y-1/2 flex flex-col gap-4 pointer-events-none z-30">
        <div className={`flex items-center justify-end gap-3 p-2 rounded-lg transition-all duration-300 ${gesture === 'FOLD' ? 'bg-cyan-500/40 scale-110 shadow-lg shadow-cyan-500/20 translate-x-[-10px]' : 'bg-black/40 opacity-50'}`}>
            <span className="text-xs font-mono font-bold text-white uppercase tracking-wider">Fold</span>
            <span className="text-2xl drop-shadow-md">✋</span>
        </div>
        <div className={`flex items-center justify-end gap-3 p-2 rounded-lg transition-all duration-300 ${gesture === 'FIST' ? 'bg-red-500/40 scale-110 shadow-lg shadow-red-500/20 translate-x-[-10px]' : 'bg-black/40 opacity-50'}`}>
            <span className="text-xs font-mono font-bold text-white uppercase tracking-wider">Crumple</span>
            <span className="text-2xl drop-shadow-md">✊</span>
        </div>
        <div className={`flex items-center justify-end gap-3 p-2 rounded-lg transition-all duration-300 ${gesture === 'PINCH' ? 'bg-yellow-500/40 scale-110 shadow-lg shadow-yellow-500/20 translate-x-[-10px]' : 'bg-black/40 opacity-50'}`}>
            <span className="text-xs font-mono font-bold text-white uppercase tracking-wider">Stretch/Grab</span>
            <span className="text-2xl drop-shadow-md">🤏</span>
        </div>
        <div className={`flex items-center justify-end gap-3 p-2 rounded-lg transition-all duration-300 ${gesture === 'HORNS' ? 'bg-orange-500/40 scale-110 shadow-lg shadow-orange-500/20 translate-x-[-10px]' : 'bg-black/40 opacity-50'}`}>
            <span className="text-xs font-mono font-bold text-white uppercase tracking-wider">Horns</span>
            <span className="text-2xl drop-shadow-md">✌️</span>
        </div>
      </div>

      {/* Controls */}
      <div className="absolute top-4 right-4 flex flex-col gap-2 select-none z-30">
        <button 
          onClick={cycleMode}
          className="px-4 py-2 bg-purple-900/80 hover:bg-purple-800 text-purple-200 border border-purple-500/30 rounded text-xs font-mono transition-all backdrop-blur-md text-right"
        >
          [M] MODE: {mode.toUpperCase()}
        </button>
        <button 
          onClick={handleResetObjects}
          className="px-4 py-2 bg-zinc-900/80 hover:bg-zinc-800 text-red-400 border border-red-500/30 rounded text-xs font-mono transition-all backdrop-blur-md text-right"
        >
          [C] CLEAR / [Q] QUIT
        </button>
         <div className="mt-2 px-4 py-2 bg-zinc-900/60 border border-zinc-700/30 rounded text-[10px] font-mono text-zinc-400 text-right">
          <p className="font-bold text-white mb-1">2D OBJECTS</p>
          <p>[1] CAR</p>
          <p>[2] PLANT</p>
          <p>[3] CASTLE</p>
          <p className="font-bold text-white mt-2 mb-1">3D OBJECTS</p>
          <p>[4] CUBE</p>
          <p>[5] PYRAMID</p>
          <p className="mt-2">[+/-] SENSITIVITY</p>
        </div>
      </div>
    </div>
  );
};
