import { Buffer } from 'node:buffer';

/**
 * Streaming parser for RTSP-over-TCP (RFC 2326 §10.12).
 *
 * The TCP byte stream multiplexes two kinds of items:
 *
 *   1. ASCII RTSP messages (requests or responses), terminated by CRLFCRLF.
 *      They may carry a body of `Content-Length` bytes immediately after.
 *   2. Binary interleaved frames: `$<channel:u8><length:u16><payload>`. These
 *      are RTP or RTCP packets tunnelled over the control connection.
 *
 * Items are not separated by framing bytes in between, so after finishing
 * one item the parser must inspect the next byte to decide which mode it's
 * in. This class buffers partial data across feeds and emits whole items
 * only.
 *
 * Concurrency: single-consumer (one TCP socket → one parser). Not safe to
 * call `feed()` concurrently.
 */

const MARKER_DOLLAR = 0x24;
const BINARY_HEADER_LEN = 4;
const HEADERS_TERMINATOR = Buffer.from('\r\n\r\n');
const CONTENT_LENGTH_RE = /^content-length:\s*(\d+)/im;

type ParsedItem = BinaryItem | TextItem;
interface TextItem {
    type: 'text';
    message: Buffer;
}
interface BinaryItem {
    type: 'binary';
    channel: number;
    payload: Buffer;
}

class RtspInterleavedParser {
    private buffer = Buffer.alloc(0);

    /**
     * Append new bytes to the internal buffer and return all complete
     * items that can now be extracted. Remaining partial data stays
     * buffered for the next call.
     */
    feed(chunk: Buffer): ParsedItem[] {
        this.buffer = this.buffer.length === 0 ? Buffer.from(chunk) : Buffer.concat([this.buffer, chunk]);
        const items: ParsedItem[] = [];
        while (true) {
            const item = this.tryExtract();
            if (!item) break;
            items.push(item);
        }
        // Compact: if the buffer still holds references to a large parent
        // chunk, copy the remainder so the original can be GC'd.
        if (this.buffer.byteOffset > 0 && this.buffer.length > 0) {
            this.buffer = Buffer.from(this.buffer);
        }
        return items;
    }

    private tryExtract(): null | ParsedItem {
        if (this.buffer.length === 0) return null;
        if (this.buffer[0] === MARKER_DOLLAR) return this.tryExtractBinary();
        return this.tryExtractText();
    }

    private tryExtractBinary(): BinaryItem | null {
        if (this.buffer.length < BINARY_HEADER_LEN) return null;
        const channel = this.buffer[1];
        const length = this.buffer.readUInt16BE(2);
        const total = BINARY_HEADER_LEN + length;
        if (this.buffer.length < total) return null;
        // Copy the payload so callers can mutate it without corrupting our
        // internal buffer (or the still-unparsed bytes that follow).
        const payload = Buffer.from(this.buffer.subarray(BINARY_HEADER_LEN, total));
        this.buffer = this.buffer.subarray(total);
        return { channel, payload, type: 'binary' };
    }

    private tryExtractText(): null | TextItem {
        const delimIndex = this.buffer.indexOf(HEADERS_TERMINATOR);
        if (delimIndex === -1) return null;
        const headersEnd = delimIndex + HEADERS_TERMINATOR.length;
        const headersText = this.buffer.subarray(0, headersEnd).toString('utf8');
        const contentLength = extractContentLength(headersText);
        const total = headersEnd + contentLength;
        if (this.buffer.length < total) return null;
        const message = Buffer.from(this.buffer.subarray(0, total));
        this.buffer = this.buffer.subarray(total);
        return { message, type: 'text' };
    }
}

const extractContentLength = (headers: string): number => {
    const match = CONTENT_LENGTH_RE.exec(headers);
    if (!match) return 0;
    const n = Number.parseInt(match[1], 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
};

export { type TextItem, type BinaryItem, type ParsedItem, RtspInterleavedParser };
