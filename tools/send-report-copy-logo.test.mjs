import assert from 'node:assert/strict';
import { readPngResponseBytes } from '../supabase/functions/send-report-copy/report-logo.mjs';

const pngSignature = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
const validResponse = await readPngResponseBytes(new Response(pngSignature, {
  status: 200,
  headers: { 'content-type': 'image/png' },
}));
assert.deepEqual(validResponse, pngSignature, 'a PNG response with the valid signature should be returned');

const htmlResponse = await readPngResponseBytes(new Response('<html>not an image</html>', {
  status: 200,
  headers: { 'content-type': 'text/html' },
}));
assert.equal(htmlResponse, null, 'a successful non-PNG response should be rejected');

const failedResponse = await readPngResponseBytes(new Response(pngSignature, { status: 503 }));
assert.equal(failedResponse, null, 'a failed HTTP response should be rejected');

let chunksProduced = 0;
let streamCancelled = false;
const oversizedStream = new ReadableStream({
  pull(controller) {
    chunksProduced += 1;
    controller.enqueue(new Uint8Array(8));
  },
  cancel() {
    streamCancelled = true;
  },
});
const oversizedResponse = await readPngResponseBytes(new Response(oversizedStream), 8);
assert.equal(oversizedResponse, null, 'a body exceeding the byte limit should be rejected');
assert.equal(streamCancelled, true, 'reading should stop once the streamed body exceeds the limit');
assert.ok(chunksProduced <= 3, 'the body must be rejected without consuming it all');

console.log('send-report-copy logo response tests: passed (bounded streaming; no email sent)');
