// Node child-process stdin is a pipe on Windows. Consume it asynchronously;
// synchronous fd reads are not portable across process launchers.
export async function readSecretInput(input: AsyncIterable<Uint8Array> = process.stdin): Promise<string> {
  const chunks: Buffer[] = []
  let length = 0
  for await (const chunk of input) {
    length += chunk.byteLength
    if (length > 16384) throw new Error('invalid_secret_input')
    chunks.push(Buffer.from(chunk))
  }
  return Buffer.concat(chunks).toString('utf8').trim()
}
