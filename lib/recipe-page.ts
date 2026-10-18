import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { isIP } from "node:net";
export function publicIPv4(ip: string) {
  if (isIP(ip) !== 4) return false;
  const [a, b] = ip.split(".").map(Number);
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || b === 0)) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 198 && (b === 18 || b === 19))
  );
}
export function validRecipeUrl(value: string) {
  try {
    const u = new URL(value),
      host = u.hostname.toLowerCase();
    return (
      u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      !u.port &&
      host.includes(".") &&
      !host.endsWith(".local") &&
      !host.endsWith(".localhost") &&
      (!isIP(host) || publicIPv4(host))
    );
  } catch {
    return false;
  }
}
export async function recipePage(
  value: string,
  redirects = 0,
): Promise<string> {
  if (!validRecipeUrl(value) || redirects > 3)
    throw new Error("Recipe URL is not a public HTTPS page.");
  const url = new URL(value);
  // Pin a validated public IPv4 address to prevent redirects or DNS rebinding into private networks.
  const addresses = await lookup(url.hostname, { all: true, family: 4 });
  if (!addresses.length || addresses.some((a) => !publicIPv4(a.address)))
    throw new Error("Recipe host resolved to a private address.");
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        family: 4,
        lookup: (_host, _options, cb) => cb(null, addresses[0].address, 4),
        headers: {
          "User-Agent": "SupperClub/1.0 recipe reader",
          "Accept-Encoding": "identity",
        },
      },
      (res) => {
        if (
          [301, 302, 303, 307, 308].includes(res.statusCode || 0) &&
          res.headers.location
        ) {
          res.resume();
          clearTimeout(timer);
          recipePage(
            new URL(res.headers.location, url).href,
            redirects + 1,
          ).then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error("Could not open recipe source."));
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > 2500000) req.destroy(new Error("Recipe page too large"));
          else chunks.push(chunk);
        });
        res.on("end", () => {
          clearTimeout(timer);
          resolve(Buffer.concat(chunks).toString("utf8"));
        });
        res.on("error", reject);
      },
    );
    const timer = setTimeout(
      () => req.destroy(new Error("Recipe source timed out")),
      15000,
    );
    req.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    req.on("close", () => clearTimeout(timer));
    req.end();
  });
}
