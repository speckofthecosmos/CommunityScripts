// playability.test.js — run: node --test
//
// Motivating failure: opening the editor on a scene whose video codec the
// browser can't decode (mpeg4, hevc, …) showed an EMPTY stage. The modal
// requests the direct stream, the <video> gets bytes it can't render, and
// nothing said so — meanwhile Stash's own player looked fine, because it falls
// back to a server-side transcode the plugin doesn't use.
const test = require("node:test");
const assert = require("node:assert");
const p = require("./playability.js");

test("a decode failure is reported as an un-editable source", () => {
  // MediaError.MEDIA_ERR_DECODE
  const msg = p.unplayableMessage({ code: 3 });
  assert.ok(msg, "must produce a message");
  assert.match(msg, /can'?t|cannot/i);
});

test("an unsupported-source failure is reported too", () => {
  // MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED — the usual one for a codec the
  // browser has no decoder for.
  assert.ok(p.unplayableMessage({ code: 4 }));
});

test("the message says what to do about it, not just that it broke", () => {
  const msg = p.unplayableMessage({ code: 4 });
  assert.match(msg, /H\.264|transcode|convert/i);
});

test("a network abort is NOT reported as un-editable", () => {
  // MEDIA_ERR_ABORTED (1) and MEDIA_ERR_NETWORK (2) are transient — the file
  // may be perfectly editable, so claiming otherwise sends the operator off to
  // transcode something that needs no transcoding.
  assert.equal(p.unplayableMessage({ code: 1 }), null);
  assert.equal(p.unplayableMessage({ code: 2 }), null);
});

test("a missing or malformed error object yields no message", () => {
  assert.equal(p.unplayableMessage(null), null);
  assert.equal(p.unplayableMessage(undefined), null);
  assert.equal(p.unplayableMessage({}), null);
});

test("metadata never arriving counts as unplayable once the grace period passes", () => {
  // Some browsers stall silently instead of firing `error`, so the modal would
  // sit blank forever with no event to react to.
  assert.equal(p.stalledWithoutMetadata({ hasMetadata: false, elapsedMs: 3000, timeoutMs: 8000 }), false);
  assert.equal(p.stalledWithoutMetadata({ hasMetadata: false, elapsedMs: 9000, timeoutMs: 8000 }), true);
});

test("metadata that did arrive is never treated as a stall", () => {
  assert.equal(p.stalledWithoutMetadata({ hasMetadata: true, elapsedMs: 60000, timeoutMs: 8000 }), false);
});

test("the stall message matches the decode-failure message", () => {
  // Same cause, same remedy — the operator shouldn't have to tell two failure
  // shapes apart to know what to do.
  assert.equal(p.stalledMessage(), p.unplayableMessage({ code: 4 }));
});
