'use strict';
const fs = require('node:fs');
const path = require('node:path');

async function connect() {
  const tabs = await (await fetch('http://127.0.0.1:9223/json')).json();
  const tab = tabs.find(t => t.type === 'page' && (t.url.includes(':8080') || t.url.startsWith('file:')));
  if (!tab) throw new Error('Open the game in an isolated Chrome with --remote-debugging-port=9223.');
  const socket = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let sequence = 0;
  const requests = new Map(), errors = [];
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const request = requests.get(message.id);
      requests.delete(message.id);
      if (!request) return;
      clearTimeout(request.timer);
      message.error ? request.reject(new Error(JSON.stringify(message.error))) : request.resolve(message.result);
    } else if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { requests.delete(id); reject(new Error('CDP timed out: ' + method)); }, 30000);
    requests.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  await send('Runtime.enable');
  await send('Page.enable');
  return { send, evaluate, errors, close: () => socket.close() };
}
module.exports = connect;

if (require.main === module) {
  (async () => {
    const browser = await connect();
    try {
      const [action, argument] = process.argv.slice(2);
      if (action === 'eval') console.log(JSON.stringify(await browser.evaluate(argument), null, 2));
      else if (action === 'shot') {
        const data = await browser.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
        const output = path.resolve(__dirname, argument || 'preview.png');
        fs.writeFileSync(output, Buffer.from(data.data, 'base64'));
        console.log(output);
      } else if (action === 'click') {
        const point = await browser.evaluate(`(() => { const r=document.querySelector(${JSON.stringify(argument)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
        await browser.send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point });
        await browser.send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point });
        console.log('Clicked', argument);
      } else if (action === 'reload') {
        await browser.send('Page.reload', { ignoreCache: true });
        console.log('Reload requested');
      } else if (action === 'size') {
        const [width, height] = argument.split('x').map(Number);
        await browser.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
        console.log('Viewport', width, height);
      } else throw new Error('Use eval, shot, click, reload, or size.');
    } finally { browser.close(); }
  })().catch(error => { console.error(error); process.exitCode = 1; });
}
