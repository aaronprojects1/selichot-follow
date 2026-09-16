import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

// Use the deployed commit's time, never the visitor's page-load time.
const committedAt = execFileSync('git', ['show', '-s', '--format=%cI', 'HEAD'], { encoding: 'utf8' }).trim();
const timestamp = new Date(committedAt).toISOString();
const label = `${timestamp.slice(0, 19).replace('T', ' ')} UTC`;
const path = new URL('../SelichotFollow/web/index.html', import.meta.url);
const html = readFileSync(path, 'utf8');
const marker = /<time id="version-updated" datetime="[^"]*">[^<]*<\/time>/;
if (!marker.test(html)) throw new Error('Settings version timestamp is missing');
writeFileSync(path, html.replace(marker, `<time id="version-updated" datetime="${timestamp}">${label}</time>`));
console.log(`Settings release timestamp: ${label}`);
