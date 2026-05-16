/**
 * exporter.js — Video Export Engine
 *
 * Strategy:
 * 1. Create a hidden AudioContext, route the audio file through it
 * 2. Capture canvas.captureStream() for video
 * 3. Capture AudioContext destination.stream for audio
 * 4. Combine both into a MediaRecorder
 * 5. On end, produce a downloadable WebM blob
 */

(function (global) {

  class VideoExporter {
    constructor({ canvas, audioBuffer, animator, lines, onProgress, onComplete, onError }) {
      this.canvas     = canvas;
      this.audioBuffer = audioBuffer;
      this.animator   = animator;
      this.lines      = lines;
      this.onProgress = onProgress || (() => {});
      this.onComplete = onComplete || (() => {});
      this.onError    = onError || console.error;
    }

    async start() {
      const canvas      = this.canvas;
      const audioBuffer = this.audioBuffer;

      if (!audioBuffer) {
        this.onError('No audio loaded. Please upload an audio file first.');
        return;
      }

      try {
        // ── 1. Set up AudioContext for playback capture ──
        const audioCtx   = new (window.AudioContext || window.webkitAudioContext)();
        const source     = audioCtx.createBufferSource();
        source.buffer    = audioBuffer;

        // Destination node that we can capture as a stream
        const dest       = audioCtx.createMediaStreamDestination();
        source.connect(dest);
        source.connect(audioCtx.destination); // also play out speakers (optional, can mute)

        // ── 2. Canvas stream ──
        const fps          = 30;
        const canvasStream = canvas.captureStream(fps);

        // ── 3. Combine streams ──
        const combined    = new MediaStream([
          ...canvasStream.getVideoTracks(),
          ...dest.stream.getAudioTracks()
        ]);

        // ── 4. Pick best supported MIME type ──
        const mimeType = this._getBestMime();

        const recorder = new MediaRecorder(combined, {
          mimeType,
          videoBitsPerSecond: 8_000_000,
          audioBitsPerSecond:   192_000,
        });

        const chunks = [];
        recorder.ondataavailable = e => {
          if (e.data && e.data.size > 0) chunks.push(e.data);
        };

        const duration = audioBuffer.duration;
        let startWall  = null;
        let rafId      = null;

        recorder.onstop = () => {
          cancelAnimationFrame(rafId);
          const blob = new Blob(chunks, { type: mimeType });
          const url  = URL.createObjectURL(blob);
          const ext  = mimeType.includes('mp4') ? 'mp4' : 'webm';
          const a    = document.createElement('a');
          a.href     = url;
          a.download = `lyrimotion-export.${ext}`;
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 30_000);
          this.onComplete();
        };

        // ── 5. Drive the animation with a fake "getCurrentTime" ──
        const getTime = () => {
          if (startWall === null) return 0;
          return (performance.now() - startWall) / 1000;
        };

        // Reset animator to use export time source
        this.animator.stop();
        this.animator.setLines(this.lines);
        this.animator.start(getTime);

        // ── 6. Start recording ──
        recorder.start(100); // collect chunks every 100ms
        source.start(0);
        startWall = performance.now();

        // ── 7. Progress loop ──
        const trackProgress = () => {
          const elapsed  = (performance.now() - startWall) / 1000;
          const progress = Math.min(1, elapsed / duration);
          this.onProgress(progress);

          if (elapsed >= duration + 0.3) {
            recorder.stop();
            source.stop();
            audioCtx.close();
          } else {
            rafId = requestAnimationFrame(trackProgress);
          }
        };

        rafId = requestAnimationFrame(trackProgress);

      } catch (err) {
        this.onError('Export failed: ' + err.message);
        console.error(err);
      }
    }

    _getBestMime() {
      const candidates = [
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=vp8,opus',
        'video/webm;codecs=h264,opus',
        'video/webm',
        'video/mp4',
      ];
      for (const m of candidates) {
        if (MediaRecorder.isTypeSupported(m)) return m;
      }
      return 'video/webm';
    }
  }

  global.VideoExporter = VideoExporter;

})(window);
