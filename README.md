# n8n-nodes-frappe-helpdesk

This is an n8n community node package for [Frappe Helpdesk](https://frappe.io/helpdesk). It lets you read and write tickets, customers and teams, and read the priority and ticket-type configuration, from your n8n workflows.

[n8n](https://n8n.io/) is a [fair-code licensed](https://docs.n8n.io/reference/license/) workflow automation platform.

Other languages: [Français](README.fr.md) · [Español](README.es.md) · [Deutsch](README.de.md)

[Installation](#installation)
[Credentials](#credentials)
[Operations](#operations)
[Usage](#usage)
[Compatibility](#compatibility)
[Resources](#resources)
[Version history](#version-history)
[Development](#development)

## Installation

Follow the [installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) in the n8n community nodes documentation, using `n8n-nodes-frappe-helpdesk` as the package name.

**Self-hosted, via the n8n UI** — go to **Settings > Community nodes > Install**, enter `n8n-nodes-frappe-helpdesk` and confirm.

**Self-hosted, manually:**

```bash
cd ~/.n8n/custom
npm install n8n-nodes-frappe-helpdesk
```

Restart n8n, then search for "Frappe Helpdesk" in the node panel.

## Credentials

This package uses a single credential type, **Frappe API** (`frappeApi`) — the *same* credential type as the Frappe CRM and Frappe HRMS nodes. If you already have it configured, the Frappe Helpdesk node can select it directly.

### Generating API keys in Frappe

1. In your Frappe site, open the user you want n8n to act as (`/app/user`).
2. Scroll to **Settings > API Access** and click **Generate Keys**.
3. Copy the **API Secret** — it is shown only once — and the **API Key** displayed on the user document.

The n8n node acts as that user, so it inherits that user's roles and permissions. If a call fails with a permission error, check the roles on the doctype rather than the credential.

### Filling in the credential

| Field      | Example                        | Notes                                                             |
| ---------- | ------------------------------ | ----------------------------------------------------------------- |
| Site URL   | `https://my-site.frappe.cloud` | Site root. A trailing `/helpdesk` or `/` is stripped automatically |
| API Key    | `a1b2c3d4e5f6g7h`              |                                                                   |
| API Secret | `s1e2c3r4e5t6`                 | Stored encrypted by n8n                                           |

Requests are authenticated with the header `Authorization: token {apiKey}:{apiSecret}`. Use **Test** to validate the connection — it calls `/api/method/frappe.auth.get_logged_user` and fails if the site answers as `Guest`, which is what Frappe returns when the keys are not recognised.

The trailing `/helpdesk` is dropped for a concrete reason: `/api/…` only exists at the site root, and under an SPA mount the request is caught by the front-end router, which answers **200 with `index.html`** rather than an error. Before this stripping was applied to the connection test as well, a Site URL ending in `/helpdesk` made **Test** succeed even with completely wrong keys. An unrecognised path such as `/support` is harmless by comparison — it returns a plain 404.

### One credential for every Frappe node

`frappeApi` is deliberately **not** Helpdesk-specific. Frappe authenticates a *user on a site*, not an application: the same API key works for Frappe Helpdesk, Frappe CRM, Frappe HR and Frappe LMS, which all live on the same site and share the same `/api` endpoint.

Create one credential per *site* (`Frappe – prod`, `Frappe – staging`), not per application. See [docs/CREDENTIALS.md](docs/CREDENTIALS.md) for the full architecture, the list of consuming nodes, and the Frappe roles each operation needs.

> The user whose keys you use needs to be able to act as an agent for the **Assign** operation to work — see [Assigning a ticket](#assigning-a-ticket-to-an-agent).

## Operations

| Resource        | Frappe doctype       | Operations                                                             |
| --------------- | -------------------- | ---------------------------------------------------------------------- |
| Ticket          | `HD Ticket`          | Create, Get, Get Many, Update, Delete, **Assign**, **Change Status**    |
| Customer        | `HD Customer`        | Create, Get, Get Many, Update, Delete                                   |
| Team            | `HD Team`            | Create, Get, Get Many, Update, Delete                                   |
| Ticket Priority | `HD Ticket Priority` | Get, Get Many — read-only                                               |
| Ticket Type     | `HD Ticket Type`     | Get, Get Many — read-only                                               |

All operations go through the standard Frappe REST API at `/api/resource/{doctype}` using `GET`, `POST`, `PUT` and `DELETE`. The only exception is **Assign**, which calls a Helpdesk controller method — see below.

Doctype names were verified against [github.com/frappe/helpdesk](https://github.com/frappe/helpdesk) (`helpdesk/helpdesk/doctype/`) on both the `main` and `develop` branches.

The node also *reads* two doctypes it does not expose as resources: `HD Ticket Status` and `HD Agent`, to populate the Status and Agent dropdowns.

> **Priorities and ticket types are read-only, on purpose.**
> Both are configuration, not data. `HD Service Level Agreement` links each priority to a response and resolution target through its `priorities` child table, so creating a priority from a workflow would produce one no SLA knows about, and deleting one would break every ticket and SLA row pointing at it. Frappe seeds `Urgent`, `High`, `Medium` and `Low` at install time. Both doctypes use `autoname: "Prompt"`, meaning the document `name` *is* the label — `Urgent`, `Question`.

### Ticket status is a link, not a fixed list

This is the one thing worth knowing before writing a workflow: **`HD Ticket.status` is a `Link` to the `HD Ticket Status` doctype**, not a `Select`. Statuses are records, and a Helpdesk can define its own — with its own label, colour, ordering, and a separate label shown to end users.

`Open`, `Replied`, `Resolved` and `Closed` are simply the four rows Helpdesk's `add_default_status()` inserts at install time. Each carries a `category` of `Open`, `Paused` or `Resolved`, which is what actually drives the SLA clock:

| Default status | Category   | Meaning for the SLA           |
| -------------- | ---------- | ----------------------------- |
| `Open`         | `Open`     | The clock runs                |
| `Replied`      | `Paused`   | Waiting on the customer       |
| `Resolved`     | `Resolved` | Stopped                       |
| `Closed`       | `Resolved` | Stopped                       |

The node therefore loads the Status dropdown **from your site** rather than hardcoding it, so custom statuses appear without any change to the node. If the doctype cannot be reached — a Helpdesk older than `HD Ticket Status` — the dropdown falls back to the four defaults instead of breaking.

The Priority, Ticket Type, Team and Agent dropdowns are loaded from the site the same way. Every one of them also accepts an [expression](https://docs.n8n.io/code/expressions/), so a value computed upstream works just as well as a picked one.

### Assigning a ticket to an agent

Assignment is **not** a field update, which is why it gets its own operation rather than a checkbox in *Update*. In Frappe, an assignment is a `ToDo` document plus a `_assign` column maintained alongside it — `_assign` is not a stored field you can `PUT`.

The node calls Helpdesk's own `assign_agent` controller method, through the REST route Frappe mounts for exactly this purpose:

```
POST /api/resource/HD Ticket/{name}
{ "run_method": "assign_agent", "agent": "agent@example.com" }
```

`run_method` travels in the **body**, alongside the method's own arguments — not in the query string. Frappe rebuilds `form_dict` from the JSON body whenever there is one, and the query-string parameters are dropped in the process: `?run_method=…` together with a body answers `KeyError: 'run_method'` (verified on Frappe 15.116 and again on 16.29.0).

That method wraps `frappe.desk.form.assign_to.add` *and* raises the in-app **HD Notification** the Helpdesk UI shows the agent — which a bare `assign_to.add` would skip.

Two consequences:

- **The credential user has to be allowed to act as an agent** — and that check depends on the version. On `develop`, `assign_agent` is decorated `@agent_only`; on the released Helpdesk (checked on 1.28.1) it only carries `@frappe.whitelist()`, so the usual Frappe permissions are all that applies. Where the check is present, `helpdesk.utils.is_agent()` takes any one of three things: `Administrator`, the `Agent` or `Agent Manager` role, or an `HD Agent` record for that user. The `Agent` role is therefore enough — no need to create an `HD Agent` on top of it.
- **Assignment is additive.** Frappe appends to `_assign` and silently skips a duplicate, so a ticket can end up with several owners. Turn on **Replace Existing Assignees** in *Assign Options* to clear the current assignees first — that is the only way to express "this agent and no other".

The agent value is an **email address**, not an `HD Agent` code: `HD Agent` sets its own document `name` to the linked `User` in `before_save`, so the two are the same string.

Changing the status, by contrast, has **no** custom endpoint — `helpdesk/api/` exposes nothing of the sort, and the transition logic lives in `HD Ticket`'s own `on_update`. **Change Status** is therefore a plain `PUT`, which still triggers the SLA recomputation and the feedback email.

### Get Many options

| Option             | Maps to                      | Notes                                                |
| ------------------ | ---------------------------- | ---------------------------------------------------- |
| Return All         | auto-paginates `limit_start` | Fetches 100 records per request until the last page  |
| Limit              | `limit_page_length`          | Used when Return All is off                          |
| Offset             | `limit_start`                | Ignored when Return All is on                        |
| Fields             | `fields`                     | Comma-separated or a JSON array. Defaults to `["*"]` |
| Filters (JSON)     | `filters`                    | Frappe filter syntax                                 |
| Or Filters (JSON)  | `or_filters`                 | Same syntax, combined with OR                        |
| Sort Field / Order | `order_by`                   | e.g. `modified desc`                                 |

Frappe returns only the `name` column when `fields` is not specified, so the node defaults to `["*"]` to give you the full document.

Filters accept both Frappe forms — an object for simple equality, or an array of triples for operators:

```json
{ "status": "Open" }
```

```json
[["priority", "in", ["Urgent", "High"]], ["status", "!=", "Closed"]]
```

### Read-only fields

`HD Ticket` has a large computed surface the node does not expose, because Frappe overwrites whatever you send: the whole SLA block (`response_by`, `resolution_by`, `agreement_status`, `total_hold_time`), the response and resolution timings (`first_responded_on`, `resolution_date`, `avg_response_time`), the feedback block, and the merge bookkeeping (`is_merged`, `merged_with`, `status_category`).

Same idea on `HD Customer`: `email_id` and `mobile_no` are `read_only` with a `fetch_from` on `primary_contact`. Set the primary contact and let Frappe fill them in. On `HD Team`, `assignment_rule` is read-only — Helpdesk creates the underlying `Assignment Rule` document itself when the team is saved.

Unlike the Frappe HRMS doctypes, **`HD Ticket` is not submittable**: there is no `docstatus` to manage, and Update works on any ticket at any point in its life.

### Error handling

Frappe reports errors in a `_server_messages` field that contains JSON encoded *inside* JSON, often with HTML markup. The node unwraps it and surfaces the actual message — you get `Value missing for HD Ticket: Subject` rather than `Request failed with status code 417`. It falls back to the `exception` field, then to the HTTP status.

`401` and `403` responses carry an extra hint pointing at the Frappe role rather than the credential, because that is nearly always the cause.

## Usage

Each example below is a node you can paste into an n8n workflow. Replace the `credentials` block with your own credential.

### Ticket — create

```json
{
	"parameters": {
		"resource": "ticket",
		"operation": "create",
		"subject": "Invoice PDF fails to download",
		"additionalFields": {
			"raised_by": "claire@acme.io",
			"description": "<p>Clicking <b>Download</b> on invoice INV-2026-0042 returns a 500.</p>",
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

`subject` is the only field the doctype declares `reqd`. `description` is a Frappe Text Editor field, so it takes HTML. `priority`, `ticket_type`, `agent_group` (labelled **Team**) and `status` are Links: the value must be the `name` of an existing record — which, for priorities and types, is the label itself.

Leave `status` out and Helpdesk applies the site's `default_ticket_status`, `Open` on a stock install.

One trap that comes from Helpdesk rather than from the node: setting `agent_group` runs that team's **Assignment Rule**, and a team without members makes the rule fail with `list index out of range`. The `Billing` team a fresh install seeds is in exactly that state. Give the team members, or leave `agent_group` out.

### Ticket — change status

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

`HD Ticket` uses `autoname: ".####"`, so `documentId` is a plain counter — `214`, not a prefixed code. The output is the updated ticket, so a downstream node can branch on `status_category` to tell "resolved" from "paused" without knowing your status labels.

### Ticket — assign to an agent

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

`agent` is the agent's email. With `replace` off (the default) the agent is *added* to whoever is already assigned; with it on, the existing assignees are removed first.

The node returns the ticket re-read after the assignment — `assign_agent` itself answers with an empty envelope — with `_assign` merged into it.

That merge is necessary: `_assign` is a column Frappe maintains itself, not a docfield, and `GET /api/resource/HD Ticket/{name}` builds its answer from the doctype metadata, so it never includes it. Only a list query naming `_assign` in `fields` returns it, which is the extra request the node makes. The value keeps the shape Frappe stores in both cases — a JSON-encoded array, `"[\"marie@acme.io\"]"`.

### Ticket — get many

Every open or replied ticket on the Billing team, oldest first:

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

To select on lifecycle rather than on labels, filter `status_category` instead — `[["status_category","=","Open"]]` catches every open status a site has defined, including custom ones.

### Ticket — update

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

Raising the priority makes Helpdesk recompute `response_by` and `resolution_by` from the SLA attached to the ticket — which is why those fields are not writable here.

### Customer — create

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

`customer_name` doubles as the document `name`, so it is required even though the doctype does not flag it `reqd` — Frappe's naming expression cannot produce a name without it. Renaming it later renames the record and updates every ticket linked to it.

`domain` earns its keep: Helpdesk attaches incoming tickets to a customer automatically when the sender's email domain matches.

### Team — create

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

`users` is a Table MultiSelect over `HD Team Member`, whose only column is a Link to `User`. You give the node a list of emails and it sends the child rows Frappe expects, `[{ "user": "marie@acme.io" }, …]`. The table is `reqd`, hence its place at the top level rather than in *Additional Fields*.

On **Update**, the list you provide *replaces* the team's members; leave it out to keep them untouched.

### Ticket Priority / Ticket Type — get many

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

Useful to validate a value before creating a ticket. On `HD Ticket Type`, `priority` is the default priority applied to tickets of that type, and `is_system` marks the types Helpdesk ships, which cannot be renamed or removed.

Mind the priority ordering column, which is not the same from one version to the next: released Helpdesk (checked on 1.28.1) carries an Int `integer_value`, while `develop` swaps it for a Select `level`. Naming the wrong one in `fields` earns a `Field not permitted in query: …`, so the placeholder the node suggests sticks to `description` and `disabled` — present in both.

### Delete

Any writable resource, given its document ID:

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

The node outputs `{ "success": true, "doctype": "HD Ticket", "name": "214" }`. Frappe refuses to delete any document another record links to — a customer with tickets, or a team a ticket points at, has to be emptied or disabled first. On `HD Team` and `HD Customer`, disabling is usually the better move: it preserves the history.

## Compatibility

Tested against **n8n 2.x** (2.32.7) and Frappe Framework **v15 and v16** (16.29.0) with Frappe Helpdesk 1.28.1. The package is picked up by n8n 2's own custom-directory loader with no loading error, and the full operation suite was replayed from inside an n8n 2 container against a live site. The node uses the standard `/api/resource` REST endpoints plus the `run_method` route Frappe mounts on the same path, so it should work with any Helpdesk version that keeps the doctype names listed above.

Frappe also serves a second REST API under `/api/v2` (`/api/v2/document/…`, `/api/v2/method/…`), with its own envelope and its own pagination parameters. It is not a v16 addition — `frappe/api/v2.py` ships on `version-15` as well — and v1 is not deprecated: `/api/resource` and `/api/v1/resource` are routed to the same rules. The node stays on v1 for a stronger reason than availability: v2 does not behave the same on the two versions. On 15, `document_list` is a thin adapter that rewrites `limit`/`start` into `limit_page_length`/`limit_start` and delegates to `frappe.client.get_list`; on 16 it is a rewrite on `frappe.qb.get_query`, with `has_next_page` and a `controller.get_list(query)` hook. Covering both versions with one transport layer therefore means staying on v1. Every behaviour this node relies on — the `{ "data": … }` envelope, `limit_start`/`limit_page_length`, the `run_method` route, `_assign` being readable only through a list query — was re-verified on 16.29.0 and is unchanged.

One version-sensitive point: **`HD Ticket.status` must be a Link to `HD Ticket Status`**. That is the case on both `main` and `develop`. On a Helpdesk old enough to still declare `status` as a `Select`, the Status dropdown falls back to the four default labels and everything else keeps working.

## Resources

- [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)
- [Frappe REST API documentation](https://docs.frappe.io/framework/user/en/api/rest)
- [Frappe Helpdesk documentation](https://docs.frappe.io/helpdesk)
- [Frappe Helpdesk source](https://github.com/frappe/helpdesk)
- [Shared credential architecture](docs/CREDENTIALS.md)

## Version history

### 0.1.0

Initial release. Frappe Helpdesk node with the Ticket, Customer, Team, Ticket Priority and Ticket Type resources, the Assign and Change Status ticket actions, site-loaded dropdowns for statuses, priorities, types, teams and agents, and the shared `frappeApi` credential.

## Development

```bash
npm install
npm run build     # compiles to dist/ and copies icons
npm run dev       # development loop against a local n8n
npm run lint      # same command the CI runs
npm run lint:fix
```

There is no test runner in this repository. Verify changes with `npm run build` followed by a real load in n8n.

See [AGENTS.md](AGENTS.md) for the full contributor guide.
