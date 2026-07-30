# Architecture du credential partagé `frappeApi`

Ce package fait partie d'une suite de nœuds n8n pour les applications Frappe
(CRM, Helpdesk, HRMS, LMS…). Tous s'authentifient **de la même façon**, contre le même
site. Le credential `frappeApi` est donc défini une seule fois et partagé, plutôt que
dupliqué par produit.

## Pourquoi un seul credential

Frappe Framework n'authentifie pas « une application », il authentifie **un utilisateur
sur un site**. Une paire API Key / API Secret est émise pour un utilisateur Frappe et
vaut pour toutes les applications installées sur ce site — le CRM, le Helpdesk, Frappe HR
et le LMS partagent la même base, les mêmes utilisateurs et le même endpoint `/api`.

Créer un `frappeCrmApi`, un `frappeHelpdeskApi` et un `frappeHrmsApi` reviendrait donc à
demander trois fois la même chose à l'utilisateur, avec trois fois le risque de la saisir
différemment. Un seul credential veut dire :

- une seule saisie d'URL, de clé et de secret, même si l'utilisateur installe les trois nœuds ;
- une rotation de clé à faire à un seul endroit ;
- un test de connexion qui vaut pour tous les nœuds.

## Nœuds consommateurs

| Nœud                | Package npm                 | Doctypes visés                                                                                                            | État                    |
| ------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| **Frappe Helpdesk** | `n8n-nodes-frappe-helpdesk` | `HD Ticket`, `HD Customer`, `HD Team`, `HD Ticket Priority`, `HD Ticket Type` (+ `HD Ticket Status` et `HD Agent` en lecture) | livré (ce dépôt)        |
| **Frappe CRM**      | `n8n-nodes-frappe-crm`      | `CRM Lead`, `CRM Deal`, `Contact`, `CRM Organization`, `CRM Task`, `FCRM Note`                                              | livré                   |
| **Frappe HRMS**     | `n8n-nodes-frappe-hrms`     | `Employee`, `Leave Application`, `Attendance`, `Expense Claim`, `Salary Slip`, `Job Opening`, `Job Applicant`, `Job Offer`   | livré                   |
| **Frappe LMS**      | à créer                     | `LMS Course`, …                                                                                                             | à venir                 |

Le nœud Helpdesk **ne définit aucune variante** du credential : sa description déclare
`credentials: [{ name: 'frappeApi', required: true }]`, exactement comme les nœuds CRM et
HRMS.

> Note d'empaquetage : n8n charge les credentials par package npm. Chaque package embarque
> donc son propre fichier `credentials/FrappeApi.credentials.ts`, mais tous exposent le
> **même** `name = 'frappeApi'` et les mêmes noms de champs. Un utilisateur qui installe
> Helpdesk, CRM et HRMS voit un seul type « Frappe API » et configure son site une fois.
> **Toute modification du fichier doit être répercutée à l'identique dans les autres
> packages**, sinon deux définitions divergentes se disputent le même nom interne.

## Ce que le credential contient

| Champ      | Nom interne | Rôle                                                           |
| ---------- | ----------- | -------------------------------------------------------------- |
| Site URL   | `siteUrl`   | Racine du site Frappe, par ex. `https://mon-site.frappe.cloud`   |
| API Key    | `apiKey`    | Clé publique de la paire                                        |
| API Secret | `apiSecret` | Secret de la paire, stocké chiffré                              |

L'authentification est un header appliqué à toutes les requêtes :

```
Authorization: token {apiKey}:{apiSecret}
```

Le test de connexion appelle `GET /api/method/frappe.auth.get_logged_user`. Cet endpoint
est fourni par Frappe Framework lui-même, pas par une application : il fonctionne à
l'identique sur un site CRM, Helpdesk, HR ou LMS. Une règle supplémentaire traite la
réponse `{"message": "Guest"}` comme un échec — Frappe répond `200 OK` en tant qu'invité
quand les clés ne sont pas reconnues, ce qui donnerait sinon un faux positif.

## Ce que le credential ne contient pas, volontairement

Aucune notion de doctype, de resource ni de chemin d'application. Le credential ne connaît
que la racine du site ; c'est chaque nœud qui construit ses propres URL
(`/api/resource/HD Ticket`, `/api/resource/CRM Lead`, …). C'est cette absence de
couplage qui le rend réutilisable tel quel.

