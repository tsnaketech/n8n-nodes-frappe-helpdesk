import type { INodeProperties } from 'n8n-workflow';

import { documentIdField, getManyFields, readOperationsFor } from './CommonDescription';

/**
 * `HD Ticket Priority` is exposed read-only.
 *
 * Priorities are configuration, not data: `HD Service Level Agreement` links each of them
 * to a response and resolution target through its `priorities` child table. Creating one
 * from a workflow would produce a priority no SLA knows about, and deleting one would break
 * every ticket and SLA row pointing at it. Frappe seeds `Urgent`, `High`, `Medium` and
 * `Low` at install time; the rest is a Helpdesk settings screen, not an automation job.
 *
 * The doctype uses `autoname: "Prompt"`, so the document `name` *is* the label.
 *
 * Careful with the ordering column, which differs between versions: the released Helpdesk
 * (verified on 1.28.1) carries an Int `integer_value`, whereas the `develop` branch replaces
 * it with a Select `level` holding Urgent/High/Medium/Low. Requesting the wrong one in
 * `fields` makes Frappe answer `Field not permitted in query: …`, so the placeholder below
 * only names `description` and `disabled` — the two fields present in both.
 */
export const ticketPriorityDescription: INodeProperties[] = [
	readOperationsFor('ticketPriority', 'ticket priority'),
	documentIdField(
		'ticketPriority',
		'Champ « name » de la priorité, qui vaut son libellé, par ex. Urgent.',
		['get'],
	),
	...getManyFields('ticketPriority', 'name,description,disabled'),
];
