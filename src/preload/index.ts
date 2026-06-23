import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('beacon', {
  getSnapshot: () => ipcRenderer.invoke('snapshot'),
  markSeen: (key: string) => ipcRenderer.invoke('markSeen', key),
  dismiss: (key: string) => ipcRenderer.invoke('dismiss', key), // per-row × removes a session
  move: (key: string, group: 'needsYou' | 'done') => ipcRenderer.invoke('move', key, group), // demote/escalate
  goto: (key: string) => ipcRenderer.invoke('goto', key),
  hide: () => ipcRenderer.invoke('hide'), // close button: hide the persistent panel

  onUpdate: (cb: (snap: unknown) => void) => {
    const h = (_e: unknown, snap: unknown) => cb(snap);
    ipcRenderer.on('update', h);
    return () => ipcRenderer.removeListener('update', h);
  },
});
