import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const patches = JSON.parse(readFileSync(new URL('./dependency-patches.json', import.meta.url), 'utf8'));
const lock = JSON.parse(readFileSync(resolve(root, 'package-lock.json'), 'utf8'));
const hash = source => createHash('sha256').update(source).digest('hex');
const pending = [];
for (const patch of patches) {
    const paths = Object.keys(lock.packages).filter(path => path.endsWith(`node_modules/${patch.name}`));
    if (!paths.length) throw new Error(`Missing locked dependency: ${patch.name}`);
    for (const path of paths) {
        const manifest = resolve(root, path, 'package.json');
        // These patches concern development dependencies; production-only installs omit them.
        if (!existsSync(manifest) && lock.packages[path].dev === true) continue;
        const installed = JSON.parse(readFileSync(manifest, 'utf8'));
        if (installed.version !== patch.version) throw new Error(`Review patch for ${patch.name}@${installed.version}`);
        for (const file of patch.files) {
            const destination = resolve(root, path, file.path);
            let source = readFileSync(destination, 'utf8');
            if (hash(source) === file.patchedSha256) continue;
            if (hash(source) !== file.originalSha256) throw new Error(`Unexpected dependency source: ${destination}`);
            for (const [before, after] of file.replacements) {
                if (source.split(before).length !== 2) throw new Error(`Ambiguous dependency patch: ${destination}`);
                source = source.replace(before, after);
            }
            if (hash(source) !== file.patchedSha256) throw new Error(`Invalid dependency patch: ${destination}`);
            pending.push([destination, source]);
        }
    }
}
// Validate every original file before changing any of them. Repeated runs are idempotent.
for (const [destination, source] of pending) writeFileSync(destination, source);
console.log(`Development dependency patches verified (${pending.length} files updated).`);
