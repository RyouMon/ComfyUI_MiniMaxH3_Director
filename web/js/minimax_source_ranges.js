/** Stored source ranges use 0-based start + length, without duplicate cut frames. */
export function sourceSegmentFrameRange(segment, totalFrames) {
    const first = segment.start + 1;
    const end = segment.start + segment.length;
    const endInclusive = end === totalFrames;
    const last = end + (endInclusive ? 0 : 1);
    return { first, last, endInclusive, label: `[${first},${last}${endInclusive ? "]" : ")"}` };
}

export function sourceSegmentRangeLimits(segments, index, lockedFrames = [], minLength = 4) {
    const ordered = segments.map((segment, i) => ({ segment, index: i }))
        .sort((a, b) => a.segment.start - b.segment.start);
    const rank = ordered.findIndex((entry) => entry.index === index);
    if (rank < 0) return null;
    const segment = ordered[rank].segment;
    const left = ordered[rank - 1];
    const right = ordered[rank + 1];
    const start = segment.start;
    const end = start + segment.length;
    const locked = new Set(lockedFrames);
    const canStart = !!left && left.segment.start + left.segment.length === start
        && !locked.has(start);
    const canEnd = !!right && right.segment.start === end && !locked.has(end);
    const minStart = canStart ? left.segment.start + minLength : start;
    const maxEnd = canEnd ? right.segment.start + right.segment.length - minLength : end;
    return {
        segment, left, right, start, end, canStart, canEnd,
        firstMin: minStart + 1,
        firstMax: canStart ? maxEnd - minLength + 1 : start + 1,
        lastMin: canEnd ? minStart + minLength : end,
        lastMax: maxEnd,
    };
}

/** Change both ends atomically, retaining all segment data and total source coverage. */
export function setSourceSegmentRange(segments, index, firstFrame, lastFrame, lockedFrames = [], minLength = 4) {
    if (!Number.isInteger(firstFrame) || !Number.isInteger(lastFrame)) return null;
    const limits = sourceSegmentRangeLimits(segments, index, lockedFrames, minLength);
    if (!limits) return null;
    const start = firstFrame - 1;
    const end = lastFrame;
    if (end - start < minLength
        || firstFrame < limits.firstMin || firstFrame > limits.firstMax
        || lastFrame < limits.lastMin || lastFrame > limits.lastMax
        || (!limits.canStart && start !== limits.start)
        || (!limits.canEnd && end !== limits.end)) return null;
    const updated = segments.map((segment) => ({ ...segment }));
    updated[index].start = start;
    updated[index].length = end - start;
    if (limits.canStart) updated[limits.left.index].length = start - limits.left.segment.start;
    if (limits.canEnd) {
        updated[limits.right.index].start = end;
        updated[limits.right.index].length = limits.right.segment.start + limits.right.segment.length - end;
    }
    return updated;
}

/** Drag an interior cut, clamping it so neither adjacent segment becomes too short. */
export function moveSourceSplit(segments, frame, targetFrame, lockedFrames = [], minLength = 4) {
    if (!Number.isFinite(targetFrame)) return null;
    const index = segments.findIndex((segment) => segment.start === frame);
    const limits = sourceSegmentRangeLimits(segments, index, lockedFrames, minLength);
    if (!limits?.canStart) return null;
    const nextFrame = Math.max(limits.firstMin - 1,
        Math.min(limits.end - minLength, Math.round(targetFrame)));
    const updated = setSourceSegmentRange(segments, index, nextFrame + 1, limits.end, lockedFrames, minLength);
    return updated ? { segments: updated, frame: nextFrame, index } : null;
}