Note pratique : `normalizeSiteUrl()` retire un éventuel chemin de SPA en fin d'URL
(`/helpdesk`, `/crm`, `/hr`, `/lms`, `/app`…) ainsi que le slash final. Coller
`http://helpdesk.localhost:8000/helpdesk`, l'URL affichée par le navigateur, fonctionne donc
aussi bien que la racine du site — l'API vit toujours à la racine.

## Permissions côté Frappe

Le nœud agit **en tant que l'utilisateur** qui a généré les clés : il hérite de ses rôles.
Pour Frappe Helpdesk, cela veut dire concrètement :

- lire et écrire les tickets demande le rôle `Agent` (ou `Agent Manager`) ; un simple
  contact du portail ne voit que ses propres tickets ;
- créer ou modifier une `HD Team`, un `HD Customer` ou la configuration des priorités
  demande `Agent Manager` ;
- **l'opération Assign demande que l'utilisateur des clés puisse agir comme un agent**, et
  ce contrôle dépend de la version : sur la branche `develop`, `HDTicket.assign_agent` est
  décorée `@agent_only` ; sur le Helpdesk publié (vérifié sur 1.28.1) elle ne porte que
  `@frappe.whitelist()` et seules les permissions Frappe habituelles s'appliquent. Quand le
  contrôle est là, `helpdesk.utils.is_agent()` accepte trois choses au choix :
  `Administrator`, le rôle `Agent` ou `Agent Manager`, ou l'existence d'un enregistrement
  `HD Agent` pour cet utilisateur. Le rôle `Agent` suffit donc — il n'y a pas besoin de créer
  un `HD Agent` en plus.

Une erreur 403 renvoyée par le nœud vient donc presque toujours des rôles, pas du
credential. Le message d'erreur Frappe est remonté tel quel pour permettre de trancher.

## Comment un futur nœud le réutilise

### 1. Déclarer le credential dans la description du nœud

Rien à créer : il suffit de le référencer par son nom interne.

```ts
export class FrappeLms implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Frappe LMS',
		name: 'frappeLms',
		// ...
		credentials: [
			{
				name: 'frappeApi', // exactement le même que les nœuds Helpdesk, CRM et HRMS
				required: true,
			},
		],
	};
}
```

### 2. Réutiliser la couche transport

`nodes/FrappeHelpdesk/GenericFunctions.ts` ne contient rien de spécifique au support :
`frappeApiRequest`, `frappeApiRequestAllItems`, `frappeMethodRequest`,
`frappeRunDocMethod` et `parseFrappeError` ne connaissent que le credential `frappeApi` et
l'API générique de Frappe. Un nœud LMS peut les importer directement :

```ts
import { frappeApiRequest } from '../FrappeHelpdesk/GenericFunctions';

const courses = await frappeApiRequest.call(this, 'GET', '/api/resource/LMS Course');
```

Si un deuxième nœud arrive dans **ce** package, il sera temps de déplacer ce fichier vers
un `nodes/shared/` commun. Tant qu'il n'y en a qu'un, l'import direct évite une
indirection prématurée — mais **le fichier ne doit rien apprendre du Helpdesk** : toute
logique propre à un doctype a sa place dans `FrappeHelpdesk.node.ts`, pas ici.

### 3. Déclarer le nœud dans `package.json`

Le credential reste déclaré une seule fois, quel que soit le nombre de nœuds du package :

```json
{
	"n8n": {
		"credentials": ["dist/credentials/FrappeApi.credentials.js"],
		"nodes": [
			"dist/nodes/FrappeHelpdesk/FrappeHelpdesk.node.js",
			"dist/nodes/FrappeLms/FrappeLms.node.js"
		]
	}
}
```

## Côté utilisateur

Dans n8n, une instance de credential « Frappe API » configurée pour un site est
sélectionnable depuis n'importe quel nœud Frappe. Un utilisateur qui gère plusieurs sites
crée une instance par site (« Frappe – prod », « Frappe – recette »), pas une par
application.

## Compatibilité à préserver

Le nom interne `frappeApi` et les noms de champs `siteUrl`, `apiKey`, `apiSecret` font
partie du contrat public : les workflows enregistrés y font référence. Les renommer
casserait les credentials déjà configurés chez les utilisateurs. Un champ **ajouté**
(par exemple un token alternatif) doit donc être optionnel et laisser le comportement
actuel inchangé par défaut.
