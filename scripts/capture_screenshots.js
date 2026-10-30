import { spawn } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { createServer } from '../dist/src/web/server.js';

async function main() {
  const serverInstance = createServer();
  await serverInstance.start(3456, '127.0.0.1');
  console.log('Server started on 127.0.0.1:3456');

  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const desktopOut = path.resolve(process.cwd(), 'wildguard_desktop.png');
  const mobileOut = path.resolve(process.cwd(), 'wildguard_mobile.png');

  if (fs.existsSync(desktopOut)) fs.unlinkSync(desktopOut);
  if (fs.existsSync(mobileOut)) fs.unlinkSync(mobileOut);

  // Desktop screenshot
  console.log('Capturing desktop screenshot...');
  await new Promise((resolve, reject) => {
    const cp = spawn(chromePath, [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--window-size=1440,900',
      `--screenshot=${desktopOut}`,
      'http://127.0.0.1:3456/',
    ]);
    cp.on('close', resolve);
    cp.on('error', reject);
  });

  // Mobile screenshot
  console.log('Capturing mobile screenshot...');
  await new Promise((resolve, reject) => {
    const cp = spawn(chromePath, [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--window-size=390,844',
      `--screenshot=${mobileOut}`,
      'http://127.0.0.1:3456/',
    ]);
    cp.on('close', resolve);
    cp.on('error', reject);
  });

  console.log('Screenshots captured successfully.');
  await serverInstance.stop();
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
