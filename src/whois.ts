import { connect } from "cloudflare:sockets";
import { ResponseTooLargeError } from "./errors";

const MAX_RESPONSE_SIZE = 2 * 1024 * 1024; // 2 MiB

// queryWhois opens a TCP connection to the WHOIS server and sends the query.
// Throws on connection failure, timeout, or oversized response — callers are
// responsible for catching these so the worker keeps running.
export async function queryWhois(
  server: string,
  query: string,
  timeoutMs: number
): Promise<string> {
  // Ensure host:port format
  const host = server.includes(":") ? server.split(":")[0] : server;
  const portStr = server.includes(":") ? server.split(":")[1] : "43";
  const port = parseInt(portStr, 10);

  const socket = connect({ hostname: host, port });

  const writer = socket.writable.getWriter();
  await writer.write(new TextEncoder().encode(`${query}\r\n`));
  await writer.close();

  const reader = socket.readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  const deadline = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("WHOIS query timed out")), timeoutMs)
  );

  try {
    while (true) {
      const { value, done } = await Promise.race([
        reader.read(),
        deadline.then(() => {
          throw new Error("WHOIS query timed out");
        }),
      ]);
      if (done) break;
      if (value) {
        total += value.length;
        if (total > MAX_RESPONSE_SIZE) {
          throw new ResponseTooLargeError(server);
        }
        chunks.push(value);
      }
    }
  } finally {
    reader.releaseLock();
    // Close the socket; ignore errors from already-closed sockets
    socket.close().catch(() => {});
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.length;
  }
  return new TextDecoder().decode(merged);
}
