<div align="center">

# dsh-lowtide

**Les tâches entrent aux heures de pointe. Elles tournent seules aux heures creuses.**

<sub>Mode semi-automatique ou automatique, en évitant les heures et les tarifs de pointe des modèles. Un plugin indispensable pour DeepSeek Harness.</sub>

**Français** | [English](../README.md) | [简体中文](../README.zh-CN.md) | [繁體中文](../README.zh-HK.md) | [العربية](./README.ar.md) | [Deutsch](./README.de.md) | [Español](./README.es.md) | [Italiano](./README.it.md) | [한국어](./README.ko.md)

<img src="../assets/overview.png" alt="lowtide overview" width="100%">

</div>

> **Note sur la langue de l'interface :** dans la version actuelle, l'interface (UI) du plugin lowtide n'est disponible qu'en **chinois simplifié** et en **anglais** ; aucun autre support linguistique n'est proposé dans l'application. Ce README est une traduction française du document original en anglais, réalisée pour votre confort de lecture. Le fonctionnement du plugin ne dépend pas de la langue de ce document.

---

![hero](../assets/screenshots/hero.png)

<p align="center"><i>Trois tâches en attente dans la file, l'indicateur de prix qui brille dans l'en-tête de session, exécution automatique à l'ouverture de votre fenêtre</i></p>

## Introduction

lowtide est un plugin pour [DeepSeek Harness (dsh)](https://github.com/deepseek-ai/dsh). Le problème qu'il résout est simple et parfaitement naturel :

D'habitude, quand vous voulez qu'un agent fasse du travail, vous restez devant l'ordinateur, envoyez une instruction à l'agent, attendez la réponse, puis la relisez à la main. Mais ce flux de travail semble oublier que vous avez beaucoup de temps libre — et une occasion d'éviter les tarifs pleins/creux facturés par certains modèles.

Avec lowtide installé, la journée se déroule ainsi : dès qu'un travail vous traverse l'esprit pendant la journée, jetez-le dans la file, jetez-y un œil, libérez-le. Les tâches s'accumulent jusqu'à l'heure que vous avez définie (disons après 19 h — c'est là que DeepSeek applique ses tarifs creux), puis s'exécutent toutes seules. Le lendemain matin, vous ouvrez le rapport : gardez ce qui a bien marché, renvoyez ce qui n'a pas marché.

C'est tout. Mais utilisez-le pendant une semaine et votre rythme de travail ralentit vraiment — et n'oubliez pas que « le temps, c'est de l'argent ; l'efficacité, c'est la vie »……

Quelques capacités remarquables :

- Quatre stratégies d'exécution : unique, itérative, échantillonnage, révision — de « un seul passage suffit » à « exécute cinq candidats et je choisirai »
- 168 tests unitaires + 10 spécifications e2e, CI verte sur ubuntu / windows × node 22 / 24
- Un seul artefact de compilation sert à la fois le bureau et le web — installez une fois, ça marche partout
- L'exécution hors heures pleines atterrit dans les creux de DeepSeek : le même lot coûte environ la moitié du tarif de pointe

## Une journée normale avec un agent pourrait ressembler à ça…

**Dix minutes avant de quitter le bureau.** Vous avez fini de relire le code, alors vous déposez trois tickets pour demain : une refactorisation (itérative, 3 rondes), un rapport hebdomadaire (unique) et un design dont vous n'êtes pas sûr (échantillonnage, 4 candidats). Libérez-les tous, éteignez, partez. Demain à votre bureau, le rapport du matin dit : la refactorisation est terminée, le rapport est rédigé, et quatre designs candidats sont côte à côte, chacun avec son coût écrit.

**Vendredi soir.** Mettez en file une semaine de corvées d'un coup : nettoyage des dépendances, tests manquants, scripts de données. Les week-ends sont à tarif creux 24 h/24. Vous sortez ; il travaille à la maison. Lundi, vous consultez le rapport — relancez ce qui a échoué, fusionnez ce qui est bon.

