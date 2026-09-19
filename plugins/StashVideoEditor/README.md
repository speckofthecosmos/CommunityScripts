# Stash Video Editor

Visually crop and (optionally) stretch a scene's video from the scene page.
Re-encodes server-side using Stash's configured transcode settings, writes a new
file next to the original, and sets it as the scene's primary file (the original
is kept as a secondary file — nothing is overwritten or deleted).

## Placing the crop precisely

The stage draws the source scaled down (a 1080p video renders at 0.375x), and the
crop box dims everything outside itself — so a letterbox bar and a dimmed strip of
real content look the same there. Two controls fix that:

- **Magnifier.** Hover or drag any of the 8 handles and a panel shows the pixels
  around that edge at 1:1 source resolution, undimmed. The region being removed is
  washed red and labelled CUT, the surviving side is labelled KEEP, and the marker
  line sits on the boundary pixel *on the removed side* — so no mark ever covers a
  pixel you are keeping. The caption names the edge coordinate, how many pixels it
  removes and from which side (`top y 138 · cut 138px above`). The panel parks on
  the far side of the edge so it never covers the content you're framing.
- **Arrow keys.** They nudge the last-touched handle by 2 source pixels (Shift:
  10). The step is even because the crop is rounded to even dimensions for h.264,
  so an odd step would sometimes produce no change at all.

**Auto-crop bars** remains the fast first pass; these are the fine-tuning backstop.

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
