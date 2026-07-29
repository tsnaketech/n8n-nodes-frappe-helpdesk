import type { INodeProperties } from 'n8n-workflow';

/**
 * Property factories shared by the five resources: the CRUD operations are identical from
 * one doctype to the next, only the labels and the business fields differ.
 *
 * The option arrays are written out literally rather than composed at runtime — the n8n
 * ESLint rules read them statically and require them to be sorted alphabetically.
 */

/** Operations offered on a resource whose document ID must be supplied. */
export const DOCUMENT_OPERATIONS = ['get', 'update', 'delete'];

/**
 * Removes fields from a shared list. Used to build « Additional Fields » (create) out of
 * the full list, excluding the fields already exposed at the top level because they are
 * required.
 */
export function omitFields(fields: INodeProperties[], names: string[]): INodeProperties[] {
	return fields.filter((field) => !names.includes(field.name));
}

/** The five CRUD operations, specialised for a given resource. */
export function operationsFor(resource: string, singular: string): INodeProperties {
	return {
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: [resource] } },
		options: [
			{
				name: 'Create',
				value: 'create',
				description: `Créer un(e) ${singular}`,
				action: `Create a ${singular}`,
			},
			{
				name: 'Delete',
				value: 'delete',
				description: `Supprimer un(e) ${singular}`,
				action: `Delete a ${singular}`,
			},
			{
				name: 'Get',
				value: 'get',
				description: `Récupérer un(e) ${singular}`,
				action: `Get a ${singular}`,
			},
			{
				name: 'Get Many',
				value: 'getAll',
				description: `Récupérer plusieurs ${singular}s`,
				action: `Get many ${singular}s`,
			},
			{
				name: 'Update',
				value: 'update',
				description: `Mettre à jour un(e) ${singular}`,
				action: `Update a ${singular}`,
			},
		],
		default: 'getAll',
	};
}

/**
 * CRUD plus the two ticket-specific actions.
 *
 * Only HD Ticket uses this. « Assign » is not a field update: it goes through the
 * `assign_agent` controller method, which creates the ToDo, fills `_assign` and notifies
 * the agent. « Change Status » *is* a field update, but deserves its own operation because
 * it is the single most common thing a workflow does to a ticket.
 */
export function ticketOperations(resource: string, singular: string): INodeProperties {
	return {
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: [resource] } },
		options: [
			{
				name: 'Assign',
				value: 'assign',
				description: `Assigner un(e) ${singular} à un agent`,
				action: `Assign a ${singular} to an agent`,
			},
			{
				name: 'Change Status',
				value: 'changeStatus',
				description: `Changer le statut d'un(e) ${singular}`,
				action: `Change the status of a ${singular}`,
			},
			{
				name: 'Create',
				value: 'create',
				description: `Créer un(e) ${singular}`,
				action: `Create a ${singular}`,
			},
			{
				name: 'Delete',
				value: 'delete',
				description: `Supprimer un(e) ${singular}`,
				action: `Delete a ${singular}`,
			},
			{
				name: 'Get',
				value: 'get',
				description: `Récupérer un(e) ${singular}`,
				action: `Get a ${singular}`,
			},
			{
				name: 'Get Many',
				value: 'getAll',
				description: `Récupérer plusieurs ${singular}s`,
				action: `Get many ${singular}s`,
			},
			{
				name: 'Update',
				value: 'update',
				description: `Mettre à jour un(e) ${singular}`,
				action: `Update a ${singular}`,
			},
		],
		default: 'getAll',
	};
}

/**
 * Read-only resources. `HD Ticket Priority` and `HD Ticket Type` are configuration values:
 * a site defines them once, and tickets link to them. Creating them from a workflow would
 * silently reshape the SLA matrix, so the node only reads them.
 */
export function readOperationsFor(resource: string, singular: string): INodeProperties {
	return {
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: [resource] } },
		options: [
			{
				name: 'Get',
				value: 'get',
				description: `Récupérer un(e) ${singular}`,
				action: `Get a ${singular}`,
			},
			{
				name: 'Get Many',
				value: 'getAll',
				description: `Récupérer plusieurs ${singular}s`,
				action: `Get many ${singular}s`,
			},
		],
		default: 'getAll',
	};
}

/**
 * Document identifier (Frappe's `name` field), required by every operation that targets a
 * single record.
 */
export function documentIdField(
	resource: string,
	description: string,
	operations: string[] = DOCUMENT_OPERATIONS,
): INodeProperties {
	return {
		displayName: 'Document ID',
		name: 'documentId',
		type: 'string',
		default: '',
		required: true,
		displayOptions: { show: { resource: [resource], operation: operations } },
		description,
	};
}

/**
 * Pagination and read options for « Get Many ».
 *
 * `returnAll` triggers automatic pagination through `limit_start`; otherwise `limit` is
 * sent as-is in `limit_page_length`.
 */
export function getManyFields(resource: string, fieldsPlaceholder: string): INodeProperties[] {
	return [
		{
			displayName: 'Return All',
			name: 'returnAll',
			type: 'boolean',
			default: false,
			displayOptions: { show: { resource: [resource], operation: ['getAll'] } },
			description: 'Whether to return all results or only up to a given limit',
		},
		{
			displayName: 'Limit',
			name: 'limit',
			type: 'number',
			default: 50,
			typeOptions: { minValue: 1 },
			displayOptions: {
				show: { resource: [resource], operation: ['getAll'], returnAll: [false] },
			},
			description: 'Max number of results to return',
		},
		{
			displayName: 'Options',
			name: 'options',
			type: 'collection',
			placeholder: 'Add option',
			default: {},
			displayOptions: { show: { resource: [resource], operation: ['getAll'] } },
			options: [
				{
					displayName: 'Fields',
					name: 'fields',
					type: 'string',
					default: '',
					placeholder: fieldsPlaceholder,
					description:
						'Liste des champs à retourner, séparés par des virgules. Accepte aussi un tableau JSON. Par défaut Frappe ne renvoie que « name ».',
				},
				{
					displayName: 'Filters (JSON)',
					name: 'filters',
					type: 'json',
					default: '',
					placeholder: '{"status": "Open"}',
					description:
						'Filtres au format Frappe : objet {"champ": "valeur"} ou tableau [["champ","opérateur","valeur"]], par exemple [["priority","in",["Urgent","High"]]]',
				},
				{
					displayName: 'Offset',
					name: 'offset',
					type: 'number',
					default: 0,
					typeOptions: { minValue: 0 },
					description:
						'Nombre d\'enregistrements à ignorer (limit_start). Ignoré lorsque « Return All » est actif.',
				},
				{
					displayName: 'Or Filters (JSON)',
					name: 'orFilters',
					type: 'json',
					default: '',
					placeholder: '[["status","=","Open"],["status","=","Replied"]]',
					description: 'Filtres combinés en OU, même format que « Filters »',
				},
				{
					displayName: 'Sort Field',
					name: 'sortField',
					type: 'string',
					default: 'modified',
					description: 'Champ utilisé pour le tri (order_by)',
				},
				{
					displayName: 'Sort Order',
					name: 'sortOrder',
					type: 'options',
					options: [
						{ name: 'Ascending', value: 'asc' },
						{ name: 'Descending', value: 'desc' },
					],
					default: 'desc',
					description: 'Sens du tri',
				},
			],
		},
	];
}
