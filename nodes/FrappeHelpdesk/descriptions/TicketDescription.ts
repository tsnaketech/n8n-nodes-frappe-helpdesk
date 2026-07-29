import type { INodeProperties } from 'n8n-workflow';

import { documentIdField, getManyFields, omitFields, ticketOperations } from './CommonDescription';

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
		type: 'string',
		default: '',
		description: 'Lien vers un enregistrement du doctype Contact du core Frappe',
	},
	{
		displayName: 'Customer',
		name: 'customer',
		type: 'string',
		default: '',
		description:
			'Champ « name » du client HD Customer. Frappe le déduit du contact lorsqu\'il est laissé vide.',
	},
	{
		displayName: 'Description',
		name: 'description',
		type: 'string',
		typeOptions: { rows: 5 },
		default: '',
		description: 'Corps du ticket. Champ Text Editor côté Frappe : il accepte du HTML.',
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
		description:
			'Email du demandeur. Frappe s\'en sert pour rattacher le ticket à un contact existant.',
	},
	{
		displayName: 'SLA',
		name: 'sla',
		type: 'string',
		default: '',
		description:
			'Champ « name » d\'une HD Service Level Agreement. Laisser vide laisse Frappe appliquer la SLA par défaut.',
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

const REQUIRED_ON_CREATE = ['subject'];

export const ticketDescription: INodeProperties[] = [
	ticketOperations('ticket', 'ticket'),
	{
		displayName: 'Subject',
		name: 'subject',
		type: 'string',
		default: '',
		required: true,
		displayOptions: { show: { resource: ['ticket'], operation: ['create'] } },
		description: 'Objet du ticket. Seul champ que le doctype déclare obligatoire.',
	},
	documentIdField(
		'ticket',
		'Champ « name » du ticket. Sur HD Ticket c\'est un entier auto-incrémenté, par ex. 214.',
		['get', 'update', 'delete', 'assign', 'changeStatus'],
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
		options: omitFields(ticketFields, REQUIRED_ON_CREATE),
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
