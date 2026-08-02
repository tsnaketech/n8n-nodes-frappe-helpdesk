# n8n-nodes-frappe-helpdesk

Package de nœuds communautaires n8n pour [Frappe Helpdesk](https://frappe.io/helpdesk). Il permet de lire et écrire les tickets, les clients et les équipes, et de lire la configuration des priorités et des types de tickets, depuis vos workflows n8n.

[n8n](https://n8n.io/) est une plateforme d'automatisation de workflows sous [licence fair-code](https://docs.n8n.io/reference/license/).

Autres langues : [English](README.md) · [Español](README.es.md) · [Deutsch](README.de.md)

[Installation](#installation)
[Credentials](#credentials)
[Opérations](#opérations)
[Utilisation](#utilisation)
[Compatibilité](#compatibilité)
[Ressources](#ressources)
[Historique des versions](#historique-des-versions)
[Développement](#développement)

## Installation

Suivez le [guide d'installation](https://docs.n8n.io/integrations/community-nodes/installation/) de la documentation n8n sur les nœuds communautaires, avec `n8n-nodes-frappe-helpdesk` comme nom de package.

**Auto-hébergé, via l'interface n8n** — allez dans **Settings > Community nodes > Install**, saisissez `n8n-nodes-frappe-helpdesk` et validez.

**Auto-hébergé, manuellement :**

```bash
cd ~/.n8n/custom
npm install n8n-nodes-frappe-helpdesk
```

Redémarrez n8n, puis cherchez « Frappe Helpdesk » dans le panneau des nœuds.

## Credentials

Ce package utilise un seul type de credential, **Frappe API** (`frappeApi`) — le *même* que celui des nœuds Frappe CRM et Frappe HRMS. S'il est déjà configuré, le nœud Frappe Helpdesk peut le sélectionner directement.

### Générer les clés API dans Frappe

1. Sur votre site Frappe, ouvrez l'utilisateur au nom duquel n8n doit agir (`/app/user`).
2. Descendez jusqu'à **Settings > API Access** et cliquez sur **Generate Keys**.
3. Copiez l'**API Secret** — il n'est affiché qu'une fois — ainsi que l'**API Key** visible sur la fiche utilisateur.

Le nœud agit **en tant que cet utilisateur** : il hérite de ses rôles et de ses permissions. Si un appel échoue sur une erreur de permission, regardez les rôles sur le doctype avant de soupçonner le credential.

### Renseigner le credential

| Champ      | Exemple                         | Remarques                                                                |
| ---------- | ------------------------------- | ------------------------------------------------------------------------ |
| Site URL   | `https://mon-site.frappe.cloud` | Racine du site. Un `/helpdesk` ou un `/` final est retiré automatiquement |
| API Key    | `a1b2c3d4e5f6g7h`               |                                                                          |
| API Secret | `s1e2c3r4e5t6`                  | Stocké chiffré par n8n                                                   |

Les requêtes sont authentifiées par le header `Authorization: token {apiKey}:{apiSecret}`. Utilisez **Test** pour valider la connexion : l'appel vise `/api/method/frappe.auth.get_logged_user` et échoue si le site répond en tant que `Guest`, ce que Frappe renvoie quand les clés ne sont pas reconnues.

Le `/helpdesk` final est retiré pour une raison concrète : `/api/…` n'existe qu'à la racine du site, et sous un chemin d'application la requête est interceptée par le routeur front, qui répond **200 avec `index.html`** au lieu d'une erreur. Avant que ce nettoyage ne soit appliqué aussi au test de connexion, une Site URL finissant par `/helpdesk` faisait réussir **Test** même avec des clés totalement fausses. Un chemin inconnu comme `/support` est inoffensif en comparaison : il renvoie un 404 franc.

### Un seul credential pour tous les nœuds Frappe

`frappeApi` n'est volontairement **pas** spécifique au Helpdesk. Frappe authentifie un *utilisateur sur un site*, pas une application : la même clé API vaut pour Frappe Helpdesk, Frappe CRM, Frappe HR et Frappe LMS, qui vivent sur le même site et partagent le même endpoint `/api`.

Créez un credential par *site* (`Frappe – prod`, `Frappe – recette`), pas par application. Voir [docs/CREDENTIALS.md](docs/CREDENTIALS.md) pour l'architecture complète, la liste des nœuds consommateurs et les rôles Frappe requis par chaque opération.

> L'utilisateur dont vous utilisez les clés doit pouvoir agir comme un agent pour que l'opération **Assign** fonctionne — voir [Assigner un ticket à un agent](#assigner-un-ticket-à-un-agent).

## Opérations

| Resource        | Doctype Frappe       | Opérations                                                          |
| --------------- | -------------------- | ------------------------------------------------------------------- |
| Ticket          | `HD Ticket`          | Create, Get, Get Many, Update, Delete, **Assign**, **Change Status** |
| Customer        | `HD Customer`        | Create, Get, Get Many, Update, Delete                                |
| Team            | `HD Team`            | Create, Get, Get Many, Update, Delete                                |
| Ticket Priority | `HD Ticket Priority` | Get, Get Many — lecture seule                                        |
| Ticket Type     | `HD Ticket Type`     | Get, Get Many — lecture seule                                        |

Toutes les opérations passent par l'API REST standard de Frappe, `/api/resource/{doctype}`, en `GET`, `POST`, `PUT` et `DELETE`. Seule exception : **Assign**, qui appelle une méthode de contrôleur du Helpdesk — voir plus bas.

Les noms de doctypes ont été vérifiés sur [github.com/frappe/helpdesk](https://github.com/frappe/helpdesk) (`helpdesk/helpdesk/doctype/`), sur les branches `main` et `develop`.

Le nœud *lit* également deux doctypes qu'il n'expose pas comme resources : `HD Ticket Status` et `HD Agent`, pour alimenter les listes déroulantes Status et Agent.

> **Les priorités et les types de tickets sont en lecture seule, volontairement.**
> Ce sont des données de configuration, pas des données métier. `HD Service Level Agreement` relie chaque priorité à un objectif de réponse et de résolution via sa table enfant `priorities` : créer une priorité depuis un workflow produirait une priorité qu'aucune SLA ne connaît, et en supprimer une casserait tous les tickets et toutes les lignes de SLA qui la référencent. Frappe installe `Urgent`, `High`, `Medium` et `Low` à l'installation. Les deux doctypes utilisent `autoname: "Prompt"` : le `name` du document **est** le libellé — `Urgent`, `Question`.

### Le statut d'un ticket est un lien, pas une liste figée

C'est le point à connaître avant d'écrire un workflow : **`HD Ticket.status` est un `Link` vers le doctype `HD Ticket Status`**, pas un `Select`. Les statuts sont des enregistrements, et un Helpdesk peut définir les siens — avec leur libellé, leur couleur, leur ordre, et un libellé distinct affiché aux clients.

`Open`, `Replied`, `Resolved` et `Closed` ne sont que les quatre lignes insérées par `add_default_status()` à l'installation. Chacune porte une `category` valant `Open`, `Paused` ou `Resolved`, et c'est elle qui pilote réellement le décompte SLA :

| Statut par défaut | Catégorie  | Effet sur la SLA     |
| ----------------- | ---------- | -------------------- |
| `Open`            | `Open`     | Le compteur tourne   |
| `Replied`         | `Paused`   | En attente du client |
| `Resolved`        | `Resolved` | Arrêté               |
| `Closed`          | `Resolved` | Arrêté               |

Le nœud charge donc la liste des statuts **depuis votre site** plutôt que de la coder en dur : les statuts personnalisés apparaissent sans modification du nœud. Si le doctype est injoignable — Helpdesk antérieur à `HD Ticket Status` — la liste retombe sur les quatre valeurs par défaut au lieu de casser.

Les listes Priority, Ticket Type, Team et Agent sont chargées depuis le site de la même façon. Chacune accepte aussi une [expression](https://docs.n8n.io/code/expressions/) : une valeur calculée en amont fonctionne aussi bien qu'une valeur choisie dans la liste.

### Assigner un ticket à un agent

L'assignation n'est **pas** une mise à jour de champ, d'où une opération dédiée plutôt qu'une case dans *Update*. Dans Frappe, une assignation est un document `ToDo` accompagné d'une colonne `_assign` maintenue en parallèle — `_assign` n'est pas un champ stocké que l'on peut `PUT`.

Le nœud appelle la méthode de contrôleur `assign_agent` du Helpdesk, via la route REST que Frappe monte exactement pour cet usage :

```
POST /api/resource/HD Ticket/{name}
{ "run_method": "assign_agent", "agent": "agent@example.com" }
```

`run_method` voyage dans le **corps** de la requête, à côté des arguments de la méthode — et non dans la query string. Frappe reconstruit `form_dict` à partir du corps JSON dès qu'il y en a un, et les paramètres de la query string sont perdus au passage : `?run_method=…` accompagné d'un corps répond `KeyError: 'run_method'` (vérifié sur Frappe 15.116, puis de nouveau sur 16.29.0).

Cette méthode encapsule `frappe.desk.form.assign_to.add` **et** déclenche la notification interne **HD Notification** que l'interface Helpdesk affiche à l'agent — ce qu'un `assign_to.add` direct ne ferait pas.

Deux conséquences :

- **L'utilisateur du credential doit pouvoir agir comme un agent** — et ce contrôle dépend de la version. Sur `develop`, `assign_agent` est décorée `@agent_only` ; sur le Helpdesk publié (vérifié sur 1.28.1) elle ne porte que `@frappe.whitelist()`, seules les permissions Frappe habituelles s'appliquent alors. Là où le contrôle existe, `helpdesk.utils.is_agent()` accepte trois choses au choix : `Administrator`, le rôle `Agent` ou `Agent Manager`, ou un enregistrement `HD Agent` pour cet utilisateur. Le rôle `Agent` suffit donc — inutile de créer un `HD Agent` en plus.
- **L'assignation est additive.** Frappe ajoute à `_assign` et ignore silencieusement un doublon : un ticket peut donc se retrouver avec plusieurs responsables. Activez **Replace Existing Assignees** dans *Assign Options* pour vider les assignés en place d'abord — c'est le seul moyen d'exprimer « cet agent et lui seul ».

La valeur attendue est une **adresse email**, pas un code `HD Agent` : `HD Agent` fixe lui-même le `name` de son document à la valeur du `User` lié dans `before_save`, les deux chaînes sont donc identiques.

Le changement de statut, lui, n'a **aucun** endpoint custom — `helpdesk/api/` n'en expose pas, et la logique de transition vit dans le `on_update` de `HD Ticket`. **Change Status** est donc un simple `PUT`, ce qui déclenche malgré tout le recalcul de la SLA et l'email de feedback.

### Options de « Get Many »

| Option             | Correspond à                      | Remarques                                                   |
| ------------------ | --------------------------------- | ----------------------------------------------------------- |
| Return All         | pagination auto sur `limit_start` | Récupère 100 enregistrements par requête jusqu'à la fin     |
| Limit              | `limit_page_length`               | Utilisé quand Return All est désactivé                      |
| Offset             | `limit_start`                     | Ignoré quand Return All est actif                           |
| Fields             | `fields`                          | Séparés par des virgules, ou tableau JSON. Défaut : `["*"]` |
| Filters (JSON)     | `filters`                         | Syntaxe de filtres Frappe                                   |
| Or Filters (JSON)  | `or_filters`                      | Même syntaxe, combinée en OU                                |
| Sort Field / Order | `order_by`                        | par ex. `modified desc`                                     |

Sans `fields`, Frappe ne renvoie que la colonne `name` : le nœud passe donc `["*"]` par défaut pour vous donner le document complet.

Les filtres acceptent les deux formes Frappe — un objet pour une égalité simple, ou un tableau de triplets pour les opérateurs :

```json
{ "status": "Open" }
```

```json
[["priority", "in", ["Urgent", "High"]], ["status", "!=", "Closed"]]
```

### Champs en lecture seule

`HD Ticket` porte une large surface calculée que le nœud n'expose pas, parce que Frappe écrase ce qu'on lui envoie : tout le bloc SLA (`response_by`, `resolution_by`, `agreement_status`, `total_hold_time`), les temps de réponse et de résolution (`first_responded_on`, `resolution_date`, `avg_response_time`), le bloc feedback, et la comptabilité de fusion (`is_merged`, `merged_with`, `status_category`).

Même logique sur `HD Customer` : `email_id` et `mobile_no` sont `read_only` avec un `fetch_from` sur `primary_contact`. Renseignez le contact principal et laissez Frappe les remplir. Sur `HD Team`, `assignment_rule` est en lecture seule — le Helpdesk crée lui-même le document `Assignment Rule` sous-jacent à l'enregistrement de l'équipe.

Contrairement aux doctypes de Frappe HRMS, **`HD Ticket` n'est pas soumissible** : pas de `docstatus` à gérer, et Update fonctionne sur n'importe quel ticket à n'importe quel moment de sa vie.

### Gestion des erreurs

Frappe remonte ses erreurs dans un champ `_server_messages` qui contient du JSON encodé *dans* du JSON, souvent truffé de HTML. Le nœud le déballe et expose le vrai message : vous obtenez `Value missing for HD Ticket: Subject` plutôt que `Request failed with status code 417`. Il se rabat ensuite sur le champ `exception`, puis sur le code HTTP.

Les réponses `401` et `403` portent une indication supplémentaire pointant vers le rôle Frappe plutôt que vers le credential, parce que c'est presque toujours la cause.

## Utilisation

Chaque exemple ci-dessous est un nœud à coller dans un workflow n8n. Remplacez le bloc `credentials` par le vôtre.

### Ticket — création

```json
{
	"parameters": {
		"resource": "ticket",
		"operation": "create",
		"subject": "Le PDF de facture ne se télécharge pas",
		"additionalFields": {
			"raised_by": "claire@acme.io",
			"description": "<p>Le bouton <b>Télécharger</b> de la facture INV-2026-0042 renvoie une 500.</p>",
			"priority": "High",
			"ticket_type": "Bug",
			"agent_group": "Billing",
			"customer": "Acme SAS",
			"status": "Open"
		}
	},
	"type": "n8n-nodes-frappe-helpdesk.frappeHelpdesk",
	"typeVersion": 1,
	"name": "Create Ticket",
	"position": [0, 0],
	"credentials": { "frappeApi": { "id": "1", "name": "Frappe account" } }
}
```

`subject` est le seul champ que le doctype déclare `reqd`. `description` est un champ Text Editor côté Frappe : il accepte du HTML. `priority`, `ticket_type`, `agent_group` (libellé **Team**) et `status` sont des Links : la valeur doit être le `name` d'un enregistrement existant — qui, pour les priorités et les types, est le libellé lui-même.

Omettez `status` et le Helpdesk applique le `default_ticket_status` du site, soit `Open` sur une installation standard.

Un piège qui vient du Helpdesk et non du nœud : renseigner `agent_group` déclenche l'**Assignment Rule** de l'équipe, et une équipe sans membres fait échouer cette règle sur `list index out of range`. L'équipe `Billing` créée par une installation neuve est exactement dans cet état. Donnez des membres à l'équipe, ou laissez `agent_group` de côté.

### Ticket — changement de statut

```json
{
	"parameters": {
		"resource": "ticket",
		"operation": "changeStatus",
		"documentId": "214",
		"status": "Resolved"
	},
	"type": "n8n-nodes-frappe-helpdesk.frappeHelpdesk",
	"typeVersion": 1,
	"name": "Resolve Ticket",
	"position": [0, 0],
	"credentials": { "frappeApi": { "id": "1", "name": "Frappe account" } }
}
```

`HD Ticket` utilise `autoname: ".####"` : `documentId` est un simple compteur — `214`, pas un code préfixé. La sortie est le ticket mis à jour, ce qui permet à un nœud en aval de brancher sur `status_category` pour distinguer « résolu » de « en pause » sans connaître vos libellés de statut.

### Ticket — assignation à un agent

```json
{
	"parameters": {
		"resource": "ticket",
		"operation": "assign",
		"documentId": "214",
		"agent": "marie@acme.io",
		"assignOptions": {
			"replace": true
		}
	},
	"type": "n8n-nodes-frappe-helpdesk.frappeHelpdesk",
	"typeVersion": 1,
	"name": "Assign Ticket",
	"position": [0, 0],
	"credentials": { "frappeApi": { "id": "1", "name": "Frappe account" } }
}
```

`agent` est l'email de l'agent. Avec `replace` désactivé (le défaut), l'agent est *ajouté* aux assignés existants ; activé, les assignés en place sont retirés d'abord.

Le nœud renvoie le ticket relu après l'assignation — `assign_agent` répond de son côté avec une enveloppe vide — avec `_assign` réinjecté dedans.

Cette réinjection est nécessaire : `_assign` est une colonne que Frappe maintient lui-même, pas un champ du doctype, et `GET /api/resource/HD Ticket/{name}` construit sa réponse à partir des métadonnées du doctype — il ne la renvoie donc jamais. Seule une requête de liste nommant `_assign` dans `fields` la retourne, d'où la requête supplémentaire que fait le nœud. La valeur conserve dans les deux cas la forme que Frappe stocke : un tableau encodé en JSON, `"[\"marie@acme.io\"]"`.

### Ticket — liste

Tous les tickets ouverts ou en attente de l'équipe Billing, du plus ancien au plus récent :

```json
{
	"parameters": {
		"resource": "ticket",
		"operation": "getAll",
		"returnAll": true,
		"options": {
			"fields": "name,subject,status,priority,customer,agent_group,_assign,creation",
			"filters": "[[\"agent_group\",\"=\",\"Billing\"],[\"status\",\"in\",[\"Open\",\"Replied\"]]]",
			"sortField": "creation",
			"sortOrder": "asc"
		}
	},
	"type": "n8n-nodes-frappe-helpdesk.frappeHelpdesk",
	"typeVersion": 1,
	"name": "Billing Backlog",
	"position": [0, 0],
	"credentials": { "frappeApi": { "id": "1", "name": "Frappe account" } }
}
```

Pour filtrer sur le cycle de vie plutôt que sur les libellés, utilisez `status_category` : `[["status_category","=","Open"]]` attrape tous les statuts ouverts définis sur le site, y compris les statuts personnalisés.

### Ticket — mise à jour

```json
{
	"parameters": {
		"resource": "ticket",
		"operation": "update",
		"documentId": "214",
		"updateFields": {
			"priority": "Urgent",
			"agent_group": "Product Experts",
			"ticket_type": "Incident"
		}
	},
	"type": "n8n-nodes-frappe-helpdesk.frappeHelpdesk",
	"typeVersion": 1,
	"name": "Escalate Ticket",
	"position": [0, 0],
	"credentials": { "frappeApi": { "id": "1", "name": "Frappe account" } }
}
```

Relever la priorité amène le Helpdesk à recalculer `response_by` et `resolution_by` à partir de la SLA rattachée au ticket — raison pour laquelle ces champs ne sont pas modifiables ici.

### Customer — création

```json
{
	"parameters": {
		"resource": "customer",
		"operation": "create",
		"customer_name": "Acme SAS",
		"additionalFields": {
			"domain": "acme.io",
			"customer_type": "Company",
			"country": "France",
			"primary_contact": "Claire Dubois"
		}
	},
	"type": "n8n-nodes-frappe-helpdesk.frappeHelpdesk",
	"typeVersion": 1,
	"name": "Create Customer",
	"position": [0, 0],
	"credentials": { "frappeApi": { "id": "1", "name": "Frappe account" } }
}
```

`customer_name` sert aussi de `name` au document : il est donc indispensable même si le doctype ne le marque pas `reqd` — l'expression de nommage de Frappe ne peut rien produire sans lui. Le modifier plus tard renomme l'enregistrement et met à jour tous les tickets qui y sont liés.

`domain` est utile : le Helpdesk rattache automatiquement un ticket entrant à un client quand le domaine email de l'expéditeur correspond.

### Team — création

```json
{
	"parameters": {
		"resource": "team",
		"operation": "create",
		"team_name": "Billing",
		"users": ["marie@acme.io", "jean@acme.io"],
		"additionalFields": {
			"ignore_restrictions": false
		}
	},
	"type": "n8n-nodes-frappe-helpdesk.frappeHelpdesk",
	"typeVersion": 1,
	"name": "Create Team",
	"position": [0, 0],
	"credentials": { "frappeApi": { "id": "1", "name": "Frappe account" } }
}
```

`users` est une Table MultiSelect sur `HD Team Member`, dont l'unique colonne est un Link vers `User`. Vous donnez une liste d'emails au nœud, il envoie les lignes enfants attendues par Frappe : `[{ "user": "marie@acme.io" }, …]`. La table est `reqd`, d'où sa place au premier niveau plutôt que dans *Additional Fields*.

En **Update**, la liste fournie *remplace* les membres de l'équipe ; ne la renseignez pas pour les laisser intacts.

### Ticket Priority / Ticket Type — liste

```json
{
	"parameters": {
		"resource": "ticketType",
		"operation": "getAll",
		"returnAll": true,
		"options": {
			"fields": "name,priority,is_system,disabled"
		}
	},
	"type": "n8n-nodes-frappe-helpdesk.frappeHelpdesk",
	"typeVersion": 1,
	"name": "List Ticket Types",
	"position": [0, 0],
	"credentials": { "frappeApi": { "id": "1", "name": "Frappe account" } }
}
```

Pratique pour valider une valeur avant de créer un ticket. Sur `HD Ticket Type`, `priority` est la priorité appliquée par défaut aux tickets de ce type, et `is_system` marque les types livrés par le Helpdesk, qui ne peuvent être ni renommés ni supprimés.

Attention à la colonne d'ordre des priorités, qui change d'une version à l'autre : le Helpdesk publié (vérifié sur 1.28.1) porte un Int `integer_value`, alors que `develop` le remplace par un Select `level`. Nommer la mauvaise dans `fields` vaut un `Field not permitted in query: …`, d'où le placeholder proposé par le nœud qui s'en tient à `description` et `disabled` — présents dans les deux.

### Suppression

N'importe quelle resource modifiable, à partir de son ID de document :

```json
{
	"parameters": {
		"resource": "ticket",
		"operation": "delete",
		"documentId": "214"
	},
	"type": "n8n-nodes-frappe-helpdesk.frappeHelpdesk",
	"typeVersion": 1,
	"name": "Delete Ticket",
	"position": [0, 0],
	"credentials": { "frappeApi": { "id": "1", "name": "Frappe account" } }
}
```

Le nœud renvoie `{ "success": true, "doctype": "HD Ticket", "name": "214" }`. Frappe refuse de supprimer un document référencé par un autre : un client avec des tickets, ou une équipe pointée par un ticket, doit d'abord être vidé ou désactivé. Sur `HD Team` et `HD Customer`, la désactivation est généralement préférable : elle préserve l'historique.

## Compatibilité

Testé avec n8n 1.x et Frappe Framework **v15 et v16** (16.29.0) sous Frappe Helpdesk 1.28.1. Le nœud n'utilise que les endpoints REST standard `/api/resource` et la route `run_method` que Frappe monte sur le même chemin : il devrait fonctionner avec toute version du Helpdesk qui conserve les noms de doctypes listés plus haut.

Frappe 16 ajoute une seconde API REST sous `/api/v2` (`/api/v2/document/…`, `/api/v2/method/…`), avec sa propre enveloppe et ses propres paramètres de pagination. Le nœud reste volontairement sur la v1 : elle est toujours pleinement supportée sur 16, et tous les comportements dont dépend ce nœud — l'enveloppe `{ "data": … }`, `limit_start`/`limit_page_length`, la route `run_method`, `_assign` lisible seulement par une requête de liste — ont été revérifiés sur 16.29.0 et sont inchangés.

Un point sensible à la version : **`HD Ticket.status` doit être un Link vers `HD Ticket Status`**. C'est le cas sur `main` comme sur `develop`. Sur un Helpdesk assez ancien pour déclarer encore `status` comme un `Select`, la liste des statuts retombe sur les quatre libellés par défaut et le reste continue de fonctionner.

## Ressources

- [Documentation n8n sur les nœuds communautaires](https://docs.n8n.io/integrations/#community-nodes)
- [Documentation de l'API REST Frappe](https://docs.frappe.io/framework/user/en/api/rest)
- [Documentation de Frappe Helpdesk](https://docs.frappe.io/helpdesk)
- [Sources de Frappe Helpdesk](https://github.com/frappe/helpdesk)
- [Architecture du credential partagé](docs/CREDENTIALS.md)

## Historique des versions

### 0.1.0

Version initiale. Nœud Frappe Helpdesk avec les resources Ticket, Customer, Team, Ticket Priority et Ticket Type, les actions Assign et Change Status sur les tickets, les listes déroulantes de statuts, priorités, types, équipes et agents chargées depuis le site, et le credential partagé `frappeApi`.

## Développement

```bash
npm install
npm run build     # compile vers dist/ et copie les icônes
npm run dev       # boucle de développement avec un n8n local
npm run lint      # même commande que la CI
npm run lint:fix
```

Il n'y a aucun runner de test dans ce dépôt. Vérifiez vos changements avec `npm run build` puis un chargement réel dans n8n.

Voir [AGENTS.md](AGENTS.md) pour le guide complet du contributeur.
