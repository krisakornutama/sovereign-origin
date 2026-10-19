import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function walk(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

function digestToBlobName(digest) {
  const value = String(digest || '');
  if (!value.startsWith('sha256:')) return null;
  const hex = value.slice('sha256:'.length);
  if (!/^[a-f0-9]{64}$/i.test(hex)) return null;
  return `sha256-${hex.toLowerCase()}`;
}

function manifestLabel(relative) {
  return relative.replace(/\\/g, '/').replace(/^manifests\//, '').replace(/^registry\.ollama\.ai\/library\//, '');
}

export function importModels({
  from,
  to,
  only = null,
  hardlink = true,
  strict = false,
  dryRun = false,
  log = console.log
} = {}) {
  if (!from || !to) throw new Error('importModels requires from and to');
  const srcManifests = path.join(from, 'manifests');
  const srcBlobs = path.join(from, 'blobs');
  if (!fs.existsSync(srcManifests)) throw new Error(`No manifests directory under ${from}`);
  if (!fs.existsSync(srcBlobs)) throw new Error(`No blobs directory under ${from}`);
  if (!dryRun) {
    fs.mkdirSync(path.join(to, 'manifests'), { recursive: true });
    fs.mkdirSync(path.join(to, 'blobs'), { recursive: true });
  }
  const result = {
    from,
    to,
    manifests: 0,
    blobs: 0,
    bytes: 0,
    linked: 0,
    copied: 0,
    skipped: 0,
    errors: []
  };
  const manifestFiles = walk(srcManifests);
  const onlyPattern = only ? String(only).toLowerCase().replace(/:/g, '/') : null;
  for (const manifestFile of manifestFiles) {
    const relative = path.relative(from, manifestFile);
    const label = manifestLabel(relative);
    if (onlyPattern && !label.toLowerCase().includes(onlyPattern)) continue;
    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    } catch (error) {
      result.errors.push(`${label}: invalid manifest (${error.message})`);
      if (strict) throw new Error(result.errors.at(-1));
      continue;
    }
    const entries = [];
    if (manifest.config?.digest) entries.push({ digest: manifest.config.digest, size: manifest.config.size });
    for (const layer of manifest.layers || []) {
      if (layer?.digest) entries.push({ digest: layer.digest, size: layer.size });
    }
    let missing = false;
    const blobs = [];
    for (const entry of entries) {
      const name = digestToBlobName(entry.digest);
      if (!name) {
        result.errors.push(`${label}: unsupported digest ${entry.digest}`);
        missing = true;
        break;
      }
      const source = path.join(srcBlobs, name);
      if (!fs.existsSync(source)) {
        result.errors.push(`${label}: missing blob ${name}`);
        missing = true;
        break;
      }
      const size = fs.statSync(source).size;
      if (entry.size && Number(entry.size) !== size) {
        result.errors.push(`${label}: blob size mismatch ${name} (${size} != ${entry.size})`);
        missing = true;
        break;
      }
      blobs.push({ name, source, size });
    }
    if (missing) {
      if (strict) throw new Error(result.errors.at(-1));
      continue;
    }
    if (!dryRun) {
      fs.mkdirSync(path.dirname(path.join(to, relative)), { recursive: true });
      fs.copyFileSync(manifestFile, path.join(to, relative));
    }
    result.manifests += 1;
    for (const blob of blobs) {
      const destination = path.join(to, 'blobs', blob.name);
      if (fs.existsSync(destination) && fs.statSync(destination).size === blob.size) {
        result.skipped += 1;
        continue;
      }
      result.bytes += blob.size;
      result.blobs += 1;
      if (dryRun) continue;
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      let placed = false;
      if (hardlink) {
        try {
          fs.linkSync(blob.source, destination);
          result.linked += 1;
          placed = true;
        } catch {
          // Cross-volume or filesystem without hardlinks: copy below.
        }
      }
      if (!placed) {
        fs.copyFileSync(blob.source, destination);
        result.copied += 1;
      }
    }
    log(`imported ${label}: ${blobs.length} blob(s)`);
  }
  return result;
}

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  try {
    const from = path.resolve(arg('from', ''));
    const to = path.resolve(arg('to', path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'models')));
    const result = importModels({
      from,
      to,
      only: arg('only', null),
      hardlink: !process.argv.includes('--copy'),
      strict: process.argv.includes('--strict'),
      dryRun: process.argv.includes('--dry-run')
    });
    console.log(JSON.stringify(result, null, 2));
    if (result.errors.length) {
      console.error(`Skipped ${result.errors.length} manifest(s) with missing/partial blobs.`);
    }
  } catch (error) {
    console.error(`import-models failed: ${error.message}`);
    process.exit(1);
  }
}
