import assert from "node:assert/strict";
import { test } from "node:test";
import { isAllowedHost, rejectApiRequest } from "../lib/guard.js";

const req = (headers, method = "POST") => ({
  method,
  headers: { host: "192.168.1.23:8080", "content-type": "application/json", ...headers },
});

test("allows the remote's own page", () => {
  assert.equal(rejectApiRequest(req({ origin: "http://192.168.1.23:8080", "sec-fetch-site": "same-origin" })), null);
  assert.equal(rejectApiRequest(req({}, "GET")), null);
});

test("allows clients that send no Origin, like curl", () => {
  assert.equal(rejectApiRequest(req({})), null);
});

test("rejects requests from other websites", () => {
  assert.ok(rejectApiRequest(req({ origin: "https://evil.example" })));
  assert.ok(rejectApiRequest(req({ origin: "null" })));
  assert.ok(rejectApiRequest(req({ "sec-fetch-site": "cross-site" })));
});

test("rejects form and text posts that skip the CORS preflight", () => {
  assert.ok(rejectApiRequest(req({ "content-type": "text/plain" })));
  assert.ok(rejectApiRequest(req({ "content-type": "application/x-www-form-urlencoded" })));
  assert.ok(rejectApiRequest(req({ "content-type": undefined })));
  assert.equal(rejectApiRequest(req({ "content-type": "application/json; charset=utf-8" })), null);
});

test("rejects DNS-rebinding hostnames unless allowed", () => {
  assert.ok(rejectApiRequest(req({ host: "evil.example:8080", origin: "http://evil.example:8080" })));
  assert.equal(
    rejectApiRequest(req({ host: "tvremote.lan:8080", origin: "http://tvremote.lan:8080" }), ["tvremote.lan"]),
    null,
  );
});

test("isAllowedHost accepts IPs, localhost and .local names", () => {
  for (const h of ["192.168.1.23:8080", "10.0.0.5", "localhost:8080", "my-pc.local:8080", "[::1]:8080"]) {
    assert.ok(isAllowedHost(h), h);
  }
  for (const h of ["evil.example", "192.168.1.23.evil.example", "", undefined]) assert.equal(isAllowedHost(h), false, h);
});
