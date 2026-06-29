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
      e.stopPropagation();
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

  const { Modal, Button } = PluginApi.libraries.Bootstrap;
  const csLib = window.csLib;

  async function runCropTask(sceneId, crop, outW, outH) {
    const query = `mutation Run($args: Map!) {
      runPluginTask(plugin_id: "StashVideoEditor", task_name: "Crop and re-encode", args: $args)
    }`;
    const args = { mode: "crop_reencode", scene_id: sceneId,
                   crop, out_w: outW, out_h: outH };
    return csLib.callGQL({ query, variables: { args } });
  }

  function EditorModal(props) {
    // props: { sceneId, show, onHide }
    const [crop, setCrop] = useState(null);
    const [outW, setOutW] = useState("");
    const [outH, setOutH] = useState("");
    const [natural, setNatural] = useState(null);
    const containerSize = { w: 720, h: 405 };
    const streamUrl = `/scene/${props.sceneId}/stream`;

    const onMeta = (e) => {
      const v = e.target;
      setNatural({ w: v.videoWidth, h: v.videoHeight });
    };
    const submit = async () => {
      const w = parseInt(outW, 10) || crop.width;
      const h = parseInt(outH, 10) || crop.height;
      await runCropTask(props.sceneId, crop, w, h);
      props.onHide();
    };

    return React.createElement(Modal, { show: props.show, onHide: props.onHide, size: "lg" },
      React.createElement(Modal.Header, { closeButton: true },
        React.createElement(Modal.Title, null, "Crop & re-encode")),
      React.createElement(Modal.Body, null,
        React.createElement("div", { className: "sve-stage", style: { width: containerSize.w, height: containerSize.h } },
          React.createElement("video", { src: streamUrl, controls: true, onLoadedMetadata: onMeta,
            style: { width: "100%", height: "100%", objectFit: "contain" } }),
          natural && React.createElement(CropOverlay, { containerSize, natural, onCropChange: setCrop })
        ),
        React.createElement("div", { className: "sve-controls" },
          "Output W ", React.createElement("input", { type: "number", value: outW, onChange: (e) => setOutW(e.target.value), placeholder: crop ? crop.width : "" }),
          " H ", React.createElement("input", { type: "number", value: outH, onChange: (e) => setOutH(e.target.value), placeholder: crop ? crop.height : "" }),
          React.createElement("div", { className: "sve-hint" }, "Leave blank to keep crop size (crop only). Set to stretch.")
        )
      ),
      React.createElement(Modal.Footer, null,
        React.createElement(Button, { variant: "secondary", onClick: props.onHide }, "Cancel"),
        React.createElement(Button, { variant: "primary", disabled: !crop, onClick: submit }, "Crop & re-encode")
      )
    );
  }

  function CropTabButton(props) {
    const [show, setShow] = useState(false);
    return React.createElement(React.Fragment, null,
      React.createElement(Button, { variant: "secondary", className: "sve-open-btn", onClick: () => setShow(true) }, "Crop & re-encode"),
      React.createElement(EditorModal, { sceneId: props.sceneId, show, onHide: () => setShow(false) })
    );
  }

  PluginApi.patch.before("ScenePage.TabContent", function (props) {
    const sceneId = props.scene && props.scene.id;
    if (!sceneId) return [{ children: props.children }];
    const children = Array.isArray(props.children) ? props.children.slice() : [props.children];
    children.push(React.createElement(CropTabButton, { key: "sve-btn", sceneId }));
    return [{ children: React.createElement(React.Fragment, null, ...children) }];
  });
})();
