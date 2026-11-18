# Coffre — gestionnaire de mots de passe personnel

Une seule app pour **Mac, Windows et Android**, qui stocke tes mots de passe **chiffrés sur tes appareils**,
en génère de très solides, et se **synchronise via Dropbox** sans que Dropbox puisse lire quoi que ce soit.

- **Chiffrement** : format KeePass KDBX 4 — AES-256, clé dérivée de ton mot de passe maître par Argon2id
  (64 Mio de mémoire, 10 passes). Le mot de passe maître n'est jamais enregistré ni envoyé.
- **Jamais prisonnier de l'app** : le fichier du coffre s'ouvre aussi avec **KeePassXC** (Mac, Windows) et
  **KeePassDX** (Android), logiciels libres reconnus. Si un jour l'app pose problème, tes données restent lisibles.
- **Synchronisation fiable** : fusion entrée par entrée (aucune modification perdue, même faite hors ligne sur deux
  appareils), écriture conditionnelle (rien n'est écrasé si deux appareils écrivent en même temps), historique des
  versions de chaque entrée, copie locale sur chaque appareil, sauvegarde datée quotidienne sur Dropbox (30 jours).
- **Pratique** : générateur de mots de passe et de phrases de passe en français, codes de double authentification
  (2FA), recherche, corbeille avec annulation, audit des mots de passe faibles ou réutilisés, import depuis
  Chrome / Edge / Firefox / Safari / Bitwarden / 1Password / KeePass, fonctionne hors ligne.

---

## 1. Mise en ligne (une seule fois)

L'app est un site web statique « installable » (PWA). Pour l'installer sur Android et Windows, elle doit être
servie en **HTTPS**. L'hébergement ne voit que le code de l'app, **jamais tes données** (elles restent chiffrées
sur tes appareils et dans ton Dropbox).

**Option recommandée : GitHub Pages (gratuit)**

1. Crée un dépôt sur GitHub (par ex. `coffre`) et envoie-y ce dossier.
2. Dans le dépôt : *Settings → Pages → Source : GitHub Actions*. Le fichier `.github/workflows/pages.yml`
   construit, teste et publie automatiquement l'app à chaque envoi sur `main`.
3. L'app est alors disponible à l'adresse `https://<ton-compte>.github.io/coffre/`.
4. **Active la double authentification sur ton compte GitHub** : c'est lui qui contrôle le code de l'app.

Tu peux aussi construire à la main (`npm ci && npm run build`) et publier le dossier `dist/` sur n'importe quel
hébergement HTTPS (Cloudflare Pages, Netlify…).

## 2. Connexion Dropbox (une seule fois, ~5 min)

1. Ouvre <https://www.dropbox.com/developers/apps/create> → **Create app**.
2. Choisis **Scoped access**, puis **App folder** (l'app n'aura accès qu'à son propre dossier). Donne un nom unique.
3. Onglet **Permissions** : coche `files.metadata.read`, `files.content.read`, `files.content.write` → **Submit**.
4. Onglet **Settings → OAuth 2 → Redirect URIs** : ajoute l'adresse exacte de ton app, par ex.
   `https://<ton-compte>.github.io/coffre/` (et `http://localhost:5173/` si tu testes en local).
   Laisse **Allow public clients (PKCE)** sur *Allow*.
5. Copie l'**App key** (pas le secret). Elle te sera demandée dans l'app. Astuce : si tu la renseignes dans
   *GitHub → Settings → Variables → Actions* sous le nom `DROPBOX_APP_KEY`, elle sera pré-remplie partout.

## 3. Sur chaque appareil

| Appareil | Installer l'app |
|---|---|
| **Mac** | Ouvre l'adresse dans Chrome ou Edge → icône « Installer » dans la barre d'adresse. Avec Safari : *Fichier → Ajouter au Dock*. |
| **Windows** | Ouvre l'adresse dans Edge ou Chrome → « Installer Coffre » (icône dans la barre d'adresse). |
| **Android** | Ouvre l'adresse dans Chrome → menu ⋮ → **Installer l'application** (ou « Ajouter à l'écran d'accueil »). |

- **Premier appareil** : *Créer mon coffre* → choisis ton mot de passe maître (le bouton « Me proposer une phrase
  de passe » en génère une solide et facile à taper) → *Réglages → Synchronisation* → connecte Dropbox.
- **Autres appareils** : *J'ai déjà un coffre (Dropbox)* → connecte le même Dropbox → déverrouille avec le même
  mot de passe maître.

## 4. Sauvegardes et secours

Tu as automatiquement plusieurs copies : une copie chiffrée sur chaque appareil, le fichier sur Dropbox avec son
historique de versions, et une copie datée par jour dans `Applications/<ton app>/sauvegardes/`.

En plus, de temps en temps : *Réglages → Exporter une sauvegarde (.kdbx)* et range le fichier sur une clé USB.

**Si l'app ne fonctionne plus** : installe KeePassXC (Mac/Windows) ou KeePassDX (Android) et ouvre
`coffre.kdbx` depuis ton Dropbox avec ton mot de passe maître. Tout y est, codes 2FA compris.

**Si tu oublies le mot de passe maître** : personne ne peut récupérer le coffre, pas même toi. Note-le sur papier,
rangé en lieu sûr (chez toi, pas dans ton portefeuille).

## 5. Sécurité : ce qu'il faut savoir

- Protégé : vol de l'ordinateur ou du téléphone éteint/verrouillé, fuite ou piratage du compte Dropbox, curiosité de
  l'hébergeur. Sans le mot de passe maître, le fichier est inexploitable (chaque essai coûte 64 Mio et des
  centaines de millisecondes de calcul à un attaquant).
