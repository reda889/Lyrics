/**
 * app.js — Main Application Controller
 * Wires together: UI, Parser, Animator, Exporter
 */

(function () {

  /* ─────────────────────────────────────────
   *  STATE
   * ───────────────────────────────────────── */
  const state = {
    audioFile:      null,
    audioBuffer:    null,     // decoded AudioBuffer for export
    audioUrl:       null,     // object URL for <audio> element
    parsedLines:    [],
    canvasSize:     720,      // 720 or 1080
    animStyle:      'dynamic',
    bgColor:        '#0a0a0f',
    textColor:      '#ffffff',
    highlightColor: '#FFE566',
    fontFamily:     "'Syne', sans-serif",
    direction:      'ltr',
    isGenerated:    false,
  };

  /* ─────────────────────────────────────────
   *  DOM REFERENCES
   * ───────────────────────────────────────── */
  const $ = id => document.getElementById(id);

  const audioFileInput  = $('audioFile');
  const audioDropZone   = $('audioDropZone');
  const audioFileInfo   = $('audioFileInfo');
  const lyricsInput     = $('lyricsInput');
  const generateBtn     = $('generateBtn');
  const exportBtn       = $('exportBtn');
  const exportStatus    = $('exportStatus');
  const statusFill      = $('statusFill');
  const statusText      = $('statusText');
  const mainCanvas      = $('mainCanvas');
  const canvasIdleMsg   = $('canvasIdleMsg');
  const audioPlayer     = $('audioPlayer');
  const playerPlaceholder = $('playerPlaceholder');
  const previewTime     = $('previewTime');
  const tickerWord      = $('tickerWord');
  const fontFamilySelect = $('fontFamily');

  /* ─────────────────────────────────────────
   *  CANVAS SETUP
   * ───────────────────────────────────────── */
  function resizeCanvas(size) {
    mainCanvas.width  = size;
    mainCanvas.height = size;
    state.canvasSize  = size;
  }

  resizeCanvas(720);

  /* ─────────────────────────────────────────
   *  ANIMATOR INSTANCE
   * ───────────────────────────────────────── */
  let animator = new Animator(mainCanvas, {
    style:          state.animStyle,
    bgColor:        state.bgColor,
    textColor:      state.textColor,
    highlightColor: state.highlightColor,
    fontFamily:     state.fontFamily,
    direction:      state.direction,
  });

  // Start idle animation immediately
  animator.start(() => 0);

  /* ─────────────────────────────────────────
   *  AUDIO FILE HANDLING
   * ───────────────────────────────────────── */
  audioDropZone.addEventListener('click', () => audioFileInput.click());

  audioDropZone.addEventListener('dragover', e => {
    e.preventDefault();
    audioDropZone.classList.add('drag-over');
  });
  audioDropZone.addEventListener('dragleave', () => audioDropZone.classList.remove('drag-over'));
  audioDropZone.addEventListener('drop', e => {
    e.preventDefault();
    audioDropZone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('audio/')) loadAudio(file);
    else showToast('Please drop an audio file.', 'error');
  });

  audioFileInput.addEventListener('change', () => {
    if (audioFileInput.files[0]) loadAudio(audioFileInput.files[0]);
  });

  async function loadAudio(file) {
    state.audioFile = file;

    // Show filename
    const sizeMB = (file.size / 1_048_576).toFixed(2);
    audioFileInfo.textContent = `♫ ${file.name} — ${sizeMB} MB`;
    audioFileInfo.style.display = 'block';

    // Object URL for <audio>
    if (state.audioUrl) URL.revokeObjectURL(state.audioUrl);
    state.audioUrl = URL.createObjectURL(file);
    audioPlayer.src = state.audioUrl;
    audioPlayer.style.display = 'block';
    playerPlaceholder.style.display = 'none';

    // Decode to AudioBuffer for export
    try {
      const arrayBuffer = await file.arrayBuffer();
      const audioCtx    = new (window.AudioContext || window.webkitAudioContext)();
      state.audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
      audioCtx.close();
      showToast('Audio loaded ✓', 'success');
    } catch (err) {
      console.warn('AudioBuffer decode failed (export may not work):', err);
    }
  }

  /* ─────────────────────────────────────────
   *  STYLE CARD RADIO BUTTONS
   * ───────────────────────────────────────── */
  document.querySelectorAll('.style-card').forEach(card => {
    card.addEventListener('click', () => {
      document.querySelectorAll('.style-card').forEach(c => c.classList.remove('active'));
      card.classList.add('active');
      const val = card.querySelector('input[type=radio]').value;
      state.animStyle = val;
      animator.updateConfig({ style: val });
    });
  });

  /* ─────────────────────────────────────────
   *  SEGMENTED CONTROLS
   * ───────────────────────────────────────── */

  // Canvas size
  document.querySelectorAll('[data-size]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-size]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const size = parseInt(btn.dataset.size);
      resizeCanvas(size);
      // Update base font sizes for new canvas dimension
      if (state.isGenerated) generate();
    });
  });

  // Text direction
  document.querySelectorAll('[data-dir]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-dir]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.direction = btn.dataset.dir;
      animator.updateConfig({ direction: state.direction });
    });
  });

  /* ─────────────────────────────────────────
   *  COLOR SWATCHES
   * ───────────────────────────────────────── */
  function setupPalette(paletteId, stateKey, configKey) {
    const palette = $(paletteId);
    palette.querySelectorAll('.swatch[data-color]').forEach(swatch => {
      swatch.addEventListener('click', () => {
        palette.querySelectorAll('.swatch').forEach(s => s.classList.remove('active'));
        swatch.classList.add('active');
        state[stateKey] = swatch.dataset.color;
        const cfg = {};
        cfg[configKey] = swatch.dataset.color;
        animator.updateConfig(cfg);
      });
    });
    // Custom color input
    const customInput = palette.querySelector('input[type=color]');
    if (customInput) {
      customInput.addEventListener('input', () => {
        palette.querySelectorAll('.swatch').forEach(s => s.classList.remove('active'));
        customInput.closest('.swatch').classList.add('active');
        state[stateKey] = customInput.value;
        const cfg = {};
        cfg[configKey] = customInput.value;
        animator.updateConfig(cfg);
      });
    }
  }

  setupPalette('bgPalette',        'bgColor',        'bgColor');
  setupPalette('textPalette',      'textColor',      'textColor');
  setupPalette('highlightPalette', 'highlightColor', 'highlightColor');

  /* ─────────────────────────────────────────
   *  FONT FAMILY
   * ───────────────────────────────────────── */
  fontFamilySelect.addEventListener('change', () => {
    state.fontFamily = fontFamilySelect.value;
    animator.updateConfig({ fontFamily: state.fontFamily });
  });

  /* ─────────────────────────────────────────
   *  GENERATE & PREVIEW
   * ───────────────────────────────────────── */
  generateBtn.addEventListener('click', generate);

  function generate() {
    const lyricsText = lyricsInput.value.trim();
    if (!lyricsText) {
      showToast('Please enter lyrics first.', 'error');
      return;
    }

    // Parse lyrics
    state.parsedLines = LRCParser.parse(lyricsText);

    if (state.parsedLines.length === 0) {
      showToast('Could not parse lyrics. Check the format.', 'error');
      return;
    }

    // Stop current animation
    animator.stop();

    // Create fresh animator with current config
    animator = new Animator(mainCanvas, {
      style:          state.animStyle,
      bgColor:        state.bgColor,
      textColor:      state.textColor,
      highlightColor: state.highlightColor,
      fontFamily:     state.fontFamily,
      direction:      state.direction,
    });

    animator.setLines(state.parsedLines);
    animator.start(() => audioPlayer.currentTime || 0);

    // Hide idle message
    canvasIdleMsg.classList.add('hidden');

    state.isGenerated = true;
    exportBtn.disabled = false;

    showToast(`Parsed ${state.parsedLines.length} lines ✓`, 'success');

    // If audio isn't loaded, reset it
    if (!state.audioUrl) {
      showToast('Tip: Upload an audio file for sync.', '');
    }
  }

  /* ─────────────────────────────────────────
   *  AUDIO PLAYER → TIME DISPLAY + TICKER
   * ───────────────────────────────────────── */
  audioPlayer.addEventListener('timeupdate', () => {
    const t = audioPlayer.currentTime;
    previewTime.textContent = formatTime(t);
    updateTicker(t);
  });

  function updateTicker(time) {
    if (!state.parsedLines.length) return;
    let activeWord = '—';
    for (const line of state.parsedLines) {
      if (time >= line.lineStart && time < line.lineEnd) {
        for (const word of line.words) {
          if (time >= word.start) activeWord = word.text;
        }
      }
    }
    if (tickerWord.textContent !== activeWord) {
      tickerWord.style.transform = 'translateY(-8px)';
      tickerWord.style.opacity = '0';
      setTimeout(() => {
        tickerWord.textContent = activeWord;
        tickerWord.style.transform = 'translateY(0)';
        tickerWord.style.opacity = '1';
      }, 100);
    }
  }

  function formatTime(seconds) {
    const m  = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s  = Math.floor(seconds % 60).toString().padStart(2, '0');
    const ms = Math.floor((seconds % 1) * 1000).toString().padStart(3, '0');
    return `${m}:${s}.${ms}`;
  }

  /* ─────────────────────────────────────────
   *  EXPORT VIDEO
   * ───────────────────────────────────────── */
  exportBtn.addEventListener('click', async () => {
    if (!state.isGenerated) {
      showToast('Generate preview first.', 'error'); return;
    }
    if (!state.audioBuffer) {
      showToast('Please upload an audio file to export.', 'error'); return;
    }

    // Pause audio player
    audioPlayer.pause();
    audioPlayer.currentTime = 0;

    exportBtn.disabled = true;
    generateBtn.disabled = true;
    exportStatus.style.display = 'block';
    statusFill.style.width = '0%';
    statusText.textContent = 'Starting export...';

    // Resize canvas to chosen export size (already set)
    resizeCanvas(state.canvasSize);

    // Create fresh animator for export
    const exportAnimator = new Animator(mainCanvas, {
      style:          state.animStyle,
      bgColor:        state.bgColor,
      textColor:      state.textColor,
      highlightColor: state.highlightColor,
      fontFamily:     state.fontFamily,
      direction:      state.direction,
    });
    exportAnimator.setLines(state.parsedLines);

    const exporter = new VideoExporter({
      canvas:      mainCanvas,
      audioBuffer: state.audioBuffer,
      animator:    exportAnimator,
      lines:       state.parsedLines,
      onProgress:  (p) => {
        const pct = Math.round(p * 100);
        statusFill.style.width = pct + '%';
        statusText.textContent = `Encoding: ${pct}%`;
      },
      onComplete: () => {
        exportStatus.style.display = 'none';
        exportBtn.disabled = false;
        generateBtn.disabled = false;
        // Re-attach the preview animator
        animator.stop();
        animator = new Animator(mainCanvas, {
          style:          state.animStyle,
          bgColor:        state.bgColor,
          textColor:      state.textColor,
          highlightColor: state.highlightColor,
          fontFamily:     state.fontFamily,
          direction:      state.direction,
        });
        animator.setLines(state.parsedLines);
        animator.start(() => audioPlayer.currentTime || 0);
        showToast('Export complete! Download started ✓', 'success');
      },
      onError: (msg) => {
        exportStatus.style.display = 'none';
        exportBtn.disabled = false;
        generateBtn.disabled = false;
        showToast(msg, 'error');
        console.error(msg);
        // Re-attach preview
        animator.start(() => audioPlayer.currentTime || 0);
      }
    });

    await exporter.start();
  });

  /* ─────────────────────────────────────────
   *  TOAST NOTIFICATIONS
   * ───────────────────────────────────────── */
  let toastTimeout = null;

  function showToast(message, type = '') {
    let toast = document.querySelector('.toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'toast';
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.className = `toast ${type}`;
    clearTimeout(toastTimeout);
    // Force reflow
    toast.getBoundingClientRect();
    toast.classList.add('show');
    toastTimeout = setTimeout(() => toast.classList.remove('show'), 3000);
  }

  /* ─────────────────────────────────────────
   *  UI ENTRANCE ANIMATIONS
   *  (stagger the panel sections in)
   * ───────────────────────────────────────── */
  document.querySelectorAll('.control-section, .action-buttons').forEach((el, i) => {
    el.style.animationDelay = `${0.05 + i * 0.07}s`;
  });

  /* ─────────────────────────────────────────
   *  KEYBOARD SHORTCUTS
   * ───────────────────────────────────────── */
  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;
    if (e.key === ' ') {
      e.preventDefault();
      audioPlayer.paused ? audioPlayer.play() : audioPlayer.pause();
    }
    if (e.key === 'g' || e.key === 'G') generate();
  });

  /* ─────────────────────────────────────────
   *  SAMPLE LYRICS HELPER
   * ───────────────────────────────────────── */
  // Pre-populate with sample if empty
  if (!lyricsInput.value.trim()) {
    lyricsInput.value =
`[00:05.000] Hello <00:05.000> world <00:06.200> this <00:07.100> is <00:07.800> kinetic <00:08.600> typography
[00:10.500] Every <00:10.500> single <00:11.400> word <00:12.200> comes <00:13.000> alive
[00:15.000] Feel <00:15.000> the <00:15.600> rhythm <00:16.500> of <00:17.200> the <00:17.800> music
[00:20.000] في <00:20.000> عالم <00:21.500> يجتاحه <00:23.000> الظلم <00:24.500> والطغيان`;
  }

  /* ─────────────────────────────────────────
   *  CANVAS POINTER — fun interactive ripple
   * ───────────────────────────────────────── */
  mainCanvas.addEventListener('click', e => {
    if (!state.isGenerated) return;
    const rect = mainCanvas.getBoundingClientRect();
    const scaleX = mainCanvas.width  / rect.width;
    const scaleY = mainCanvas.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top)  * scaleY;
    animator._addRipple(x, y, state.highlightColor);
  });

  // ── Expose for debugging ──
  window._app = { state, animator };

})();
