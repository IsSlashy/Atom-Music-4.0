# Audit UI/UX — Atom Music 4.0

> Audit multi-agents (10 chercheurs spécialisés + vérification adversariale + synthèse).
> Focus prioritaire : bug du lecteur vidéo en mode réduit / Picture-in-Picture / détachement.
> 69 findings au total — 0 critique confirmé, 11 élevés, 27 moyens, 29 faibles (2 faux positifs écartés).

---

## 0. Analyse de régression vs l'upstream `th-ch/youtube-music`

**Constat clé : le revamp a cassé une fonctionnalité qui marchait en supprimant un plugin éprouvé.**

Comparaison directe avec l'upstream `th-ch/youtube-music` (branche `master`, version **3.11.0** — ton fork s'annonce en 4.0.0 mais dérive de la 3.11.0 ou antérieure) :

| Élément | Upstream (fonctionne) | Fork « Atom Music 4.0 » (revamp) |
|---|---|---|
| Plugin `src/plugins/picture-in-picture/` | **Présent** — plugin dédié complet (`index.ts`, `main.ts`, `menu.ts`, renderer, `style.css`) | **Supprimé** (absent de `src/plugins/`) |
| PiP dans `video-toggle/index.tsx` | **0 ligne** (bascule pochette/vidéo seulement — 11 402 o) | Auto‑PiP maison greffé (15 655 o) |
| Hack `ghost-collapse` / `MINIPLAYER` dans `renderer.ts` | **Absent** (renderer = 16 Ko) | **Inventé par le revamp** (renderer gonflé à 72 Ko) |

### Comment l'upstream gère « détacher la vidéo sur le bureau » (la bonne approche)

Le plugin `picture-in-picture` upstream propose ce que tu décris vouloir, proprement. Sa config :
`alwaysOnTop`, `savePosition`, `saveSize`, `hotkey: 'P'`, `pip-position`, `pip-size`, `isInPiP`, **`useNativePiP`**.

Dans `picture-in-picture/main.ts`, un `togglePiP()` déclenché par une **vraie action** (menu, raccourci `P`, ou IPC `plugin:toggle-picture-in-picture`) :
- transforme la fenêtre en petite fenêtre flottante via `setAlwaysOnTop(true, 'screen-saver', 1)` + `setVisibleOnAllWorkspaces(true)` ;
- **sauvegarde** la position/taille d'origine, applique `pip-position`/`pip-size` (`setPosition`/`setSize`), masque les boutons de fenêtre ;
- restaure tout en sortie.

L'option `useNativePiP` bascule entre cette **fenêtre Electron détachée** (déplaçable, redimensionnable, position/taille mémorisées) et le **PiP natif Chromium**. Le revamp a jeté l'ensemble et l'a remplacé par un auto‑PiP déclenché depuis un `MutationObserver` (sans geste utilisateur), en conflit avec un hack de collapse.

### Deux voies de correction possibles

- **Voie A — Restaurer le plugin upstream** (recommandée pour la robustesse) : porter `src/plugins/picture-in-picture/` depuis l'upstream 3.11.0, retirer l'auto‑PiP de `video-toggle`, neutraliser le `ghost-collapse`. Donne la fenêtre détachée + position/taille mémorisées.
- **Voie B — Réparer le bricolage en place** : appliquer le plan en 8 étapes de la section « Bug prioritaire » ci‑dessous (déclencheur sur clic, collapse PiP‑aware, unification). Plus rapide, mais reste sur le PiP natif uniquement (pas de fenêtre détachée mémorisée).

---

## Resume executif

