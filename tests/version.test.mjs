import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("package, plugin, marketplace, and installers stay aligned", async () => {
  const [packageJson, pluginJson, marketplaceJson, macInstaller, windowsInstaller, macUninstaller, windowsUninstaller] = await Promise.all([
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../plugin.json", import.meta.url), "utf8"),
    readFile(new URL("../.github/plugin/marketplace.json", import.meta.url), "utf8"),
    readFile(new URL("../scripts/install.sh", import.meta.url), "utf8"),
    readFile(new URL("../scripts/install.ps1", import.meta.url), "utf8"),
    readFile(new URL("../scripts/uninstall.sh", import.meta.url), "utf8"),
    readFile(new URL("../scripts/uninstall.ps1", import.meta.url), "utf8")
  ]);
  const packageVersion = JSON.parse(packageJson).version;
  const pluginVersion = JSON.parse(pluginJson).version;
  const marketplace = JSON.parse(marketplaceJson);
  assert.match(packageVersion, /^\d+\.\d+\.\d+$/);
  assert.equal(pluginVersion, packageVersion);
  assert.equal(marketplace.metadata.version, packageVersion);
  assert.equal(marketplace.plugins[0].version, packageVersion);
  assert.equal(JSON.parse(pluginJson).name, "cw");
  assert.equal(marketplace.name, "context-workspace");
  assert.equal(marketplace.plugins[0].name, "cw");
  assert.equal(marketplace.plugins[0].source, ".");
  assert.equal(marketplace.plugins[1].name, "sham");
  assert.equal(marketplace.plugins[1].source, "./compat/sham");
  assert.match(macInstaller, /plugin marketplace add "\$INSTALL_ROOT"/);
  assert.match(windowsInstaller, /plugin marketplace add \$InstallRoot/);
  assert.ok(
    macInstaller.indexOf("plugin uninstall sham") <
      macInstaller.indexOf("plugin marketplace remove context-workspace")
  );
  assert.ok(
    macInstaller.indexOf("plugin uninstall sam") <
      macInstaller.indexOf("plugin marketplace remove ai-session-hub")
  );
  assert.ok(
    macInstaller.indexOf("plugin uninstall copilot-session-hub") <
      macInstaller.indexOf("plugin marketplace remove ai-session-hub")
  );
  assert.ok(
    windowsInstaller.indexOf("plugin uninstall sham") <
      windowsInstaller.indexOf("plugin marketplace remove context-workspace")
  );
  assert.ok(
    windowsInstaller.indexOf("plugin uninstall sam") <
      windowsInstaller.indexOf("plugin marketplace remove ai-session-hub")
  );
  assert.ok(
    windowsInstaller.indexOf("plugin uninstall copilot-session-hub") <
      windowsInstaller.indexOf("plugin marketplace remove ai-session-hub")
  );
  assert.match(macInstaller, /plugin install cw@context-workspace/);
  assert.match(windowsInstaller, /plugin install cw@context-workspace/);
  assert.match(macInstaller, /plugin install sham@context-workspace/);
  assert.match(windowsInstaller, /plugin install sham@context-workspace/);
  assert.match(macInstaller, /cp "\$INSTALL_ROOT\/scripts\/project-share\.mjs" "\$COMPAT_ROOT\/scripts\/project-share\.mjs"/);
  assert.match(windowsInstaller, /Copy-Item -LiteralPath \(Join-Path \$InstallRoot "scripts\\project-share\.mjs"\) -Destination \$CompatScripts/);
  assert.doesNotMatch(macInstaller, /plugin marketplace add OAbouHajar/);
  assert.doesNotMatch(windowsInstaller, /plugin marketplace add OAbouHajar/);
  assert.match(macInstaller, /rm -rf "\$INSTALL_ROOT\/commands"/);
  assert.match(windowsInstaller, /Remove-Item -LiteralPath \(Join-Path \$InstallRoot "commands"\) -Recurse/);
  assert.match(macInstaller, /LEGACY_INSTALL_ROOTS=/);
  assert.ok(macInstaller.lastIndexOf('rm -rf "$legacy_install_root"') > macInstaller.indexOf('if [[ "$HEALTHY"'));
  assert.match(windowsInstaller, /LegacyInstallRoots/);
  assert.ok(windowsInstaller.lastIndexOf("Remove-Item -LiteralPath $Path") > windowsInstaller.indexOf("if (-not $Healthy)"));
  for (const uninstaller of [macUninstaller, windowsUninstaller]) {
    assert.match(uninstaller, /plugin uninstall cw/);
    assert.match(uninstaller, /plugin uninstall sham/);
    assert.match(uninstaller, /plugin uninstall sam/);
    assert.match(uninstaller, /plugin uninstall copilot-session-hub/);
    assert.match(uninstaller, /plugin marketplace remove context-workspace/);
    assert.match(uninstaller, /plugin marketplace remove ai-session-hub/);
  }
});