**Une idée à 10 h du matin.** Vous êtes en pleine conversation avec l'agent à propos d'un bug urgent quand vous pensez « au fait, mets aussi à jour la doc ». La carte d'interception apparaît : l'exécuter maintenant coûte le tarif de pointe, ce soir environ la moitié — la différence est expliquée. Cliquez sur « mettre en file pour les heures creuses » ; votre brouillon survit intact, et vous revenez au bug.

**Un serveur toujours allumé.** Vous avez une machine qui fait tourner dsh 24 h/24. Passez en mode L3 entièrement automatique, puis déposez des tâches de n'importe où via l'API (`POST /ds-lowtide/tasks`). Il les exécute selon le planning et écrit le rapport. Personne ne surveille, mais la sandbox, le budget quotidien et les verrous de fichiers sont toujours là.

**Quelque chose qui part chez un client.** Utilisez la stratégie de révision : exécutez une fois, puis ouvrez automatiquement une session indépendante qui démonte le résultat selon le focus choisi (par exemple « cherche des erreurs de source de données »). Le matin, vous n'obtenez pas un résultat nu — vous obtenez un résultat plus une révision critique.

**Vivre à l'étranger.** Vous êtes à San Francisco ; le pic de DeepSeek est à l'heure de Pékin, ce qui pour vous correspond à la soirée et à la nuit de la veille. Les paramètres convertissent les heures officielles en heure locale, adoption en un clic. Vous définissez vos fenêtres selon votre propre emploi du temps, et les comptes restent toujours alignés sur le barème officiel.

## Comment fonctionne lowtide

```
① Entrée              ② Arbitrage           ③ Exécution             ④ Acceptation
Dès que vous avez un   Le dock de la file    Quand la fenêtre de      À votre retour :
moment : un clic sur   regroupe les tâches   creux s'ouvre : cinq     ouvrez le rapport —
la carte               par espace de         portes de preflight →   résultats + diff
d'interception, ou →   travail ; arbitrez →  passent, puis des       + dépense réelle
déposez un ticket      ligne par ligne :     exécutions en sandbox   + argent économisé
(4 stratégies)         ✓approuver ⏸différer  un lot par fenêtre
                       ✕abandonner / tout-approuver
```

La vie d'une tâche : `pending-review → queued → preflight → running → done / failed / stale / timeout`, plus `deferred` (différée) et `dropped` (suppression douce, restaurable).

L'étape deux est ce qui distingue lowtide d'un « script entièrement automatisé » : **chaque tâche doit être libérée par votre main avant de s'exécuter** (en L2, vous libérez tout le lot d'un coup, 30 minutes avant la fenêtre). La machine ne peut pas se glisser d'elle-même dans la file d'exécution. L'exécution est automatisée ; les décisions ne le sont pas. C'est pourquoi vous pouvez vous permettre d'être absent en toute sécurité.

## Visite guidée de l'interface lowtide

**La fenêtre modale de nouvelle tâche.** Quatre stratégies côte à côte, chacune avec une indication en langage clair ; rondes, priorité et mode d'exécution voyagent avec chaque tâche — pas besoin de repasser par les paramètres. Les tâches arrivent en « pending review ». Rien ne vous contourne pour entrer dans la file.

![new-task-modal](../assets/screenshots/new-task-modal.png)

**Options avancées.** Modèle, effort de raisonnement, priorité de 0 à 9, nouvelle session ou continuation de la précédente, et la liste des fichiers verrouillés — le tout dans un petit panneau. Fichiers verrouillés, en bref : tout élément de la liste est vérifié par sha256 avant l'exécution, et s'il ne correspond pas à ce que vous avez déposé, la tâche devient obsolète (`stale`) et refuse de s'exécuter. Sinon, le fichier contre lequel vous avez mis en file pourrait être réécrit par une autre tâche pendant l'attente, et celle-ci lui passerait dessus à l'aveugle.

![advanced-options](../assets/screenshots/advanced-options.png)