L'etat general du fork "Atom Music 4.0" est **fonctionnel mais fragile** : le typecheck est casse (6 erreurs `tsc`), le lint est totalement inutilisable (ESLint 10 vs `eslint-plugin-import` legacy), l'install peut echouer (mismatch pnpm), et le revamp a introduit plusieurs fuites d'observers/intervals et des conflits de logique non coordonnes. Aucun crash systematique en production, mais l'experience se degrade et le pipeline qualite est a l'arret. **Le bug prioritaire (passer en mini-player et detacher la video hors de l'app)** a une cause racine claire : la fonctionnalite repose entierement sur le Picture-in-Picture natif Chromium, declenche depuis un `MutationObserver` (donc **sans geste utilisateur** -> `NotAllowedError` silencieuse), tandis qu'**en parallele** un second observer dans `renderer.ts` collapse le conteneur de la video (`#song-media-window` -> `height:0; visibility:hidden`) sur le **meme** etat `MINIPLAYER`, sans aucune coordination entre les deux. Resultat : « ca bug a moitie » (PiP qui echoue, s'ouvre noir, ou video qui disparait selon le timing). **Correctif recommande** : declencher le PiP sur le vrai clic du bouton « lecteur reduit » (pas sur la mutation), rendre le collapse `PiP-aware` (`!document.pictureInPictureElement` + listeners `enter/leavepictureinpicture`), et unifier toute la logique MINIPLAYER en un seul endroit (le plugin `video-toggle`).

## Bug prioritaire — Lecteur video (mini / Picture-in-Picture / detachement)

### Diagnostic
La feature « detacher la video hors de l'app » = **PiP natif Chromium** (la fenetre PiP est une fenetre OS flottante, deplacable hors de l'app — c'est bien ce que l'utilisateur veut). Il n'existe **aucune** fenetre Electron secondaire de secours (`index.ts` : un seul `new BrowserWindow`, aucun `documentPictureInPicture`). Tout repose donc sur `video.requestPictureInPicture()`. Or **deux mecanismes independants** reagissent au **meme** attribut `player-ui-state === 'MINIPLAYER'`, avec des intentions opposees et sans se connaitre :

| # | Fichier:lignes | Action sur MINIPLAYER |
|---|---|---|
| Observer A (PiP) | `src/plugins/video-toggle/index.tsx:242-259` | `video.requestPictureInPicture().catch(() => {})` |
| Observer B (collapse) | `src/renderer.ts:953-975` | `smw.classList.add('ytmd-ghost-collapsed')` sur `#song-media-window` |
| Effet CSS de B | `src/theme/global-styles.ts:727-735` | `height:0 !important; visibility:hidden !important; overflow:hidden !important` |

Le `<video>` vit **dans** `#song-media-window` (`#song-media-window > ytmusic-player#player > #song-video > video`). Collapser cet ancetre clippe/masque donc la source PiP.

### Pourquoi « ca bug a moitie » (3 causes cumulees)
1. **Cause dominante — pas de geste utilisateur.** `requestPictureInPicture()` (index.tsx:245) est appele depuis un callback de `MutationObserver` declenche par YTM, **hors de toute activation utilisateur**. Chromium exige une *transient user activation* -> `NotAllowedError`. L'erreur est **avalee** par `.catch(() => {})` (lignes 245 et 266) -> « rien ne se passe », sans trace. A l'oppose, le bouton PiP manuel `#ytmd-pip-button` (index.tsx:202-216) **fonctionne** car il est dans un `click` handler.
2. **Cause secondaire — collision collapse vs PiP.** Le collapse de `renderer.ts` n'a **aucune** garde `document.pictureInPictureElement` (contrairement a `setVideoState` index.tsx:285 qui, lui, protege deja le PiP). Si la PiP demarre malgre tout, le conteneur est ensuite masque (`visibility:hidden`/`height:0`) -> PiP noir/fige, selon l'ordre des deux observers.
3. **Cause tertiaire — detection d'etat divergente.** `renderer.ts:954-955` lit `player-ui-state` **OU** `player-ui-state_`, alors que `index.tsx:243/253/258` ne lit/observe QUE `player-ui-state`. Si YTM utilise la variante `_`, l'observer PiP peut ne **jamais** matcher.

### Plan de correction (etape par etape)
1. **Declencher le PiP sur un vrai clic.** Retirer le declenchement depuis `MutationObserver`. Attacher `video.requestPictureInPicture()` au clic reel du bouton « lecteur reduit » de YTM (en capture : `addEventListener('click', ..., true)`), sur le meme modele que `#ytmd-pip-button` (index.tsx:202-216).
2. **Rendre le collapse PiP-aware** dans `renderer.ts` `updateGhost` (l.958-962) :
   `if (state === 'MINIPLAYER' && !document.pictureInPictureElement) smw.classList.add('ytmd-ghost-collapsed'); else smw.classList.remove(...)`.
