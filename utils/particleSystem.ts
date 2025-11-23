import { Particle } from '../types';

export class ParticleSystem {
  particles: Particle[] = [];
  maxParticles: number = 1500;
  sprite: HTMLCanvasElement;

  constructor() {
    // Pre-render a glow sprite for high performance "volumetric" rendering
    this.sprite = document.createElement('canvas');
    this.sprite.width = 32;
    this.sprite.height = 32;
    const ctx = this.sprite.getContext('2d');
    if (ctx) {
      const grad = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
      grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
      grad.addColorStop(0.2, 'rgba(255, 255, 255, 0.8)');
      grad.addColorStop(0.5, 'rgba(255, 255, 255, 0.2)');
      grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 32, 32);
    }
  }

  emit(
    x: number, 
    y: number, 
    intensity: number, 
    velocity: {x: number, y: number} = {x:0, y:0}, 
    type: 'default' | 'stream' | 'cloud' = 'default'
  ) {
    let count = 2; 
    let spread = 5 + (intensity * 20);
    let speedMult = 0.3;
    let lifeMult = 1.0;

    // Configure particle properties based on type
    if (type === 'cloud') {
        count = 5 + Math.floor(intensity * 10);
        spread = 40 + (intensity * 10); // Wide diffuse area
        speedMult = 0.1; // Slow, floating
        lifeMult = 1.5; // Last longer
    } else if (type === 'stream') {
        count = 5;
        spread = 3; // Tight beam
        speedMult = 0.9; // Fast directed flow
        lifeMult = 0.8;
    } else {
        // Default
        count = 2 + Math.floor(intensity * 8);
    }
    
    if (this.particles.length >= this.maxParticles) return;
    
    for (let i = 0; i < count; i++) {
      if (this.particles.length >= this.maxParticles) break;
      
      const px = x + (Math.random() - 0.5) * spread;
      const py = y + (Math.random() - 0.5) * spread;

      // Physics: Inherit hand velocity + random scatter
      const angle = Math.random() * Math.PI * 2;
      const scatterSpeed = (type === 'stream' ? 0.2 : 0.5) + (intensity * 2);
      
      const vx = (velocity.x * speedMult) + Math.cos(angle) * scatterSpeed;
      const vy = (velocity.y * speedMult) + Math.sin(angle) * scatterSpeed;

      // Color mapping
      let targetHue = 200 - (intensity * 160); // Default Blue->Gold
      if (type === 'stream') targetHue = 50; // Electric Yellow
      if (type === 'cloud') targetHue = 260; // Ethereal Purple/Blue

      const hueVariation = Math.random() * 30 - 15;

      const baseSize = type === 'stream' ? 4 : 2;
      
      // Size scales with intensity: brighter light = larger particles
      // Using a multiplicative scaler creates a more noticeable difference between dim and bright environments
      const randomVar = Math.random() * 3;
      const size = (baseSize + randomVar) * (0.8 + (intensity * 1.5));

      this.particles.push({
        x: px,
        y: py,
        vx,
        vy,
        life: 1.0 * lifeMult,
        maxLife: 1.0 * lifeMult,
        size,
        hue: targetHue + hueVariation,
      });
    }
  }

  repel(x: number, y: number, radius: number, strength: number) {
    for (const p of this.particles) {
      const dx = p.x - x;
      const dy = p.y - y;
      const distSq = dx*dx + dy*dy;
      const rSq = radius * radius;
      
      if (distSq < rSq && distSq > 0.1) {
        const dist = Math.sqrt(distSq);
        const factor = (1 - dist / radius) * strength;
        
        // Push away
        p.vx += (dx / dist) * factor;
        p.vy += (dy / dist) * factor;
        
        // Add turbulence
        p.vx += (Math.random() - 0.5) * factor * 2;
        p.vy += (Math.random() - 0.5) * factor * 2;
      }
    }
  }

  update() {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      
      p.x += p.vx;
      p.y += p.vy;
      
      // Fluid drag
      p.vx *= 0.95;
      p.vy *= 0.95;
      
      // Slight turbulence/noise
      p.vx += (Math.random() - 0.5) * 0.1;
      p.vy += (Math.random() - 0.5) * 0.1;

      // Decay
      p.life -= 0.015;

      if (p.life <= 0) {
        this.particles.splice(i, 1);
      }
    }
  }

  draw(ctx: CanvasRenderingContext2D, bloomIntensity: number = 1.0) {
    // "Lighter" creates the glowing, additive effect typical of TouchDesigner visuals
    ctx.globalCompositeOperation = 'lighter';
    
    for (const p of this.particles) {
      const opacity = p.life / p.maxLife;
      
      const drawSize = p.size * opacity;
      
      // Create a "hot" core look
      ctx.fillStyle = `hsla(${p.hue}, 85%, 60%, ${opacity})`;
      
      // Draw the particle
      ctx.beginPath();
      ctx.arc(p.x, p.y, drawSize, 0, Math.PI * 2);
      ctx.fill();
      
      // Optional: Draw the glow sprite on top for extra "bloom"
      if (bloomIntensity > 0) {
        const glowSize = drawSize * 4 * bloomIntensity;
        ctx.globalAlpha = Math.min(1.0, 0.8 * bloomIntensity); // Modulate alpha slightly with intensity
        ctx.drawImage(
            this.sprite, 
            p.x - glowSize, 
            p.y - glowSize, 
            glowSize * 2, 
            glowSize * 2
        );
        ctx.globalAlpha = 1.0;
      }
    }
    
    ctx.globalCompositeOperation = 'source-over';
  }
}