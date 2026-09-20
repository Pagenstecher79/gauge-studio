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
 * served. That is the twenty seconds this costs, and it is why the whole
 * thing is skipped when there is nothing to put it in front of - and why the
 * restart waits on the URL having actually changed. A build that produced the
 * same bytes has nothing to show the browser it has not already got.
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
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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
  console.log("postbuild: done - a plain reload now gets the build you just made.");
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.log(`postbuild: could not refresh the dev instance (${message}).`);
  console.log("postbuild: the build itself is fine; run `node docker/prepare.mjs` by hand.");
}
