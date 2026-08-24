const DEFAULT_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_FAILURE_RETRY_MS = 60 * 60 * 1000;

export function createUpdateChecker({
  currentVersion,
  releaseUrl,
  enabled = true,
  readCache = () => null,
  writeCache = () => {},
  fetchImpl = fetch,
  now = Date.now,
  checkIntervalMs = DEFAULT_CHECK_INTERVAL_MS,
  failureRetryMs = DEFAULT_FAILURE_RETRY_MS,
  timeoutMs = 2500
}) {
  let pendingCheck;

  function cachedStatus() {
    const cached = readCache();
    return normalizeStatus(cached, currentVersion, enabled);
  }

  function isStale(status) {
    if (!status.checkedAt) return true;
    const maxAge = status.error ? failureRetryMs : checkIntervalMs;
    return now() - status.checkedAt >= maxAge;
  }

  async function check({ force = false } = {}) {
    const cached = cachedStatus();
    if (!enabled || (!force && !isStale(cached))) return cached;
    if (pendingCheck) return pendingCheck;

    pendingCheck = fetchLatestRelease()
      .then((status) => {
        writeCache(status);
        return status;
      })
      .finally(() => {
        pendingCheck = undefined;
      });
    return pendingCheck;
  }

  async function fetchLatestRelease() {
    const checkedAt = now();
    try {
      const response = await fetchImpl(releaseUrl, {
        headers: {
          accept: "application/vnd.github+json",
          "x-github-api-version": "2022-11-28",
          "user-agent": `smart-ai-human-manager/${currentVersion}`
        },
        signal: AbortSignal.timeout(timeoutMs)
      });
      if (response.status === 404) {
        return normalizeStatus({ checkedAt }, currentVersion, enabled);
      }
      if (!response.ok) {
        return failureStatus(`GitHub release check failed with HTTP ${response.status}.`, checkedAt);
      }
      const release = await response.json();
      const latestVersion = parseVersion(release.tag_name);
      if (!latestVersion) {
        return failureStatus("The latest GitHub release does not use a valid semantic version tag.", checkedAt);
      }
      const releasePage = validReleasePage(release.html_url, latestVersion);
      if (!releasePage) {
        return failureStatus("The latest GitHub release URL is invalid.", checkedAt);
      }
      return normalizeStatus({
        latestVersion,
        releaseUrl: releasePage,
        publishedAt: typeof release.published_at === "string" ? release.published_at : "",
        checkedAt
      }, currentVersion, enabled);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown update check error";
      return failureStatus(`Could not check for updates: ${message}`, checkedAt);
    }
  }

  function failureStatus(error, checkedAt) {
    const cached = cachedStatus();
    return normalizeStatus({
      ...cached,
      error,
      checkedAt
    }, currentVersion, enabled);
  }

  return { check, cachedStatus };
}

export function isNewerVersion(candidate, current) {
  const next = versionParts(candidate);
  const installed = versionParts(current);
  if (!next || !installed) return false;
  for (let index = 0; index < 3; index++) {
    if (next[index] !== installed[index]) return next[index] > installed[index];
  }
  return false;
}

export function parseVersion(value) {
  const match = String(value || "").trim().match(/^v?(\d+)\.(\d+)\.(\d+)$/);
  return match ? `${Number(match[1])}.${Number(match[2])}.${Number(match[3])}` : "";
}

function versionParts(value) {
  const parsed = parseVersion(value);
  return parsed ? parsed.split(".").map(Number) : null;
}

function validReleasePage(value, version) {
  try {
    const url = new URL(value);
    const expectedPath = `/OAbouHajar/smart-ai-human-manager/releases/tag/v${version}`;
    return url.protocol === "https:" && url.hostname === "github.com" && url.pathname === expectedPath
      ? url.href
      : "";
  } catch {
    return "";
  }
}

function normalizeStatus(value, currentVersion, enabled) {
  const latestVersion = parseVersion(value?.latestVersion);
  return {
    enabled,
    currentVersion,
    latestVersion: latestVersion || null,
    updateAvailable: enabled && Boolean(latestVersion) && isNewerVersion(latestVersion, currentVersion),
    releaseUrl: typeof value?.releaseUrl === "string" ? value.releaseUrl : "",
    publishedAt: typeof value?.publishedAt === "string" ? value.publishedAt : "",
    checkedAt: Number(value?.checkedAt) || null,
    error: typeof value?.error === "string" ? value.error : ""
  };
}
