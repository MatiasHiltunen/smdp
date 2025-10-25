import assert from "node:assert/strict";
import test from "node:test";

import { parseRoute } from "../src/client/routing";

type StubLocation = {
  pathname: string;
  search?: string;
  hash?: string;
};

const location = (pathname: string, overrides: Omit<StubLocation, "pathname"> = {}): StubLocation => ({
  pathname,
  search: "",
  hash: "",
  ...overrides,
});

test("shared embeds accept external markdown URLs", () => {
  const route = parseRoute(location("/shared/https://example.com/foo.md"));
  assert.equal(route.mode, "html");
  assert.equal(route.shared, true);
  assert.equal(route.dataPayload, null);
  assert.equal(route.dataFormat, "legacy");
  assert.equal(route.dataEncoding, null);
  assert.equal(route.externalUrl?.href, "https://example.com/foo.md");
});

test("shared route without payload hides editor but uses default content", () => {
  const route = parseRoute(location("/shared"));
  assert.equal(route.mode, "html");
  assert.equal(route.shared, true);
  assert.equal(route.externalUrl, null);
  assert.equal(route.dataPayload, null);
  assert.equal(route.dataFormat, "legacy");
  assert.equal(route.dataEncoding, null);
});

test("data routes surface base64 payloads", () => {
  const payload = "YWJj"; // "abc"
  const route = parseRoute(location(`/data/${payload}`));
  assert.equal(route.shared, true);
  assert.equal(route.mode, "html");
  assert.equal(route.externalUrl, null);
  assert.equal(route.dataPayload, payload);
  assert.equal(route.dataFormat, "legacy");
  assert.equal(route.dataEncoding, "base64");
});

test("data routes accept fragment payloads", () => {
  const payload = "fragmentPayload";
  const route = parseRoute(location("/data", { hash: `#${payload}` }));
  assert.equal(route.shared, true);
  assert.equal(route.mode, "html");
  assert.equal(route.externalUrl, null);
  assert.equal(route.dataPayload, payload);
  assert.equal(route.dataFormat, "binary");
  assert.equal(route.dataEncoding, "base64");
});

test("data79 routes mark binary payloads", () => {
  const payload = "XYZ";
  const route = parseRoute(location(`/data79/${payload}`));
  assert.equal(route.shared, true);
  assert.equal(route.mode, "html");
  assert.equal(route.externalUrl, null);
  assert.equal(route.dataPayload, payload);
  assert.equal(route.dataFormat, "binary");
  assert.equal(route.dataEncoding, "base79");
});

test("edit/data79 route keeps editor enabled", () => {
  const payload = "XYZ";
  const route = parseRoute(location(`/edit/data79/${payload}`));
  assert.equal(route.shared, false);
  assert.equal(route.mode, "html");
  assert.equal(route.dataPayload, payload);
  assert.equal(route.dataFormat, "binary");
  assert.equal(route.dataEncoding, "base79");
});

test("edit/data route keeps editor enabled for legacy payloads", () => {
  const payload = "YWJj";
  const route = parseRoute(location(`/edit/data/${payload}`));
  assert.equal(route.shared, false);
  assert.equal(route.mode, "html");
  assert.equal(route.dataPayload, payload);
  assert.equal(route.dataFormat, "legacy");
  assert.equal(route.dataEncoding, "base64");
});

test("edit/data route accepts fragment payloads", () => {
  const payload = "editFragment";
  const route = parseRoute(location("/edit/data", { hash: `#${payload}` }));
  assert.equal(route.shared, false);
  assert.equal(route.mode, "html");
  assert.equal(route.dataPayload, payload);
  assert.equal(route.dataFormat, "binary");
  assert.equal(route.dataEncoding, "base64");
});

test("canvas routes select canvas renderer and optional external URL", () => {
  const route = parseRoute(location("/canvas/https://cdn.example.org/doc.md"));
  assert.equal(route.mode, "canvas");
  assert.equal(route.shared, false);
  assert.equal(route.dataPayload, null);
  assert.equal(route.dataFormat, "legacy");
  assert.equal(route.dataEncoding, null);
  assert.equal(route.externalUrl?.href, "https://cdn.example.org/doc.md");
});

test("html routes prefer html renderer even when suffix provided", () => {
  const route = parseRoute(location("/html/https://gist.github.com/example"));
  assert.equal(route.mode, "html");
  assert.equal(route.shared, false);
  assert.equal(route.dataFormat, "legacy");
  assert.equal(route.dataEncoding, null);
  assert.equal(route.externalUrl?.href, "https://gist.github.com/example");
});

test("root path loads default html view", () => {
  const route = parseRoute(location("/"));
  assert.equal(route.mode, "html");
  assert.equal(route.shared, false);
  assert.equal(route.externalUrl, null);
  assert.equal(route.dataPayload, null);
  assert.equal(route.dataFormat, "legacy");
  assert.equal(route.dataEncoding, null);
});

test("fallback treats remaining path as external url when parsable", () => {
  const route = parseRoute(location("/https://example.com/notes.md"));
  assert.equal(route.mode, "html");
  assert.equal(route.shared, false);
  assert.equal(route.dataPayload, null);
  assert.equal(route.dataFormat, "legacy");
  assert.equal(route.dataEncoding, null);
  assert.equal(route.externalUrl?.href, "https://example.com/notes.md");
});

test("fallback gracefully handles invalid external url fragments", () => {
  const route = parseRoute(location("/foo/bar"));
  assert.equal(route.mode, "html");
  assert.equal(route.externalUrl, null);
  assert.equal(route.shared, false);
  assert.equal(route.dataPayload, null);
  assert.equal(route.dataFormat, "legacy");
  assert.equal(route.dataEncoding, null);
});

test("percent-encoded paths decode before routing", () => {
  const route = parseRoute(location("/shared/https%3A%2F%2Fexample.com%2Fencoded%2520path.md"));
  assert.equal(route.mode, "html");
  assert.equal(route.shared, true);
  assert.equal(route.dataFormat, "legacy");
  assert.equal(route.dataEncoding, null);
  assert.equal(route.externalUrl?.href, "https://example.com/encoded%20path.md");
});
