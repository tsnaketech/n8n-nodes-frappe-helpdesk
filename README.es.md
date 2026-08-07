# n8n-nodes-frappe-helpdesk

Paquete de nodos comunitarios de n8n para [Frappe Helpdesk](https://frappe.io/helpdesk). Permite leer y escribir tickets, clientes y equipos, y leer la configuración de prioridades y tipos de ticket, desde tus workflows de n8n.

[n8n](https://n8n.io/) es una plataforma de automatización de workflows con [licencia fair-code](https://docs.n8n.io/reference/license/).

Otros idiomas: [English](README.md) · [Français](README.fr.md) · [Deutsch](README.de.md)

[Instalación](#instalación)
[Credenciales](#credenciales)
[Operaciones](#operaciones)
[Uso](#uso)
[Compatibilidad](#compatibilidad)
[Recursos](#recursos)
[Historial de versiones](#historial-de-versiones)
[Desarrollo](#desarrollo)

## Instalación

Sigue la [guía de instalación](https://docs.n8n.io/integrations/community-nodes/installation/) de la documentación de nodos comunitarios de n8n, usando `n8n-nodes-frappe-helpdesk` como nombre del paquete.

**Autoalojado, desde la interfaz de n8n** — ve a **Settings > Community nodes > Install**, escribe `n8n-nodes-frappe-helpdesk` y confirma.

**Autoalojado, manualmente:**

```bash
cd ~/.n8n/custom
npm install n8n-nodes-frappe-helpdesk
```

Reinicia n8n y busca «Frappe Helpdesk» en el panel de nodos.

## Credenciales

Este paquete usa un único tipo de credencial, **Frappe API** (`frappeApi`) — el *mismo* que usan los nodos Frappe CRM y Frappe HR. Si ya la tienes configurada, el nodo Frappe Helpdesk puede seleccionarla directamente.

### Generar las claves API en Frappe

1. En tu sitio Frappe, abre el usuario en cuyo nombre debe actuar n8n (`/app/user`).
2. Baja hasta **Settings > API Access** y pulsa **Generate Keys**.
3. Copia el **API Secret** — solo se muestra una vez — y el **API Key** visible en la ficha del usuario.

El nodo actúa **como ese usuario**: hereda sus roles y permisos. Si una llamada falla con un error de permisos, revisa los roles sobre el doctype antes de sospechar de la credencial.

### Rellenar la credencial

| Campo      | Ejemplo                        | Notas                                                                |
| ---------- | ------------------------------ | -------------------------------------------------------------------- |
| Site URL   | `https://mi-sitio.frappe.cloud` | Raíz del sitio. Un `/helpdesk` o `/` final se elimina automáticamente |
| API Key    | `a1b2c3d4e5f6g7h`              |                                                                      |
| API Secret | `s1e2c3r4e5t6`                 | n8n lo almacena cifrado                                              |

Las peticiones se autentican con la cabecera `Authorization: token {apiKey}:{apiSecret}`. Usa **Test** para validar la conexión: la llamada va a `/api/method/frappe.auth.get_logged_user` y falla si el sitio responde como `Guest`, que es lo que devuelve Frappe cuando no reconoce las claves.

El `/helpdesk` final se elimina por un motivo concreto: `/api/…` solo existe en la raíz del sitio, y bajo una ruta de aplicación la petición la intercepta el router del front, que responde **200 con `index.html`** en lugar de un error. Antes de que esta limpieza se aplicara también a la prueba de conexión, una Site URL terminada en `/helpdesk` hacía que **Test** tuviera éxito incluso con claves completamente erróneas. Una ruta desconocida como `/support` es inofensiva en comparación: devuelve un 404 limpio.

### Una sola credencial para todos los nodos Frappe

`frappeApi` deliberadamente **no** es específica del Helpdesk. Frappe autentica a un *usuario en un sitio*, no a una aplicación: la misma clave API sirve para Frappe Helpdesk, Frappe CRM, Frappe HR y Frappe LMS, que viven en el mismo sitio y comparten el mismo endpoint `/api`.

Crea una credencial por *sitio* (`Frappe – prod`, `Frappe – pruebas`), no por aplicación. Consulta [docs/CREDENTIALS.md](docs/CREDENTIALS.md) para la arquitectura completa, la lista de nodos consumidores y los roles de Frappe que requiere cada operación.

> El usuario cuyas claves utilices tiene que poder actuar como agente para que funcione la operación **Assign** — ver [Asignar un ticket a un agente](#asignar-un-ticket-a-un-agente).

## Operaciones

| Recurso         | Doctype de Frappe    | Operaciones                                                         |
| --------------- | -------------------- | ------------------------------------------------------------------- |
| Ticket          | `HD Ticket`          | Create, Get, Get Many, Update, Delete, **Assign**, **Change Status** |
| Customer        | `HD Customer`        | Create, Get, Get Many, Update, Delete                                |
| Team            | `HD Team`            | Create, Get, Get Many, Update, Delete                                |
| Ticket Priority | `HD Ticket Priority` | Get, Get Many — solo lectura                                         |
| Ticket Type     | `HD Ticket Type`     | Get, Get Many — solo lectura                                         |

Todas las operaciones pasan por la API REST estándar de Frappe, `/api/resource/{doctype}`, con `GET`, `POST`, `PUT` y `DELETE`. La única excepción es **Assign**, que llama a un método de controlador del Helpdesk — ver más abajo.

Los nombres de los doctypes se verificaron en [github.com/frappe/helpdesk](https://github.com/frappe/helpdesk) (`helpdesk/helpdesk/doctype/`), en las ramas `main` y `develop`.

El nodo también *lee* dos doctypes que no expone como recursos: `HD Ticket Status` y `HD Agent`, para poblar los desplegables Status y Agent.

> **Las prioridades y los tipos de ticket son de solo lectura, a propósito.**
> Son configuración, no datos. `HD Service Level Agreement` enlaza cada prioridad con un objetivo de respuesta y resolución mediante su tabla hija `priorities`: crear una prioridad desde un workflow produciría una que ningún SLA conoce, y eliminar una rompería todos los tickets y filas de SLA que la referencian. Frappe instala `Urgent`, `High`, `Medium` y `Low` al instalar. Ambos doctypes usan `autoname: "Prompt"`: el `name` del documento **es** la etiqueta — `Urgent`, `Question`.

### El estado de un ticket es un enlace, no una lista fija

Esto es lo que conviene saber antes de escribir un workflow: **`HD Ticket.status` es un `Link` al doctype `HD Ticket Status`**, no un `Select`. Los estados son registros, y un Helpdesk puede definir los suyos — con su etiqueta, su color, su orden y una etiqueta distinta mostrada a los clientes.

`Open`, `Replied`, `Resolved` y `Closed` son solo las cuatro filas que inserta `add_default_status()` en la instalación. Cada una lleva una `category` con valor `Open`, `Paused` o `Resolved`, y es esa categoría la que realmente gobierna el reloj del SLA:

| Estado por defecto | Categoría  | Efecto sobre el SLA    |
| ------------------ | ---------- | ---------------------- |
| `Open`             | `Open`     | El reloj corre         |
| `Replied`          | `Paused`   | A la espera del cliente |
| `Resolved`         | `Resolved` | Detenido               |
| `Closed`           | `Resolved` | Detenido               |

Por eso el nodo carga la lista de estados **desde tu sitio** en lugar de codificarla: los estados personalizados aparecen sin tocar el nodo. Si el doctype no está disponible — un Helpdesk anterior a `HD Ticket Status` — el desplegable recurre a los cuatro valores por defecto en vez de fallar.

Los desplegables Priority, Ticket Type, Team y Agent se cargan del sitio de la misma forma. Todos aceptan además una [expresión](https://docs.n8n.io/code/expressions/): un valor calculado aguas arriba funciona igual de bien que uno elegido en la lista.

### Asignar un ticket a un agente

La asignación **no** es una actualización de campo, de ahí que tenga su propia operación en lugar de una casilla en *Update*. En Frappe, una asignación es un documento `ToDo` acompañado de una columna `_assign` mantenida en paralelo — `_assign` no es un campo almacenado que se pueda enviar por `PUT`.

El nodo llama al método de controlador `assign_agent` del Helpdesk, a través de la ruta REST que Frappe monta exactamente para esto:

```
POST /api/resource/HD Ticket/{name}
{ "run_method": "assign_agent", "agent": "agent@example.com" }
```

`run_method` viaja en el **cuerpo** de la petición, junto a los argumentos del método, no en la query string. Frappe reconstruye `form_dict` a partir del cuerpo JSON en cuanto hay uno, y los parámetros de la query string se pierden por el camino: `?run_method=…` acompañado de un cuerpo responde `KeyError: 'run_method'` (verificado en Frappe 15.116 y de nuevo en 16.29.0).

Ese método envuelve `frappe.desk.form.assign_to.add` **y** genera la notificación interna **HD Notification** que la interfaz del Helpdesk muestra al agente — algo que un `assign_to.add` directo se saltaría.

Dos consecuencias:

- **El usuario de la credencial tiene que poder actuar como agente**, y esa comprobación depende de la versión. En `develop`, `assign_agent` está decorada con `@agent_only`; en el Helpdesk publicado (comprobado en 1.28.1) solo lleva `@frappe.whitelist()`, así que únicamente aplican los permisos habituales de Frappe. Donde la comprobación existe, `helpdesk.utils.is_agent()` acepta cualquiera de tres cosas: `Administrator`, el rol `Agent` o `Agent Manager`, o un registro `HD Agent` para ese usuario. El rol `Agent` basta, por tanto — no hace falta crear además un `HD Agent`.
- **La asignación es aditiva.** Frappe añade a `_assign` e ignora silenciosamente los duplicados, así que un ticket puede acabar con varios responsables. Activa **Replace Existing Assignees** en *Assign Options* para vaciar antes los asignados actuales — es la única forma de expresar «este agente y ningún otro».

El valor esperado es una **dirección de correo**, no un código `HD Agent`: `HD Agent` fija el `name` de su propio documento al `User` enlazado en `before_save`, de modo que ambas cadenas coinciden.

El cambio de estado, en cambio, **no** tiene endpoint propio — `helpdesk/api/` no expone ninguno, y la lógica de transición vive en el `on_update` de `HD Ticket`. **Change Status** es por tanto un `PUT` normal, que aun así dispara el recálculo del SLA y el correo de feedback.

### Opciones de «Get Many»

| Opción             | Corresponde a                       | Notas                                                          |
| ------------------ | ----------------------------------- | -------------------------------------------------------------- |
| Return All         | paginación automática `limit_start` | Trae 100 registros por petición hasta la última página         |
| Limit              | `limit_page_length`                 | Se usa cuando Return All está desactivado                      |
| Offset             | `limit_start`                       | Se ignora cuando Return All está activo                        |
| Fields             | `fields`                            | Separados por comas, o array JSON. Por defecto `["*"]`         |
| Filters (JSON)     | `filters`                           | Sintaxis de filtros de Frappe                                  |
| Or Filters (JSON)  | `or_filters`                        | Misma sintaxis, combinada con OR                               |
| Sort Field / Order | `order_by`                          | por ejemplo `modified desc`                                    |

Sin `fields`, Frappe devuelve solo la columna `name`: por eso el nodo envía `["*"]` por defecto y te da el documento completo.

Los filtros aceptan las dos formas de Frappe — un objeto para una igualdad simple, o un array de tripletas para operadores:

```json
{ "status": "Open" }
```

```json
[["priority", "in", ["Urgent", "High"]], ["status", "!=", "Closed"]]
```

### Campos de solo lectura

`HD Ticket` tiene una amplia superficie calculada que el nodo no expone, porque Frappe sobrescribe lo que se le envíe: todo el bloque SLA (`response_by`, `resolution_by`, `agreement_status`, `total_hold_time`), los tiempos de respuesta y resolución (`first_responded_on`, `resolution_date`, `avg_response_time`), el bloque de feedback y la contabilidad de fusiones (`is_merged`, `merged_with`, `status_category`).

La misma idea en `HD Customer`: `email_id` y `mobile_no` son `read_only` con un `fetch_from` sobre `primary_contact`. Rellena el contacto principal y deja que Frappe los complete. En `HD Team`, `assignment_rule` es de solo lectura — el Helpdesk crea él mismo el documento `Assignment Rule` subyacente al guardar el equipo.

A diferencia de los doctypes de Frappe HR, **`HD Ticket` no es submittable**: no hay `docstatus` que gestionar, y Update funciona sobre cualquier ticket en cualquier momento de su vida.

### Gestión de errores

Frappe informa de sus errores en un campo `_server_messages` que contiene JSON codificado *dentro* de JSON, a menudo con marcado HTML. El nodo lo desenvuelve y muestra el mensaje real: obtienes `Value missing for HD Ticket: Subject` en vez de `Request failed with status code 417`. Después recurre al campo `exception` y, por último, al código HTTP.

Las respuestas `401` y `403` llevan una indicación adicional que apunta al rol de Frappe y no a la credencial, porque casi siempre es esa la causa.

## Uso

Cada ejemplo siguiente es un nodo que puedes pegar en un workflow de n8n. Sustituye el bloque `credentials` por el tuyo.

### Campos Link

Los campos que apuntan a otro registro de Frappe son selectores, ya no texto libre. Dos formas,
según lo que contenga el doctype de destino:

- **Una lista con búsqueda** para todo lo que crece con la actividad diaria — contactos, clientes,
  países. El filtrado ocurre en Frappe, de 50 en 50, y la lista muestra una etiqueta legible junto
  al identificador: `214 — Impresora averiada`. Todos conservan una pestaña **By Name** para un
  valor literal o una expresión.
- **Una lista desplegable** para los doctypes de configuración que mantiene una administración —
  prioridades, tipos de ticket, equipos. n8n los etiqueta como `… Name or ID`.

Un selector nunca bloquea: si la lista no puede leerse, el modo manual sigue aceptando el
identificador. Un campo con búsqueda se guarda como `{ "__rl": true, "mode": …, "value": … }`, de
ahí que los ejemplos lo escriban completo.


### Ticket — crear

```json
{
	"parameters": {
		"resource": "ticket",
		"operation": "create",
		"subject": "El PDF de la factura no se descarga",
		"raised_by": "clara@acme.io",
		"description": "<p>Pulsar <b>Descargar</b> en la factura INV-2026-0042 devuelve un 500.</p>",
		"priority": "High",
		"ticket_type": "Bug",
		"agent_group": "Billing",
		"additionalFields": {
			"customer": {
				"__rl": true,
				"mode": "name",
				"value": "Acme SAS"
			},
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

`subject` es el único campo que el doctype declara `reqd`. Los cinco campos que lo acompañan — **Requester Email**, **Description**, **Priority**, **Ticket Type** y **Team** — están en el primer nivel al **crear**, y no dentro de Additional Fields, porque son lo que lleva un ticket normal. En **update** siguen en la colección: una actualización envía solo lo que pongas en ella, así que omitir un campo es la forma de no tocarlo. `description` es un campo Text Editor en Frappe: acepta HTML. `priority`, `ticket_type`, `agent_group` (etiquetado **Team**) y `status` son Links: el valor debe ser el `name` de un registro existente — que, para prioridades y tipos, es la propia etiqueta.

Si omites `status`, el Helpdesk aplica el `default_ticket_status` del sitio, que es `Open` en una instalación estándar.

Una trampa que viene del Helpdesk y no del nodo: rellenar `agent_group` dispara la **Assignment Rule** del equipo, y un equipo sin miembros hace fallar esa regla con `list index out of range`. El equipo `Billing` que crea una instalación nueva está justo en ese estado. Dale miembros al equipo, o deja `agent_group` fuera.

### Ticket — cambiar de estado

```json
{
	"parameters": {
		"resource": "ticket",
		"operation": "changeStatus",
		"documentId": {
			"__rl": true,
			"mode": "name",
			"value": "214"
		},
		"status": "Resolved"
	},
	"type": "n8n-nodes-frappe-helpdesk.frappeHelpdesk",
	"typeVersion": 1,
	"name": "Resolve Ticket",
	"position": [0, 0],
	"credentials": { "frappeApi": { "id": "1", "name": "Frappe account" } }
}
```

`HD Ticket` usa `autoname: ".####"`: `documentId` es un contador simple — `214`, no un código con prefijo. La salida es el ticket actualizado, de modo que un nodo posterior puede ramificar sobre `status_category` para distinguir «resuelto» de «en pausa» sin conocer tus etiquetas de estado.

### Ticket — asignar a un agente

```json
{
	"parameters": {
		"resource": "ticket",
		"operation": "assign",
		"documentId": {
			"__rl": true,
			"mode": "name",
			"value": "214"
		},
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

`agent` es el correo del agente. Con `replace` desactivado (el valor por defecto) el agente se *añade* a quienes ya estuvieran asignados; activado, los asignados actuales se retiran primero.

El nodo devuelve el ticket releído tras la asignación — `assign_agent` responde por su parte con un sobre vacío — con `_assign` incorporado.

Esa incorporación es necesaria: `_assign` es una columna que Frappe mantiene por su cuenta, no un campo del doctype, y `GET /api/resource/HD Ticket/{name}` construye su respuesta a partir de los metadatos del doctype, así que nunca la devuelve. Solo una consulta de lista que nombre `_assign` en `fields` la retorna, de ahí la petición adicional que hace el nodo. El valor conserva en ambos casos la forma que Frappe almacena: un array codificado en JSON, `"[\"marie@acme.io\"]"`.

### Ticket — listar

Todos los tickets abiertos o en espera del equipo Billing, del más antiguo al más reciente:

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

Para filtrar por ciclo de vida en lugar de por etiquetas, usa `status_category`: `[["status_category","=","Open"]]` captura todos los estados abiertos definidos en el sitio, incluidos los personalizados.

### Ticket — actualizar

```json
{
	"parameters": {
		"resource": "ticket",
		"operation": "update",
		"documentId": {
			"__rl": true,
			"mode": "name",
			"value": "214"
		},
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

Subir la prioridad hace que el Helpdesk recalcule `response_by` y `resolution_by` a partir del SLA asociado al ticket — razón por la que esos campos no son escribibles aquí.

### Customer — crear

```json
{
	"parameters": {
		"resource": "customer",
		"operation": "create",
		"customer_name": "Acme SAS",
		"additionalFields": {
			"domain": "acme.io",
			"customer_type": "Company",
			"country": {
				"__rl": true,
				"mode": "name",
				"value": "France"
			},
			"primary_contact": {
				"__rl": true,
				"mode": "name",
				"value": "Clara Dubois"
			}
		}
	},
	"type": "n8n-nodes-frappe-helpdesk.frappeHelpdesk",
	"typeVersion": 1,
	"name": "Create Customer",
	"position": [0, 0],
	"credentials": { "frappeApi": { "id": "1", "name": "Frappe account" } }
}
```

`customer_name` sirve además de `name` del documento, así que es imprescindible aunque el doctype no lo marque `reqd` — la expresión de nombrado de Frappe no puede generar nada sin él. Cambiarlo después renombra el registro y actualiza todos los tickets enlazados.

`domain` resulta útil: el Helpdesk asocia automáticamente un ticket entrante a un cliente cuando el dominio de correo del remitente coincide.

### Team — crear

```json
{
	"parameters": {
		"resource": "team",
		"operation": "create",
		"team_name": "Billing",
		"users": ["maria@acme.io", "juan@acme.io"],
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

`users` es una Table MultiSelect sobre `HD Team Member`, cuya única columna es un Link a `User`. Le das al nodo una lista de correos y él envía las filas hijas que Frappe espera: `[{ "user": "maria@acme.io" }, …]`. La tabla es `reqd`, de ahí su sitio en el primer nivel y no en *Additional Fields*.

En **Update**, la lista que proporciones *sustituye* a los miembros del equipo; omítela para dejarlos intactos.

### Ticket Priority / Ticket Type — listar

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

Útil para validar un valor antes de crear un ticket. En `HD Ticket Type`, `priority` es la prioridad aplicada por defecto a los tickets de ese tipo, e `is_system` marca los tipos que trae el Helpdesk, que no se pueden renombrar ni eliminar.

Cuidado con la columna de orden de las prioridades, que cambia de una versión a otra: el Helpdesk publicado (comprobado en 1.28.1) lleva un Int `integer_value`, mientras que `develop` lo sustituye por un Select `level`. Nombrar la equivocada en `fields` cuesta un `Field not permitted in query: …`, de ahí que el placeholder que propone el nodo se limite a `description` y `disabled`, presentes en ambas.

### Eliminar

Cualquier recurso escribible, a partir de su ID de documento:

```json
{
	"parameters": {
		"resource": "ticket",
		"operation": "delete",
		"documentId": {
			"__rl": true,
			"mode": "name",
			"value": "214"
		}
	},
	"type": "n8n-nodes-frappe-helpdesk.frappeHelpdesk",
	"typeVersion": 1,
	"name": "Delete Ticket",
	"position": [0, 0],
	"credentials": { "frappeApi": { "id": "1", "name": "Frappe account" } }
}
```

El nodo devuelve `{ "success": true, "doctype": "HD Ticket", "name": "214" }`. Frappe se niega a borrar un documento referenciado por otro: un cliente con tickets, o un equipo al que apunta un ticket, hay que vaciarlo o desactivarlo primero. En `HD Team` y `HD Customer`, desactivar suele ser mejor opción: conserva el histórico.

## Compatibilidad

Probado con **n8n 2.x** (2.32.7) y Frappe Framework **v15 y v16** (16.29.0) con Frappe Helpdesk 1.28.1. El paquete lo carga sin errores el propio cargador de directorios custom de n8n 2, y toda la batería de operaciones se ha vuelto a ejecutar desde un contenedor n8n 2 contra una instancia real. El nodo solo usa los endpoints REST estándar `/api/resource` y la ruta `run_method` que Frappe monta en esa misma ruta, así que debería funcionar con cualquier versión del Helpdesk que conserve los nombres de doctype listados arriba.

Frappe también sirve una segunda API REST bajo `/api/v2` (`/api/v2/document/…`, `/api/v2/method/…`), con su propio sobre y sus propios parámetros de paginación. No es una novedad de la v16 —`frappe/api/v2.py` también está en `version-15`— y la v1 no está obsoleta: `/api/resource` y `/api/v1/resource` apuntan a las mismas reglas de enrutado. El nodo se queda en la v1 por una razón más sólida que la disponibilidad: la v2 no se comporta igual en las dos versiones. En la 15, `document_list` es un adaptador de unas pocas líneas que reescribe `limit`/`start` como `limit_page_length`/`limit_start` y delega en `frappe.client.get_list`; en la 16 es una reescritura sobre `frappe.qb.get_query`, con `has_next_page` y un hook `controller.get_list(query)`. Cubrir ambas versiones con una sola capa de transporte obliga, por tanto, a permanecer en la v1. Todos los comportamientos de los que depende este nodo —el sobre `{ "data": … }`, `limit_start`/`limit_page_length`, la ruta `run_method`, `_assign` legible solo mediante una consulta de lista— se han vuelto a verificar en 16.29.0 y no han cambiado.

Un punto sensible a la versión: **`HD Ticket.status` debe ser un Link a `HD Ticket Status`**. Así es tanto en `main` como en `develop`. En un Helpdesk lo bastante antiguo como para declarar aún `status` como `Select`, el desplegable de estados recurre a las cuatro etiquetas por defecto y todo lo demás sigue funcionando.

## Recursos

- [Documentación de nodos comunitarios de n8n](https://docs.n8n.io/integrations/#community-nodes)
- [Documentación de la API REST de Frappe](https://docs.frappe.io/framework/user/en/api/rest)
- [Documentación de Frappe Helpdesk](https://docs.frappe.io/helpdesk)
- [Código fuente de Frappe Helpdesk](https://github.com/frappe/helpdesk)
- [Arquitectura de la credencial compartida](docs/CREDENTIALS.md)

## Historial de versiones

### 0.1.0

Versión inicial. Nodo Frappe Helpdesk con los recursos Ticket, Customer, Team, Ticket Priority y Ticket Type, las acciones Assign y Change Status sobre los tickets, los desplegables de estados, prioridades, tipos, equipos y agentes cargados desde el sitio, y la credencial compartida `frappeApi`.

## Desarrollo

```bash
npm install
npm run build     # compila a dist/ y copia los iconos
npm run dev       # bucle de desarrollo contra un n8n local
npm run lint      # el mismo comando que ejecuta la CI
npm run lint:fix
```

No hay ningún runner de tests en este repositorio. Verifica los cambios con `npm run build` y una carga real en n8n.

Consulta [AGENTS.md](AGENTS.md) para la guía completa del contribuidor.
