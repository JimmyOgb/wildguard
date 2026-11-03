import * as fs from 'node:fs';
import * as path from 'node:path';

const srcDir = path.resolve(process.cwd(), 'frontend');
const destDir = path.resolve(process.cwd(), 'public');

if (fs.existsSync(srcDir)) {
  fs.mkdirSync(destDir, { recursive: true });
  fs.cpSync(srcDir, destDir, { recursive: true });
  console.log('Synchronized frontend/ assets into public/ build directory.');
}
