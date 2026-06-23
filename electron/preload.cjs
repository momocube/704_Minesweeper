const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron704mine', {
  listDisplays:        () => ipcRenderer.invoke('displays:list'),
  openProjector:       (opts) => ipcRenderer.invoke('projector:open', opts ?? {}),
  closeProjector:      () => ipcRenderer.invoke('projector:close'),
  isProjectorOpen:     () => ipcRenderer.invoke('projector:isOpen'),
  openProjectorOnSecondary: () => ipcRenderer.invoke('projector:openSecondary'),
  onProjectorState: (cb) => {
    const handler = (_e, isOpen) => cb(!!isOpen);
    ipcRenderer.on('projector:state', handler);
    return () => ipcRenderer.off('projector:state', handler);
  },
});
