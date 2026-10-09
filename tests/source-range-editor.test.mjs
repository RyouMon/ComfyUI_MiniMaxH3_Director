import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const helperSource = await readFile(new URL("../web/js/minimax_source_ranges.js", import.meta.url), "utf8");
const helpers = await import(`data:text/javascript;base64,${Buffer.from(helperSource).toString("base64")}`);
const timelineSource = await readFile(new URL("../web/js/minimax_timeline.js", import.meta.url), "utf8");
const classStart = timelineSource.indexOf("class MiniMaxH3DirectorEditor {");
const classEnd = timelineSource.indexOf("\nfunction ", classStart);
assert.ok(classStart >= 0 && classEnd > classStart);
const document = { activeElement: null };
const Editor = vm.runInNewContext(`${timelineSource.slice(classStart, classEnd)}\nMiniMaxH3DirectorEditor;`, {
    ...helpers, document, MIN_SEG: 4, HANDLE_PX: 14, RULER_H: 24, TRACK_Y: 44, TRACK_H: 160,
    stopDomEvent() {}, clamp: (value, min, max) => Math.max(min, Math.min(max, value)),
    t: (key, vars = {}) => `${key}:${JSON.stringify(vars)}`,
});

function editorFixture() {
    const elements = new Map();
    for (const name of ["range-first", "range-last", "range-error", "range-segment-label", "split-edit-hint"]) {
        elements.set(`[data-r="${name}"]`, { value: "", textContent: "", disabled: false });
    }
    for (const name of ["apply-segment-range", "del-split"]) elements.set(`[data-a="${name}"]`, { disabled: false });
    const bar = {
        dataset: {}, classList: { toggle(name, on) { bar.hidden = on; } },
        querySelector: (selector) => elements.get(selector),
    };
    const splitBar = { classList: { toggle() {}, add() {} } };
    elements.set('[data-r="segment-range-bar"]', bar);
    elements.set('[data-r="split-edit-bar"]', splitBar);
    const editor = Object.create(Editor.prototype);
    Object.assign(editor, {
        timeline: { totalFrames: 90, global: {}, segments: [0, 1, 2].map((i) => ({
            id: `s${i}`, start: i * 30, length: 30, prompt: `prompt${i}`,
            refs: [{ imageFile: `ref${i}.png` }], run: i !== 1,
        })) },
        root: { querySelector: (selector) => elements.get(selector) },
        selectedIndex: 0, selectedSplitFrame: null, currentFrame: 0,
        _drag: null, _edgeSnapshot: null, _previewSegments: null, commits: 0,
        seekBar: { value: 0 }, boundsEl: { textContent: "" }, segInfo: null,
        isFl2vMode: () => false, isGenMode: () => false, isImageBatch: () => false,
        isR2vBatch: () => false, isGlobalMode: () => true,
        usesBatchTimeline: () => false, needsSourceVideoUpload: () => false,
        isRunSelectEnabled: () => false, _showsContinuityJoints: () => false,
        getLayoutWidth: () => 900, getTotalFrames: () => 90, getClipBoundaries: () => [0, 90],
        frameToX: (frame) => frame * 10, xToFrame: (x) => Math.round(x / 10),
        getMousePos: (e) => ({ x: e.x, y: e.y }),
        scheduleRender() {}, updateOutputPreview() {}, setSmartSplitMessage() {},
        updateSegmentContinuityUI() {},
        updateSelectionUI() { this.updateSegmentRangeUI(); },
        _updateTimelineDom() { this.updateSplitPointUI(); },
        commit() { this.commits++; this.normalizeSegments(); this.updateSelectionUI(); },
    });
    return { editor, elements, bar };
}

function mouse(x) { return { button: 0, x, y: 180, preventDefault() {} }; }
function ranges(editor) { return Array.from(editor.timeline.segments, (s) => `${s.start}:${s.length}`).join(","); }

