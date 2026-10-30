import { spawn } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { createServer } from '../dist/src/web/server.js';

async function main() {
  const serverInstance = createServer();
  await serverInstance.start(3458, '127.0.0.1');
  console.log('Server started on 127.0.0.1:3458');

  // Let's create an active chat state HTML screenshot or trigger the chat API
  const chatOut = path.resolve(process.cwd(), 'wildguard_chat_desktop.png');
  if (fs.existsSync(chatOut)) fs.unlinkSync(chatOut);

  // We can use headless Chrome with a small script injected or evaluate
  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

  // We can write a tiny wrapper HTML or use Chrome DevTools protocol if needed, or simple node script
  console.log('Capturing chat screenshot...');
  // Let's trigger a run via node
  await new Promise((resolve) => {
    const cp = spawn(chromePath, [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--window-size=1440,900',
      `--screenshot=${chatOut}`,
      'http://127.0.0.1:3458/',
    ]);
    cp.on('close', resolve);
  });

  await serverInstance.stop();
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
