import type { INodeProperties } from 'n8n-workflow';

import {
	documentIdField,
	getManyFields,
	omitFields,
	promoteFields,
	ticketOperations,
} from './CommonDescription';

/**
 * `HD Ticket` fields offered on create as well as update.
 *
 * Only writable fields are exposed. The doctype carries a large read-only surface that
 * Frappe computes itself and would silently discard: the whole SLA block (`response_by`,
 * `resolution_by`, `agreement_status`, `total_hold_time`), the response and resolution
 * timings (`first_responded_on`, `resolution_date`, `avg_response_time`), the feedback
 * block, and the merge bookkeeping (`is_merged`, `merged_with`, `status_category`).
 *
 * `status`, `priority`, `ticket_type` and `agent_group` are Link fields: their value is the
 * `name` of a record in `HD Ticket Status`, `HD Ticket Priority`, `HD Ticket Type` and
 * `HD Team` respectively. The lists below are loaded from the site rather than hardcoded,
 * so a Helpdesk with custom statuses or types works without touching the node.
 */
const ticketFields: INodeProperties[] = [
	{
		displayName: 'Contact',
		name: 'contact',
		type: 'resourceLocator',
		default: { mode: 'list', value: '' },
		description: 'Link to a record of the core Frappe Contact doctype',
		modes: [
			{
				displayName: 'From List',
				name: 'list',
				type: 'list',
				typeOptions: {
					searchListMethod: 'searchContact',
					searchable: true,
					searchFilterRequired: false,
				},
			},
			{
				displayName: 'By Name',
				name: 'name',
				type: 'string',
				placeholder: 'Marie Dupont',
			},
		],
	},
	{
		displayName: 'Customer',
		name: 'customer',
		type: 'resourceLocator',
		default: { mode: 'list', value: '' },
		description:
			'The "name" of the HD Customer record. Frappe derives it from the contact when left empty.',
		modes: [
			{
				displayName: 'From List',
				name: 'list',
				type: 'list',
				typeOptions: {
					searchListMethod: 'searchHdCustomer',
					searchable: true,
					searchFilterRequired: false,
				},
			},
			{
				displayName: 'By Name',
				name: 'name',
				type: 'string',
				placeholder: 'Acme SAS',
			},
		],
	},
	{
		displayName: 'Description',
		name: 'description',
		type: 'string',
		typeOptions: { rows: 5 },
		default: '',
		description: 'Ticket body. A Text Editor field in Frappe: it accepts HTML.',
	},
	{
		displayName: 'Priority Name or ID',
		name: 'priority',
		type: 'options',
		typeOptions: { loadOptionsMethod: 'getTicketPriorities' },
		default: '',
		description:
			'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
	},
	{
		displayName: 'Raised By (Email)',
		name: 'raised_by',
		type: 'string',
		placeholder: 'client@example.com',
		default: '',
		description: 'Requester email. Frappe uses it to attach the ticket to an existing contact.',
	},
	{
		displayName: 'SLA Name or ID',
		name: 'sla',
		type: 'options',
		typeOptions: { loadOptionsMethod: 'getServiceLevelAgreements' },
		default: '',
		description:
			'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
	},
	{
		displayName: 'Status Name or ID',
		name: 'status',
		type: 'options',
		typeOptions: { loadOptionsMethod: 'getTicketStatuses' },
		default: '',
		description:
			'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
	},
	{
		displayName: 'Team Name or ID',
		name: 'agent_group',
		type: 'options',
		typeOptions: { loadOptionsMethod: 'getTeams' },
		default: '',
		description:
			'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
	},
	{
		displayName: 'Ticket Type Name or ID',
		name: 'ticket_type',
		type: 'options',
		typeOptions: { loadOptionsMethod: 'getTicketTypes' },
		default: '',
		description:
			'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
	},
	{
		displayName: 'Via Customer Portal',
		name: 'via_customer_portal',
		type: 'boolean',
		default: false,
		description: 'Whether the ticket should be recorded as raised from the customer portal',
	},
];

/**
 * Fields exposed at the top level on create, outside the collection.
 *
 * The node imports this list to know which parameters to read there, so the fields
 * drawn here and the fields sent cannot drift apart.
 */
export const TICKET_REQUIRED_ON_CREATE = ['subject'];

/**
 * Fields lifted out of "Additional Fields" on create: who raised the ticket, what it says,
 * and how it is qualified and routed — the ones an integration sets on nearly every ticket.
 * Ranked by how often they are filled, since that is the order they appear in.
 *
 * `status` deliberately stays in the collection: a new ticket is `Open`, and forcing another
 * status at creation is the minority case.
 *
 * **Create only.** On update the collection is the right tool: it sends only what the user
 * explicitly added, which is the partial-update semantics a PUT needs — and adding the field
 * there *is* the way to say "clear this one".
 *
 * The node imports this list to know which top-level parameters to read, so the two never
 * drift apart.
 */
export const TICKET_PROMOTED_ON_CREATE = [
	'raised_by',
	'description',
	'priority',
	'ticket_type',
	'agent_group',
];

export const ticketDescription: INodeProperties[] = [
	ticketOperations('ticket', 'ticket'),
	{
		displayName: 'Subject',
		name: 'subject',
		type: 'string',
		default: '',
		required: true,
		displayOptions: { show: { resource: ['ticket'], operation: ['create'] } },
		description: 'Ticket subject. The only field the doctype declares as required.',
	},
	...promoteFields(ticketFields, TICKET_PROMOTED_ON_CREATE, 'ticket', ['create']),
	documentIdField(
		'ticket',
		'The ticket\'s "name". On HD Ticket it is an auto-incremented integer, e.g. 214.',
		['get', 'update', 'delete', 'assign', 'changeStatus'],
		'214',
	),
	{
		displayName: 'Agent Name or ID',
		name: 'agent',
		type: 'options',
		typeOptions: { loadOptionsMethod: 'getAgents' },
		default: '',
		required: true,
		displayOptions: { show: { resource: ['ticket'], operation: ['assign'] } },
		description:
			'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
	},
	{
		displayName: 'Assign Options',
		name: 'assignOptions',
		type: 'collection',
		placeholder: 'Add option',
		default: {},
		displayOptions: { show: { resource: ['ticket'], operation: ['assign'] } },
		options: [
			{
				displayName: 'Replace Existing Assignees',
				name: 'replace',
				type: 'boolean',
				default: false,
				description:
					'Whether to remove the agents already assigned before adding the new one. Frappe assignment is additive by default, so a ticket can end up with several owners.',
			},
		],
	},
	{
		displayName: 'Status Name or ID',
		name: 'status',
		type: 'options',
		typeOptions: { loadOptionsMethod: 'getTicketStatuses' },
		default: '',
		required: true,
		displayOptions: { show: { resource: ['ticket'], operation: ['changeStatus'] } },
		description:
			'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
	},
	{
		displayName: 'Additional Fields',
		name: 'additionalFields',
		type: 'collection',
		placeholder: 'Add field',
		default: {},
		displayOptions: { show: { resource: ['ticket'], operation: ['create'] } },
		options: omitFields(ticketFields, [...TICKET_REQUIRED_ON_CREATE, ...TICKET_PROMOTED_ON_CREATE]),
	},
	{
		displayName: 'Update Fields',
		name: 'updateFields',
		type: 'collection',
		placeholder: 'Add field',
		default: {},
		displayOptions: { show: { resource: ['ticket'], operation: ['update'] } },
		options: ticketFields,
	},
	...getManyFields('ticket', 'name,subject,status,priority,customer'),
];
