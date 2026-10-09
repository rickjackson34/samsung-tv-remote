// Stops other websites from driving the TV through the bridge. A page on any
// site can send requests to a LAN address, so API requests must:
//   - name the bridge by IP address, localhost, or a .local name (blocks DNS rebinding),
//   - come from the bridge's own page when the browser says where they came from, and
//   - send JSON, which browsers won't do cross-site without a CORS preflight we never approve.

function hostname(host) {
  const h = String(host ?? "").toLowerCase();
  if (h.startsWith("[")) return h.slice(0, h.indexOf("]") + 1);
  return h.split(":")[0];
}

export function isAllowedHost(host, extraHosts = []) {
  const name = hostname(host);
  if (!name) return false;
  return (
    /^\d{1,3}(\.\d{1,3}){3}$/.test(name) ||
    name.startsWith("[") ||
    name === "localhost" ||
    name.endsWith(".local") ||
    extraHosts.includes(name)
  );
}

// Returns null when the request is allowed, or a reason it was rejected.
export function rejectApiRequest({ method, headers }, extraHosts = []) {
  if (!isAllowedHost(headers.host, extraHosts)) {
    return "Open the remote using the computer's IP address. To use a hostname, add it to ALLOWED_HOSTS.";
  }
  if (headers.origin !== undefined) {
    let originHost;
    try {
      originHost = new URL(headers.origin).host;
    } catch {
      return "Requests from other websites aren't allowed.";
    }
    if (originHost.toLowerCase() !== String(headers.host).toLowerCase()) {
      return "Requests from other websites aren't allowed.";
    }
  }
  if (headers["sec-fetch-site"] === "cross-site") return "Requests from other websites aren't allowed.";
  if (method === "POST" && !/^application\/json\b/i.test(headers["content-type"] ?? "")) {
    return "Requests must be sent as JSON.";
  }
  return null;
}
