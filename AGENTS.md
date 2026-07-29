# AGENTS.md

Guide pour les agents IA travaillant sur ce dépôt.

## Contexte du projet

Package de nœuds communautaires n8n, écrit en TypeScript, publié sous le nom
`n8n-nodes-frappe-helpdesk` (dépôt : github.com/tsnaketech/n8n-nodes-frappe-helpdesk).

Objectif : une **suite** de nœuds pour les applications Frappe. Ce dépôt ne contient que le
nœud Frappe Helpdesk. Les nœuds Frappe CRM et Frappe HRMS existent déjà, mais **dans des
packages npm frères** (`n8n-nodes-frappe-crm`, `n8n-nodes-frappe-hrms`), pas ici. Le nœud
Frappe LMS reste à créer. Le template de départ (`ExampleNode` / `ExampleApi`) a été
supprimé.

Le point structurant : les quatre applications tournent sur le même site Frappe et
partagent la même authentification. Le credential `frappeApi` est donc **unique et
générique** — il ne connaît que la racine du site, jamais un doctype ni un produit. Ne pas
créer de credential par application. Voir `docs/CREDENTIALS.md`, qui fait référence sur ce
point.

Conséquence d'empaquetage à ne pas confondre avec une duplication : n8n charge les
credentials **par package npm**, donc chaque package embarque sa propre copie de
`credentials/FrappeApi.credentials.ts`. Les trois copies exposent le même
`name = 'frappeApi'` et les mêmes noms de champs, si bien que l'utilisateur ne voit qu'un
seul type « Frappe API ». **Toute modification de ce fichier doit être répercutée à
l'identique dans `n8n-nodes-frappe-crm` et `n8n-nodes-frappe-hrms`.**

Le dépôt n'est pas initialisé sous git (`git init` reste à faire si besoin).

## Structure

```
nodes/FrappeHelpdesk/FrappeHelpdesk.node.ts   Nœud (programmatique, routeur execute + loadOptions)
nodes/FrappeHelpdesk/GenericFunctions.ts      Transport Frappe : requêtes, pagination, erreurs
nodes/FrappeHelpdesk/types.ts                 Map resource n8n -> doctype Frappe
nodes/FrappeHelpdesk/descriptions/            Propriétés UI, un fichier par resource
credentials/FrappeApi.credentials.ts          Credential partagé (siteUrl + apiKey + apiSecret)
icons/frappe-helpdesk.svg                     Icône du nœud (badge violet opaque, fichier unique)
icons/frappe.svg, frappe.dark.svg             Icônes light/dark référencées par le credential
docs/CREDENTIALS.md                           Architecture du credential partagé
.github/workflows/ci.yml                      lint + build sur PR et push sur main
.github/workflows/publish.yml                 Publication npm avec provenance sur tag *.*.*
```

`GenericFunctions.ts` est volontairement dépourvu de logique Helpdesk : c'est la couche que
le futur nœud LMS importera. Toute logique propre à un doctype va dans
`FrappeHelpdesk.node.ts`. À partir d'un deuxième nœud dans **ce** package, déplacer ce
fichier vers `nodes/shared/`.

## Doctypes Frappe Helpdesk

Noms vérifiés dans `helpdesk/helpdesk/doctype/` du dépôt frappe/helpdesk, branches `main`
et `develop`. À ne pas deviner :

| Resource        | Doctype              |
| --------------- | -------------------- |
| Ticket          | `HD Ticket`          |
| Customer        | `HD Customer`        |
| Team            | `HD Team`            |
| Ticket Priority | `HD Ticket Priority` |
| Ticket Type     | `HD Ticket Type`     |

Deux doctypes sont **lus sans être exposés** comme resources, uniquement pour alimenter les
listes déroulantes : `HD Ticket Status` et `HD Agent`.

Quatre pièges vérifiés dans la source, à ne pas réintroduire :

