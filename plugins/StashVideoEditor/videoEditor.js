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

    const drag = useRef(null);
    const videoRef = useRef(null);
    const timeRef = useRef(0);                        // preserve playhead across mode remounts
    const frozen = useRef(null);                      // {crop, baseFrame} captured on entering stretch
    const naturalRef = useRef(null);

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
      naturalRef.current = nat;
      setNatural(nat);
    };

    // Initialize the box to the full rendered frame once the video's natural size is known.
    useEffect(() => {
      if (!natural) return;
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

    const toggleMode = () => {
      if (mode === "crop") {
        const fc = cm.rectToSourceCrop(box, rendered, natural);
        frozen.current = { crop: fc, baseFrame: { w: box.w, h: box.h } };
        setCrop(fc);
        setOutDims(cm.stretchOutputDims(fc, { w: box.w, h: box.h }, { w: box.w, h: box.h }));
        setMode("stretch");
      } else {
        setMode("crop");
        commit(box, "crop", rendered);
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

    // Shared <video> handlers — preserve the playhead when the element remounts across modes.
    const videoProps = {
      ref: videoRef,
      src: streamUrl,
      controls: true,
      onLoadedMetadata: onMeta,
      onLoadedData: () => { if (videoRef.current) videoRef.current.currentTime = timeRef.current; },
      onTimeUpdate: () => { if (videoRef.current) timeRef.current = videoRef.current.currentTime; },
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

    return React.createElement(Modal, { show: props.show, onHide: props.onHide, size: "lg" },
      React.createElement(Modal.Header, { closeButton: true },
        React.createElement(Modal.Title, null, "Crop & re-encode")),
      React.createElement(Modal.Body, null,
        React.createElement("div", { className: "sve-stage", style: { width: CONTAINER.w, height: CONTAINER.h } },
          ...stageChildren
        ),
        React.createElement("div", { className: "sve-modebar" },
          React.createElement(Button, {
            variant: mode === "stretch" ? "primary" : "outline-secondary",
            size: "sm", className: "sve-mode-btn", disabled: !box, onClick: toggleMode,
          }, mode === "stretch" ? "Stretching — switch to Crop" : "Switch to Stretch"),
        ),
        controls
      ),
      React.createElement(Modal.Footer, null,
        React.createElement(Button, { variant: "secondary", onClick: props.onHide }, "Cancel"),
        React.createElement(Button, { variant: "primary", disabled: submitDisabled, onClick: submit }, "Crop & re-encode")
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

  // Guard registration so a plugin error can never block Stash's UI bootstrap.
  try {
    PluginApi.patch.before("ScenePage.TabContent", function (props) {
      const sceneId = props.scene && props.scene.id;
      if (!sceneId) return [{ children: props.children }];
      const children = Array.isArray(props.children) ? props.children.slice() : [props.children];
      children.push(React.createElement(CropTabButton, { key: "sve-btn", sceneId }));
      return [{ children: React.createElement(React.Fragment, null, ...children) }];
    });
    console.log("[StashVideoEditor] loaded");
  } catch (e) {
    console.error("[StashVideoEditor] registration failed (UI unaffected)", e);
  }
})();
