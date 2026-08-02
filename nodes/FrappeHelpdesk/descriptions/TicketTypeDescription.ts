import type { INodeProperties } from 'n8n-workflow';

import { documentIdField, getManyFields, readOperationsFor } from './CommonDescription';

/**
 * `HD Ticket Type` is exposed read-only, for the same reason as `HD Ticket Priority`: it is
 * a configuration list a site defines once and tickets link to.
 *
 * The doctype carries a `priority` Link, which is the default priority applied to a ticket
 * created with that type, and an `is_system` flag Frappe sets on the types it ships and
 * marks read-only — those cannot be renamed or removed.
 *
 * `autoname: "Prompt"` again: the document `name` *is* the label.
 */
export const ticketTypeDescription: INodeProperties[] = [
	readOperationsFor('ticketType', 'ticket type'),
	documentIdField('ticketType', 'The ticket type\'s "name", which is its label, e.g. Question.', [
		'get',
	]),
	...getManyFields('ticketType', 'name,priority,is_system,disabled'),
];
