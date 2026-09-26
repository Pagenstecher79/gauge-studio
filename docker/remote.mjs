/**
 * Where the dev instance runs when it is not this machine's Docker.
 *
 * There is one Home Assistant to test against, and it may live on another
 * Mac on the LAN. `docker/.remote` says so - gitignored, because the host is
 * a fact about one desk, not about the project:
 *
 *   { "ssh": "m2", "url": "http://192.168.2.150:8123", "dir": "gauge-studio-ha" }
 *
 * `ssh` is a host from ~/.ssh/config with key authentication (every call runs
 * in BatchMode, so a password prompt fails instead of hanging a build), `dir`
 * is the checkout-shaped folder on that host - `docker/config`,
 * `docker/docker-compose.yml` and `dist` - and `url` is where a browser
 * reaches the instance.
 *
 * With the file present, the build ships `dist/` there and restarts that
 * container, and `npm run ha` refuses to start a local one: two instances
 * split the dashboards, the storage and the resource entry, and a build that
 * works in one and not the other says nothing about the card.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const REMOTE_FILE = join(here, ".remote");

/**
 * @typedef {{ ssh: string, url: string, dir: string }} Remote
 * @returns {Remote | null}
 */
export function readRemote() {
  if (!existsSync(REMOTE_FILE)) return null;
  const raw = JSON.parse(readFileSync(REMOTE_FILE, "utf8"));
  return { ssh: raw.ssh, url: String(raw.url).replace(/\/$/, ""), dir: raw.dir ?? "gauge-studio-ha" };
}

// A non-interactive ssh session does not read the login profile, so the
// Docker and OrbStack CLIs in /usr/local/bin are not on its PATH.
const REMOTE_PATH = "export PATH=/usr/local/bin:/opt/homebrew/bin:$PATH";

/**
 * Run a shell command on the remote host and return its stdout.
 *
 * @param {Remote} remote
 * @param {string} command
 * @param {{ inherit?: boolean }} [opts]
 */
export function onRemote(remote, command, opts = {}) {
  return execFileSync("ssh", ["-o", "BatchMode=yes", "-o", "ConnectTimeout=5", remote.ssh,
                              `${REMOTE_PATH}; cd ${remote.dir} && ${command}`],
                      { encoding: "utf8", stdio: ["ignore", opts.inherit ? "inherit" : "pipe", "inherit"] });
}

/**
 * Copy a local path to the same path under the remote folder.
 *
 * @param {Remote} remote
 * @param {string} local absolute local path; a trailing slash copies the contents
 * @param {string} target path relative to `remote.dir`
 * @param {string[]} [extra] further rsync flags
 */
export function pushTo(remote, local, target, extra = []) {
  execFileSync("rsync", ["-a", ...extra, "-e", "ssh -o BatchMode=yes", local,
                         `${remote.ssh}:${remote.dir}/${target}`],
               { stdio: ["ignore", "ignore", "inherit"] });
}

/**
 * Copy a file from under the remote folder to a local path.
 *
 * @param {Remote} remote
 * @param {string} source path relative to `remote.dir`
 * @param {string} local
 */
export function pullFrom(remote, source, local) {
  execFileSync("rsync", ["-a", "-e", "ssh -o BatchMode=yes", `${remote.ssh}:${remote.dir}/${source}`, local],
               { stdio: ["ignore", "ignore", "inherit"] });
}
