/**
 * Rewrites RTP timestamps for cameras whose firmware sends packets with
 * missing, zero, or otherwise non-monotonic timestamps (e.g. Aqara G410).
 *
 * Two-track algorithm:
 *
 *  1. Wall-clock anchor. Every "new frame" boundary (detected via the RTP
 *     marker bit or a change in the incoming timestamp) produces a candidate
 *     output based on real-time elapsed since the first packet, scaled to
 *     the track's clock rate.
 *
 *  2. Per-codec minimum advance. Audio codecs such as AAC-LC emit fixed-size
 *     frames (1024 samples per packet); if we ever advance the RTP
 *     timestamp by less than the frame size, downstream encoders interpret
 *     the packet as spanning "zero time" and choke ("libopus: Queue input
 *     is backward in time"). So callers pass `minAdvanceTicks` — for audio
 *     that's samples-per-frame; for video it's `clockRate / maxFps` so a
 *     burst of buffered frames still advances by a plausible inter-frame
 *     interval.
 *
 * For each new frame, the output advances by max(wall-clock-delta,
 * minAdvanceTicks). This preserves real-time pacing when packets arrive
 * paced, and preserves content-duration pacing when they arrive in bursts.
 *
 * Frame boundary heuristic: a packet starts a new frame when either the
 * previous packet had its RTP marker bit set, or the incoming timestamp
 * changed. The first signal is the RFC-3550 end-of-frame marker; the second
 * catches cameras that set marker incorrectly but still advance timestamps.
 * For streams like the G410 where incoming timestamps are always zero, the
 * marker bit of any given packet is typically still correct.
 */

interface Clock {
    now(): number;
}

const systemClock: Clock = { now: () => Date.now() };

class RtpTimestampFixer {
    private firstIncoming?: number;
    private firstWallMs?: number;
    private lastOutput = 0;
    private previousIncoming?: number;
    private previousMarker = true;

    constructor(
        private readonly clockRate: number,
        private readonly minAdvanceTicks = 1,
        private readonly clock: Clock = systemClock
    ) {}

    /**
     * Rewrite a single incoming RTP timestamp. Returns the value that should
     * be written back into the outgoing packet's timestamp field.
     *
     * Invariants maintained:
     *  - Output is monotonically non-decreasing across calls.
     *  - Packets that belong to the same frame (same incoming timestamp, no
     *    intervening marker) get the same output timestamp.
     *  - Between new frames, output advances by at least `minAdvanceTicks`.
     */
    fix(incomingTimestamp: number, marker: boolean): number {
        const nowMs = this.clock.now();
        const ts = incomingTimestamp >>> 0;

        if (this.firstWallMs === undefined) {
            this.firstWallMs = nowMs;
            this.firstIncoming = ts;
            this.lastOutput = ts;
            this.previousIncoming = ts;
            this.previousMarker = marker;
            return ts;
        }

        const isNewFrame = this.previousMarker || ts !== this.previousIncoming;

        if (isNewFrame) {
            const elapsedMs = nowMs - this.firstWallMs;
            const tickDelta = Math.trunc((elapsedMs * this.clockRate) / 1000);
            const wallClockCandidate = ((this.firstIncoming ?? 0) + tickDelta) >>> 0;
            const minAdvanceCandidate = (this.lastOutput + this.minAdvanceTicks) >>> 0;
            // Pick whichever is further ahead of lastOutput (wraparound-aware).
            const candidate = this.notAfter(wallClockCandidate, minAdvanceCandidate) ? minAdvanceCandidate : wallClockCandidate;
            this.lastOutput = candidate;
        }

        this.previousIncoming = ts;
        this.previousMarker = marker;
        return this.lastOutput;
    }

    /**
     * Wraparound-safe comparison: returns true iff `a` is not strictly after
     * `b` when both are interpreted as unsigned 32-bit RTP timestamps.
     */
    private notAfter(a: number, b: number): boolean {
        return (a - b) >>> 0 >= 0x80000000 || a === b;
    }
}

export { type Clock, RtpTimestampFixer };
