/**
 * parser.js — Enhanced LRC Parser
 * Parses lines like:
 *   [00:10.300] في <00:10.300> عالم <00:12.500> يجتاحه الظلم والطغيان
 *
 * Returns array of:
 * {
 *   lineStart: number,     // seconds
 *   lineEnd:   number,     // seconds (derived from next line start or last word)
 *   words: [{
 *     text:     string,
 *     start:    number,    // seconds
 *     end:      number,    // seconds
 *     duration: number     // seconds
 *   }]
 * }
 */

(function (global) {

  /**
   * Convert "[mm:ss.ms]" or "<mm:ss.ms>" timestamp string to seconds.
   * Handles both bracket types and optional milliseconds.
   */
  function tsToSeconds(ts) {
    // Strip brackets/angle brackets
    const clean = ts.replace(/[\[\]<>]/g, '').trim();
    const parts = clean.split(':');
    if (parts.length !== 2) return 0;
    const minutes = parseFloat(parts[0]) || 0;
    const seconds = parseFloat(parts[1]) || 0;
    return minutes * 60 + seconds;
  }

  /**
   * Parse a single LRC line string into a structured line object.
   * Returns null if the line doesn't match the expected format.
   */
  function parseLine(rawLine) {
    rawLine = rawLine.trim();
    if (!rawLine) return null;

    // Match leading line timestamp: [mm:ss.ms]
    const lineTimestampMatch = rawLine.match(/^\[(\d{2}:\d{2}(?:\.\d+)?)\]/);
    if (!lineTimestampMatch) return null;

    const lineStart = tsToSeconds(lineTimestampMatch[0]);
    const rest = rawLine.slice(lineTimestampMatch[0].length).trim();

    // Split into tokens: either <timestamp> or plain text
    // We tokenize the rest by splitting on <timestamp> markers
    // Pattern: optional text, then <timestamp> text chunks
    const wordTimestampPattern = /<(\d{2}:\d{2}(?:\.\d+)?)>/g;

    const words = [];
    let lastIndex = 0;
    let pendingTimestamp = lineStart; // default: first word starts at line start
    let match;

    // Collect all <timestamp> matches with their positions
    const markers = [];
    let m;
    while ((m = wordTimestampPattern.exec(rest)) !== null) {
      markers.push({ index: m.index, ts: tsToSeconds(m[0]), fullMatch: m[0] });
    }

    if (markers.length === 0) {
      // No word timestamps — treat whole line as a single word block
      const text = rest.trim();
      if (text) {
        words.push({ text, start: lineStart, end: lineStart + 3, duration: 3 });
      }
    } else {
      // Build words from the markers
      // Each marker gives: the timestamp, and the TEXT that follows it
      // until the next marker (or end of string)
      for (let i = 0; i < markers.length; i++) {
        const marker = markers[i];
        const nextMarker = markers[i + 1];
        const markerEnd = marker.index + marker.fullMatch.length;
        const textEnd = nextMarker ? nextMarker.index : rest.length;
        const wordText = rest.slice(markerEnd, textEnd).trim();

        // There may be text BEFORE the first marker (attached to lineStart)
        if (i === 0 && marker.index > 0) {
          const preText = rest.slice(0, marker.index).trim();
          if (preText) {
            words.push({
              text: preText,
              start: lineStart,
              end: marker.ts,
              duration: marker.ts - lineStart
            });
          }
        }

        if (wordText) {
          const wordStart = marker.ts;
          const wordEnd = nextMarker ? nextMarker.ts : marker.ts + 2.5;
          words.push({
            text: wordText,
            start: wordStart,
            end: wordEnd,
            duration: wordEnd - wordStart
          });
        }
      }
    }

    // Filter out any empty or whitespace-only words
    const filteredWords = words.filter(w => w.text && w.text.trim().length > 0);

    if (filteredWords.length === 0) return null;

    return {
      lineStart,
      lineEnd: null, // filled in post-processing
      words: filteredWords
    };
  }

  /**
   * Main parse function. Takes the full lyrics string, returns array of line objects.
   */
  function parseLyrics(lyricsText) {
    if (!lyricsText || !lyricsText.trim()) return [];

    const rawLines = lyricsText.split('\n');
    const lines = [];

    for (const raw of rawLines) {
      const parsed = parseLine(raw);
      if (parsed) lines.push(parsed);
    }

    // Sort by line start time
    lines.sort((a, b) => a.lineStart - b.lineStart);

    // Fill in lineEnd values based on next line start
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const nextLine = lines[i + 1];
      const lastWordEnd = line.words.length > 0
        ? line.words[line.words.length - 1].end
        : line.lineStart + 3;

      line.lineEnd = nextLine ? nextLine.lineStart : lastWordEnd + 0.5;

      // Clamp word ends to the line's end time
      for (let j = 0; j < line.words.length; j++) {
        const word = line.words[j];
        const nextWord = line.words[j + 1];
        if (nextWord) {
          word.end = nextWord.start;
          word.duration = word.end - word.start;
        } else {
          word.end = Math.min(word.end, line.lineEnd);
          word.duration = word.end - word.start;
        }
        // Ensure minimum duration
        if (word.duration <= 0) word.duration = 0.5;
      }
    }

    return lines;
  }

  // Expose globally
  global.LRCParser = { parse: parseLyrics, tsToSeconds };

})(window);
