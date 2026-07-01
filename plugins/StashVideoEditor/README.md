# Stash Video Editor

Visually crop and (optionally) stretch a scene's video from the scene page.
Re-encodes server-side using Stash's configured transcode settings, writes a new
file next to the original, and sets it as the scene's primary file (the original
is kept as a secondary file — nothing is overwritten or deleted).

## Image clips

The same **Crop & re-encode** button appears on the image detail page for image
clips (`.vclip` videos). Image clips lack the scene file-swap API (`imageAssignFile`
/ `imageMerge` don't exist), so instead of the scene's non-destructive secondary-file
swap, the cropped file is written over the original path and the original is kept as
a `.sve-bak` sidecar (Stash ignores that extension). A rescan refreshes the image's
dimensions in place — the image record and all its metadata are preserved. Trim and
marker remapping are scene-only.

## Crop math attribution
`cropMath.js` adapts coordinate helpers from react-easy-crop
(https://github.com/ValentinH/react-easy-crop), MIT License.
