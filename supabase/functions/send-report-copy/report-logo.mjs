const PNG_SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])

export async function readPngResponseBytes(response, maxBytes = 1024 * 1024) {
  if (!response?.ok || !Number.isInteger(maxBytes) || maxBytes < PNG_SIGNATURE.length) return null

  const contentLength = response.headers?.get('content-length') || ''
  if (/^\d+$/.test(contentLength) && Number(contentLength) > maxBytes) {
    try { await response.body?.cancel() } catch { /* best-effort cancellation */ }
    return null
  }

  const reader = response.body?.getReader()
  if (!reader) return null
  const chunks = []
  let totalBytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      totalBytes += value.byteLength
      if (totalBytes > maxBytes) {
        try { await reader.cancel() } catch { /* best-effort cancellation */ }
        return null
      }
      chunks.push(value)
    }
  } catch {
    return null
  } finally {
    try { reader.releaseLock() } catch { /* ignore a released or errored reader */ }
  }

  if (totalBytes < PNG_SIGNATURE.length) return null
  const bytes = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  if (!PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)) return null
  return bytes
}
