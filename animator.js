/**
 * animator.js — Canvas Animation Engine
 * Handles both "Dynamic Trend" (Hormozi/TikTok style) and "Typewriter" animations.
 *
 * Key design decisions:
 * - All positions are in canvas-space coordinates (not screen pixels)
 * - We animate word "slots" using spring physics for smooth, natural motion
 * - The active word is always centered and large; others arrange around it
 */

(function (global) {

  /* ─────────────────────────────────────────
   *  SPRING PHYSICS HELPER
   * ───────────────────────────────────────── */
  function Spring(stiffness = 0.12, damping = 0.75) {
    this.stiffness = stiffness;
    this.damping   = damping;
    this.value     = 0;
    this.velocity  = 0;
    this.target    = 0;
  }

  Spring.prototype.update = function (dt) {
    const force     = (this.target - this.value) * this.stiffness;
    this.velocity   = this.velocity * this.damping + force;
    this.value     += this.velocity;
    return this.value;
  };

  Spring.prototype.set = function (target, snap = false) {
    this.target = target;
    if (snap) { this.value = target; this.velocity = 0; }
  };

  /* ─────────────────────────────────────────
   *  EASING FUNCTIONS
   * ───────────────────────────────────────── */
  const ease = {
    inOutCubic: t => t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t+2,3)/2,
    outElastic: t => {
      if (t === 0 || t === 1) return t;
      return Math.pow(2,-10*t) * Math.sin((t*10-0.75)*(2*Math.PI)/3) + 1;
    },
    outBack: t => {
      const c1 = 1.70158, c3 = c1 + 1;
      return 1 + c3 * Math.pow(t-1, 3) + c1 * Math.pow(t-1, 2);
    },
    inOutQuart: t => t < 0.5 ? 8*t*t*t*t : 1-Math.pow(-2*t+2,4)/2,
    outQuart: t => 1 - Math.pow(1-t, 4)
  };

  /* ─────────────────────────────────────────
   *  WORD STATE (used by Dynamic Trend)
   * ───────────────────────────────────────── */
  function WordState(text, wordIndex, totalWords) {
    this.text       = text;
    this.wordIndex  = wordIndex;
    this.totalWords = totalWords;

    // Springs for smooth animation
    this.xSpring    = new Spring(0.10, 0.72);
    this.ySpring    = new Spring(0.10, 0.72);
    this.scaleSpring= new Spring(0.14, 0.75);
    this.alphaSpring= new Spring(0.16, 0.80);

    this.xSpring.set(0, true);
    this.ySpring.set(0, true);
    this.scaleSpring.set(0, true); // starts at 0 (invisible)
    this.alphaSpring.set(0, true);

    this.isActive   = false;
    this.isVisible  = false;
    this.entryTime  = 0;
    this.birthTime  = performance.now();
  }

  /* ─────────────────────────────────────────
   *  LAYOUT CALCULATOR
   *  Computes target x/y/scale for each word
   *  given how many words have appeared and
   *  which one is currently active.
   * ───────────────────────────────────────── */
  function computeLayout(wordStates, activeIndex, canvasSize, config) {
    const W = canvasSize;
    const H = canvasSize;
    const cx = W / 2;
    const cy = H / 2;

    const visibleWords = wordStates.filter(w => w.isVisible);
    const visibleCount = visibleWords.length;

    if (visibleCount === 0) return;

    // Scale ranges based on canvas size
    const BASE_FONT  = config.baseFontSize || W * 0.13;   // ~140px at 1080
    const SMALL_FONT = config.smallFontSize || W * 0.055;  // ~60px at 1080

    visibleWords.forEach((word, vi) => {
      const isActive = (word.wordIndex === activeIndex);
      const relIndex = vi - visibleWords.findIndex(w => w.wordIndex === activeIndex);

      if (isActive) {
        // Center, large
        word.xSpring.set(cx);
        word.ySpring.set(cy);
        word.scaleSpring.set(BASE_FONT);
        word.alphaSpring.set(1.0);
      } else {
        // Past or future words — arrange around center
        const scale = SMALL_FONT * (0.75 + Math.max(0, 1 - Math.abs(relIndex) * 0.15));
        word.scaleSpring.set(scale);
        word.alphaSpring.set(Math.max(0.25, 0.85 - Math.abs(relIndex) * 0.2));

        // Layout: stack previous words above, future below
        // We build a virtual grid of lines
        computeWordPosition(word, vi, activeIndex, visibleWords, cx, cy, W, H, scale);
      }
    });
  }

  function computeWordPosition(word, vi, activeIdx, visibleWords, cx, cy, W, H, scale) {
    const activeVi = visibleWords.findIndex(w => w.isActive);
    const relToActive = vi - (activeVi >= 0 ? activeVi : vi);

    const ROW_HEIGHT = H * 0.11;
    const MAX_ROWS   = 3; // rows above/below center

    // Clamp row offset
    const rowOffset = Math.max(-MAX_ROWS, Math.min(MAX_ROWS, relToActive));
    const targetY   = cy + rowOffset * ROW_HEIGHT;

    // Slight horizontal spread for multi-word same-row situations
    // (simple approach: center all on x)
    const targetX = cx;

    word.xSpring.set(targetX);
    word.ySpring.set(targetY);
  }

  /* ─────────────────────────────────────────
   *  PARTICLE SYSTEM for Dynamic background
   * ───────────────────────────────────────── */
  function Particle(canvasSize) {
    this.reset(canvasSize);
  }

  Particle.prototype.reset = function (S) {
    this.x  = Math.random() * S;
    this.y  = Math.random() * S;
    this.vx = (Math.random() - 0.5) * 0.6;
    this.vy = (Math.random() - 0.5) * 0.6;
    this.r  = Math.random() * 2 + 0.5;
    this.alpha = Math.random() * 0.3 + 0.05;
    this.life  = 0;
    this.maxLife = Math.random() * 300 + 100;
    this.S  = S;
  };

  Particle.prototype.update = function () {
    this.x    += this.vx;
    this.y    += this.vy;
    this.life ++;

    const t = this.life / this.maxLife;
    this.currentAlpha = this.alpha * Math.sin(t * Math.PI);

    if (this.life >= this.maxLife ||
        this.x < 0 || this.x > this.S ||
        this.y < 0 || this.y > this.S) {
      this.reset(this.S);
    }
  };

  /* ─────────────────────────────────────────
   *  MAIN ANIMATOR CLASS
   * ───────────────────────────────────────── */
  function Animator(canvas, config) {
    this.canvas  = canvas;
    this.ctx     = canvas.getContext('2d');
    this.config  = Object.assign({
      style:          'dynamic',
      bgColor:        '#0a0a0f',
      textColor:      '#ffffff',
      highlightColor: '#FFE566',
      fontFamily:     "'Syne', sans-serif",
      direction:      'ltr',
      baseFontSize:   null,
      smallFontSize:  null,
    }, config);

    this.lines       = [];
    this.wordStates  = [];
    this.currentLine = -1;
    this.activeWordIndex = -1;
    this.lastTime    = 0;
    this.rafId       = null;
    this.isRunning   = false;
    this.getCurrentTime = null; // callback: () => seconds

    // Particles
    this.particles = [];
    const S = canvas.width;
    for (let i = 0; i < 60; i++) this.particles.push(new Particle(S));

    // Typewriter state
    this.twLetters   = []; // array of {char, x, y, alpha, scale, color}
    this.twLineIdx   = -1;
    this.twWordIdx   = -1;

    // Ripple effects on word hit
    this.ripples = [];
  }

  Animator.prototype.setLines = function (lines) {
    this.lines       = lines;
    this.wordStates  = [];
    this.currentLine = -1;
    this.activeWordIndex = -1;
    this.twLetters   = [];
    this.twLineIdx   = -1;
    this.twWordIdx   = -1;
    this.ripples     = [];
  };

  Animator.prototype.start = function (getCurrentTimeFn) {
    this.getCurrentTime = getCurrentTimeFn;
    this.isRunning = true;
    this.lastTime  = performance.now();
    this._raf();
  };

  Animator.prototype.stop = function () {
    this.isRunning = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = null;
  };

  Animator.prototype._raf = function () {
    if (!this.isRunning) return;
    this.rafId = requestAnimationFrame((now) => {
      const dt = (now - this.lastTime) / 16.67; // normalize to ~60fps
      this.lastTime = now;
      this._draw(dt, now);
      this._raf();
    });
  };

  Animator.prototype._draw = function (dt, now) {
    const ctx  = this.ctx;
    const W    = this.canvas.width;
    const H    = this.canvas.height;
    const time = this.getCurrentTime ? this.getCurrentTime() : 0;
    const cfg  = this.config;

    // ── Background ──
    ctx.fillStyle = cfg.bgColor;
    ctx.fillRect(0, 0, W, H);

    // ── Particles ──
    this._drawParticles(ctx, W, dt, cfg.highlightColor);

    if (this.lines.length === 0) {
      this._drawIdle(ctx, W, H, now);
      return;
    }

    if (cfg.style === 'dynamic') {
      this._drawDynamic(ctx, W, H, time, dt, now, cfg);
    } else {
      this._drawTypewriter(ctx, W, H, time, dt, now, cfg);
    }

    // ── Ripples ──
    this._drawRipples(ctx, dt, cfg.highlightColor);
  };

  /* ─── PARTICLE DRAW ─── */
  Animator.prototype._drawParticles = function (ctx, S, dt, color) {
    ctx.save();
    this.particles.forEach(p => {
      p.update();
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = this._alphaColor(color || '#FFE566', p.currentAlpha || 0.1);
      ctx.fill();
    });
    ctx.restore();
  };

  /* ─── RIPPLE DRAW ─── */
  Animator.prototype._addRipple = function (x, y, color) {
    this.ripples.push({ x, y, r: 0, maxR: this.canvas.width * 0.4, alpha: 0.5, color });
  };

  Animator.prototype._drawRipples = function (ctx, dt, color) {
    this.ripples = this.ripples.filter(r => r.alpha > 0.01);
    this.ripples.forEach(r => {
      r.r     += 4 * dt;
      r.alpha -= 0.018 * dt;
      ctx.save();
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2);
      ctx.strokeStyle = this._alphaColor(r.color || color, Math.max(0, r.alpha));
      ctx.lineWidth   = 1.5;
      ctx.stroke();
      ctx.restore();
    });
  };

  /* ─── IDLE SCREEN ─── */
  Animator.prototype._drawIdle = function (ctx, W, H, now) {
    const pulse = 0.7 + 0.3 * Math.sin(now / 1000);
    ctx.save();
    ctx.globalAlpha = pulse;
    ctx.font = `bold ${W * 0.06}px ${this.config.fontFamily}`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.fillText('◈ LYRIMOTION', W/2, H/2);
    ctx.restore();
  };

  /* ─────────────────────────────────────────
   *  STYLE 1: DYNAMIC TREND
   * ───────────────────────────────────────── */
  Animator.prototype._drawDynamic = function (ctx, W, H, time, dt, now, cfg) {
    const lines  = this.lines;

    // Find current line
    let lineIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (time >= lines[i].lineStart && time < lines[i].lineEnd) {
        lineIdx = i; break;
      }
    }

    // If line changed, rebuild word states
    if (lineIdx !== this.currentLine) {
      this.currentLine = lineIdx;
      this.wordStates  = [];
      this.activeWordIndex = -1;

      if (lineIdx >= 0) {
        const line = lines[lineIdx];
        line.words.forEach((w, wi) => {
          const ws = new WordState(w.text, wi, line.words.length);
          this.wordStates.push(ws);
        });
      }
    }

    if (lineIdx < 0) {
      // Between lines — draw subtle placeholder
      this._drawBetweenLines(ctx, W, H, now);
      return;
    }

    const line = lines[lineIdx];

    // Figure out which word is active now
    let newActiveIdx = -1;
    for (let wi = 0; wi < line.words.length; wi++) {
      if (time >= line.words[wi].start) newActiveIdx = wi;
    }

    // On word change: trigger effects
    if (newActiveIdx !== this.activeWordIndex && newActiveIdx >= 0) {
      this.activeWordIndex = newActiveIdx;
      // Mark states
      this.wordStates.forEach((ws, wi) => {
        ws.isActive = (wi === newActiveIdx);
        if (wi <= newActiveIdx) ws.isVisible = true;
        ws.alphaSpring.set(0, !ws.isVisible);
      });

      // Ripple at center on new word
      this._addRipple(W/2, H/2, cfg.highlightColor);
    }

    // Update layout targets
    const baseFontSize  = cfg.baseFontSize  || W * 0.125;
    const smallFontSize = cfg.smallFontSize || W * 0.055;
    this._computeDynamicLayout(this.wordStates, newActiveIdx, W, H, baseFontSize, smallFontSize);

    // Update springs & draw
    ctx.save();
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.direction    = cfg.direction;

    // Draw words back-to-front (so active is on top)
    const sorted = [...this.wordStates].sort((a,b) => {
      if (a.isActive) return 1;
      if (b.isActive) return -1;
      return 0;
    });

    sorted.forEach(ws => {
      if (!ws.isVisible && ws.alphaSpring.value < 0.01) return;

      ws.xSpring.update(dt);
      ws.ySpring.update(dt);
      ws.scaleSpring.update(dt);
      ws.alphaSpring.update(dt);

      const x     = ws.xSpring.value;
      const y     = ws.ySpring.value;
      const fSize = Math.max(1, ws.scaleSpring.value);
      const alpha = Math.max(0, Math.min(1, ws.alphaSpring.value));

      if (alpha < 0.01) return;

      ctx.save();
      ctx.globalAlpha = alpha;

      // Active word: colored highlight + shadow glow
      if (ws.isActive) {
        ctx.shadowColor = cfg.highlightColor;
        ctx.shadowBlur  = fSize * 0.6;
        ctx.font        = `900 ${fSize}px ${cfg.fontFamily}`;
        ctx.fillStyle   = cfg.highlightColor;

        // Pop-in scale animation
        const ageMs  = performance.now() - ws.birthTime;
        if (ageMs < 300) {
          const popT  = ease.outBack(Math.min(1, ageMs / 300));
          ctx.translate(x, y);
          ctx.scale(popT * 1.05, popT * 1.05);
          ctx.fillText(ws.text, 0, 0);
        } else {
          // Breathing pulse
          const pulse = 1 + 0.015 * Math.sin(performance.now() / 200);
          ctx.translate(x, y);
          ctx.scale(pulse, pulse);
          ctx.fillText(ws.text, 0, 0);
        }
      } else {
        ctx.font      = `700 ${fSize}px ${cfg.fontFamily}`;
        ctx.fillStyle = cfg.textColor;
        ctx.shadowBlur = 0;
        ctx.fillText(ws.text, x, y);
      }
      ctx.restore();
    });

    ctx.restore();

    // Draw subtle line progress bar at bottom
    this._drawLineProgress(ctx, W, H, time, line, cfg);
  };

  Animator.prototype._computeDynamicLayout = function (wordStates, activeIdx, W, H, baseFontSize, smallFontSize) {
    const cx = W / 2;
    const cy = H / 2;
    const visible = wordStates.filter(w => w.isVisible);
    const activeVi = visible.findIndex(w => w.wordIndex === activeIdx);

    const SLOT_HEIGHT = H * 0.13;
    const SCALE_FALLOFF = 0.80;

    visible.forEach((ws, vi) => {
      const relToActive = vi - activeVi;
      const absRel = Math.abs(relToActive);
      const dirSign = Math.sign(relToActive);

      if (relToActive === 0) {
        // Active: center
        ws.isActive = true;
        ws.xSpring.set(cx);
        ws.ySpring.set(cy);
        ws.scaleSpring.set(baseFontSize);
        ws.alphaSpring.set(1.0);
        ws.birthTime = ws.birthTime || performance.now();
      } else {
        ws.isActive = false;
        const scale = smallFontSize * Math.pow(SCALE_FALLOFF, absRel);
        ws.scaleSpring.set(Math.max(scale, smallFontSize * 0.3));
        ws.alphaSpring.set(Math.max(0.15, 0.75 - absRel * 0.18));

        // Stack rows
        let stackY = cy + dirSign * (H * 0.155 + (absRel - 1) * SLOT_HEIGHT * 0.85);
        // Clamp to canvas
        stackY = Math.max(H * 0.07, Math.min(H * 0.93, stackY));
        ws.xSpring.set(cx);
        ws.ySpring.set(stackY);
      }
    });
  };

  Animator.prototype._drawBetweenLines = function (ctx, W, H, now) {
    // Gentle pulsing dot
    const pulse = 0.3 + 0.15 * Math.sin(now / 700);
    ctx.save();
    ctx.globalAlpha = pulse;
    ctx.beginPath();
    ctx.arc(W/2, H/2, W * 0.008, 0, Math.PI * 2);
    ctx.fillStyle = this.config.highlightColor;
    ctx.fill();
    ctx.restore();
  };

  Animator.prototype._drawLineProgress = function (ctx, W, H, time, line, cfg) {
    const duration = line.lineEnd - line.lineStart;
    if (duration <= 0) return;
    const progress = Math.max(0, Math.min(1, (time - line.lineStart) / duration));

    const barH  = H * 0.005;
    const barY  = H - barH - H * 0.025;
    const barW  = W * 0.6;
    const barX  = (W - barW) / 2;

    ctx.save();
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    ctx.beginPath();
    ctx.roundRect(barX, barY, barW, barH, barH/2);
    ctx.fill();

    ctx.globalAlpha = 0.7;
    ctx.fillStyle = cfg.highlightColor;
    ctx.beginPath();
    ctx.roundRect(barX, barY, barW * progress, barH, barH/2);
    ctx.fill();
    ctx.restore();
  };

  /* ─────────────────────────────────────────
   *  STYLE 2: TYPEWRITER
   * ───────────────────────────────────────── */
  Animator.prototype._drawTypewriter = function (ctx, W, H, time, dt, now, cfg) {
    const lines = this.lines;

    // Find current line
    let lineIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (time >= lines[i].lineStart && time < lines[i].lineEnd) {
        lineIdx = i; break;
      }
    }

    // Line changed: reset typewriter state
    if (lineIdx !== this.twLineIdx) {
      this.twLineIdx = lineIdx;
      this.twWordIdx = -1;
      this.twLetters = [];
    }

    if (lineIdx < 0) {
      this._drawBetweenLines(ctx, W, H, now);
      return;
    }

    const line = lines[lineIdx];

    // Determine which words should be visible
    let latestWordIdx = -1;
    for (let wi = 0; wi < line.words.length; wi++) {
      if (time >= line.words[wi].start) latestWordIdx = wi;
    }

    // New word appeared: add its letters to twLetters
    if (latestWordIdx > this.twWordIdx) {
      for (let wi = this.twWordIdx + 1; wi <= latestWordIdx; wi++) {
        const wordObj = line.words[wi];
        const chars   = wordObj.text.split('');
        chars.forEach((ch, ci) => {
          this.twLetters.push({
            char:      ch,
            wordIdx:   wi,
            charIdx:   ci,
            birthTime: performance.now() + ci * 40, // stagger per letter
            alpha:     0,
            scale:     0,
            isSpace:   ch === ' '
          });
        });
        // Space between words
        if (wi < line.words.length - 1) {
          this.twLetters.push({
            char: ' ', wordIdx: wi, charIdx: 999,
            birthTime: performance.now(), alpha: 1, scale: 1, isSpace: true
          });
        }
        this.twWordIdx = wi;
      }
    }

    if (this.twLetters.length === 0) return;

    // Measure and layout all letters
    const baseFontSize = cfg.baseFontSize || W * 0.075;
    ctx.save();
    ctx.font      = `800 ${baseFontSize}px ${cfg.fontFamily}`;
    ctx.direction = cfg.direction;

    // Build array of word strings and measure each word's width
    // for wrapping/centering
    const wordGroups = [];
    let currentGroup = { wordIdx: this.twLetters[0]?.wordIdx, chars: [] };

    this.twLetters.forEach(lt => {
      if (lt.wordIdx !== currentGroup.wordIdx) {
        wordGroups.push(currentGroup);
        currentGroup = { wordIdx: lt.wordIdx, chars: [] };
      }
      currentGroup.chars.push(lt);
    });
    wordGroups.push(currentGroup);

    // Measure each word
    const SPACE_W   = ctx.measureText(' ').width;
    const LINE_H    = baseFontSize * 1.4;
    const MAX_LINE_W = W * 0.85;
    const now_ms    = performance.now();

    // Build display lines (wrapping)
    const displayLines = [[]];
    let lineWidth = 0;
    wordGroups.forEach(group => {
      const wordStr  = group.chars.filter(c => !c.isSpace).map(c => c.char).join('');
      const wordW    = ctx.measureText(wordStr).width;
      if (lineWidth + wordW > MAX_LINE_W && displayLines[displayLines.length-1].length > 0) {
        displayLines.push([]);
        lineWidth = 0;
      }
      displayLines[displayLines.length-1].push({ group, wordW });
      lineWidth += wordW + SPACE_W;
    });

    const totalH  = displayLines.length * LINE_H;
    let startY    = H/2 - totalH/2 + baseFontSize/2;

    displayLines.forEach((dline, dli) => {
      // Measure line width for centering
      const lineW = dline.reduce((acc, item) => acc + item.wordW, 0)
                  + Math.max(0, dline.length - 1) * SPACE_W;
      let curX = W/2 - lineW/2;
      const lineY = startY + dli * LINE_H;

      dline.forEach(({ group, wordW }, gi) => {
        const isLastWord = group.wordIdx === this.twWordIdx;
        const chars = group.chars.filter(c => !c.isSpace);

        // Get current active word index for highlight
        const isCurrentWord = group.wordIdx === latestWordIdx;

        let charX = curX;
        chars.forEach(lt => {
          const age = now_ms - lt.birthTime;
          if (age < 0) {
            lt.alpha = 0; lt.scale = 0;
          } else {
            const t = Math.min(1, age / 180);
            lt.alpha = ease.outQuart(t);
            lt.scale = ease.outBack(t);
          }

          if (lt.alpha <= 0) { charX += ctx.measureText(lt.char).width; return; }

          ctx.save();
          ctx.globalAlpha = lt.alpha;
          ctx.translate(charX + ctx.measureText(lt.char).width/2, lineY);
          ctx.scale(lt.scale, lt.scale);

          if (isCurrentWord) {
            ctx.shadowColor  = cfg.highlightColor;
            ctx.shadowBlur   = baseFontSize * 0.4;
            ctx.fillStyle    = cfg.highlightColor;
          } else {
            ctx.shadowBlur = 0;
            ctx.fillStyle  = cfg.textColor;
          }
          ctx.font         = `800 ${baseFontSize}px ${cfg.fontFamily}`;
          ctx.textAlign    = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(lt.char, 0, 0);
          ctx.restore();

          charX += ctx.measureText(lt.char).width;
        });

        curX += wordW + SPACE_W;
      });
    });

    ctx.restore();

    this._drawLineProgress(ctx, W, H, time, line, cfg);
  };

  /* ─── UTILITIES ─── */
  Animator.prototype._alphaColor = function (hex, alpha) {
    // Convert hex to rgba
    const r = parseInt(hex.slice(1,3),16);
    const g = parseInt(hex.slice(3,5),16);
    const b = parseInt(hex.slice(5,7),16);
    return `rgba(${r},${g},${b},${alpha})`;
  };

  Animator.prototype.updateConfig = function (newConfig) {
    Object.assign(this.config, newConfig);
  };

  // Expose
  global.Animator = Animator;

})(window);
