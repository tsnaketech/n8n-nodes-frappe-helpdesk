/**
 * Mapping from n8n resource to Frappe doctype.
 *
 * Names verified in `helpdesk/helpdesk/doctype/` of the frappe/helpdesk repository, on the
 * `main` and `develop` branches. To be read, not guessed: every Helpdesk doctype is
 * prefixed `HD `, including the two configuration ones.
 *
 * Two facts worth keeping in mind, both checked in the doctype JSON:
 *
 * - `HD Ticket Priority` and `HD Ticket Type` use `autoname: "Prompt"`, so a record's
 *   `name` *is* its label — `Urgent`, `Question`. There is no separate title field, which
 *   is why both resources are addressed by their label everywhere in the node.
 * - `HD Team` is named after `team_name` and `HD Customer` after `customer_name`. Renaming
 *   one of those changes the document `name`, and therefore every ticket linking to it.
 */
export const DOCTYPE_BY_RESOURCE = {
	ticket: 'HD Ticket',
	customer: 'HD Customer',
	team: 'HD Team',
	ticketPriority: 'HD Ticket Priority',
	ticketType: 'HD Ticket Type',
} as const;

export type FrappeHelpdeskResource = keyof typeof DOCTYPE_BY_RESOURCE;

export function getDoctype(resource: string): string {
	const doctype = DOCTYPE_BY_RESOURCE[resource as FrappeHelpdeskResource];
	if (doctype === undefined) {
		throw new Error(`Unknown resource: ${resource}`);
	}
	return doctype;
}

/**
 * Doctype backing the ticket `status` field.
 *
 * `HD Ticket.status` is a **Link**, not a Select: statuses are records, and a site can
 * define its own. `Open`, `Replied`, `Resolved` and `Closed` are merely the four rows
 * `add_default_status()` inserts at install time. Hence the dynamic list in the UI, and
 * this constant rather than a hardcoded enum.
 */
export const TICKET_STATUS_DOCTYPE = 'HD Ticket Status';

/** Statuses offered when the site cannot be queried, or predates `HD Ticket Status`. */
export const DEFAULT_TICKET_STATUSES = ['Open', 'Replied', 'Resolved', 'Closed'];

/** Doctype holding the agents a ticket can be assigned to. */
export const AGENT_DOCTYPE = 'HD Agent';