3. **Resynchroniser via les events PiP** : sur la `<video>`, `enterpictureinpicture` -> `remove('ytmd-ghost-collapsed')`, `leavepictureinpicture` -> re-`updateGhost`. Ne jamais masquer le conteneur tant qu'une video y est en PiP.
4. **Eviter `visibility:hidden`+`height:0`** sur l'ancetre du `<video>` : preferer un collapse qui garde la video peinte (cibler le sous-conteneur side-panel/queue, ou `position:absolute; clip-path:inset(50%); pointer-events:none`).
5. **Unifier la logique MINIPLAYER** dans le plugin `video-toggle` (qui possede deja `video` et la garde PiP) et **supprimer** le second observer de `renderer.ts:948-976`. Une seule source de verite.
6. **Aligner la detection d'etat** : observer/lire `['player-ui-state','player-ui-state_']` des deux cotes.
7. **Ne plus avaler les erreurs PiP** : `.catch((e) => console.warn('[video-toggle] PiP refused:', e))` (l.245, 266) pour diagnostiquer.
8. **Bonus** : reintroduire le workaround resize (`window.dispatchEvent(new Event('resize'))` en fin de `setVideoState`, dans un `requestAnimationFrame`) pour forcer YTM a recalculer la geometrie apres bascule (cf VTG-03), et masquer le switch en MINIPLAYER pour liberer la zone de drag (VTG-04).

> Note : `THM-01` (« aucune occurrence de PiP ») est un **faux positif** — la PiP existe bien dans `video-toggle`. La vraie cause est le declenchement sans geste + la collision de collapse, pas l'absence de PiP.

## Problemes par gravite

