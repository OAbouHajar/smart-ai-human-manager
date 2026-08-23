import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("package, plugin, marketplace, and installers stay aligned", async () => {
  const [packageJson, pluginJson, marketplaceJson, macInstaller, windowsInstaller] = await Promise.all([
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../plugin.json", import.meta.url), "utf8"),
    readFile(new URL("../.github/plugin/marketplace.json", import.meta.url), "utf8"),
    readFile(new URL("../scripts/install.sh", import.meta.url), "utf8"),
    readFile(new URL("../scripts/install.ps1", import.meta.url), "utf8")
  ]);
  const packageVersion = JSON.parse(packageJson).version;
  const pluginVersion = JSON.parse(pluginJson).version;
  const marketplace = JSON.parse(marketplaceJson);
  assert.match(packageVersion, /^\d+\.\d+\.\d+$/);
  assert.equal(pluginVersion, packageVersion);
  assert.equal(marketplace.metadata.version, packageVersion);
  assert.equal(marketplace.plugins[0].version, packageVersion);
  assert.equal(marketplace.plugins[0].name, "copilot-session-hub");
  assert.equal(marketplace.plugins[0].source, ".");
  assert.match(macInstaller, /plugin marketplace add "\$INSTALL_ROOT"/);
  assert.match(windowsInstaller, /plugin marketplace add \$InstallRoot/);
  assert.ok(
    macInstaller.indexOf("plugin uninstall copilot-session-hub") <
      macInstaller.indexOf("plugin marketplace remove ai-session-hub")
  );
  assert.ok(
    windowsInstaller.indexOf("plugin uninstall copilot-session-hub") <
      windowsInstaller.indexOf("plugin marketplace remove ai-session-hub")
  );
  assert.doesNotMatch(macInstaller, /plugin marketplace add OAbouHajar/);
  assert.doesNotMatch(windowsInstaller, /plugin marketplace add OAbouHajar/);
  for (const command of ["do", "handoff", "next", "plan", "project", "reopen", "sync", "update", "wrap"]) {
    assert.match(macInstaller, new RegExp(`sesh-${command}\\.md`));
    assert.match(windowsInstaller, new RegExp(`sesh-${command}\\.md`));
  }
});
