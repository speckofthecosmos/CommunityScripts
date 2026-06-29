(function () {
  "use strict";
  const PluginApi = window.PluginApi;
  if (!PluginApi) { console.warn("[StashVideoEditor] PluginApi not ready"); return; }
  console.log("[StashVideoEditor] loaded");

  const React = PluginApi.React;
  const { useState, useRef, useCallback } = React;

  function CropOverlay(props) {
    // props: { containerSize:{w,h}, natural:{w,h}, onCropChange }
    const cm = window.SVECropMath;
    const rendered = cm.getRenderedVideoRect(props.natural, props.containerSize);
    const [box, setBox] = useState({ x: rendered.x, y: rendered.y, w: rendered.w, h: rendered.h });
    const drag = useRef(null);

    const emit = useCallback((b) => {
      props.onCropChange(cm.rectToSourceCrop(b, rendered, props.natural));
    }, [rendered, props]);

    const onDown = (mode) => (e) => {
      e.preventDefault();
      drag.current = { mode, sx: e.clientX, sy: e.clientY, start: box };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    };
    const onMove = (e) => {
      const d = drag.current; if (!d) return;
      const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
      let b = { ...d.start };
      if (d.mode === "move") { b.x += dx; b.y += dy; }
      else { b.w = Math.max(20, d.start.w + dx); b.h = Math.max(20, d.start.h + dy); }
      setBox(b); emit(b);
    };
    const onUp = () => {
      drag.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };

    return React.createElement("div", {
      className: "sve-crop-box",
      style: { left: box.x + "px", top: box.y + "px", width: box.w + "px", height: box.h + "px" },
      onMouseDown: onDown("move"),
    }, React.createElement("div", { className: "sve-crop-handle", onMouseDown: onDown("resize") }));
  }
})();
