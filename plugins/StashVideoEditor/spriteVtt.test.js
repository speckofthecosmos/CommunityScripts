// spriteVtt.test.js
const test = require("node:test");
const assert = require("node:assert");
const { parseSpriteVTT, spriteSheetSize, cueAt } = require("./spriteVtt.js");

// Stash sprite VTT: each cue spans a time range and points at one tile of the
// sprite sheet via a media fragment (#xywh=x,y,w,h).
const VTT = [
  "WEBVTT",
  "",
  "00:00:00.000 --> 00:00:05.000",
  "123_sprite.jpg#xywh=0,0,160,90",
  "",
  "00:00:05.000 --> 00:00:10.000",
  "123_sprite.jpg#xywh=160,0,160,90",
  "",
  "00:00:10.000 --> 00:00:15.000",
  "123_sprite.jpg#xywh=0,90,160,90",
  "",
].join("\n");

test("parseSpriteVTT: extracts cues with time range, url and tile rect", () => {
  const cues = parseSpriteVTT(VTT);
  assert.strictEqual(cues.length, 3);
  assert.deepStrictEqual(cues[0], { start: 0, end: 5, url: "123_sprite.jpg", x: 0, y: 0, w: 160, h: 90 });
  assert.deepStrictEqual(cues[1], { start: 5, end: 10, url: "123_sprite.jpg", x: 160, y: 0, w: 160, h: 90 });
  assert.deepStrictEqual(cues[2], { start: 10, end: 15, url: "123_sprite.jpg", x: 0, y: 90, w: 160, h: 90 });
});

test("parseSpriteVTT: supports MM:SS.mmm timestamps (no hours)", () => {
  const vtt = "WEBVTT\n\n01:30.000 --> 01:35.000\ns.jpg#xywh=0,0,10,10\n";
  const cues = parseSpriteVTT(vtt);
  assert.strictEqual(cues.length, 1);
  assert.strictEqual(cues[0].start, 90);
  assert.strictEqual(cues[0].end, 95);
});

test("parseSpriteVTT: empty / non-sprite input yields no cues", () => {
  assert.deepStrictEqual(parseSpriteVTT(""), []);
  assert.deepStrictEqual(parseSpriteVTT("WEBVTT\n\n00:00:00.000 --> 00:00:05.000\nno-fragment.jpg\n"), []);
});

test("spriteSheetSize: full sheet dims derived from tile extents", () => {
  assert.deepStrictEqual(spriteSheetSize(parseSpriteVTT(VTT)), { w: 320, h: 180 });
});

test("spriteSheetSize: empty cues → zero size", () => {
  assert.deepStrictEqual(spriteSheetSize([]), { w: 0, h: 0 });
});

test("cueAt: returns the tile whose range covers the time", () => {
  const cues = parseSpriteVTT(VTT);
  assert.strictEqual(cueAt(cues, 2).x, 0);
  assert.strictEqual(cueAt(cues, 7).x, 160);
  assert.strictEqual(cueAt(cues, 12).y, 90);
});

test("cueAt: clamps before-first / after-last to the edge tiles", () => {
  const cues = parseSpriteVTT(VTT);
  assert.strictEqual(cueAt(cues, -5), cues[0]);
  assert.strictEqual(cueAt(cues, 999), cues[2]);
});

test("cueAt: empty cues → null", () => {
  assert.strictEqual(cueAt([], 5), null);
});