- **`HD Ticket.status` est un `Link` vers `HD Ticket Status`, pas un `Select`.** Les statuts
  sont des enregistrements ; `Open` / `Replied` / `Resolved` / `Closed` ne sont que les
  quatre lignes insérées par `add_default_status()` dans `helpdesk/setup/install.py`. D'où
  le `loadOptions` `getTicketStatuses` plutôt qu'une énumération figée, et son repli sur
  `DEFAULT_TICKET_STATUSES` si le doctype est injoignable. C'est le champ `category`
  (`Open` / `Paused` / `Resolved`) qui pilote la SLA, pas le libellé : filtrer sur
  `status_category` est plus robuste que filtrer sur `status`.
- **L'assignation ne passe pas par le CRUD.** `_assign` n'est pas un champ stocké : c'est
  une colonne maintenue par `frappe.desk.form.assign_to`, doublée d'un `ToDo`. Le nœud
  appelle donc la méthode de contrôleur `HDTicket.assign_agent`, qui ajoute en plus la
  `HD Notification` affichée à l'agent. Elle est décorée `@agent_only` : **l'utilisateur des
  clés API doit être un `HD Agent`**, le rôle `Agent` ne suffit pas.
- **Le changement de statut, lui, n'a aucun endpoint custom.** Rien dans `helpdesk/api/` ne
  s'en charge ; la logique vit dans le `on_update` de `HD Ticket`. Un `PUT` ordinaire suffit
  et déclenche bien le recalcul SLA. Ne pas inventer d'appel `/api/method/` pour ça.
- **`HD Ticket Priority` et `HD Ticket Type` sont en `autoname: "Prompt"`** : le `name` du
  document *est* le libellé (`Urgent`, `Question`). Il n'y a pas de champ titre séparé. Même
  logique de nommage par champ sur `HD Team` (`team_name`) et `HD Customer`
  (`customer_name`) — renommer l'un renomme le document et tous les liens qui y pointent.

`HD Ticket` utilise `autoname: ".####"` : les IDs sont des compteurs nus (`214`), sans
préfixe. Le doctype **n'est pas soumissible** — contrairement à ceux du package HRMS, il n'y
a pas de `docstatus` à gérer.

`tsconfig.json` compile `credentials/**` et `nodes/**` vers `dist/`. Les chemins déclarés
dans `package.json` → `n8n.nodes` / `n8n.credentials` pointent vers `dist/`, pas vers les
sources : **toute création ou renommage de nœud doit être répercuté dans ces deux tableaux**,
sinon n8n ne charge rien et il n'y a aucune erreur explicite.

## Commandes

```bash
npm install          # node_modules n'est pas versionné
npm run build        # n8n-node build → dist/ (JS compilé + icônes copiées)
npm run build:watch  # tsc --watch
npm run dev          # n8n-node dev (boucle de dev avec n8n)
npm run lint         # n8n-node lint — même commande que la CI
npm run lint:fix
npm run release      # release interactive : lint, build, bump, tag, push → déclenche publish.yml
```

La CI n'exécute que `npm ci`, `npm run lint`, `npm run build`. Il n'y a **aucun test**
dans le dépôt et aucun runner de test configuré ; ne pas inventer `npm test`. Si un
changement mérite d'être vérifié, le faire via `npm run build` puis un chargement réel
dans n8n (voir README, section « Testing locally in n8n »).

`npm run lint` sort en 0 avec **un warning attendu** : `icon-prefer-themed-variants`, parce
que l'icône du nœud est un fichier unique. C'est un choix — le badge violet `#7d3dff` porte
son propre fond et tient le contraste sur les deux thèmes ; la forme `{ light, dark }`
exigerait deux fichiers distincts, donc une teinte différente sur l'un des thèmes. Ne pas
« corriger » ce warning sans en discuter. Le package HRMS fait le même choix.

## Conventions de code

- Prettier (`.prettierrc.js`) : **tabulations**, largeur 100, guillemets simples, points-virgules,
  virgules finales partout, fins de ligne LF. Attention : les fichiers `.ts` de ce dépôt sont
  indentés en tabulations, mais le package CRM contient encore des fichiers en espaces (2).
  Suivre l'indentation du fichier qu'on modifie plutôt que de reformater en masse ; un
  reformatage global doit être une tâche à part, explicitement demandée.
- ESLint : config `@n8n/node-cli/eslint`, non personnalisée. Elle impose les règles n8n sur
  le nommage des paramètres, `displayName`, l'ordre des options, etc. — ces erreurs de lint
  sont des vraies contraintes de la plateforme, ne pas les désactiver avec un commentaire
  sans raison.
