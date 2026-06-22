import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('beacon', {
  getSnapshot: () => ipcRenderer.invoke('snapshot'),
  markSeen: (key: string) => ipcRenderer.invoke('markSeen', key),
  goto: (key: string) => ipcRenderer.invoke('goto', key),
  onUpdate: (cb: (snap: unknown) => void) => {
    const h = (_e: unknown, snap: unknown) => cb(snap);
    ipcRenderer.on('update', h);
    return () => ipcRenderer.removeListener('update', h);
  },
});
