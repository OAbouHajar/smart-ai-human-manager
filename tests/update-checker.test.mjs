import test from "node:test";
import assert from "node:assert/strict";
import { createUpdateChecker, isNewerVersion, parseVersion } from "../server/update-checker.mjs";

test("compares stable semantic release versions", () => {
  assert.equal(parseVersion("v1.2.3"), "1.2.3");
  assert.equal(parseVersion("1.2.3"), "1.2.3");
  assert.equal(parseVersion("v1.2.3-beta.1"), "");
  assert.equal(isNewerVersion("1.3.0", "1.2.9"), true);
  assert.equal(isNewerVersion("2.0.0", "1.99.99"), true);
  assert.equal(isNewerVersion("1.2.3", "1.2.3"), false);
  assert.equal(isNewerVersion("1.2.2", "1.2.3"), false);
});

test("checks GitHub releases once per cache interval", async () => {
  let cache;
  let requests = 0;
  let time = 1_000_000;
  const checker = createUpdateChecker({
    currentVersion: "0.3.0",
    releaseUrl: "https://example.test/releases/latest",
    readCache: () => cache,
    writeCache: (value) => { cache = value; },
    now: () => time,
    checkIntervalMs: 1000,
    fetchImpl: async () => {
      requests++;
      return new Response(JSON.stringify({
        tag_name: "v0.4.0",
        html_url: "https://github.com/OAbouHajar/context-workspace/releases/tag/v0.4.0",
        published_at: "2026-08-18T08:00:00Z"
      }), { status: 200 });
    }
  });

  const first = await checker.check();
  assert.equal(first.currentVersion, "0.3.0");
  assert.equal(first.latestVersion, "0.4.0");
  assert.equal(first.updateAvailable, true);
  assert.equal(first.releaseUrl, "https://github.com/OAbouHajar/context-workspace/releases/tag/v0.4.0");
  assert.equal(requests, 1);

  await checker.check();
  assert.equal(requests, 1);

  time += 1001;
  await checker.check();
  assert.equal(requests, 2);
});

test("surfaces release-check failures without hiding cached update data", async () => {
  let cache = {
    latestVersion: "0.4.0",
    releaseUrl: "https://example.test/releases/v0.4.0",
    checkedAt: 100
  };
  const checker = createUpdateChecker({
    currentVersion: "0.3.0",
    releaseUrl: "https://example.test/releases/latest",
    readCache: () => cache,
    writeCache: (value) => { cache = value; },
    now: () => 200,
    checkIntervalMs: 1,
    fetchImpl: async () => new Response("", { status: 503 })
  });

  const status = await checker.check();
  assert.equal(status.updateAvailable, true);
  assert.match(status.error, /HTTP 503/);
});

test("does not contact GitHub when update checks are disabled", async () => {
  let requested = false;
  const checker = createUpdateChecker({
    currentVersion: "0.3.0",
    releaseUrl: "https://example.test/releases/latest",
    enabled: false,
    fetchImpl: async () => {
      requested = true;
      return new Response();
    }
  });

  const status = await checker.check({ force: true });
  assert.equal(status.enabled, false);
  assert.equal(status.updateAvailable, false);
  assert.equal(requested, false);
});