- Verrouillage automatique (réglable, 5 min par défaut), effacement du presse-papiers après 30 s, aucune donnée
  envoyée ailleurs qu'à Dropbox (politique de sécurité du navigateur stricte : l'app ne peut contacter aucun autre
  serveur, aucune ressource externe n'est chargée).
- Non protégé (comme tout gestionnaire) : un appareil déjà infecté par un logiciel espion pendant que le coffre est
  ouvert.
- Limites honnêtes : cette app n'a pas été auditée par des experts indépendants, contrairement à Bitwarden ou
  KeePassXC. C'est pour cela qu'elle utilise leur format standard : en cas de doute, tu peux basculer sur eux sans
  rien perdre. Pas de remplissage automatique dans les autres apps Android (copier-coller à la place).
- Le jeton Dropbox est stocké sur chaque appareil ; il ne donne accès qu'au dossier de l'app (fichier chiffré).

## 6. Pour les développeurs

```bash
npm ci            # installe les dépendances (kdbxweb, hash-wasm, esbuild, typescript)
npm run dev       # serveur local http://localhost:5173 avec rechargement
npm test          # 23 tests : chiffrement, synchronisation multi-appareils, générateur, 2FA, import CSV
npm run typecheck
npm run build     # produit dist/ (à héberger)
```

Test de compatibilité avec une implémentation KeePass indépendante (`pip install pykeepass` requis) :
`python3 tests/compat/check_pykeepass.py <dossier-temporaire>`.

Organisation du code (`src/`) :

| Fichier | Rôle |
|---|---|
| `vault.ts` | Coffre KeePass : création, ouverture, entrées, historique, corbeille, fusion |
| `sync.ts` | Moteur de synchronisation (indépendant du service) |
| `dropbox.ts` | Connexion OAuth PKCE et fichiers Dropbox |
| `app.ts` | Contrôleur : verrouillage, enregistrement local, synchro automatique |
| `storage.ts` | Stockage local IndexedDB |
| `generator.ts`, `wordlist-fr.ts` | Générateur et estimation de robustesse |
| `totp.ts`, `csv.ts` | Codes 2FA, import CSV |
| `ui-*.ts`, `widgets.ts`, `dom.ts` | Interface (aucun HTML injecté : tout le texte passe par `textContent`) |
| `argon2*.ts` | Dérivation de clé Argon2 dans un Web Worker |