**Choisissez n'importe quel modèle.** L'exécution par lots utilise par défaut le `deepseek-v4-flash` officiel, mais chaque tâche peut choisir son propre modèle — tout ce qui est connecté à votre Harness apparaît dans la liste déroulante, groupé par fournisseur. Les fournisseurs privés fonctionnent aussi. Les modèles non officiels n'ont pas de barème public, donc le grand livre dit honnêtement « prix inconnu » ; ajoutez une dérogation de prix dans les paramètres si vous voulez une comptabilité exacte.

![model-picker](../assets/screenshots/model-picker.png)

**L'éditeur de fenêtres.** Multi-segments, de nuit, par jour de semaine — tout passe. En dessous, une bande de prix en direct sur 24 h : rouge pour le pic, vert pour le creux, et un marqueur montrant où vous êtes maintenant. Hors UTC+8, un clic sur « adopter les heures de pointe officielles » convertit l'heure de Pékin en heure locale.

![window-editor](../assets/screenshots/window-editor.png)

**La page des paramètres.** Heures de fenêtre, tâches par lot, plafond de durée par tâche, concurrence, budget quotidien, historique des rapports, niveau d'autonomie, dérogations de prix — tout est graphique, aucun fichier de configuration. Les règles tarifaires officielles (y compris le nouveau creux de tout le week-end) sont expliquées en langage humain sur la même page.

![settings](../assets/screenshots/settings.png)

Trois autres surfaces se cachent dans le flux quotidien : la **pilule de prix** (en-tête de session — occupé/inactif, compte à rebours, taille de la file ; cliquez pour éditer les fenêtres), la **carte d'interception en heures pleines** (tapez en heure pleine, elle apparaît ; la différence de prix est expliquée ; votre brouillon survit) et le **rapport d'exécution** (le briefing du matin : économies d'abord, anomalies épinglées, candidats attendant votre choix, copie Markdown en un clic).

## À propos des espaces de travail lowtide

Chaque tâche s'exécute dans un espace de travail. Cette unique liste déroulante décide de trois choses.

**Quels fichiers il peut toucher.** Les tâches s'exécutent dans une sandbox dont la frontière est le répertoire de l'espace de travail. Mauvais choix : au mieux il ne trouve pas les fichiers ; au pire il modifie ce qu'il ne devrait pas.

**Avec qui il fait la queue.** Les tâches du même espace de travail s'exécutent en série (deux tâches ne se battent jamais pour un dépôt) ; les espaces de travail différents s'exécutent en parallèle (plafond par défaut 3, réglable). Vous voulez du débit ? Répartissez le travail sans rapport entre plusieurs espaces. Vous voulez de l'ordre ? Gardez tout dans un seul.

**Comment les rapports se regroupent.** Le dock comme le rapport du matin s'organisent par espace de travail — une fois que vous avez du vrai volume, ce regroupement porte ses fruits.

La liste Espace de travail dans la fenêtre modale a trois sources : **Utiliser l'espace de travail actuel** (celui où vit votre session — le cas courant), **un espace de travail existant de la liste** (chacun avec son chemin absolu, pour toujours savoir de quel projet il s'agit), ou **Chemin personnalisé…** (à taper à la main). Si vous avez choisi « Continuer la précédente » comme mode de session, vous choisirez aussi l'espace de travail et la conversation exacte — la tâche reprend avec le contexte de cette conversation.

Mon conseil : **un projet, un espace de travail — ne mélangez pas.** L'instantané git et les verrous de fichiers du preflight sont limités à l'espace de travail ; mélanger des projets dans un même espace est un bon moyen de se perdre.

## Quatre stratégies, et quand utiliser laquelle

| Stratégie | Ce qu'elle fait | Quand y recourir | Coût |
|---|---|---|---|
| **Unique** | Un passage, terminé | Tâches simples et bien définies | 1× |
| **Itérative** | 2–5 rondes dans une même session, chacune améliorant la précédente via votre « lentille d'itération » ; s'arrête tôt quand deux rondes se ressemblent assez | Travail à polir : rédaction, plans, code | ~N× |
| **Échantillonnage** | 2–5 sessions isolées produisent chacune un candidat complet, affichés côte à côte avec leurs coûts — **vous** choisissez ; la machine ne fait aucun jugement esthétique | Titres, idées, designs : vous voulez des options, pas une réponse | ~N× |
| **Révision** | Après l'exécution, une session indépendante démonte le résultat selon votre « focus de révision » et rédige ses conclusions | Livrables importants, une dernière passe avant l'envoi | ~2× |

