import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../web/js/minimax_source_ranges.js", import.meta.url), "utf8");
const { sourceSegmentRangeLimits, setSourceSegmentRange, moveSourceSplit } =
    await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);

function fixture() {
    return [0, 1, 2].map((i) => ({
        id: `segment-${i}`, start: i * 30, length: 30, prompt: `prompt-${i}`,
        refs: [{ imageFile: `picture-${i}.png` }],
        refAudios: [{ audioFile: `sound-${i}.wav` }],
        referenceVideo: { videoFile: `reference-${i}.mp4` },
        loras: [{ name: "example.safetensors", strength: 0.8 }],
        run: i !== 1, continuityFromPrev: i > 0,
    }));
}

function assertCoverage(segments, total = 90) {
    let cursor = 0;
    for (const segment of [...segments].sort((a, b) => a.start - b.start)) {
        assert.equal(segment.start, cursor, "no missing or duplicate source frames");
        assert.ok(segment.length >= 4);
        cursor += segment.length;
    }
    assert.equal(cursor, total);
}

test("dragging adjusts only the adjacent lengths and retains all settings", () => {
    const before = fixture();
    const saved = structuredClone(before);
    const result = moveSourceSplit(before, 30, 42);
    assert.equal(result.frame, 42);
    assert.deepEqual(result.segments.map((s) => [s.start, s.length]), [[0, 42], [42, 18], [60, 30]]);
    assert.deepEqual(before, saved, "preview must not modify committed timeline");
    for (let i = 0; i < before.length; i++) {
        const { start, length, ...data } = result.segments[i];
        const { start: oldStart, length: oldLength, ...original } = before[i];
        assert.deepEqual(data, original);
    }
    assertCoverage(result.segments);
});

test("dragging clamps both ways and rounds to whole frames", () => {
    const segments = fixture();
    assert.equal(moveSourceSplit(segments, 30, -100).frame, 4);
    assert.equal(moveSourceSplit(segments, 30, 200).frame, 56);
    assert.equal(moveSourceSplit(segments, 30, 42.6).frame, 43);
    assertCoverage(moveSourceSplit(segments, 30, -100).segments);
    assertCoverage(moveSourceSplit(segments, 30, 200).segments);
});

test("UI inclusive range maps to exact source frames, with no end-frame loss", () => {
    const result = setSourceSegmentRange(fixture(), 1, 35, 65);
    assert.deepEqual(result.map((s) => [s.start, s.length]), [[0, 34], [34, 31], [65, 25]]);
    assert.equal(result[1].start + 1, 35);
    assert.equal(result[1].start + result[1].length, 65);
    assertCoverage(result);
});

test("both ends can move atomically beyond the segment's former end", () => {
    const result = setSourceSegmentRange(fixture(), 1, 61, 80);
    assert.deepEqual(result.map((s) => [s.start, s.length]), [[0, 60], [60, 20], [80, 10]]);
    assertCoverage(result);
});

test("outer endpoints are fixed while interior endpoints remain editable", () => {
    const segments = fixture();
    const first = sourceSegmentRangeLimits(segments, 0);
    const last = sourceSegmentRangeLimits(segments, 2);
    assert.equal(first.canStart, false);
    assert.equal(last.canEnd, false);
    assert.equal(setSourceSegmentRange(segments, 0, 2, 30), null);
    assert.equal(setSourceSegmentRange(segments, 2, 61, 89), null);
    assertCoverage(setSourceSegmentRange(segments, 0, 1, 35));
    assertCoverage(setSourceSegmentRange(segments, 2, 65, 90));
});

test("uploaded-clip seams cannot move or be crossed", () => {
    const segments = fixture();
    assert.equal(moveSourceSplit(segments, 30, 40, [30]), null);
    assert.equal(sourceSegmentRangeLimits(segments, 1, [30]).canStart, false);
    assert.equal(setSourceSegmentRange(segments, 1, 35, 60, [30]), null);
    assert.equal(setSourceSegmentRange(segments, 1, 31, 65, [60]), null);
    assertCoverage(moveSourceSplit(segments, 60, 70, [30]).segments);
});

test("invalid, too-short and out-of-neighbor ranges leave the timeline intact", () => {
    const segments = fixture();
    const saved = structuredClone(segments);
    for (const [first, last] of [[NaN, 60], [31, NaN], [31.5, 60], [0, 60],
        [31, 32], [55, 54], [88, 90], [31, 87], [3, 60]]) {
        assert.equal(setSourceSegmentRange(segments, 1, first, last), null);
    }
    assert.equal(moveSourceSplit(segments, 0, 10), null);
    assert.equal(moveSourceSplit(segments, 30, NaN), null);
    assert.deepEqual(segments, saved);
});

test("array order is retained even when segments arrive unsorted", () => {
    const base = fixture();
    const unordered = [base[2], base[0], base[1]];
    const result = setSourceSegmentRange(unordered, 2, 35, 65);
    assert.deepEqual(result.map((s) => s.id), ["segment-2", "segment-0", "segment-1"]);
    assertCoverage(result);
});

test("an unchanged range retains exact coverage and metadata", () => {
    const segments = fixture();
    assert.deepEqual(setSourceSegmentRange(segments, 1, 31, 60), segments);
    assertCoverage(moveSourceSplit(segments, 30, 30).segments);
});
