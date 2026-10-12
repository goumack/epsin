// Pont entre l ecran de mise en route et le programme : seules ces deux
// operations sont exposees, rien d autre.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('epsin', {
  cloner: (donnees) => ipcRenderer.invoke('cloner', donnees),
  baseVide: (donnees) => ipcRenderer.invoke('base-vide', donnees),
});