## Trois niveaux d'autonomie

- **L1 par tâche** : chaque tâche a besoin de votre ✓ individuel. À utiliser au début, ou quand le dépôt est précieux.
- **L2 par lot** (par défaut) : les tâches attendent en révision ; une carte de porte apparaît 30 minutes avant le lot et libère tout d'un coup ; pas de libération, pas d'exécution. Le pilier du quotidien.
- **L3 entièrement automatique** : les tâches déposées se mettent en file immédiatement et s'exécutent en sandbox pendant les heures creuses, zéro confirmation (le changement demande deux confirmations). Conçu pour les serveurs toujours allumés.

Les tâches individuelles peuvent outrepasser le niveau global dans la fenêtre modale.

## Architecture : comment il fonctionne pendant votre absence

Laisser un agent exécuter des lots pendant que vous dormez est beaucoup demander. Quatre couches en dessous rendent cela sûr.

**Le micro-noyau Cordis.** dsh tourne sur l'écosystème de plugins du micro-noyau Cordis : chaque capacité est un plugin, et les plugins communiquent par injection de services plutôt que par dépendance directe. La moitié hôte de lowtide est un ensemble de services Cordis bien disciplinés — routes, planificateur, machine à états — chacun faisant son travail, enregistrés dans le noyau, démarrant avec le harness, se désinstallant proprement. En clair : ce n'est pas une peau collée sur dsh ; c'est un organe cultivé à l'intérieur du noyau.

**Deux faces, un artefact.** La moitié hôte (Node.js) possède la planification, l'exécution et le grand livre ; la moitié navigateur (React) possède chaque pixel. Une compilation produit les deux — et comme l'interface de dsh Desktop est elle-même rendue en web, le bureau et le web n'ont pas besoin de branches séparées. Mêmes octets, même comportement.

**Un noyau indépendant de la plateforme.** `lowtide-core` contient le modèle de fenêtres, les barèmes de prix, la formule de facturation, le digest de la file, le grand livre et les calculs de fenêtres de lot — toutes fonctions pures qui ne touchent aucune API dsh, publiées dans leur propre paquet avec leurs propres tests. Le bénéfice pratique : le noyau a été martelé par 44 tests unitaires de fonctions pures, et si vous portez un jour lowtide vers un autre framework d'agents, ce paquet s'extrait intact.

