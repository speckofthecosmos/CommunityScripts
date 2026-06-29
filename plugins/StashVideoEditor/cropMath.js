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

  // Stretch mode: the on-screen crop region (baseFrame, undistorted) is dragged to a
  // new on-screen size (frame); the baked output is the crop's source pixels scaled by
  // the per-axis distortion ratio. frame == baseFrame ⇒ crop's native size (crop-only).
  function stretchOutputDims(crop, frame, baseFrame) {
    const sx = baseFrame.w > 0 ? frame.w / baseFrame.w : 1;
    const sy = baseFrame.h > 0 ? frame.h / baseFrame.h : 1;
    return {
      width: evenRound(crop.width * sx),
      height: evenRound(crop.height * sy),
    };
  }

  // Which edges each handle moves. Corners move two; edge-handles one; "move" translates.
  const HANDLE_EDGES = {
    nw: { l: true, t: true }, ne: { r: true, t: true },
    sw: { l: true, b: true }, se: { r: true, b: true },
    n: { t: true }, s: { b: true }, w: { l: true }, e: { r: true },
  };

  // Resize/move a box by a drag delta, clamped to `bounds` and a `minSize` floor.
  // box/bounds are {x,y,w,h}; handle is one of move|n|s|e|w|nw|ne|sw|se. Pure.
  function resizeBox(box, handle, dx, dy, bounds, minSize) {
    const bx0 = bounds.x, by0 = bounds.y;
    const bx1 = bounds.x + bounds.w, by1 = bounds.y + bounds.h;
    let l = box.x, t = box.y, r = box.x + box.w, b = box.y + box.h;

    if (handle === "move") {
      // Translate, clamping the shift so the box stays fully inside bounds.
      const sx = clamp(dx, bx0 - l, bx1 - r);
      const sy = clamp(dy, by0 - t, by1 - b);
      l += sx; r += sx; t += sy; b += sy;
      return { x: l, y: t, w: r - l, h: b - t };
    }

    const edges = HANDLE_EDGES[handle] || {};
    if (edges.l) l = clamp(l + dx, bx0, r - minSize);
    if (edges.r) r = clamp(r + dx, l + minSize, bx1);
    if (edges.t) t = clamp(t + dy, by0, b - minSize);
    if (edges.b) b = clamp(b + dy, t + minSize, by1);
    return { x: l, y: t, w: r - l, h: b - t };
  }

  const api = { evenRound: evenRound, getRenderedVideoRect: getRenderedVideoRect, rectToSourceCrop: rectToSourceCrop, stretchOutputDims: stretchOutputDims, resizeBox: resizeBox };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.SVECropMath = api;
})(typeof window !== "undefined" ? window : null);
