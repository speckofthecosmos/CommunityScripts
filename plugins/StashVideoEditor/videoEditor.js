(function () {
  "use strict";
  const PluginApi = window.PluginApi;
  if (!PluginApi) { console.warn("[StashVideoEditor] PluginApi not ready"); return; }

  const React = PluginApi.React; // core API — safe at load time
  const { useState, useRef, useCallback, useEffect } = React;

  const CONTAINER = { w: 720, h: 405 };
  const MIN_BOX = 20;
  const HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"]; // 8 resize handles

  // Presentational crop/frame rectangle with 8 resize handles + a draggable body.
  // props: { box:{x,y,w,h}, mode:"crop"|"stretch", onHandleDown:(handle)=>(e)=>void }
  function CropBox(props) {
    const box = props.box;
    const handleEls = HANDLES.map((h) =>
      React.createElement("div", {
        key: h,
        className: "sve-handle sve-handle-" + h,
        onMouseDown: props.onHandleDown(h),
      })
    );
    return React.createElement("div", {
      className: "sve-crop-box" + (props.mode === "stretch" ? " sve-frame" : ""),
      style: { left: box.x + "px", top: box.y + "px", width: box.w + "px", height: box.h + "px" },
      onMouseDown: props.onHandleDown("move"),
    }, handleEls);
  }

  async function runCropTask(sceneId, crop, outW, outH) {
    const csLib = window.csLib; // lazy: loaded by CommunityScriptsUILibrary, not ready at script load
    const query = `mutation Run($args: Map!) {
      runPluginTask(plugin_id: "StashVideoEditor", task_name: "Crop and re-encode", args_map: $args)
    }`;
    const args = { mode: "crop_reencode", scene_id: sceneId,
                   crop, out_w: outW, out_h: outH };
    return csLib.callGQL({ query, variables: { args } });
  }

  const MIN_TRIM = 0.25; // seconds — shortest selectable trim range

  async function runTrimTask(sceneId, start, end, lossless) {
    const csLib = window.csLib; // lazy: not ready at script load
    const query = `mutation Run($args: Map!) {
      runPluginTask(plugin_id: "StashVideoEditor", task_name: "Trim", args_map: $args)
    }`;
    const args = { mode: lossless ? "lossless_trim" : "precision_trim",
                   scene_id: sceneId, start, end };
    return csLib.callGQL({ query, variables: { args } });
  }

  function EditorModal(props) {
    // props: { sceneId, show, onHide }
    const { Modal, Button } = PluginApi.libraries.Bootstrap; // lazy: ready at render, not at load
    const cm = window.SVECropMath;

    const [natural, setNatural] = useState(null);   // {w,h} source pixels
    const [mode, setMode] = useState("crop");        // "crop" | "stretch"
    const [box, setBox] = useState(null);            // {x,y,w,h} in container px
    const [crop, setCrop] = useState(null);          // {x,y,width,height} source px
    const [outW, setOutW] = useState("");            // crop-mode numeric override
    const [outH, setOutH] = useState("");
    const [outDims, setOutDims] = useState(null);    // {width,height} derived in stretch mode
    const [playing, setPlaying] = useState(false);   // our own transport (native controls removed)
    const [curTime, setCurTime] = useState(0);
    const [duration, setDuration] = useState(0);

    const drag = useRef(null);
    const videoRef = useRef(null);
    const timeRef = useRef(0);                        // preserve playhead across mode remounts
    const frozen = useRef(null);                      // {crop, baseFrame, cropBox} captured on entering stretch
    const naturalRef = useRef(null);
    const inited = useRef(false);                     // init the box exactly once (survives video remounts)

    const streamUrl = `/scene/${props.sceneId}/stream`;
    const rendered = natural ? cm.getRenderedVideoRect(natural, CONTAINER) : null;

    // Push the current geometry up as crop (crop mode) or derived out dims (stretch mode).
    const commit = useCallback((nextBox, m, rnd) => {
      if (m === "crop") {
        setCrop(cm.rectToSourceCrop(nextBox, rnd, naturalRef.current));
      } else {
        const fr = frozen.current;
        setOutDims(cm.stretchOutputDims(fr.crop, { w: nextBox.w, h: nextBox.h }, fr.baseFrame));
      }
    }, [cm]);

    const onMeta = (e) => {
      const v = e.target;
      const nat = { w: v.videoWidth, h: v.videoHeight };
      // The <video> remounts when toggling Crop/Stretch and re-fires this. Only push a
      // new `natural` when the dims actually change, so the init effect isn't handed a
      // fresh object ref that would reset the box mid-edit.
      if (!naturalRef.current || naturalRef.current.w !== nat.w || naturalRef.current.h !== nat.h) {
        naturalRef.current = nat;
        setNatural(nat);
      }
      setDuration(v.duration || 0);
    };

    const fmtTime = (s) => {
      if (!isFinite(s)) return "0:00";
      const m = Math.floor(s / 60);
      const sec = Math.floor(s % 60);
      return m + ":" + (sec < 10 ? "0" + sec : sec);
    };
    const togglePlay = () => {
      const v = videoRef.current; if (!v) return;
      if (v.paused) v.play(); else v.pause();
    };
    const seek = (e) => {
      const t = parseFloat(e.target.value);
      if (videoRef.current) videoRef.current.currentTime = t;
      setCurTime(t);
    };

    // Initialize the box to the full rendered frame ONCE the video's natural size is
    // known. The `inited` guard keeps a video remount (mode toggle) from re-running this
    // and wiping the user's crop/stretch edits.
    useEffect(() => {
      if (!natural || inited.current) return;
      inited.current = true;
      const rnd = cm.getRenderedVideoRect(natural, CONTAINER);
      const initial = { x: rnd.x, y: rnd.y, w: rnd.w, h: rnd.h };
      setBox(initial);
      setCrop(cm.rectToSourceCrop(initial, rnd, natural));
    }, [natural, cm]);

    const onHandleDown = (handle) => (e) => {
      e.preventDefault();
      e.stopPropagation(); // keep a handle's resize from also triggering the body's "move"
      const bounds = mode === "crop"
        ? rendered
        : { x: 0, y: 0, w: CONTAINER.w, h: CONTAINER.h }; // stretch frame may exceed the video rect
      drag.current = { handle, sx: e.clientX, sy: e.clientY, start: box, bounds, mode, rendered };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    };
    const onMove = (e) => {
      const d = drag.current; if (!d) return;
      const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
      const nb = cm.resizeBox(d.start, d.handle, dx, dy, d.bounds, MIN_BOX);
      setBox(nb);
      commit(nb, d.mode, d.rendered);
    };
    const onUp = () => {
      drag.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };

    // Auto-crop: sample the current frame to a canvas, detect the sharp content box
    // (strips black bars AND blurred-zoom padding), and snap the crop box to it.
    // Detection is a starting point — the 8 handles stay live for fine-tuning.
    const autoCrop = () => {
      const v = videoRef.current;
      if (!v || !natural || !rendered) return;
      const sw = Math.min(natural.w, 320); // downscale: bar detection doesn't need full res
      const sh = Math.max(1, Math.round(natural.h * sw / natural.w));
      const canvas = document.createElement("canvas");
      canvas.width = sw; canvas.height = sh;
      const ctx = canvas.getContext("2d");
      try {
        ctx.drawImage(v, 0, 0, sw, sh);
        const img = ctx.getImageData(0, 0, sw, sh); // same-origin stream → not tainted
        const cb = cm.detectSharpContentBox(img.data, sw, sh);
        const sx = natural.w / sw, sy = natural.h / sh;   // sample px → source px
        const scale = rendered.w / natural.w;             // source px → container px
        const nb = {
          x: rendered.x + cb.x * sx * scale,
          y: rendered.y + cb.y * sy * scale,
          w: cb.w * sx * scale,
          h: cb.h * sy * scale,
        };
        setBox(nb);
        commit(nb, "crop", rendered);
      } catch (err) {
        console.error("[StashVideoEditor] auto-crop failed", err);
      }
    };

    const sameRect = (a, b) => a && b &&
      a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;

    const toggleMode = () => {
      setPlaying(false); // the <video> remounts across modes; resync transport state
      if (mode === "crop") {
        const fc = cm.rectToSourceCrop(box, rendered, natural);
        const cropBox = { x: box.x, y: box.y, w: box.w, h: box.h };
        const prev = frozen.current;
        // Resume the prior stretch frame if the crop is unchanged; otherwise start
        // undistorted (frame == cropBox). baseFrame stays the crop's own dims, so the
        // output-dim math is always measured from the undistorted reference.
        const frame = (prev && prev.lastFrame && sameRect(prev.cropBox, cropBox))
          ? prev.lastFrame : cropBox;
        frozen.current = { crop: fc, baseFrame: { w: cropBox.w, h: cropBox.h }, cropBox: cropBox, lastFrame: frame };
        setBox(frame);
        setCrop(fc);
        setOutDims(cm.stretchOutputDims(fc, { w: frame.w, h: frame.h }, { w: cropBox.w, h: cropBox.h }));
        setMode("stretch");
      } else {
        // Remember the stretch frame so it can be resumed, then restore the crop box —
        // don't treat the dragged output frame as a new crop.
        if (frozen.current) frozen.current.lastFrame = { x: box.x, y: box.y, w: box.w, h: box.h };
        const cb = frozen.current ? frozen.current.cropBox : box;
        setBox(cb);
        commit(cb, "crop", rendered);
        setMode("crop");
      }
    };

    const submit = async () => {
      let w, h, theCrop;
      if (mode === "stretch") {
        theCrop = frozen.current.crop;
        w = outDims.width; h = outDims.height;
      } else {
        theCrop = crop;
        w = parseInt(outW, 10) || crop.width;
        h = parseInt(outH, 10) || crop.height;
      }
      try {
        await runCropTask(props.sceneId, theCrop, w, h);
      } catch (err) {
        console.error("[StashVideoEditor] crop task failed", err);
      } finally {
        props.onHide();
      }
    };

    // Shared <video> handlers. Native controls are intentionally OFF so the player's
    // control bar never overlaps the crop box — transport lives below the stage instead.
    // Preserve the playhead when the element remounts across modes.
    const videoProps = {
      ref: videoRef,
      src: streamUrl,
      onLoadedMetadata: onMeta,
      onLoadedData: () => { if (videoRef.current) videoRef.current.currentTime = timeRef.current; },
      onTimeUpdate: () => {
        const v = videoRef.current; if (!v) return;
        timeRef.current = v.currentTime;
        setCurTime(v.currentTime);
      },
      onPlay: () => setPlaying(true),
      onPause: () => setPlaying(false),
    };

    // --- Stage rendering -----------------------------------------------------
    let stageChildren;
    if (mode === "stretch" && box && frozen.current) {
      // Show ONLY the frozen crop region, scaled (non-uniformly) to fill the frame box.
      const fc = frozen.current.crop;
      const vidStyle = {
        position: "absolute",
        left: (-(fc.x * box.w / fc.width)) + "px",
        top: (-(fc.y * box.h / fc.height)) + "px",
        width: (natural.w * box.w / fc.width) + "px",
        height: (natural.h * box.h / fc.height) + "px",
        objectFit: "fill",
      };
      stageChildren = [
        React.createElement("div", {
          key: "clip", className: "sve-frame-clip",
          style: { left: box.x + "px", top: box.y + "px", width: box.w + "px", height: box.h + "px" },
        }, React.createElement("video", Object.assign({}, videoProps, { style: vidStyle }))),
        React.createElement(CropBox, { key: "box", box, mode, onHandleDown }),
      ];
    } else {
      stageChildren = [
        React.createElement("video", Object.assign({}, videoProps, {
          key: "video",
          style: { width: "100%", height: "100%", objectFit: "contain" },
        })),
        box && React.createElement(CropBox, { key: "box", box, mode, onHandleDown }),
      ];
    }

    const controls = mode === "stretch"
      ? React.createElement("div", { className: "sve-controls" },
          React.createElement("span", { className: "sve-outdims" },
            "Output ", outDims ? (outDims.width + " × " + outDims.height) : "—", " px"),
          React.createElement("div", { className: "sve-hint" },
            "Drag the frame handles to stretch the cropped region. Output size follows the frame."))
      : React.createElement("div", { className: "sve-controls" },
          "Output W ", React.createElement("input", { type: "number", value: outW, onChange: (e) => setOutW(e.target.value), placeholder: crop ? crop.width : "" }),
          " H ", React.createElement("input", { type: "number", value: outH, onChange: (e) => setOutH(e.target.value), placeholder: crop ? crop.height : "" }),
          React.createElement("div", { className: "sve-hint" }, "Leave blank to keep crop size (crop only). Set to stretch numerically, or switch to Stretch to do it visually."));

    const submitDisabled = mode === "stretch" ? !outDims : !crop;

    // What will actually be re-encoded, so the submit button states it outright.
    let applyCrop = null, applyOut = null;
    if (mode === "stretch") {
      applyCrop = frozen.current ? frozen.current.crop : null;
      applyOut = outDims;
    } else if (crop) {
      applyCrop = crop;
      applyOut = { width: parseInt(outW, 10) || crop.width, height: parseInt(outH, 10) || crop.height };
    }
    const isStretched = applyCrop && applyOut &&
      (applyOut.width !== applyCrop.width || applyOut.height !== applyCrop.height);
    const applyLabel = applyOut
      ? (isStretched ? "Stretch & re-encode" : "Crop & re-encode") + " → " + applyOut.width + "×" + applyOut.height
      : "Crop & re-encode";

    return React.createElement(Modal, { show: props.show, onHide: props.onHide, size: "lg" },
      React.createElement(Modal.Header, { closeButton: true },
        React.createElement(Modal.Title, null, "Crop & re-encode")),
      React.createElement(Modal.Body, null,
        React.createElement("div", { className: "sve-stage", style: { width: CONTAINER.w, height: CONTAINER.h } },
          ...stageChildren
        ),
        React.createElement("div", { className: "sve-transport" },
          React.createElement(Button, {
            variant: "secondary", size: "sm", className: "sve-play-btn",
            disabled: !natural, onClick: togglePlay,
          }, playing ? "❚❚" : "►"),
          React.createElement("input", {
            type: "range", className: "sve-seek", min: 0, max: duration || 0, step: 0.05,
            value: curTime, disabled: !duration, onChange: seek,
          }),
          React.createElement("span", { className: "sve-time" }, fmtTime(curTime) + " / " + fmtTime(duration))
        ),
        React.createElement("div", { className: "sve-modebar" },
          mode === "crop" && React.createElement(Button, {
            variant: "info", size: "sm", className: "sve-autocrop-btn",
            disabled: !natural, onClick: autoCrop, title: "Snap the crop to the sharp content, removing black bars or blurred padding",
          }, "Auto-crop bars"),
          React.createElement(Button, {
            variant: mode === "stretch" ? "primary" : "secondary",
            size: "sm", className: "sve-mode-btn", disabled: !box, onClick: toggleMode,
          }, mode === "stretch" ? "Stretching — switch to Crop" : "Switch to Stretch"),
        ),
        controls
      ),
      React.createElement(Modal.Footer, null,
        React.createElement(Button, { variant: "secondary", onClick: props.onHide }, "Cancel"),
        React.createElement(Button, { variant: "primary", disabled: submitDisabled, onClick: submit }, applyLabel)
      )
    );
  }

  function CropTabButton(props) {
    const { Button } = PluginApi.libraries.Bootstrap; // lazy
    const [show, setShow] = useState(false);
    return React.createElement(React.Fragment, null,
      React.createElement(Button, { variant: "secondary", className: "sve-open-btn", onClick: () => setShow(true) }, "Crop & re-encode"),
      show && React.createElement(EditorModal, { sceneId: props.sceneId, show: true, onHide: () => setShow(false) })
    );
  }

  // Lossless/precision TRIM modal. Distinct operation from crop (can't do both in
  // one pass), so it's a separate button + modal. The stage is identical in both
  // trim modes, so the <video> never remounts here — the in/out range lives safely
  // in component state. `inited` still guards against a stray metadata re-fire.
  // The timeline reuses Stash's already-generated sprite sheet as a filmstrip; if
  // sprites aren't generated it degrades to a plain track — the draggable handles
  // and live preview work either way.
  function TrimModal(props) {
    const { Modal, Button } = PluginApi.libraries.Bootstrap; // lazy: ready at render
    const tm = window.SVETimeMath;
    const sv = window.SVESpriteVtt;

    const [duration, setDuration] = useState(0);
    const [curTime, setCurTime] = useState(0);
    const [playing, setPlaying] = useState(false);
    const [range, setRange] = useState(null);   // {in, out} (source seconds)
    const [lossless, setLossless] = useState(true);
    const [film, setFilm] = useState(null);     // {url, cues, sheet:{w,h}} or null

    const videoRef = useRef(null);
    const filmRef = useRef(null);               // timeline element, for clientX→time
    const dragRef = useRef(null);               // "in" | "out" while dragging a handle
    const timeRef = useRef(0);                  // preserve playhead if the element reloads
    const inited = useRef(false);               // default the range to the whole clip once

    const streamUrl = `/scene/${props.sceneId}/stream`;

    // Reuse the scene's sprite sheet (paths.sprite) + its VTT (paths.vtt) as a
    // filmstrip. Best-effort: any failure leaves `film` null → plain-track fallback.
    useEffect(() => {
      let cancelled = false;
      (async () => {
        try {
          const csLib = window.csLib;
          const q = `query SvePaths($id: ID!) { findScene(id: $id) { paths { sprite vtt } } }`;
          const res = await csLib.callGQL({ query: q, variables: { id: props.sceneId } });
          const paths = res && res.findScene && res.findScene.paths;
          if (!paths || !paths.sprite || !paths.vtt) return;
          const text = await fetch(paths.vtt, { credentials: "include" }).then((r) => r.ok ? r.text() : "");
          const cues = sv.parseSpriteVTT(text);
          if (!cancelled && cues.length) {
            setFilm({ url: paths.sprite, cues: cues, sheet: sv.spriteSheetSize(cues) });
          }
        } catch (err) {
          console.warn("[StashVideoEditor] sprite filmstrip unavailable; using plain track", err);
        }
      })();
      return () => { cancelled = true; };
    }, [props.sceneId, sv]);

    const onMeta = (e) => {
      const d = e.target.duration || 0;
      setDuration(d);
      if (!inited.current && d > 0) {
        inited.current = true;
        setRange({ in: 0, out: d });             // whole clip selected by default
      }
    };

    const togglePlay = () => {
      const v = videoRef.current; if (!v) return;
      if (v.paused) v.play(); else v.pause();
    };
    const seek = (e) => {
      const t = parseFloat(e.target.value);
      if (videoRef.current) videoRef.current.currentTime = t;
      setCurTime(t);
    };
    const setInHere = () => { if (range && duration) setRange(tm.clampIn(range, curTime, duration, MIN_TRIM)); };
    const setOutHere = () => { if (range && duration) setRange(tm.clampOut(range, curTime, duration, MIN_TRIM)); };

    // Drag an in/out handle along the timeline. Live preview: scrub the real
    // <video> to the handle's time so the exact frame shows under the cursor.
    const timeFromClientX = (clientX) => {
      const el = filmRef.current;
      if (!el || !duration) return 0;
      const r = el.getBoundingClientRect();
      return tm.clamp((clientX - r.left) / r.width, 0, 1) * duration;
    };
    const onDragMove = (e) => {
      const which = dragRef.current; if (!which) return;
      const t = timeFromClientX(e.clientX);
      setRange((r) => which === "in" ? tm.clampIn(r, t, duration, MIN_TRIM)
                                     : tm.clampOut(r, t, duration, MIN_TRIM));
      if (videoRef.current) videoRef.current.currentTime = t; // live preview frame
      setCurTime(t);
    };
    const onDragUp = () => {
      dragRef.current = null;
      window.removeEventListener("mousemove", onDragMove);
      window.removeEventListener("mouseup", onDragUp);
    };
    const onHandleDown = (which) => (e) => {
      e.preventDefault(); e.stopPropagation();
      if (videoRef.current) videoRef.current.pause(); // freeze for a clean scrub
      dragRef.current = which;
      window.addEventListener("mousemove", onDragMove);
      window.addEventListener("mouseup", onDragUp);
    };

    const videoProps = {
      ref: videoRef,
      src: streamUrl,
      onLoadedMetadata: onMeta,
      onLoadedData: () => { if (videoRef.current) videoRef.current.currentTime = timeRef.current; },
      onTimeUpdate: () => {
        const v = videoRef.current; if (!v) return;
        timeRef.current = v.currentTime;
        setCurTime(v.currentTime);
      },
      onPlay: () => setPlaying(true),
      onPause: () => setPlaying(false),
      style: { width: "100%", height: "100%", objectFit: "contain" },
    };

    const pct = (t) => duration > 0 ? (tm.clamp(t, 0, duration) / duration) * 100 : 0;
    const valid = range ? tm.validateRange(range.in, range.out, duration, MIN_TRIM)
                        : { valid: false, reason: "Loading…" };
    const selDur = range ? Math.max(0, range.out - range.in) : 0;
    const fmtRange = range ? tm.formatTime(range.in) + "–" + tm.formatTime(range.out) : "";
    const submitLabel = (lossless ? "Lossless trim → " : "Precision trim → ") + fmtRange;

    const submit = async () => {
      if (!valid.valid) return;
      try {
        await runTrimTask(props.sceneId, range.in, range.out, lossless);
      } catch (err) {
        console.error("[StashVideoEditor] trim task failed", err);
      } finally {
        props.onHide();
      }
    };

    // --- Filmstrip timeline --------------------------------------------------
    const haveFilm = !!(film && film.sheet.w > 0 && duration > 0);
    const N = haveFilm ? Math.max(1, Math.round(CONTAINER.w / 96)) : 0; // ~8 thumbs
    const tileW = haveFilm ? CONTAINER.w / N : 0;
    const aspect = haveFilm ? film.cues[0].h / film.cues[0].w : 9 / 16;
    const stripH = haveFilm ? Math.round(tileW * aspect) : 54;

    const tiles = [];
    if (haveFilm) {
      for (let i = 0; i < N; i++) {
        const cue = sv.cueAt(film.cues, ((i + 0.5) / N) * duration);
        const scale = tileW / cue.w;
        tiles.push(React.createElement("div", {
          key: i, className: "sve-film-tile",
          style: {
            width: tileW + "px", height: stripH + "px",
            backgroundImage: `url("${film.url}")`,
            backgroundSize: (film.sheet.w * scale) + "px " + (film.sheet.h * scale) + "px",
            backgroundPosition: (-cue.x * scale) + "px " + (-cue.y * scale) + "px",
          },
        }));
      }
    }

    const timeline = React.createElement("div", {
      className: "sve-film", ref: filmRef,
      style: { width: CONTAINER.w + "px", height: stripH + "px" },
    },
      haveFilm
        ? React.createElement("div", { className: "sve-film-row" }, ...tiles)
        : React.createElement("div", { className: "sve-film-blank" }),
      range && React.createElement("div", { className: "sve-film-dim", style: { left: 0, width: pct(range.in) + "%" } }),
      range && React.createElement("div", { className: "sve-film-dim", style: { left: pct(range.out) + "%", right: 0 } }),
      React.createElement("div", { className: "sve-film-playhead", style: { left: pct(curTime) + "%" } }),
      range && React.createElement("div", {
        className: "sve-film-handle sve-in", style: { left: pct(range.in) + "%" },
        onMouseDown: onHandleDown("in"),
      }),
      range && React.createElement("div", {
        className: "sve-film-handle sve-out", style: { left: pct(range.out) + "%" },
        onMouseDown: onHandleDown("out"),
      })
    );

    return React.createElement(Modal, { show: props.show, onHide: props.onHide, size: "lg" },
      React.createElement(Modal.Header, { closeButton: true },
        React.createElement(Modal.Title, null, "Trim")),
      React.createElement(Modal.Body, null,
        React.createElement("div", { className: "sve-stage", style: { width: CONTAINER.w, height: CONTAINER.h } },
          React.createElement("video", Object.assign({ key: "video" }, videoProps))
        ),
        timeline,
        React.createElement("div", { className: "sve-transport" },
          React.createElement(Button, {
            variant: "secondary", size: "sm", className: "sve-play-btn",
            disabled: !duration, onClick: togglePlay,
          }, playing ? "❚❚" : "►"),
          React.createElement("input", {
            type: "range", className: "sve-seek", min: 0, max: duration || 0, step: 0.05,
            value: curTime, disabled: !duration, onChange: seek,
          }),
          React.createElement("span", { className: "sve-time" }, tm.formatTime(curTime) + " / " + tm.formatTime(duration))
        ),
        React.createElement("div", { className: "sve-modebar" },
          React.createElement(Button, { variant: "secondary", size: "sm", disabled: !range, onClick: setInHere }, "Set In @ playhead"),
          React.createElement(Button, { variant: "secondary", size: "sm", disabled: !range, onClick: setOutHere }, "Set Out @ playhead"),
          React.createElement(Button, {
            variant: lossless ? "primary" : "info", size: "sm", className: "sve-mode-btn",
            onClick: () => setLossless(!lossless),
          }, lossless ? "Lossless (keyframe-snap)" : "Precision (re-encode)")
        ),
        React.createElement("div", { className: "sve-controls" },
          React.createElement("span", { className: "sve-outdims" }, "Selected: " + (range ? fmtRange + " (" + tm.formatTime(selDur) + ")" : "—")),
          React.createElement("div", { className: "sve-hint" },
            lossless
              ? "Lossless — instant, zero quality loss. Drag the in/out handles; the cut snaps to the nearest keyframe at or before your in-point, so the whole selection is kept."
              : "Precision — re-encodes the selection for a frame-accurate cut exactly where you set the handles."),
          !valid.valid && React.createElement("div", { className: "sve-hint sve-warn" }, valid.reason)
        )
      ),
      React.createElement(Modal.Footer, null,
        React.createElement(Button, { variant: "secondary", onClick: props.onHide }, "Cancel"),
        React.createElement(Button, { variant: "primary", disabled: !valid.valid, onClick: submit }, submitLabel)
      )
    );
  }

  function TrimButton(props) {
    const { Button } = PluginApi.libraries.Bootstrap; // lazy
    const [show, setShow] = useState(false);
    return React.createElement(React.Fragment, null,
      React.createElement(Button, { variant: "secondary", className: "sve-open-btn", onClick: () => setShow(true) }, "Trim"),
      show && React.createElement(TrimModal, { sceneId: props.sceneId, show: true, onHide: () => setShow(false) })
    );
  }

  // Guard registration so a plugin error can never block Stash's UI bootstrap.
  try {
    PluginApi.patch.before("ScenePage.TabContent", function (props) {
      const sceneId = props.scene && props.scene.id;
      if (!sceneId) return [{ children: props.children }];
      const children = Array.isArray(props.children) ? props.children.slice() : [props.children];
      children.push(React.createElement(CropTabButton, { key: "sve-crop-btn", sceneId }));
      children.push(React.createElement(TrimButton, { key: "sve-trim-btn", sceneId }));
      return [{ children: React.createElement(React.Fragment, null, ...children) }];
    });
    console.log("[StashVideoEditor] loaded");
  } catch (e) {
    console.error("[StashVideoEditor] registration failed (UI unaffected)", e);
  }
})();
