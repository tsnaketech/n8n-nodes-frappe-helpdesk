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
 * Removes fields from a shared list. Used to build "Additional Fields" (create) out of
 * the full list, excluding the fields already exposed at the top level because they are
 * required.
 */
export function omitFields(fields: INodeProperties[], names: string[]): INodeProperties[] {
	return fields.filter((field) => !names.includes(field.name));
}

/**
 * Re-exposes shared fields at the top level, for one operation.
 *
 * Used to lift the fields a user sets on almost every create out of "Additional Fields",
 * where they are invisible until the collection is opened. The field keeps its type,
 * description and dynamic list — it is the same object with a `displayOptions` added, not a
 * second copy that would drift.
 *
 * **A promoted field changes the execute contract.** Inside a collection a field exists only
 * once the user adds it; at the top level it always yields a value, so an untouched one
 * arrives as `''`. Whoever calls this must drop the empty ones before building the request
 * body, or Frappe writes a blank over a Link field. See `PROMOTED_ON_CREATE` in the node.
 *
 * Order follows `names`, not the shared array: these are ranked by how often they are used,
 * which is the whole point of promoting them.
 */
export function promoteFields(
	fields: INodeProperties[],
	names: string[],
	resource: string,
	operations: string[],
): INodeProperties[] {
	return names.map((name) => {
		const field = fields.find((candidate) => candidate.name === name);
		if (field === undefined) {
			// Loud on purpose: a typo here would silently drop the field from the UI, and the
			// node would keep working while quietly ignoring what the user typed.
			throw new Error(`Cannot promote unknown field "${name}" of resource "${resource}"`);
		}

		return {
			...field,
			displayOptions: { show: { resource: [resource], operation: operations } },
		};
	});
}

/**
 * Indefinite article for a resource label.
 *
 * Helpdesk, where this wording comes from, never needed it — ticket, team and customer all
 * start with a consonant. The other packages do: "a employee", "a alert" or "a assignment"
 * would be wrong, so the article is derived rather than written into the template.
 */
function articleFor(singular: string): string {
	return /^[aeiou]/i.test(singular) ? 'an' : 'a';
}

/**
 * The five CRUD operations, specialised for a given resource.
 *
 * `plural` is a parameter rather than `${singular}s` because that naive rule produces
 * "ticket prioritys".
 */
export function operationsFor(
	resource: string,
	singular: string,
	plural = `${singular}s`,
): INodeProperties {
	const article = articleFor(singular);

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
				description: `Create ${article} ${singular}`,
				action: `Create ${article} ${singular}`,
			},
			{
				name: 'Delete',
				value: 'delete',
				description: `Delete ${article} ${singular}`,
				action: `Delete ${article} ${singular}`,
			},
			{
				name: 'Get',
				value: 'get',
				description: `Get ${article} ${singular}`,
				action: `Get ${article} ${singular}`,
			},
			{
				name: 'Get Many',
				value: 'getAll',
				description: `Get many ${plural}`,
				action: `Get many ${plural}`,
			},
			{
				name: 'Update',
				value: 'update',
				description: `Update ${article} ${singular}`,
				action: `Update ${article} ${singular}`,
			},
		],
		default: 'getAll',
	};
}

/**
 * CRUD plus the two ticket-specific actions.
 *
 * Only HD Ticket uses this. "Assign" is not a field update: it goes through the
 * `assign_agent` controller method, which creates the ToDo, fills `_assign` and notifies
 * the agent. "Change Status" *is* a field update, but deserves its own operation because
 * it is the single most common thing a workflow does to a ticket.
 */
export function ticketOperations(
	resource: string,
	singular: string,
	plural = `${singular}s`,
): INodeProperties {
	const article = articleFor(singular);

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
				description: `Assign ${article} ${singular} to an agent`,
				action: `Assign ${article} ${singular} to an agent`,
			},
			{
				name: 'Change Status',
				value: 'changeStatus',
				description: `Change the status of ${article} ${singular}`,
				action: `Change the status of ${article} ${singular}`,
			},
			{
				name: 'Create',
				value: 'create',
				description: `Create ${article} ${singular}`,
				action: `Create ${article} ${singular}`,
			},
			{
				name: 'Delete',
				value: 'delete',
				description: `Delete ${article} ${singular}`,
				action: `Delete ${article} ${singular}`,
			},
			{
				name: 'Get',
				value: 'get',
				description: `Get ${article} ${singular}`,
				action: `Get ${article} ${singular}`,
			},
			{
				name: 'Get Many',
				value: 'getAll',
				description: `Get many ${plural}`,
				action: `Get many ${plural}`,
			},
			{
				name: 'Update',
				value: 'update',
				description: `Update ${article} ${singular}`,
				action: `Update ${article} ${singular}`,
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
export function readOperationsFor(
	resource: string,
	singular: string,
	plural = `${singular}s`,
): INodeProperties {
	const article = articleFor(singular);

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
				description: `Get ${article} ${singular}`,
				action: `Get ${article} ${singular}`,
			},
			{
				name: 'Get Many',
				value: 'getAll',
				description: `Get many ${plural}`,
				action: `Get many ${plural}`,
			},
		],
		default: 'getAll',
	};
}

/**
 * Document targeted by every operation that acts on a single record, identified by Frappe's
 * `name` field.
 *
 * A `resourceLocator` rather than a plain string: `name` is rarely something a user knows by
 * heart — an `HD Ticket` is an integer — so the list mode searches the site through
 * `searchDocuments`. The `name` mode is kept for expressions and for the case where the
 * search cannot run, which is why the locator is never a dead end.
 *
 * `extractValue: true` is mandatory when reading this parameter in `execute()`: the stored
 * value is `{ mode, value }`, not the identifier.
 */
export function documentIdField(
	resource: string,
	description: string,
	operations: string[] = DOCUMENT_OPERATIONS,
	placeholder?: string,
): INodeProperties {
	return {
		displayName: 'Document',
		name: 'documentId',
		type: 'resourceLocator',
		default: { mode: 'list', value: '' },
		required: true,
		displayOptions: { show: { resource: [resource], operation: operations } },
		description,
		modes: [
			{
				displayName: 'From List',
				name: 'list',
				type: 'list',
				typeOptions: {
					searchListMethod: 'searchDocuments',
					searchable: true,
					searchFilterRequired: false,
				},
			},
			{
				displayName: 'By Name',
				name: 'name',
				type: 'string',
				placeholder,
			},
		],
	};
}

/**
 * Pagination and read options for "Get Many".
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
						'Comma-separated list of fields to return. A JSON array works too. Frappe returns only "name" by default.',
				},
				{
					displayName: 'Filters (JSON)',
					name: 'filters',
					type: 'json',
					default: '',
					placeholder: '{"status": "Open"}',
					description:
						'Filters in Frappe format: an object {"field": "value"} or an array [["field","operator","value"]], for example [["priority","in",["Urgent","High"]]]',
				},
				{
					displayName: 'Offset',
					name: 'offset',
					type: 'number',
					default: 0,
					typeOptions: { minValue: 0 },
					description: 'Number of records to skip (limit_start). Ignored when "Return All" is on.',
				},
				{
					displayName: 'Or Filters (JSON)',
					name: 'orFilters',
					type: 'json',
					default: '',
					placeholder: '[["status","=","Open"],["status","=","Replied"]]',
					description: 'Filters combined with OR, same format as "Filters"',
				},
				{
					displayName: 'Sort Field',
					name: 'sortField',
					type: 'string',
					default: 'modified',
					description: 'Field to sort on (order_by)',
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
					description: 'Sort direction',
				},
			],
		},
	];
}
