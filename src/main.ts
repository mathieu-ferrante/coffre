// Point d'entrée : démarrage, verrouillage automatique, service worker.
import { installArgon2 } from './argon2.ts';
import { app, errMsg } from './app.ts';
import { completeDropboxAuth } from './dropbox.ts';
import { h, mount } from './dom.ts';
import { renderWelcome, renderUnlock, setFlash, lockState } from './ui-lock.ts';
import { renderMain, resetView, onDataChanged, updateStatus } from './ui-main.ts';
import { loadGenPrefs } from './ui-gen.ts';
import { toast } from './widgets.ts';

installArgon2('argon2-worker.js');

const root = document.getElementById('app')!;
let mainShown = false;
let updatePending = false;

function render() {
  if (app.vault) {
    if (!mainShown) {
      mainShown = true;
      renderMain(root);
    }
    return;
  }
  mainShown = false;
  resetView();
  if (app.hasLocalVault) renderUnlock(root, render);
  else renderWelcome(root, render);
}

app.on((what) => {
  if (what === 'lock') {
    if (updatePending) return location.reload();
    return render();
  }
  if (!app.vault) return;
  if (!mainShown) return render();
  if (what === 'data') onDataChanged();
  else updateStatus();
});

// ---------- Verrouillage automatique ----------

let lastActivity = Date.now();
for (const ev of ['pointerdown', 'keydown', 'wheel', 'touchstart', 'input']) {
  addEventListener(ev, () => (lastActivity = Date.now()), { passive: true, capture: true });
}
function checkAutoLock() {
  if (app.vault && Date.now() - lastActivity > app.settings.lockMinutes * 60_000) void app.lock();
}
setInterval(checkAutoLock, 5000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    checkAutoLock();
    app.scheduleSync(0);
  } else if (app.vault) {
    void app.persistNow().catch(() => undefined);
  }
});
addEventListener('online', () => app.scheduleSync(0));
addEventListener('pagehide', () => void app.persistNow().catch(() => undefined));

// ---------- Démarrage ----------

async function boot() {
  if (!window.isSecureContext || !crypto?.subtle) {
    mount(root, h('main', { class: 'center-screen' }, h('div', { class: 'card narrow' }, h('h1', null, 'Connexion non sécurisée'), h('p', null, 'Coffre doit être ouvert en HTTPS (ou sur localhost) pour pouvoir chiffrer.'))));
    return;
  }
  try {
    await Promise.all([app.init(), loadGenPrefs()]);
  } catch (e) {
    mount(root, h('main', { class: 'center-screen' }, h('div', { class: 'card narrow' }, h('h1', null, 'Stockage indisponible'), h('p', null, 'Le navigateur refuse le stockage local (navigation privée ?). ' + errMsg(e)))));
    return;
  }
  try {
    if (await completeDropboxAuth()) {
      await app.loadDropbox();
      if (!app.hasLocalVault) {
        lockState.step = 'dropbox';
        const found = await app.fetchRemoteVault();
        if (found) setFlash('Coffre récupéré depuis Dropbox. Déverrouille-le avec ton mot de passe maître.', 'ok');
        else setFlash('Dropbox est connecté, mais aucun coffre n’y a encore été envoyé. Crée ton coffre sur ton autre appareil et connecte-le à ce même Dropbox (ou crée un nouveau coffre ici).', 'error');
        lockState.step = found ? 'home' : 'dropbox';
      } else {
        setFlash('Dropbox connecté. Déverrouille ton coffre pour lancer la synchronisation.', 'ok');
      }
    }
  } catch (e) {
    setFlash(errMsg(e), 'error');
  }
  render();
}

void boot();

if (!__DEV__ && 'serviceWorker' in navigator) {
  // Seule une *mise à jour* (déjà un service worker actif) déclenche un rechargement ;
  // jamais la toute première installation (l'utilisateur pourrait être en train de saisir).
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js').catch(() => undefined);
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloaded || !hadController) return;
    reloaded = true;
    if (!app.vault && lockState.step === 'home' && !document.querySelector('input:focus')) location.reload();
    else if (!app.vault) updatePending = true;
    else {
      updatePending = true;
      toast('Mise à jour installée : elle s’appliquera au prochain verrouillage.');
    }
  });
}
