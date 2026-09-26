/**
 * Put the build that was just made in front of the dev instance.
 *
 * Runs as npm's `postbuild`, so it fires after every `npm run build` without
 * anybody having to remember it. The thing it is remembering for you is a
 * convincing failure: Home Assistant serves `/local/` with a month of
 * `Cache-Control`, so the resource URL carries a hash of the bundle, and a
 * build that does not re-register that URL leaves the browser asking for a
 * URL it already has cached. You rebuild, you reload, and you test last
 * week's card - with everything else about the instance looking new.
 *
 * Re-registering means writing `.storage`, which Home Assistant reads once at
 * startup, so the container has to come round again for the new URL to be
 * served. That is the half minute this costs, and it is why the whole thing
 * is skipped when there is nothing to put it in front of - and why the
 * restart waits on the URL having actually changed. A build that produced the
 * same bytes has nothing to show the browser it has not already got.
 *
 * It then waits for the instance to answer before it says it is done, because
 * the alternative is a lie that costs an afternoon: `docker restart` returns
 * long before Home Assistant is listening, and a reload into that window
 * looks exactly like a build that did not take.
 *
 * Three ways to do nothing, all of them quiet:
 *   - no `.storage` to write into (a fresh clone, and CI)
 *   - no container of that name running (you are only building)
 *   - `SKIP_HA_SYNC=1` (you know better this once)
 *
 * It must never fail a build. A build is also how the release workflow ships,
 * and a broken dev convenience has no business stopping that, so every exit
 * here is 0 and every error is a line of prose.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { onRemote, pullFrom, pushTo, readRemote } from "./remote.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const CONTAINER = "gauge-studio-ha";
const RESOURCES = join(here, "config", ".storage", "lovelace_resources");

/** @param {string} why */
const skip = (why) => { console.log(`postbuild: ${why}`); process.exit(0); };

if (process.env.SKIP_HA_SYNC) skip("SKIP_HA_SYNC is set, leaving the instance alone.");
if (!existsSync(RESOURCES)) skip("no dev instance has been set up here, nothing to refresh.");

/**
 * The card's registered URL, hash and all, or null if it cannot be read.
 * A file being rewritten underneath us reads as null, which means "restart
 * anyway" - the cheap answer to not knowing is the one that cannot leave a
 * stale bundle on screen.
 *
 * @returns {string | null}
 */
function registeredUrl() {
  try {
    const store = JSON.parse(readFileSync(RESOURCES, "utf8"));
    const items = store?.data?.items ?? [];
    const ours = items.find((/** @type {any} */ item) =>
      typeof item?.url === "string" && item.url.includes("gauge-studio.js"));
    return ours ? ours.url : null;
  } catch {
    return null;
  }
}

/**
 * Whether the container is up. `docker` missing, or a daemon that is not
 * running, both answer no - neither is an error worth a red build.
 *
 * @returns {boolean}
 */
function containerRunning() {
  try {
    const out = execFileSync("docker", ["ps", "--filter", `name=^${CONTAINER}$`, "--format", "{{.Names}}"],
                             { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return out.trim() === CONTAINER;
  } catch {
    return false;
  }
}

/**
 * Wait until the restarted instance actually serves the bundle again.
 *
 * `docker restart` returns when the process has been started, not when Home
 * Assistant is listening - that takes another twenty to forty seconds. Saying
 * "done" at the first of those two moments is worse than saying nothing: you
 * reload into a dead port, the browser shows you whatever it can, and the
 * conclusion you draw is that the build did not take.
 *
 * The probe asks for the resource URL itself rather than the front page,
 * because that is the thing that has to be right - a 200 on it means both
 * that Home Assistant is up and that it is serving this build.
 *
 * @param {string | null} url the registered resource URL, or null if unknown
 * @returns {Promise<boolean>} false if it never answered in time
 */
async function waitForHa(url, base = "http://localhost:8123") {
  const deadline = Date.now() + 90_000;
  const target = `${base}${url ?? "/local/gauge-studio.js"}`;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(target, { method: "HEAD" });
      if (res.ok) return true;
    } catch {
      // Connection refused while it boots, which is the normal case here.
    }
    await sleep(1000);
  }
  return false;
}

/**
 * The same job against an instance on another host (see remote.mjs).
 *
 * The bundle goes over first and unconditionally: with `npm run watch` the
 * file under /local/ is what a hard refresh picks up, restart or not. The
 * resource store then makes a round trip through the local `.storage`, so
 * prepare.mjs stays the one place that knows how the entry is written - and
 * only that one file goes back, because the dashboards on the host are the
 * ones being edited there, and the local copies are not.
 *
 * @param {import("./remote.mjs").Remote} remote
 */
async function refreshRemote(remote) {
  try {
    onRemote(remote, "orb status | grep -q Running || orb start");
    const running = onRemote(remote,
      `docker ps --filter name=^${CONTAINER}$ --format '{{.Names}}'`).trim() === CONTAINER;
    pushTo(remote, join(here, "..", "dist") + "/", "dist/", ["--delete"]);
    if (!running) skip(`${CONTAINER} is not running on ${remote.ssh}; the bundle is there, the resource as it was.`);
    pullFrom(remote, "docker/config/.storage/lovelace_resources", RESOURCES);
    const before = registeredUrl();
    execFileSync("node", [join(here, "prepare.mjs")], { stdio: "inherit", env: { ...process.env, GS_STAGING: "1" } });
    const after = registeredUrl();
    if (before && after && before === after) {
      skip(`the bundle is byte for byte the one already registered on ${remote.ssh}, no restart needed.`);
    }
    pushTo(remote, RESOURCES, "docker/config/.storage/lovelace_resources");
    console.log(`postbuild: restarting ${CONTAINER} on ${remote.ssh} so it serves the new URL...`);
    onRemote(remote, `docker restart ${CONTAINER} >/dev/null`);
    const up = await waitForHa(after ?? before, remote.url);
    console.log(up
      ? `postbuild: done - a plain reload of ${remote.url} now gets the build you just made.`
      : `postbuild: restarted, but ${CONTAINER} on ${remote.ssh} has not answered yet - give it a moment.`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.log(`postbuild: could not refresh the instance on ${remote.ssh} (${message.split("\n")[0]}).`);
    console.log("postbuild: the build itself is fine.");
  }
  process.exit(0);
}

const remote = readRemote();
if (remote) await refreshRemote(remote);

if (!containerRunning()) skip(`${CONTAINER} is not running, leaving the resource as it is.`);

try {
  // prepare.mjs is the one place that knows how the resource is registered,
  // and it is idempotent - it keeps a dashboard that already exists.
  const before = registeredUrl();
  execFileSync("node", [join(here, "prepare.mjs")], { stdio: "inherit" });
  const after = registeredUrl();
  if (before && after && before === after) {
    skip("the bundle is byte for byte the one already registered, no restart needed.");
  }
  console.log(`postbuild: restarting ${CONTAINER} so it serves the new URL...`);
  execFileSync("docker", ["restart", CONTAINER], { stdio: ["ignore", "ignore", "inherit"] });
  const up = await waitForHa(after ?? before);
  console.log(up
    ? "postbuild: done - a plain reload now gets the build you just made."
    : `postbuild: restarted, but ${CONTAINER} has not answered yet - give it a moment before reloading.`);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.log(`postbuild: could not refresh the dev instance (${message}).`);
  console.log("postbuild: the build itself is fine; run `node docker/prepare.mjs` by hand.");
}
