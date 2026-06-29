// cropMath.js
// Coordinate math adapted from react-easy-crop (helpers.ts), MIT License.
// https://github.com/ValentinH/react-easy-crop
(function (root) {
  "use strict";

  function evenRound(n) {
    if (!isFinite(n) || n < 0) return 0;
    return 2 * Math.floor(n / 2); // round DOWN to even — never exceeds source bounds
  }

  // object-fit: contain — scale media to fit container, preserving aspect, centered.
  function getRenderedVideoRect(natural, container) {
    const scale = Math.min(container.w / natural.w, container.h / natural.h);
    const w = natural.w * scale;
    const h = natural.h * scale;
    return { x: (container.w - w) / 2, y: (container.h - h) / 2, w: w, h: h };
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  // Map an on-screen rectangle (container coords) to source-pixel crop, clamped, even.
  function rectToSourceCrop(rectPx, rendered, natural) {
    const scale = natural.w / rendered.w; // rendered is aspect-preserving, so w & h scale equally
    // rectangle relative to the rendered video, in rendered px
    let rx = rectPx.x - rendered.x;
    let ry = rectPx.y - rendered.y;
    let rw = rectPx.w;
    let rh = rectPx.h;
    // clamp to the rendered media box
    const x0 = clamp(rx, 0, rendered.w);
    const y0 = clamp(ry, 0, rendered.h);
    const x1 = clamp(rx + rw, 0, rendered.w);
    const y1 = clamp(ry + rh, 0, rendered.h);
    return {
      x: evenRound(x0 * scale),
      y: evenRound(y0 * scale),
      width: evenRound((x1 - x0) * scale),
      height: evenRound((y1 - y0) * scale),
    };
  }

  const api = { evenRound: evenRound, getRenderedVideoRect: getRenderedVideoRect, rectToSourceCrop: rectToSourceCrop };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.SVECropMath = api;
})(typeof window !== "undefined" ? window : null);
