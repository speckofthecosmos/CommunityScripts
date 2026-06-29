# Stash Video Editor

Visually crop and (optionally) stretch a scene's video from the scene page.
Re-encodes server-side using Stash's configured transcode settings, writes a new
file next to the original, and sets it as the scene's primary file (the original
is kept as a secondary file — nothing is overwritten or deleted).

## Crop math attribution
`cropMath.js` adapts coordinate helpers from react-easy-crop
(https://github.com/ValentinH/react-easy-crop), MIT License.
