/**
 * `npm run watch` - rebuild both bundles on any change under `src/`.
 *
 * Not `vite build --watch`, because the two bundles are two builds and the
 * second one depends on the first: the editor's file name carries a content
 * hash, and the card's build writes that name into `getConfigElement`. A
 * watcher over one of them alone would leave the card importing an editor
 * that no longer exists.
 */
import { spawn } from 'node:child_process';
import { watch } from 'node:fs';

let running = false, again = false, timer = null;

function build() {
  if (running) { again = true; return; }
  running = true;
  const t = Date.now();
  const p = spawn('npm', ['run', 'build'], { stdio: 'inherit', shell: false });
  p.on('exit', (code) => {
    running = false;
    console.log(code === 0
      ? `watch: rebuilt in ${Date.now() - t} ms - reload the dashboard.`
      : `watch: build failed (${code}); waiting for the next change.`);
    if (again) { again = false; build(); }
  });
}

const schedule = () => { clearTimeout(timer); timer = setTimeout(build, 80); };

watch('src', { recursive: true }, schedule);
watch('build', { recursive: true }, schedule);
console.log('watch: watching src/ and build/ - Ctrl-C to stop.');
build();