**Défense en profondeur.** Cinq portes de preflight (l'espace de travail est-il toujours là, le HEAD git a-t-il bougé, les sha256 des fichiers verrouillés correspondent-ils, la fenêtre convient-elle, reste-t-il du budget) — si l'une échoue, la tâche devient obsolète ou diffère ; jamais d'exécution à l'aveugle. Trois presets de sandbox avec approbation sur « never » — en mode non surveillé, personne n'est là pour cliquer sur « autoriser », donc ce qui est permis est décidé avant le début de l'exécution. Le fichier d'état est écrit atomiquement et revient à une sauvegarde en cas de corruption. Les routes HTTP n'acceptent que les requêtes même-origine de cette machine.

La synchronisation d'état utilise SSE avec un sondage de secours de 4 secondes — la file bouge, l'interface bouge avec elle.

## Installation

**Installation en une commande (précompilé) :** `dsh plugin --profile web add https://github.com/KelaoHu/dsh-lowtide/releases/latest/download/dsh-lowtide.tgz` — ou compilez depuis les sources ci-dessous.

Prérequis : Node `^22.19 || >=24`, pnpm `11.7`. Tout est sur le registre public npm — aucun registre privé nécessaire.

Installez d'abord dsh (au choix) : Desktop depuis les canaux officiels de DeepSeek, ou `npm install -g @deepseek-ai/dsh` pour la CLI. Configurez ensuite un modèle fonctionnel dans les paramètres de dsh (par exemple une clé API officielle DeepSeek) — lowtide ne touche jamais à vos identifiants.

Puis clonez, compilez, installez :

```powershell
git clone https://github.com/KelaoHu/dsh-lowtide
cd dsh-lowtide
pnpm install

# Compilez d'abord la couche du noyau (les tests du plugin résolvent sa sortie)
pnpm --filter lowtide-core bundle
# Puis le plugin : moitié hôte + moitié navigateur en une passe
pnpm --filter dsh-lowtide bundle

# Installez dans un profil — un artefact sert le bureau et le web
npx @deepseek-ai/dsh@0.1.0-rc.7 plugin --profile desktop add ./packages/dsh-lowtide   # Desktop
npx @deepseek-ai/dsh@0.1.0-rc.7 plugin --profile web add ./packages/dsh-lowtide       # Web

# Démarrez l'instance de développement (port 3080)
pnpm --filter dsh-lowtide dev
```

Ouvrez dsh ensuite : vous devriez voir la pilule de prix dans l'en-tête de session et le dock de la file à côté de la zone de saisie. Sinon, consultez la FAQ ci-dessous.

## Utilisation au quotidien

**Trois façons de déposer une tâche.** La carte d'interception (tapez en heure pleine, un clic, votre brouillon devient le ticket inchangé) ; la fenêtre modale de tickets (« Nouveau » à côté de la zone de saisie — prompt, stratégie, rondes, priorité) ; ou l'API (`POST /ds-lowtide/tasks`, à brancher sur votre propre automatisation).

**La vie dans le dock de la file.** Groupée par espace de travail : en attente / terminées / abandonnées. En ligne par tâche : ✓ approuver, ⏸ différer, ✕ abandonner (suppression douce, restaurable). « Tout approuver » libère tout ; « nettoyer les terminées » garde l'ordre (les comptes ne sont pas affectés) ; « Exécuter maintenant » saute l'attente et lance un lot immédiatement — c'est comme ça qu'on débogue.

**Sémantique du temps.** Les heures de pointe officielles sont déterminées en **heure de Pékin** (DeepSeek facture à l'heure de Pékin, donc les comptes restent alignés ; les week-ends sont en creux toute la journée). Vos fenêtres personnalisées et la fenêtre d'exécution sont déterminées en **heure locale**, avec plages nocturnes et règles par jour de semaine. La fin de fenêtre arrête les nouveaux lancements ; les tâches en cours ne sont jamais interrompues.

**Le grand livre.** `ledger[YYYY-MM-DD] = { yuan, savedYuan }` — dépense et économies, cumulées chaque jour. Le prix affiché est le prix facturé : une formule, vérifiable au chiffre près.

## Référence de configuration

`GET /ds-lowtide/config` lit ; `PUT` met à jour partiellement (les champs non listés sont rejetés) :

| Champ | Type | Défaut | Notes |
|---|---|---|---|
| `autonomy` | `'l1'\|'l2'\|'l3'` | `l2` | Niveau d'autonomie ; dérogation par tâche dans la fenêtre modale |
| `batch.window` | `"HH:MM-HH:MM"` | `19:00-23:30` | Fenêtre d'exécution en creux (fuseau local) |
| `batch.tz` | fuseau IANA | système | Fuseau de la fenêtre d'exécution (vide = local) |
| `batch.gateLeadMin` | minutes | `30` | Anticipation de la porte du lot |
| `batch.maxTasksPerNight` | nombre | `10` | Plafond de tâches par lot |
| `batch.maxDurationMin` | minutes | `240` | Plafond de durée par tâche (annulation + un nouvel essai au délai) |
| `batch.maxConcurrency` | nombre | `3` | Concurrence max 1–8 (série par espace de travail, parallèle entre eux) |
| `batch.paused` | booléen | `false` | Mettre en pause les lots automatiques |
| `budgetDailyYuan` | ¥ | `0` | Budget quotidien (0 = illimité) |
| `windows[]` | tableau | `[]` | Fenêtres personnalisées ; vide = pic officiel (heure de Pékin) |
| `windows[].level` | `peak\|off\|custom` | — | Pic / creux / personnalisée (prix creux × multiplicateur) |
| `windows[].start/end` | `"HH:MM"` | — | Heure locale, nocturne pris en charge |
| `windows[].days` | tableau `1..7` | tous les jours | Jours ISO (1 = lun … 7 = dim) |
| `windows[].tz` | fuseau IANA | système | Fuseau par fenêtre |
| `windows[].multiplier` | nombre | `1` | Multiplicateur de prix creux pour les fenêtres personnalisées |
| `prices[model].{peak,off}.{input,inputCached,output}` | ¥/1M | officiel | Dérogations au barème |

## API HTTP

Préfixe `/ds-lowtide/`, derrière la barrière de confiance même-origine + loopback :

| Méthode | Chemin | Objet |
|---|---|---|
| GET | `/state` | État agrégé (prix/compte à rebours/file/dernier rapport) |
| GET | `/events` | Push incrémental SSE (le client retombe sur un sondage de 4 s) |
| GET/PUT | `/config` | Lire/écrire la configuration |
| POST | `/tasks` | Déposer un ticket |
| POST | `/tasks/:id/approve \| defer \| drop \| cancel \| retry \| restore \| delete \| choose-candidate` | Arbitrage et gestion |
| POST | `/tasks/approve-all` | Tout approuver |
| POST | `/estimate` | Estimation : pic vs creux |
| POST | `/batch/run-now` | Exécuter le lot maintenant |
| POST | `/dismiss` | Pas d'interception pour le reste de la journée |
| GET | `/health` | Battement de cœur |

## Presets de permissions

| preset | sandbox | approbation |
|---|---|---|
| `lt-readonly` | read-only | never |
| `lt-standard` | workspace-write | never |
| `lt-trusted` | danger-full-access | never |

L'interface d'entrée n'offre pas de choix — toutes les tâches s'exécutent sous `lt-standard` ; les deux autres restent pour les appelants API (`permissionPreset` sur `POST /tasks`). Rien ne s'exécute sans preflight.

## Données et état

- Tout persiste dans `$DSH_HOME/lowtide.json` (écritures atomiques, retour arrière automatique en cas de corruption) ; avec `DSH_PROFILE` défini, l'état est isolé par profil. **Un seul écrivain par fichier à la fois** — ne lancez pas Desktop et Web en même temps sans isolation de profil.
- Un lot par fenêtre, sûr la nuit ; une file vide ne produit pas de rapport vide.
- Récupération des différées : à l'ouverture de la fenêtre, les tâches différées par preflight se remettent en file automatiquement (échec après ≥3) ; les différées manuellement reviennent en pending-review.

## Tests et CI

```powershell
pnpm --filter lowtide-core test    # 44 tests de noyau en fonctions pures
pnpm --filter dsh-lowtide test     # 124 tests unitaires du plugin
pnpm --filter dsh-lowtide exec playwright test   # e2e (nécessite dsh web sur :3080)
```

Dix spécifications e2e s'exécutent en série, du test de fumée de chargement double face jusqu'à la boucle complète entrée→arbitrage→exécution→rapport contre la vraie API. Le dépôt inclut un workflow GitHub Actions : chaque push / PR exécute install → build → typecheck → la suite unitaire complète sur quatre environnements.

## Sécurité

- Les routes n'acceptent que loopback + même-origine ; **n'exposez pas le port 3080 sur Internet public** — utilisez un tunnel SSH ou un proxy inverse authentifié.
- La sandbox Windows est de niveau atténuation ; Linux/macOS imposent pleinement. Pour un usage non surveillé, cumulez la liste blanche de fichiers et le budget quotidien.
- Passer en L3 entièrement automatique demande deux confirmations.
- Le fichier d'état contient les prompts complets et les chemins ; traitez les sauvegardes en conséquence.
- Signalez les vulnérabilités en privé via [SECURITY.md](../SECURITY.md).

## FAQ

**La fenêtre est arrivée et rien ne s'est exécuté ?**
Vérifiez dans l'ordre : tâches approuvées ? → « pause des lots en creux » coché ? → porte libérée ? → budget épuisé ? → preflight échoué (la tâche devient `stale`, motif dans la vue de détail) ?

**Pourquoi l'échantillonnage ne choisit-il pas automatiquement le gagnant ?**
Volontairement. La machine ne fait aucun jugement esthétique — candidats et coûts sont côte à côte, et vous cliquez sur « choisir celui-ci ».

**Je suis à l'étranger et les heures de pointe ne correspondent pas à mon rythme ?**
Les paramètres montrent à quoi ressemblent les heures officielles localement ; définissez des fenêtres personnalisées pour votre propre rythme, ou cliquez sur « adopter les heures de pointe officielles (converties dans mon fuseau) ».

**L'estimation et la dépense réelle ne correspondent pas ?**
Les estimations utilisent une borne supérieure approximative de tokens d'entrée ; la dépense réelle utilise l'usage réel (sortie et hits de cache inclus). Les deux chiffres figurent dans le rapport.

**Une tâche est devenue obsolète (`stale`) ?**
Preflight échoué : espace de travail disparu, instantané git déplacé, fichier verrouillé modifié, budget insuffisant ou fenêtre trop petite. Lisez `lastError` dans les détails, corrigez, `retry`.

## Limitations connues et feuille de route

- Candidat à la version (v0.1.1), installé depuis les sources ; e2e nécessite une instance dsh web vivante.
- Le modèle de lot par défaut est `deepseek-v4-flash` ; les modèles non officiels n'ont pas de barème public — le grand livre les marque « prix inconnu », remplissable dans les paramètres.
- Plafond par tâche de 240 minutes ; le délai dépassé annule et réessaie une fois.
- Candidats de la feuille de route : fenêtres et lots multiples, graphes de dépendance de tâches, répartition automatique du budget, envoi de rapports (email/Webhook), alertes de changement de prix.

## Structure du dépôt

```
dsh-lowtide/
├── README.md                  English
├── README.zh-CN.md            Version en chinois simplifié
├── README.zh-HK.md            Version en chinois traditionnel
├── assets/screenshots/        Captures du README
├── docs/                      README multilingues (ar, de, es, fr, it, ko)
├── LICENSE                    MIT
├── CHANGELOG.md               Historique des versions
├── CONTRIBUTING.md            Guide de contribution
├── CODE_OF_CONDUCT.md         Code de conduite
├── SECURITY.md                Politique de sécurité
├── .github/                   Workflow CI + modèles d'issue/PR
├── package.json               Racine du workspace pnpm
└── packages/
    ├── core/                  Noyau indépendant de la plateforme (lowtide-core)
    │   ├── src/               windows / pricing / model / digest / ledger / scheduler
    │   └── test/              Tests unitaires de fonctions pures
    └── dsh/                   Le plugin (dsh-lowtide)
        ├── src/               Moitié hôte : routes / runner / scheduler / intake / store / state-machine
        ├── client/            Moitié navigateur : components / hooks / i18n / store
        ├── test/              Tests unitaires + e2e (Playwright)
        ├── cordis.patch.yml   Ligne du plugin + presets de permissions lt-*
        └── README.md          README au niveau du paquet
```

## Quelques mots honnêtes

Que ce plugin Harness soit du peuple, par le peuple et pour le peuple. Que la sagesse de la communauté open source et la volonté de collaborer ne périssent jamais de la surface de la Terre.

## Licence et remerciements

Licence MIT (voir [LICENSE](../LICENSE)).

- Construit sur [DeepSeek Harness (dsh)](https://github.com/deepseek-ai/dsh) · l'écosystème de plugins Cordis
- [Annonce tarifaire de DeepSeek (2026-08-13)](https://finance.eastmoney.com/a/202608133840616378.html) · [couverture de la date d'effet (2026-08-17)](https://www.dzwww.com/news/ssnews/202608/t20260817_18025522.htm) · [avis sur les tarifs du week-end](https://www.ithome.com/0/993/095.htm)

---

> **Rappel final :** l'interface du plugin lowtide ne prend en charge que le **chinois simplifié** et l'**anglais** dans cette version. Ce README en français est une traduction de courtoisie ; en cas de divergence, le document original en anglais (`README.md`) fait foi.
