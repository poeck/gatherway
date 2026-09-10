const { ipcRenderer } = require('electron');

// No API is exposed to Gather's main world. Only genuine user input is forwarded.
for (const name of ['keydown', 'pointerdown', 'wheel']) {
  window.addEventListener(name, event => {
    if (!event.isTrusted || window !== window.top) return;
    const editable = event.target instanceof Element && event.target.closest('input,textarea,[contenteditable="true"],[role="textbox"]');
    const movement = name === 'keydown' && !editable && !event.ctrlKey && !event.metaKey && !event.altKey && ['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(event.key.toLowerCase());
    ipcRenderer.send('gatherway:interaction', { movement });
  }, true);
}