- TypeScript en `strict`, avec `noUnusedLocals` et `noImplicitReturns` : du code mort ou une
  branche sans `return` casse le build.
- Importer les types depuis `n8n-workflow` en `import type`, et les valeurs
  (`NodeConnectionTypes`, `NodeApiError`, `NodeOperationError`) en import normal.

## Patterns n8n à respecter

- Requêtes HTTP : passer par `this.helpers.httpRequestWithAuthentication.call(this, '<credName>', {...})`
  plutôt que `fetch`/`axios`. Cela applique les credentials et le proxy de l'instance.
- Boucle sur les items : itérer `this.getInputData()`, renseigner `pairedItem: { item: i }` sur
  chaque sortie, et honorer `this.continueOnFail()` avant de relancer l'erreur.
- Erreurs : `throw new NodeOperationError(this.getNode(), error, { itemIndex: i })`.
  Ne pas laisser remonter une `Error` brute.
- Le nœud expose `usableAsTool: true` (utilisable par les agents IA n8n) — garder les
  `description` et `action` des opérations lisibles, elles servent de doc à l'agent.
- Erreurs Frappe : passer par `parseFrappeError()`. Frappe renvoie ses messages dans
  `_server_messages`, du JSON encodé **dans** du JSON et truffé de HTML ; remonter le code
  HTTP brut ne renseigne pas l'utilisateur. Les requêtes utilisent donc
  `ignoreHttpStatusErrors` pour inspecter le corps avant de lever une `NodeApiError`.
- Champs dynamiques : les listes Status, Priority, Ticket Type, Team et Agent sont des
  `loadOptions` interrogeant le site. Les règles ESLint n8n imposent alors un `displayName`
  suffixé « Name or ID » (ou « Names or IDs » en `multiOptions`) et une `description`
  strictement égale au texte « Choose from the list, or specify… ». Ne pas y ajouter de
  précision métier : elle a sa place dans le README, pas dans ce champ.
- **Pas de normalisation de dates ici, contrairement au nœud HRMS.** Tous les champs Date /
  Datetime de `HD Ticket` (`response_by`, `resolution_by`, `opening_date`, `resolution_date`,
  `first_responded_on`…) sont `read_only` : Frappe les calcule. Le nœud n'expose donc **aucun
  champ date en écriture**, et l'équivalent de `normalizeDates()` serait du code mort. Si un
  champ date écrivable apparaît un jour, reprendre l'implémentation du package HRMS — et
  surtout ne pas faire `toISOString()`, Frappe stocke des datetimes naïfs interprétés dans le
  fuseau du site.

## Attention avec `npm run lint:fix`

L'autofix de `node-param-description-missing-final-period` **casse les descriptions
construites en template literal** : il a déjà remplacé une description
`` `... ${hint}` `` par une chaîne littérale tronquée, supprimant l'interpolation au
passage (le build ne le voit pas, seul `noUnusedLocals` a signalé le paramètre devenu
inutilisé). `CommonDescription.ts` construit précisément ses `description` et `action` par
interpolation. Après un `lint:fix`, relire le diff des fichiers `descriptions/` plutôt que
de le supposer sûr — ou corriger la ponctuation à la main, ce que fait ce dépôt.

## Documentation

Quatre READMEs traduits (`README.md`, `.fr.md`, `.es.md`, `.de.md`). Un changement visible par
l'utilisateur (nouvelle opération, nouveau credential, prérequis) doit être répercuté dans
**les quatre**, sinon les traductions divergent silencieusement.

`docs/CREDENTIALS.md` tient le tableau des nœuds consommateurs du credential partagé. Il est
dupliqué dans les packages CRM et HRMS : quand l'état d'un nœud de la suite change, penser à
le mettre à jour là-bas aussi.

## Publication

`publish.yml` se déclenche sur un tag `*.*.*` et publie sur npm avec provenance
(exigence n8n depuis mai 2026). Nécessite `@n8n/node-cli` ≥ 0.23.0. Ne pas publier
manuellement (`npm publish`) : cela produit un package sans attestation de provenance,
que n8n refusera.