test("the real split mouse handlers preview and commit without deleting either segment", () => {
    const { editor, elements } = editorFixture();
    assert.equal(editor.hitTest(300, 180).type, "split");
    editor.onMouseDown(mouse(300));
    assert.equal(editor._drag.kind, "split");
    editor.onMouseMove(mouse(420));
    assert.equal(ranges(editor), "0:30,30:30,60:30", "drag is still a preview");
    assert.equal(editor.selectedSplitFrame, 42);
    assert.equal(elements.get('[data-r="range-first"]').value, "43");
    editor.onMouseUp();
    assert.equal(ranges(editor), "0:42,42:18,60:30");
    assert.equal(editor.commits, 1);
    assert.equal(editor._previewSegments, null);
    assert.equal(editor._drag, null);
    assert.equal(Array.from(editor.timeline.segments, (s) => s.id).join(","), "s0,s1,s2");
    assert.equal(editor.timeline.segments[1].prompt, "prompt1");
    assert.equal(editor.timeline.segments[1].refs[0].imageFile, "ref1.png");
    assert.equal(editor.timeline.segments[1].run, false);
});

test("a click still selects/toggles the split without committing a range change", () => {
    const { editor } = editorFixture();
    editor.onMouseDown(mouse(300));
    editor.onMouseMove(mouse(301));
    editor.onMouseUp();
    assert.equal(editor.selectedSplitFrame, 30);
    assert.equal(editor.commits, 0);
    editor.onMouseDown(mouse(300));
    editor.onMouseUp();
    assert.equal(editor.selectedSplitFrame, null);
    assert.equal(ranges(editor), "0:30,30:30,60:30");
});

test("typed endpoints survive redraw/focus changes and apply atomically", () => {
    const { editor, elements, bar } = editorFixture();
    editor.selectedIndex = 1;
    editor.updateSegmentRangeUI();
    const first = elements.get('[data-r="range-first"]');
    const last = elements.get('[data-r="range-last"]');
    first.value = "41";
    last.value = "66";
    bar.dataset.dirty = "true";
    document.activeElement = last;
    editor.updateSegmentRangeUI();
    assert.equal(first.value, "41");
    document.activeElement = null;
    editor.applySelectedSegmentRange();
    assert.equal(ranges(editor), "0:40,40:26,66:24");
    assert.equal(bar.dataset.dirty, "false");
    assert.equal(first.value, "41");
    assert.equal(last.value, "66");
    assert.equal(editor.commits, 1);
});

test("invalid ranges report an error, retain drafts, and leave source coverage unchanged", () => {
    const { editor, elements, bar } = editorFixture();
    editor.selectedIndex = 1;
    editor.updateSegmentRangeUI();
    elements.get('[data-r="range-first"]').value = "60";
    elements.get('[data-r="range-last"]').value = "61";
    bar.dataset.dirty = "true";
    editor.applySelectedSegmentRange();
    assert.match(elements.get('[data-r="range-error"]').textContent, /range.invalid/);
    assert.equal(editor.commits, 0);
    assert.equal(ranges(editor), "0:30,30:30,60:30");
    editor.selectedIndex = 2;
    editor.updateSegmentRangeUI();
    assert.equal(elements.get('[data-r="range-first"]').value, "61");
    assert.equal(elements.get('[data-r="range-error"]').textContent, "");
    assert.equal(bar.dataset.dirty, "false");
});

test("source endpoint fields are disabled and other director modes hide the range bar", () => {
    const { editor, elements, bar } = editorFixture();
    editor.updateSegmentRangeUI();
    assert.equal(elements.get('[data-r="range-first"]').disabled, true);
    assert.equal(elements.get('[data-r="range-last"]').disabled, false);
    for (const mode of ["isFl2vMode", "isGenMode", "isImageBatch"]) {
        editor[mode] = () => true;
        editor.updateSegmentRangeUI();
        assert.equal(bar.hidden, true);
        editor.applySelectedSegmentRange();
        assert.equal(editor.commits, 0);
        editor[mode] = () => false;
    }
});
