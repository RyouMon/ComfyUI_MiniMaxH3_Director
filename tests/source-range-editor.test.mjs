import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const helperSource = await readFile(new URL("../web/js/minimax_source_ranges.js", import.meta.url), "utf8");
const helpers = await import(`data:text/javascript;base64,${Buffer.from(helperSource).toString("base64")}`);
const i18nSource = await readFile(new URL("../web/js/minimax_i18n.js", import.meta.url), "utf8");
const i18n = await import(`data:text/javascript;base64,${Buffer.from(i18nSource).toString("base64")}`);
i18n.setLocale("zh");
const timelineSource = await readFile(new URL("../web/js/minimax_timeline.js", import.meta.url), "utf8");
const classStart = timelineSource.indexOf("class MiniMaxH3DirectorEditor {");
const classEnd = timelineSource.indexOf("\nfunction ", classStart);
assert.ok(classStart >= 0 && classEnd > classStart);
const document = { activeElement: null };
const Editor = vm.runInNewContext(`${timelineSource.slice(classStart, classEnd)}\nMiniMaxH3DirectorEditor;`, {
    ...helpers, document, MIN_SEG: 4, HANDLE_PX: 14, RULER_H: 24, TRACK_Y: 44, TRACK_H: 160,
    stopDomEvent() {}, clamp: (value, min, max) => Math.max(min, Math.min(max, value)),
    t: i18n.t, resolveTaskKey: (key) => key,
    taskUsesReferenceVideo: () => false, taskUsesReferenceImages: () => false,
    taskUsesReferenceAudios: () => false,
});

function editorFixture() {
    const elements = new Map();
    for (const name of ["split-edit-hint"]) {
        elements.set(`[data-r="${name}"]`, { value: "", textContent: "", disabled: false });
    }
    elements.set('[data-a="del-split"]', { disabled: false });
    const splitBar = { classList: { toggle() {}, add() {} } };
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
        seekBar: { value: 0 }, boundsEl: { textContent: "" }, segInfo: { textContent: "" },
        getFrameRate: () => 24, getTaskKey: () => "rv2v", getVideoClips: () => [],
        isFl2vMode: () => false, isGenMode: () => false, isImageBatch: () => false,
        isR2vBatch: () => false, isGlobalMode: () => true,
        usesBatchTimeline: () => false, needsSourceVideoUpload: () => false,
        isRunSelectEnabled: () => false, _showsContinuityJoints: () => false,
        getLayoutWidth: () => 900, getTotalFrames: () => 90, getClipBoundaries: () => [0, 90],
        frameToX: (frame) => frame * 10, xToFrame: (x) => Math.round(x / 10),
        getMousePos: (e) => ({ x: e.x, y: e.y }),
        scheduleRender() {}, updateOutputPreview() {}, setSmartSplitMessage() {},
        updateSegmentContinuityUI() {},
        updateSelectionUI() { this._updateSegInfoFromSegment(this.timeline.segments[this.selectedIndex]); },
        _updateTimelineDom() { this.updateSplitPointUI(); },
        commit() { this.commits++; this.normalizeSegments(); this.updateSelectionUI(); },
    });
    return { editor, elements };
}

function mouse(x) { return { button: 0, x, y: 180, preventDefault() {} }; }
function ranges(editor) { return Array.from(editor.timeline.segments, (s) => `${s.start}:${s.length}`).join(","); }

test("the real split mouse handlers preview and commit without deleting either segment", () => {
    const { editor } = editorFixture();
    assert.equal(editor.hitTest(300, 180).type, "split");
    editor.onMouseDown(mouse(300));
    assert.equal(editor._drag.kind, "split");
    editor.onMouseMove(mouse(420));
    assert.equal(ranges(editor), "0:30,30:30,60:30", "drag is still a preview");
    assert.equal(editor.selectedSplitFrame, 42);
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

test("source metadata states which cut frame is excluded and includes the final frame", () => {
    const { editor } = editorFixture();
    editor.isGlobalMode = () => false;
    editor._updateSegInfoFromSegment(editor.timeline.segments[0]);
    assert.match(editor.segInfo.textContent, /\[1,31\).*包含第1帧，不包含第31帧.*30f/);
    editor._updateSegInfoFromSegment(editor.timeline.segments[2]);
    assert.match(editor.segInfo.textContent, /\[61,90\].*包含第61帧，包含第90帧.*30f/);
});

test("dragging refreshes metadata to match the new boundary without changing coverage", () => {
    const { editor } = editorFixture();
    editor.isGlobalMode = () => false;
    editor.onMouseDown(mouse(300));
    editor.onMouseMove(mouse(420));
    assert.match(editor.segInfo.textContent, /\[43,61\).*包含第43帧，不包含第61帧.*18f/);
    editor.onMouseUp();
    assert.match(editor.segInfo.textContent, /\[43,61\).*18f/);
    assert.equal(ranges(editor), "0:42,42:18,60:30");
    editor._updateSegInfoFromSegment(editor.timeline.segments[0]);
    assert.match(editor.segInfo.textContent, /\[1,43\).*不包含第43帧.*42f/);
});
