// Minimal test for electron
const { app, BrowserWindow } = require('electron');

console.log('Electron app:', app);
console.log('BrowserWindow:', BrowserWindow);

if (app) {
  app.whenReady().then(() => {
    console.log('Electron is ready!');
    const win = new BrowserWindow({ width: 400, height: 300 });
    win.loadURL('data:text/html,<h1>Electron is working!</h1>');
  });
} else {
  console.log('app is undefined - electron not loaded correctly');
}
