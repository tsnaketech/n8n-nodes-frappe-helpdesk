# n8n-nodes-frappe-helpdesk

Ein n8n-Community-Node-Paket für [Frappe Helpdesk](https://frappe.io/helpdesk). Es ermöglicht das Lesen und Schreiben von Tickets, Kunden und Teams sowie das Lesen der Prioritäts- und Tickettyp-Konfiguration aus deinen n8n-Workflows heraus.

[n8n](https://n8n.io/) ist eine Workflow-Automatisierungsplattform unter [Fair-Code-Lizenz](https://docs.n8n.io/reference/license/).

Andere Sprachen: [English](README.md) · [Français](README.fr.md) · [Español](README.es.md)

[Installation](#installation)
[Zugangsdaten](#zugangsdaten)
[Operationen](#operationen)
[Verwendung](#verwendung)
[Kompatibilität](#kompatibilität)
[Ressourcen](#ressourcen)
[Versionsverlauf](#versionsverlauf)
[Entwicklung](#entwicklung)

## Installation

Folge der [Installationsanleitung](https://docs.n8n.io/integrations/community-nodes/installation/) in der n8n-Dokumentation zu Community-Nodes, mit `n8n-nodes-frappe-helpdesk` als Paketnamen.

**Self-hosted, über die n8n-Oberfläche** — gehe zu **Settings > Community nodes > Install**, gib `n8n-nodes-frappe-helpdesk` ein und bestätige.

**Self-hosted, manuell:**

```bash
cd ~/.n8n/custom
npm install n8n-nodes-frappe-helpdesk
```

Starte n8n neu und suche im Node-Panel nach „Frappe Helpdesk".

## Zugangsdaten

Dieses Paket verwendet einen einzigen Credential-Typ, **Frappe API** (`frappeApi`) — denselben wie die Nodes Frappe CRM und Frappe HRMS. Ist er bereits eingerichtet, kann der Frappe-Helpdesk-Node ihn direkt auswählen.

### API-Schlüssel in Frappe erzeugen

1. Öffne auf deiner Frappe-Site den Benutzer, in dessen Namen n8n handeln soll (`/app/user`).
2. Scrolle zu **Settings > API Access** und klicke auf **Generate Keys**.
3. Kopiere das **API Secret** — es wird nur einmal angezeigt — sowie den **API Key**, der auf dem Benutzerdokument steht.

Der Node handelt **als dieser Benutzer**: Er erbt dessen Rollen und Berechtigungen. Scheitert ein Aufruf an einer Berechtigung, prüfe die Rollen auf dem Doctype, bevor du die Zugangsdaten verdächtigst.

### Zugangsdaten ausfüllen

| Feld       | Beispiel                         | Hinweise                                                                  |
| ---------- | -------------------------------- | ------------------------------------------------------------------------- |
| Site URL   | `https://meine-site.frappe.cloud` | Site-Wurzel. Ein abschließendes `/helpdesk` oder `/` wird entfernt        |
| API Key    | `a1b2c3d4e5f6g7h`                |                                                                           |
| API Secret | `s1e2c3r4e5t6`                   | Von n8n verschlüsselt gespeichert                                         |

Anfragen werden über den Header `Authorization: token {apiKey}:{apiSecret}` authentifiziert. Nutze **Test**, um die Verbindung zu prüfen: Der Aufruf geht an `/api/method/frappe.auth.get_logged_user` und schlägt fehl, wenn die Site als `Guest` antwortet — genau das liefert Frappe, wenn die Schlüssel nicht erkannt werden.

Das abschließende `/helpdesk` wird aus einem konkreten Grund entfernt: `/api/…` existiert nur an der Site-Wurzel, und unter einem App-Pfad fängt der Frontend-Router die Anfrage ab und antwortet **200 mit `index.html`** statt mit einem Fehler. Bevor diese Bereinigung auch für den Verbindungstest galt, ließ eine Site URL mit `/helpdesk` am Ende **Test** selbst mit völlig falschen Schlüsseln erfolgreich erscheinen. Ein unbekannter Pfad wie `/support` ist im Vergleich harmlos: Er liefert einen sauberen 404.

### Ein Credential für alle Frappe-Nodes

`frappeApi` ist bewusst **nicht** Helpdesk-spezifisch. Frappe authentifiziert einen *Benutzer auf einer Site*, keine Anwendung: Derselbe API-Schlüssel gilt für Frappe Helpdesk, Frappe CRM, Frappe HR und Frappe LMS, die alle auf derselben Site laufen und denselben `/api`-Endpunkt teilen.

Lege ein Credential pro *Site* an (`Frappe – prod`, `Frappe – test`), nicht pro Anwendung. Siehe [docs/CREDENTIALS.md](docs/CREDENTIALS.md) für die vollständige Architektur, die Liste der nutzenden Nodes und die Frappe-Rollen, die jede Operation benötigt.

> Der Benutzer, dessen Schlüssel du verwendest, muss als Agent handeln können, damit die Operation **Assign** funktioniert — siehe [Ein Ticket einem Agenten zuweisen](#ein-ticket-einem-agenten-zuweisen).

## Operationen

| Ressource       | Frappe-Doctype       | Operationen                                                         |
| --------------- | -------------------- | ------------------------------------------------------------------- |
| Ticket          | `HD Ticket`          | Create, Get, Get Many, Update, Delete, **Assign**, **Change Status** |
| Customer        | `HD Customer`        | Create, Get, Get Many, Update, Delete                                |
| Team            | `HD Team`            | Create, Get, Get Many, Update, Delete                                |
| Ticket Priority | `HD Ticket Priority` | Get, Get Many — schreibgeschützt                                     |
| Ticket Type     | `HD Ticket Type`     | Get, Get Many — schreibgeschützt                                     |

Alle Operationen laufen über die Standard-REST-API von Frappe unter `/api/resource/{doctype}` mit `GET`, `POST`, `PUT` und `DELETE`. Einzige Ausnahme ist **Assign**, das eine Controller-Methode des Helpdesks aufruft — siehe unten.

Die Doctype-Namen wurden gegen [github.com/frappe/helpdesk](https://github.com/frappe/helpdesk) (`helpdesk/helpdesk/doctype/`) auf den Branches `main` und `develop` geprüft.

Der Node *liest* außerdem zwei Doctypes, die er nicht als Ressourcen anbietet: `HD Ticket Status` und `HD Agent`, um die Dropdowns Status und Agent zu füllen.

> **Prioritäten und Tickettypen sind bewusst schreibgeschützt.**
> Beides ist Konfiguration, keine Fachdaten. `HD Service Level Agreement` verknüpft jede Priorität über seine Kindtabelle `priorities` mit einem Reaktions- und Lösungsziel: Eine Priorität aus einem Workflow heraus anzulegen ergäbe eine, die kein SLA kennt, und eine zu löschen zerstörte jedes Ticket und jede SLA-Zeile, die darauf verweist. Frappe legt bei der Installation `Urgent`, `High`, `Medium` und `Low` an. Beide Doctypes nutzen `autoname: "Prompt"`: Der `name` des Dokuments **ist** die Bezeichnung — `Urgent`, `Question`.

### Der Ticketstatus ist ein Link, keine feste Liste

Das ist der Punkt, den man vor dem ersten Workflow kennen sollte: **`HD Ticket.status` ist ein `Link` auf den Doctype `HD Ticket Status`**, kein `Select`. Status sind Datensätze, und ein Helpdesk kann eigene definieren — mit eigener Bezeichnung, Farbe, Reihenfolge und einer abweichenden Bezeichnung für Endkunden.

`Open`, `Replied`, `Resolved` und `Closed` sind lediglich die vier Zeilen, die `add_default_status()` bei der Installation einfügt. Jede trägt eine `category` mit dem Wert `Open`, `Paused` oder `Resolved` — und diese Kategorie steuert tatsächlich die SLA-Uhr:

| Standardstatus | Kategorie  | Wirkung auf die SLA    |
| -------------- | ---------- | ---------------------- |
| `Open`         | `Open`     | Die Uhr läuft          |
| `Replied`      | `Paused`   | Warten auf den Kunden  |
| `Resolved`     | `Resolved` | Angehalten             |
| `Closed`       | `Resolved` | Angehalten             |

Der Node lädt die Statusliste deshalb **von deiner Site**, statt sie fest zu verdrahten: Eigene Status erscheinen ohne Änderung am Node. Ist der Doctype nicht erreichbar — ein Helpdesk älter als `HD Ticket Status` —, fällt das Dropdown auf die vier Standardwerte zurück, statt zu scheitern.

Die Dropdowns Priority, Ticket Type, Team und Agent werden auf dieselbe Weise von der Site geladen. Alle akzeptieren zusätzlich einen [Ausdruck](https://docs.n8n.io/code/expressions/): Ein weiter oben berechneter Wert funktioniert genauso gut wie ein ausgewählter.

### Ein Ticket einem Agenten zuweisen

Eine Zuweisung ist **keine** Feldänderung — deshalb eine eigene Operation statt eines Häkchens in *Update*. In Frappe ist eine Zuweisung ein `ToDo`-Dokument samt einer parallel gepflegten Spalte `_assign`; `_assign` ist kein gespeichertes Feld, das man per `PUT` setzen könnte.

Der Node ruft die Helpdesk-eigene Controller-Methode `assign_agent` über genau die REST-Route auf, die Frappe dafür bereitstellt:

```
POST /api/resource/HD Ticket/{name}
{ "run_method": "assign_agent", "agent": "agent@example.com" }
```

`run_method` reist im **Body** mit, neben den Argumenten der Methode — nicht im Query-String. Frappe baut `form_dict` aus dem JSON-Body neu auf, sobald einer vorhanden ist, und die Query-String-Parameter gehen dabei verloren: `?run_method=…` zusammen mit einem Body antwortet `KeyError: 'run_method'` (geprüft auf Frappe 15.116 und erneut auf 16.29.0).

Diese Methode kapselt `frappe.desk.form.assign_to.add` **und** löst die In-App-Benachrichtigung **HD Notification** aus, die die Helpdesk-Oberfläche dem Agenten anzeigt — was ein direktes `assign_to.add` übergehen würde.

Zwei Konsequenzen:

- **Der Benutzer der Zugangsdaten muss als Agent handeln können** — und diese Prüfung hängt von der Version ab. Auf `develop` ist `assign_agent` mit `@agent_only` dekoriert; im veröffentlichten Helpdesk (geprüft auf 1.28.1) trägt sie nur `@frappe.whitelist()`, dort greifen also allein die üblichen Frappe-Berechtigungen. Wo die Prüfung vorhanden ist, akzeptiert `helpdesk.utils.is_agent()` eines von drei Dingen: `Administrator`, die Rolle `Agent` oder `Agent Manager`, oder einen `HD Agent`-Datensatz für diesen Benutzer. Die Rolle `Agent` genügt also — ein zusätzlicher `HD Agent` ist nicht nötig.
- **Zuweisungen sind additiv.** Frappe hängt an `_assign` an und übergeht Duplikate stillschweigend, ein Ticket kann also mehrere Verantwortliche bekommen. Aktiviere **Replace Existing Assignees** in den *Assign Options*, um die bisherigen Zuweisungen zuerst zu entfernen — nur so lässt sich „dieser Agent und sonst niemand" ausdrücken.

Erwartet wird eine **E-Mail-Adresse**, kein `HD Agent`-Code: `HD Agent` setzt den `name` seines eigenen Dokuments in `before_save` auf den verknüpften `User`, beide Zeichenketten sind also identisch.

Der Statuswechsel hat dagegen **keinen** eigenen Endpunkt — `helpdesk/api/` bietet keinen an, und die Übergangslogik steckt im `on_update` von `HD Ticket`. **Change Status** ist daher ein gewöhnliches `PUT`, das trotzdem die SLA-Neuberechnung und die Feedback-Mail auslöst.

### Optionen von „Get Many"

| Option             | Entspricht                        | Hinweise                                                         |
| ------------------ | --------------------------------- | ---------------------------------------------------------------- |
| Return All         | automatische `limit_start`-Paginierung | Holt 100 Datensätze pro Anfrage bis zur letzten Seite        |
| Limit              | `limit_page_length`               | Wird verwendet, wenn Return All aus ist                          |
| Offset             | `limit_start`                     | Wird ignoriert, wenn Return All an ist                           |
| Fields             | `fields`                          | Kommagetrennt oder als JSON-Array. Standard `["*"]`              |
| Filters (JSON)     | `filters`                         | Frappe-Filtersyntax                                              |
| Or Filters (JSON)  | `or_filters`                      | Gleiche Syntax, mit ODER verknüpft                               |
| Sort Field / Order | `order_by`                        | z. B. `modified desc`                                            |

Ohne `fields` liefert Frappe nur die Spalte `name` — deshalb sendet der Node standardmäßig `["*"]` und gibt dir das vollständige Dokument.

Filter akzeptieren beide Frappe-Formen — ein Objekt für einfache Gleichheit oder ein Array aus Tripeln für Operatoren:

```json
{ "status": "Open" }
```

```json
[["priority", "in", ["Urgent", "High"]], ["status", "!=", "Closed"]]
```

### Schreibgeschützte Felder

`HD Ticket` besitzt eine große berechnete Fläche, die der Node nicht anbietet, weil Frappe überschreibt, was man ihm schickt: den gesamten SLA-Block (`response_by`, `resolution_by`, `agreement_status`, `total_hold_time`), die Reaktions- und Lösungszeiten (`first_responded_on`, `resolution_date`, `avg_response_time`), den Feedback-Block und die Merge-Buchführung (`is_merged`, `merged_with`, `status_category`).

Dasselbe Prinzip bei `HD Customer`: `email_id` und `mobile_no` sind `read_only` mit einem `fetch_from` auf `primary_contact`. Setze den Hauptkontakt und lass Frappe sie füllen. Bei `HD Team` ist `assignment_rule` schreibgeschützt — der Helpdesk legt das zugrunde liegende `Assignment Rule`-Dokument beim Speichern des Teams selbst an.

Anders als die Doctypes von Frappe HRMS ist **`HD Ticket` nicht submittable**: Es gibt keinen `docstatus` zu verwalten, und Update funktioniert bei jedem Ticket zu jedem Zeitpunkt.

### Fehlerbehandlung

Frappe meldet Fehler in einem Feld `_server_messages`, das JSON *innerhalb* von JSON enthält, oft mit HTML-Markup. Der Node packt es aus und zeigt die eigentliche Meldung: Du bekommst `Value missing for HD Ticket: Subject` statt `Request failed with status code 417`. Danach greift er auf das Feld `exception` zurück und zuletzt auf den HTTP-Status.

`401`- und `403`-Antworten tragen einen zusätzlichen Hinweis, der auf die Frappe-Rolle statt auf die Zugangsdaten zeigt, weil das fast immer die Ursache ist.

## Verwendung

Jedes Beispiel unten ist ein Node, den du in einen n8n-Workflow einfügen kannst. Ersetze den `credentials`-Block durch deinen eigenen.

### Ticket — anlegen

```json
{
	"parameters": {
		"resource": "ticket",
		"operation": "create",
		"subject": "Rechnungs-PDF lässt sich nicht herunterladen",
		"additionalFields": {
			"raised_by": "klara@acme.io",
			"description": "<p>Ein Klick auf <b>Herunterladen</b> bei Rechnung INV-2026-0042 liefert einen 500er.</p>",
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

`subject` ist das einzige Feld, das der Doctype als `reqd` deklariert. `description` ist in Frappe ein Text-Editor-Feld und nimmt daher HTML an. `priority`, `ticket_type`, `agent_group` (beschriftet als **Team**) und `status` sind Links: Der Wert muss der `name` eines vorhandenen Datensatzes sein — bei Prioritäten und Typen also die Bezeichnung selbst.

Lässt du `status` weg, wendet der Helpdesk den `default_ticket_status` der Site an, bei einer Standardinstallation `Open`.

Eine Falle, die vom Helpdesk kommt und nicht vom Node: `agent_group` zu setzen löst die **Assignment Rule** des Teams aus, und ein Team ohne Mitglieder lässt diese Regel mit `list index out of range` scheitern. Genau in diesem Zustand ist das Team `Billing`, das eine frische Installation anlegt. Gib dem Team Mitglieder — oder lass `agent_group` weg.

### Ticket — Status ändern

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

`HD Ticket` nutzt `autoname: ".####"`: `documentId` ist ein schlichter Zähler — `214`, kein Code mit Präfix. Ausgegeben wird das aktualisierte Ticket, sodass ein nachgelagerter Node über `status_category` verzweigen kann und „gelöst" von „pausiert" unterscheidet, ohne deine Statusbezeichnungen zu kennen.

### Ticket — einem Agenten zuweisen

```json
{
	"parameters": {
		"resource": "ticket",
		"operation": "assign",
		"documentId": "214",
		"agent": "maria@acme.io",
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

`agent` ist die E-Mail-Adresse des Agenten. Mit ausgeschaltetem `replace` (Standard) wird der Agent zu den bereits Zugewiesenen *hinzugefügt*; eingeschaltet werden die bisherigen zuerst entfernt.

Der Node gibt das nach der Zuweisung erneut gelesene Ticket zurück — `assign_agent` selbst antwortet mit einem leeren Umschlag — und mischt `_assign` hinein.

Dieses Nachladen ist nötig: `_assign` ist eine Spalte, die Frappe selbst pflegt, kein Feld des Doctypes, und `GET /api/resource/HD Ticket/{name}` baut seine Antwort aus den Doctype-Metadaten auf — liefert sie also nie mit. Nur eine Listenabfrage, die `_assign` in `fields` nennt, gibt sie zurück; genau diese zusätzliche Anfrage stellt der Node. Der Wert behält in beiden Fällen die Form, die Frappe speichert: ein JSON-kodiertes Array, `"[\"marie@acme.io\"]"`.

### Ticket — auflisten

Alle offenen oder wartenden Tickets des Teams Billing, älteste zuerst:

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

Um nach dem Lebenszyklus statt nach Bezeichnungen zu filtern, nimm `status_category`: `[["status_category","=","Open"]]` erfasst jeden offenen Status, den die Site definiert — auch eigene.

### Ticket — aktualisieren

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

Eine höhere Priorität lässt den Helpdesk `response_by` und `resolution_by` aus der am Ticket hängenden SLA neu berechnen — genau deshalb sind diese Felder hier nicht schreibbar.

### Customer — anlegen

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
			"primary_contact": "Klara Dubois"
		}
	},
	"type": "n8n-nodes-frappe-helpdesk.frappeHelpdesk",
	"typeVersion": 1,
	"name": "Create Customer",
	"position": [0, 0],
	"credentials": { "frappeApi": { "id": "1", "name": "Frappe account" } }
}
```

`customer_name` dient zugleich als `name` des Dokuments und ist deshalb unverzichtbar, auch wenn der Doctype es nicht als `reqd` markiert — Frappes Namensausdruck kann ohne es nichts erzeugen. Es später zu ändern benennt den Datensatz um und aktualisiert alle damit verknüpften Tickets.

`domain` lohnt sich: Der Helpdesk ordnet ein eingehendes Ticket automatisch einem Kunden zu, wenn die E-Mail-Domain des Absenders passt.

### Team — anlegen

```json
{
	"parameters": {
		"resource": "team",
		"operation": "create",
		"team_name": "Billing",
		"users": ["maria@acme.io", "jan@acme.io"],
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

`users` ist ein Table MultiSelect auf `HD Team Member`, dessen einzige Spalte ein Link auf `User` ist. Du gibst dem Node eine Liste von E-Mail-Adressen, er sendet die von Frappe erwarteten Kindzeilen: `[{ "user": "maria@acme.io" }, …]`. Die Tabelle ist `reqd`, daher steht das Feld auf der obersten Ebene und nicht in den *Additional Fields*.

Bei **Update** *ersetzt* die übergebene Liste die Teammitglieder; lass sie weg, um sie unangetastet zu lassen.

### Ticket Priority / Ticket Type — auflisten

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

Nützlich, um einen Wert vor dem Anlegen eines Tickets zu prüfen. Bei `HD Ticket Type` ist `priority` die Standardpriorität für Tickets dieses Typs, und `is_system` markiert die vom Helpdesk mitgelieferten Typen, die weder umbenannt noch gelöscht werden können.

Achtung bei der Sortierspalte der Prioritäten, die sich von Version zu Version unterscheidet: der veröffentlichte Helpdesk (geprüft auf 1.28.1) führt ein Int `integer_value`, während `develop` es durch ein Select `level` ersetzt. Die falsche in `fields` zu nennen bringt ein `Field not permitted in query: …` — daher beschränkt sich der vom Node vorgeschlagene Platzhalter auf `description` und `disabled`, die in beiden vorhanden sind.

### Löschen

Jede schreibbare Ressource, anhand ihrer Dokument-ID:

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

Der Node gibt `{ "success": true, "doctype": "HD Ticket", "name": "214" }` aus. Frappe weigert sich, ein Dokument zu löschen, auf das ein anderes verweist: Ein Kunde mit Tickets oder ein Team, auf das ein Ticket zeigt, muss zuerst geleert oder deaktiviert werden. Bei `HD Team` und `HD Customer` ist Deaktivieren meist die bessere Wahl — es bewahrt die Historie.

## Kompatibilität

Getestet mit n8n 1.x und Frappe Framework **v15 und v16** (16.29.0) mit Frappe Helpdesk 1.28.1. Der Node nutzt nur die Standard-REST-Endpunkte unter `/api/resource` sowie die `run_method`-Route, die Frappe auf demselben Pfad bereitstellt — er sollte daher mit jeder Helpdesk-Version funktionieren, die die oben genannten Doctype-Namen beibehält.

Frappe 16 bringt eine zweite REST-API unter `/api/v2` mit (`/api/v2/document/…`, `/api/v2/method/…`), mit eigenem Envelope und eigenen Pagination-Parametern. Der Node bleibt bewusst bei v1: Sie wird auf 16 weiterhin voll unterstützt, und jedes Verhalten, auf das dieser Node baut — der `{ "data": … }`-Envelope, `limit_start`/`limit_page_length`, die `run_method`-Route, `_assign`, das sich nur über eine Listenabfrage lesen lässt — wurde auf 16.29.0 erneut geprüft und ist unverändert.

Ein versionsabhängiger Punkt: **`HD Ticket.status` muss ein Link auf `HD Ticket Status` sein.** Das ist auf `main` wie auf `develop` der Fall. Auf einem Helpdesk, der alt genug ist, um `status` noch als `Select` zu deklarieren, fällt das Status-Dropdown auf die vier Standardbezeichnungen zurück und alles Übrige funktioniert weiter.

## Ressourcen

- [n8n-Dokumentation zu Community-Nodes](https://docs.n8n.io/integrations/#community-nodes)
- [Dokumentation der Frappe-REST-API](https://docs.frappe.io/framework/user/en/api/rest)
- [Dokumentation von Frappe Helpdesk](https://docs.frappe.io/helpdesk)
- [Quellcode von Frappe Helpdesk](https://github.com/frappe/helpdesk)
- [Architektur des gemeinsamen Credentials](docs/CREDENTIALS.md)

## Versionsverlauf

### 0.1.0

Erste Veröffentlichung. Frappe-Helpdesk-Node mit den Ressourcen Ticket, Customer, Team, Ticket Priority und Ticket Type, den Ticket-Aktionen Assign und Change Status, von der Site geladenen Dropdowns für Status, Prioritäten, Typen, Teams und Agenten sowie dem gemeinsamen Credential `frappeApi`.

## Entwicklung

```bash
npm install
npm run build     # kompiliert nach dist/ und kopiert die Icons
npm run dev       # Entwicklungsschleife gegen ein lokales n8n
npm run lint      # derselbe Befehl, den die CI ausführt
npm run lint:fix
```

Es gibt keinen Test-Runner in diesem Repository. Prüfe Änderungen mit `npm run build` und anschließend einem echten Laden in n8n.

Siehe [AGENTS.md](AGENTS.md) für den vollständigen Beitragsleitfaden.