### Critique
_Aucun finding confirme en severite critique apres verification adversariale (PIP-01 ramene a medium : la panne n'est pas deterministe)._

### Eleve

| Titre | Fichier:lignes | Symptome | Cause | Correctif |
|---|---|---|---|---|
| **VTG-01 / PIP-02 — Deux observers MINIPLAYER antagonistes** | `index.tsx:242-259` + `renderer.ts:953-975` + `global-styles.ts:727-735` | Video erratique en mini-mode (disparait / PiP noir / rien) | Collapse vs auto-PiP sur le meme etat, sans coordination ni garde PiP | Unifier en un seul endroit ; collapse conditionnel a `!document.pictureInPictureElement` + listeners enter/leave PiP |
| **PIP-03 — Auto-PiP hors geste utilisateur** | `index.tsx:245, 252-258` | « Rien ne se passe » en mode reduit (le bouton manuel marche) | `requestPictureInPicture()` appele depuis un MutationObserver -> `NotAllowedError` avalee | Brancher le PiP sur le clic reel du bouton « lecteur reduit » ; logger l'erreur |
| **TS-01 / CFG-01 — `options.disableIdlePopup` orpheline** | `renderer.ts:1459` + `config/defaults.ts:16-39/54-74` | Option morte (popup non desactivable) + 2 erreurs tsc | Cle absente du schema ; `undefined !== false` -> interval toujours actif | Ajouter `disableIdlePopup: boolean` au type + default, et corriger la logique (`if (!get(...))`) ; ou rendre le blocage inconditionnel |
| **MAIN-01 / CFG-02 — `initHook` re-execute au re-activate macOS** | `index.ts:241-323, 448, 702-710` ; `config/index.ts:88` | Sur macOS, clic dock apres fermeture : echec recreation fenetre + fuite listeners | `ipcMain.handle` redondant **throw** ; `config.watch` ajoute un listener sans unsubscribe | Enregistrer handlers IPC + `config.watch` une seule fois (flag `hooksInstalled`) ; cibler `mainWindow` dynamiquement, pas la closure `win` |
| **REN-01 — `setInterval(forceCollapse, 250)` perpetuel + listeners fuyants** | `renderer.ts:846, 942, 230-242, 860-864` | Travail DOM toutes les 250ms a vie ; handler global `ytmd-play-local` empile a chaque re-render sidebar | Polling jamais clear + `addEventListener` non idempotent dans `addCustomEntries` | Binder le handler global une seule fois (flag) ; remplacer le polling par un MutationObserver deconnectable |
| **TOOL-01 — ESLint totalement casse** | `eslint.config.mjs:9, 52-56` ; `package.json:123,127` | `pnpm lint` plante (`getTokenOrCommentAfter is not a function`) | ESLint 10 a retire l'API legacy utilisee par `eslint-plugin-import@2.32.0` (regle `order`) | Migrer vers `eslint-plugin-import-x` ; quick fix : passer `import/order` a `off` |
| **TOOL-02 — `engines.pnpm >=10` + `engine-strict`** | `package.json:44` ; `.npmrc:1` ; `pnpm-lock.yaml:1` | `pnpm install` echoue (env=9.15.9, lockfile v9) | Contrainte engines bloquante incoherente avec le lockfile v9 | `pnpm: ">=9"` + ajouter `"packageManager": "pnpm@9.15.9"` |
| **A11Y-02 — Focus clavier supprime sans `:focus-visible`** | `IconButton.tsx:24` ; `SettingControl.tsx:42,66` ; `SettingsPage.tsx:116` | Boutons titlebar / inputs / slider sans indicateur de focus au clavier | `outline:none` sans alternative `:focus-visible` (WCAG 2.4.7 AA) | Ajouter `&:focus-visible { outline:2px solid <accent>; outline-offset:2px }` |

### Moyen

| Titre | Fichier:lignes | Symptome | Cause | Correctif |
|---|---|---|---|---|
| **PIP-01 — Collapse de l'ancetre du `<video>`** | `renderer.ts:958-961` ; `global-styles.ts:727-735` | PiP noir/echec conditionnel quand collapse actif | `visibility:hidden`/`height:0` sur un ancetre du `<video>` | Ne pas masquer le conteneur pendant le PiP (voir plan bug prioritaire) |
| **PIP-04 — `display:none` sur `#song-video` casse le frame PiP** | `index.tsx:285-287, 306-308, 262-268` | PiP noir/ferme au changement song/video | `display:none` sur la source du PiP ; garde l.285 incomplete ; re-request a delai fixe 500ms | Ne jamais toucher au `display` du `<video>` si PiP actif ; re-request sur `loadedmetadata` |
| **PIP-05 — Aucune fenetre Electron detachee de secours** | `index.ts:446` ; `index.tsx` | Pas de fallback si le PiP echoue | Detachement 100% dependant du PiP Chromium | Fiabiliser le PiP (prioritaire) ; option : vraie `BrowserWindow` flottante |
| **MAIN-02 — Pas de `setWindowOpenHandler`/`will-navigate` + CSP supprimee** | `index.ts:1077-1106, 561` | `window.open`/liens externes non controles | CSP retiree sur toutes reponses, aucune garde de navigation | Ajouter `setWindowOpenHandler` (deny + `shell.openExternal`) + `will-navigate` restreint aux domaines YTM/Google |
| **MAIN-03 — `window-size` sauvee en plein ecran** | `index.ts:515-532, 504-511` | Fenetre demesuree au redemarrage apres F11 | Handlers `resize`/`move` ne testent que `isMaximized`, pas `isFullScreen` | `if (win.isFullScreen()) return;` dans les deux handlers |
| **VTG-03 — Workaround resize #2459 supprime** | `src/plugins/video-toggle/` (0 match `resize`) | Mauvaise taille/zone noire apres bascule song<->video | Plus aucun `dispatchEvent(new Event('resize'))` apres toggle | Reintroduire `window.dispatchEvent(new Event('resize'))` en fin de `setVideoState` |
| **VTG-02 — `setOptions` persiste un objet partiel/stale** | `index.tsx:289-292` | Champs config (mode/align/forceHide) reinitialises a une valeur stale | Envoi de `this.config` entier (capture figee) au lieu du seul champ | `setOptions('video-toggle', { hideVideo: !showVideo })` (merge store) |
| **VTG-04 — Switch absolute top:0 width:100% z-index:999 au-dessus du player** | `video-toggle/styles.ts:11-19,41` ; `index.tsx:184` | Drag de la video en mini-mode intercepte par le switch | Conteneur full-width cliquable au-dessus de `#song-video` | Masquer le switch en MINIPLAYER + reduire la zone cliquable au bouton |
| **REN-03 — `setTimeout` 1000/2000ms sans retry** | `renderer.ts:946, 949-976` | Sur machine lente, fix mini-player jamais installe | `#song-media-window` souvent absent a t=2000ms, aucun retry | Remplacer par un MutationObserver attendant l'apparition de l'element |
| **REN-04 — Observer mini-player non reattache apres re-render SPA** | `renderer.ts:954-956, 971-975` | Ghost desync apres navigation | Observer cree une fois sur les noeuds presents a t=2000ms (detaches apres re-render) | Observer un ancetre stable en subtree et re-installer a la (re)apparition |
| **REN-05 — `deepObserver`/`contentObserver` subtree non debounce** | `renderer.ts:1331-1336, 1355-1363, 935-939` | Jank de scroll sur grandes bibliotheques | `querySelectorAll` global + reflow force par element a chaque mutation | Debouncer ; limiter aux `addedNodes` ; conserver refs pour disconnect |
| **REN-07 — Override `play`/`src` du `<video>` fragile** | `renderer.ts:424, 442-458, 450, 822-824` | Player YTM muet/en pause apres lecture locale | `delete` dans le propre setter ; re-querySelector au unpatch ; race avec re-render | Capturer la ref `<video>` au patch ; differer la restauration via `queueMicrotask` |
| **REN-08 — Acces non garde `queue.store.store` / `networkManager`** | `renderer.ts:1205, 1131, 1112-1118` | Handlers IPC de file plantent silencieusement si API YTM renommee | `?.` ne couvre pas toute la chaine | Optional-chainer toute la chaine + try/catch dans les handlers |
| **TS-05 — Zone lecture locale / override video non typee (~40 `as any`)** | `renderer.ts:263-851` | Regressions silencieuses dans la zone exacte du bug mini-player | Globals `__ytmdPlayLocalFile`/`__ytmdLocalCleanup` non declarees | Declarer dans `reset.d.ts` ; typer les `querySelector` |
| **THM-02 — Toggle video full-width pointer-events** | `video-toggle/styles.ts:11-19,41` | Clics du player potentiellement avales | Conteneur absolute 100% + enfant `pointer-events:all` ; `z-index:999` magique | Restreindre la largeur ; tokeniser le z-index |
| **THM-03 — 18 declarations `backdrop-filter blur(20-40px)`** | `global-styles.ts:101,309,319,621,753` ; `video-toggle/styles.ts:27` | Saccades/chauffe GPU au resize / animations en cascade | Blur cumule sur conteneurs larges/permanents + cascade fade-in | Reduire le rayon (12-16px), limiter la cascade, flag low-power |
| **THM-06 — CSS `#av-id` duplique (global-styles vs youtube-music.css)** | `global-styles.ts:71-82` ; `youtube-music.css:64-75` ; `index.ts:368,376` | Cadrage video imprevisible | Deux sources de verite injectees | Supprimer le bloc duplique, garder une source |
| **THM-07 — Selecteur `#av-id ~ #player[...]` fragile** | `global-styles.ts:75` | Cadrage video saute si structure YTM change | Depend de l'id `#av-id` + attribut suppose sur la page | Cibler via `:has(ytmusic-player:not([player-ui-state='FULLSCREEN']))` |
| **TB-01 — Boutons titlebar `app-region: none` au lieu de `no-drag`** | `IconButton.tsx:8` ; `MenuButton.tsx:8` ; `PanelItem.tsx:13` (vs `TitleBar.tsx:28`) | Clics avales / debut de drag sur hamburger/menu (Linux: min/max/close) | `none` ne soustrait pas la zone draggable parent | Remplacer par `no-drag` (pattern deja correct en `global-styles.ts:28/35`) |
| **TB-02 — `app-region: no-drag` non prefixe** | `global-styles.ts:95` | Clics avales sur dropdowns/dialogs YTM chevauchant la nav | Manque le prefixe `-webkit-` (propriete ignoree) | `-webkit-app-region: no-drag;` |
| **CFG-05 — Listeners song-info-front/MINIPLAYER jamais teardown** | `song-info-front.ts:20-25,38-51` ; `renderer.ts:973-974` | Events song-info dupliques + ghost mini-mode apres re-render | MutationObservers/`ipcRenderer.on` sans disconnect | Garder refs + disconnect ; teardown du listener module-scope |
| **A11Y-01 — Aucun `prefers-reduced-motion`** | `global-styles.ts:787-879` ; `tokens.ts:81` | Animations permanentes (fade-in, cascades, spring) -> gene vestibulaire | Aucune media query reduced-motion (et `!important` partout) | Ajouter `@media (prefers-reduced-motion: reduce)` avec `!important` (reset animation/transition-delay) |
| **A11Y-03 — MenuButton `<li>` non focusable** | `MenuButton.tsx:42` ; `TitleBar.tsx:227-230` | Menus non ouvrables au clavier | `<li>` onClick sans role/tabIndex/keydown | `role='menuitem'` + roving tabindex + Enter/Space/ArrowDown |
| **A11Y-04 — Titre video (`.ytp-title`) masque** | `global-styles.ts:712-724` | Titre de piste/clip retire (info utile + AT) | Selecteur watermark englobe les `.ytp-title*` | Separer : masquer seulement `.ytp-watermark` ; sr-only sinon |
| **A11Y-05 — Contraste faible sur surfaces glass** | `video-toggle/styles.ts:26,38` ; `tokens.ts:15-16` | Libelles inactifs sous le seuil AA 4.5:1 | Texte 0.4-0.6 sur glass translucide sur fond non controle | Monter l'opacite du fond (0.55-0.65) et/ou du texte (>=0.75) |
| **TOOL-03 — vite override 7.1.5 vs devDep 7.3.1** | `package.json:48,137` ; `pnpm-lock.yaml:8,246` | Version Vite installee != declaree | `pnpm.overrides` prime sur le specifier | Aligner override et devDep sur une seule version |
| **TOOL-04 — `@electron-toolkit/tsconfig` declare en double** | `package.json:62,102` | Version base tsconfig ambigue | Meme cle en `dependencies` (2.0.0) et `devDependencies` (1.0.1) | Supprimer l'entree `dependencies`, garder une seule version |

### Faible

| Titre | Fichier:lignes | Correctif (1 ligne) |
|---|---|---|
| **REN-06 — `console.log` debug en prod** | `renderer.ts:957` | Supprimer ou wrapper dans `if (window.electronIs.dev())` |
| **CFG-04 — `console.log` config non gate** | `index.ts:250-252` | Retirer ou gater derriere `is.dev()` |
| **TS-04 / CFG-03 — Import `deepmerge` mort** | `loader/renderer.ts:1` | Supprimer la ligne 1 (TS6133) |
| **TS-02 — `JSON.parse` -> unknown sans guard** | `index.ts:182-189` | `const parsed: unknown = ...; if (parsed && typeof parsed==='object') meta = parsed as ...` |
| **TS-03 — Acces `.imageSrc` sur unknown** | `index.ts:204-205` | `if (typeof meta?.imageSrc === 'string') ...` |
| **TS-06 — `console-message` cast `as any`** | `index.ts:564-571` | Utiliser la signature typee Electron recente (`event.level/message`) |
| **MAIN-04 — Sauvegardes debouncees perdues a la fermeture** | `index.ts:536-549, 1017-1021` | Flush `savedTimeouts` sur `before-quit`/`close` |
| **MAIN-05/06 — Offscreen + DPI position non scalee** | `index.ts:459-473` | Utiliser `screen.dipToScreenRect` / `workArea` coherent |
| **REN-02 — selObserver per-entry sans disconnect** | `renderer.ts:119-123` | Hygiene : marquer le noeud (`__ytmdSelObs`) ou observer delegue (GC gere deja le cas reel) |
| **REN-09 — rAF lecture locale non annulable** | `renderer.ts:699-714, 795-797` | Stocker l'id rAF + `cancelAnimationFrame` dans cleanup |
| **REN-10 — `listenForApiLoad` sans retry** | `renderer.ts:35-44` | Laisser `initObserver` seul point d'entree |
| **VTG-05 — `applyStyleClass` ne nettoie pas en mode native** | `index.tsx:110-118` | Brancher `else { remove('video-toggle-custom-mode','video-toggle-force-hide') }` |
| **VTG-06 — `setVideoState` bloque song pendant PiP** | `index.tsx:284-287, 350-356` | `exitPictureInPicture()` puis appliquer l'etat, ou sync le checkbox |
| **THM-04 — Regle sidebar dupliquee/morte** | `global-styles.ts:335-345 vs 466-479` | Fusionner en une seule regle (40x40) |
| **THM-05 — `borderRadius.pill = '200px'`** | `tokens.ts:45` | Remplacer par `'9999px'` |
| **THM-08 — Masquage agressif `.ytp-chrome-top-buttons`** | `global-styles.ts:55-57, 712-724` | Reduire au watermark ; `display:none` suffit |
| **THM-09 — Transition de base sans `!important`** | `global-styles.ts:551-556` | Uniformiser la strategie `!important` |
| **TB-03 — Pas de double-clic maximize sur titlebar** | `TitleBar.tsx:210` | `onDblClick` sur zone vide -> `handleToggleMaximize` |
| **TB-04 — `data-length` incoherent** | `TitleBar.tsx:314,332` | `data-length={menu()?.items.length}` |
| **A11Y-06 — Bouton PiP sans aria-label** | `video-toggle/index.tsx:197-200` | `aria-label` + `aria-pressed` + SVG `aria-hidden` |
| **A11Y-07 — Toggles sans label accessible** | `SettingControl.tsx:147-154` ; `video-switch-button.tsx:15-19` | `aria-label` sur les inputs checkbox |
| **UX-08 — Tokens incoherents (accent #49f3f7 vs #3ea6ff)** | `tokens.ts:20` ; `SettingControl.tsx:72,99` | Unifier l'accent / documenter `accentSecondary` |
| **TOOL-07 — Regles @stylistic depreciees** | `eslint.config.mjs:34,73-76` | `sort-jsx-props` + `allowTemplateLiterals:'never'` |
| **TOOL-08 — Identite fork non rebrandee** | `package.json:2-14` | Aligner name/productName/desktopName/repository |

**Faux positifs / a exclure** : `THM-01` (la PiP existe bien dans `video-toggle` ; le besoin de detachement est deja couvert par l'auto-PiP). `REN-02` (le GC collecte les observers sur noeuds detaches ; pas de fuite non bornee — simple hygiene). `TOOL-05` / `TOOL-06` (les configs timestampees et `dist/`/`pack/` **ne sont PAS** commites, deja `.gitignore` — le brief etait errone sur ce point).

## Quick wins (fort impact / faible effort)

1. **Corriger les 6 erreurs tsc** (debloque le typecheck) : `TS-04`/`CFG-03` (supprimer import `deepmerge`, `loader/renderer.ts:1`) ; `TS-02`/`TS-03` (guards `unknown`, `index.ts:182-205`) ; `TS-01`/`CFG-01` (ajouter `disableIdlePopup: boolean` au schema, `defaults.ts`).
2. **Deverrouiller ESLint** (`TOOL-01`) : passer `import/order` a `'off'` immediatement (`eslint.config.mjs:52-56`), puis migrer vers `eslint-plugin-import-x`.
3. **Reparer l'install** (`TOOL-02`) : `engines.pnpm: ">=9"` + `"packageManager": "pnpm@9.15.9"`.
4. **Supprimer les logs de debug en prod** : `renderer.ts:957`, `index.ts:250-252`.
5. **Corriger les drag regions** (`TB-01`/`TB-02`) : `none` -> `no-drag` (3 fichiers) + prefixe `-webkit-` (`global-styles.ts:95`).
6. **`prefers-reduced-motion`** (`A11Y-01`) : 1 bloc `@media` en fin de `globalStyles`.
7. **Focus-visible** (`A11Y-02`) : ring de focus sur `IconButton`/inputs/slider.
8. **Nettoyer les configs dupliquees** : `TOOL-03` (vite) + `TOOL-04` (tsconfig). Optionnel : `rm electron.vite.config.*.mjs` du working dir (deja ignores).

## Dette technique & risques structurels

- **Fragilite des selecteurs DOM YTM** : tout le revamp manipule des internals non documentes (`#av-id`, `#song-media-window`, `player-ui-state` / `player-ui-state_`, `ytmusic-*`). Un seul renommage cote YTM casse le cadrage video, le mini-player et la nav. Preferer `:has()` et des selecteurs resilients ; centraliser ces selecteurs.
- **Double source de verite MINIPLAYER** : `renderer.ts` et `video-toggle` reagissent au meme attribut sans coordination — pattern recurrent (collapse vs PiP, lecture d'attributs divergente). A unifier dans le plugin proprietaire.
- **Observers/intervals non geres** : `setInterval(250)` perpetuel (`REN-01`), MutationObservers crees sans `disconnect()` ni reference (`REN-02/04/05`, `CFG-05`), `setTimeout` magiques sans retry (`REN-03`). Risque de fuite memoire/CPU sur sessions longues et de desync apres re-render SPA. Adopter : observers stockes + deconnectables, handlers idempotents (flags module-level), MutationObserver sur ancetre stable plutot que polling.
- **`!important` massif + `as any` (~40 occurrences)** : le theme force des centaines de regles `!important` (fragile face aux updates YTM, et bloque les overrides utilisateur/a11y), et la zone lecture locale/override `<video>` (`renderer.ts:263-851`) est non typee — les regressions y passent inapercues de `tsc`, precisement la ou se trouve le bug prioritaire.
- **Cycle de vie main macOS** (`MAIN-01`/`CFG-02`) : `initHook` non idempotent au re-activate. Separer enregistrement global (une fois) vs wiring par-fenetre.
- **Securite** (`MAIN-02`) : CSP entierement supprimee sans `setWindowOpenHandler`/`will-navigate`.

## Plan d'action recommande (ordre priorise)

1. **Bug prioritaire video/PiP** (impact utilisateur n°1) : appliquer le plan en 8 etapes ci-dessus — declencheur clic, collapse PiP-aware, unification dans `video-toggle`, alignement detection d'etat, resize workaround. Findings : `VTG-01`, `PIP-02`, `PIP-03`, `PIP-01`, `PIP-04`, `VTG-03`, `VTG-04`.
2. **Debloquer le pipeline qualite** (rapide, prerequis CI) : 6 erreurs tsc (`TS-01..04`, `CFG-01/03`), ESLint (`TOOL-01`), install pnpm (`TOOL-02`).
3. **Stabilite main process** : `MAIN-01`/`CFG-02` (macOS re-activate), `MAIN-03` (fullscreen save), `MAIN-02` (securite nav).
4. **Perf/fuites renderer** : `REN-01` (polling + handler global), `REN-03/04/05`, `CFG-05` (observers/teardown).
5. **Accessibilite** : `A11Y-02` (focus-visible), `A11Y-01` (reduced-motion), `A11Y-03/04/05`.
6. **UX/Theme & dette** : `TB-01/02`, `THM-02/03/06/07`, `VTG-02`, puis le lot faible (logs, tokens, duplications, rebrand).

> Fichiers cles a modifier en priorite : `D:\Atom-Music-4.0\src\plugins\video-toggle\index.tsx`, `D:\Atom-Music-4.0\src\renderer.ts`, `D:\Atom-Music-4.0\src\theme\global-styles.ts`, `D:\Atom-Music-4.0\src\index.ts`, `D:\Atom-Music-4.0\src\config\defaults.ts`, `D:\Atom-Music-4.0\eslint.config.mjs`, `D:\Atom-Music-4.0\package.json`.