import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestMethods,
	ILoadOptionsFunctions,
	INodeExecutionData,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import {
	customerDescription,
	teamDescription,
	ticketDescription,
	ticketPriorityDescription,
	ticketTypeDescription,
} from './descriptions';
import {
	frappeApiRequest,
	frappeApiRequestAllItems,
	frappeMethodRequest,
	frappeRunDocMethod,
} from './GenericFunctions';
import { AGENT_DOCTYPE, DEFAULT_TICKET_STATUSES, getDoctype, TICKET_STATUS_DOCTYPE } from './types';

/**
 * Fields exposed at the top level, outside the "Additional Fields" collection, because the
 * doctype marks them `reqd` — or, for `customer_name`, because the doctype is named after
 * them and Frappe cannot insert the record without one. Kept here rather than in the
 * descriptions so that the execute loop has a single place to read them from.
 */
const REQUIRED_ON_CREATE: Record<string, string[]> = {
	ticket: ['subject'],
	customer: ['customer_name'],
	team: ['team_name', 'users'],
};

/** Parses a JSON parameter entered in the UI, tolerating an expression that already produced an object. */
function parseJsonParameter(
	context: IExecuteFunctions,
	value: unknown,
	parameterName: string,
	itemIndex: number,
): IDataObject | unknown[] | undefined {
	if (value === undefined || value === null || value === '') return undefined;
	if (typeof value === 'object') return value as IDataObject | unknown[];

	if (typeof value !== 'string') return undefined;

	try {
		return JSON.parse(value) as IDataObject | unknown[];
	} catch {
		throw new NodeOperationError(
			context.getNode(),
			`The "${parameterName}" parameter is not valid JSON: ${value}`,
			{
				itemIndex,
				description:
					'Expected an object {"field": "value"} or an array [["field","operator","value"]].',
			},
		);
	}
}

/** Accepts "name,status" as ["name","status"]. */
function parseFieldList(value: string): string[] {
	const trimmed = value.trim();
	if (trimmed.startsWith('[')) {
		return JSON.parse(trimmed) as string[];
	}
	return trimmed
		.split(',')
		.map((field) => field.trim())
		.filter((field) => field.length > 0);
}

/**
 * Turns the list of emails picked in the UI into the child rows `HD Team.users` expects.
 *
 * The field is a Table MultiSelect over `HD Team Member`, whose only column is `user`, so
 * Frappe wants `[{ "user": "agent@example.com" }]` and not a bare array of strings. An
 * empty selection is dropped rather than sent as `[]`: that keeps "Update" from emptying
 * a team the user did not mean to touch, and the doctype refuses an empty table anyway.
 */
function buildTeamUsers(body: IDataObject): void {
	const users = body.users;
	if (!Array.isArray(users)) return;

	if (users.length === 0) {
		delete body.users;
		return;
	}

	body.users = users.map((user) => (typeof user === 'string' ? { user } : (user as IDataObject)));
}

/**
 * Reads Frappe's `_assign` column, which holds a JSON-encoded array of user emails —
 * `'["agent@example.com"]'`. Older records may carry an empty string or null.
 */
function parseAssignees(raw: unknown): string[] {
	if (Array.isArray(raw)) return raw.filter((entry): entry is string => typeof entry === 'string');
	if (typeof raw !== 'string' || raw.trim() === '') return [];

	try {
		const parsed = JSON.parse(raw) as unknown;
		return Array.isArray(parsed)
			? parsed.filter((entry): entry is string => typeof entry === 'string')
			: [];
	} catch {
		return [];
	}
}

/**
 * Reads the assignees of a document.
 *
 * `_assign` is a table column Frappe maintains itself, not a docfield, and
 * `GET /api/resource/{doctype}/{name}` builds its answer from the doctype metadata — so the
 * single-document route never returns it (verified on Frappe 15.116 / Helpdesk 1.28.1, where
 * the payload carries no underscore-prefixed key at all). A list query naming it explicitly
 * does return it, which is the only way to read it over the REST API.
 */
async function fetchAssignees(
	this: IExecuteFunctions,
	doctype: string,
	documentName: string,
	itemIndex: number,
): Promise<string[]> {
	const rows = (await frappeApiRequest.call(
		this,
		'GET',
		`/api/resource/${encodeURIComponent(doctype)}`,
		{},
		{
			filters: [['name', '=', documentName]],
			fields: ['name', '_assign'],
			limit_page_length: 1,
		},
		itemIndex,
	)) as IDataObject[];

	return parseAssignees(Array.isArray(rows) && rows.length > 0 ? rows[0]._assign : undefined);
}

/** Builds a `{ name, value }` list out of Frappe records, sorted for a stable dropdown. */
function toOptions(
	records: IDataObject[],
	labelFor: (record: IDataObject) => string,
): INodePropertyOptions[] {
	return records
		.map((record) => ({ name: labelFor(record), value: String(record.name) }))
		.sort((a, b) => a.name.localeCompare(b.name));
}

/** Fetches the enabled records of a configuration doctype for a dropdown. */
async function loadRecords(
	context: ILoadOptionsFunctions,
	doctype: string,
	fields: string[],
	filters: IDataObject,
): Promise<IDataObject[]> {
	const records = await frappeApiRequest.call<
		ILoadOptionsFunctions,
		[IHttpRequestMethods, string, IDataObject, IDataObject, number],
		Promise<IDataObject[]>
	>(
		context,
		'GET',
		`/api/resource/${encodeURIComponent(doctype)}`,
		{},
		{ fields, filters, limit_page_length: 0 },
		0,
	);

	return Array.isArray(records) ? records : [];
}

export class FrappeHelpdesk implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Frappe Helpdesk',
		name: 'frappeHelpdesk',
		// Frappe Helpdesk logo: opaque violet #7d3dff badge with the glyph knocked out in white.
		// A single file, hence the same violet on both themes, by choice: the badge carries its
		// own background and holds contrast on light as well as dark. This leaves the
		// `icon-prefer-themed-variants` warning (non-blocking, lint exits 0); the
		// { light, dark } form requires two distinct file paths, hence a different tint on one
		// of the themes.
		icon: 'file:../../icons/frappe-helpdesk.svg',
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Read and write Frappe Helpdesk tickets, customers and teams',
		defaults: {
			name: 'Frappe Helpdesk',
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: true,
		credentials: [
			{
				name: 'frappeApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Customer', value: 'customer' },
					{ name: 'Team', value: 'team' },
					{ name: 'Ticket', value: 'ticket' },
					{ name: 'Ticket Priority', value: 'ticketPriority' },
					{ name: 'Ticket Type', value: 'ticketType' },
				],
				default: 'ticket',
			},
			...ticketDescription,
			...customerDescription,
			...teamDescription,
			...ticketPriorityDescription,
			...ticketTypeDescription,
		],
	};

	methods = {
		loadOptions: {
			/**
			 * Ticket statuses, read from the site.
			 *
			 * `HD Ticket.status` is a Link to `HD Ticket Status`, not a Select: a Helpdesk can
			 * define statuses of its own, and `Open` / `Replied` / `Resolved` / `Closed` are only
			 * the four rows seeded at install time. Sorting happens here rather than through
			 * `order_by` because the ordering column is literally named `order`, a reserved SQL
			 * word Frappe does not quote in that clause.
			 *
			 * A Helpdesk predating the doctype answers 404; the four defaults are returned then,
			 * so the dropdown degrades instead of breaking.
			 */
			async getTicketStatuses(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				let records: IDataObject[];
				try {
					records = await loadRecords(this, TICKET_STATUS_DOCTYPE, ['name', 'order'], {
						enabled: 1,
					});
				} catch {
					return DEFAULT_TICKET_STATUSES.map((status) => ({ name: status, value: status }));
				}

				if (records.length === 0) {
					return DEFAULT_TICKET_STATUSES.map((status) => ({ name: status, value: status }));
				}

				return records
					.slice()
					.sort((a, b) => Number(a.order ?? 0) - Number(b.order ?? 0))
					.map((record) => ({ name: String(record.name), value: String(record.name) }));
			},

			async getTicketPriorities(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const records = await loadRecords(this, getDoctype('ticketPriority'), ['name'], {
					disabled: 0,
				});
				return toOptions(records, (record) => String(record.name));
			},

			async getTicketTypes(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const records = await loadRecords(this, getDoctype('ticketType'), ['name'], {
					disabled: 0,
				});
				return toOptions(records, (record) => String(record.name));
			},

			async getTeams(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const records = await loadRecords(this, getDoctype('team'), ['name'], { disabled: 0 });
				return toOptions(records, (record) => String(record.name));
			},

			/**
			 * Agents, keyed by the email Frappe assigns against.
			 *
			 * `HD Agent` sets its own `name` to the linked `User` in `before_save`, so the document
			 * name *is* the email `assign_agent` and `HD Team.users` expect.
			 */
			async getAgents(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const records = await loadRecords(this, AGENT_DOCTYPE, ['name', 'agent_name'], {
					is_active: 1,
				});
				return toOptions(records, (record) =>
					typeof record.agent_name === 'string' && record.agent_name !== ''
						? `${record.agent_name} (${String(record.name)})`
						: String(record.name),
				);
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		const resource = this.getNodeParameter('resource', 0) as string;
		const operation = this.getNodeParameter('operation', 0) as string;
		const doctype = getDoctype(resource);
		const basePath = `/api/resource/${encodeURIComponent(doctype)}`;

		for (let i = 0; i < items.length; i++) {
			try {
				if (operation === 'create' || operation === 'update') {
					const collectionName = operation === 'create' ? 'additionalFields' : 'updateFields';
					const body = { ...(this.getNodeParameter(collectionName, i, {}) as IDataObject) };

					// Required fields are exposed at the top level, outside the collection.
					if (operation === 'create') {
						for (const field of REQUIRED_ON_CREATE[resource] ?? []) {
							body[field] = this.getNodeParameter(field, i);
						}
					}

					if (resource === 'team') buildTeamUsers(body);

					if (operation === 'create') {
						const created = await frappeApiRequest.call(this, 'POST', basePath, body, {}, i);
						returnData.push({ json: created as IDataObject, pairedItem: { item: i } });
					} else {
						const documentId = this.getNodeParameter('documentId', i) as string;
						const updated = await frappeApiRequest.call(
							this,
							'PUT',
							`${basePath}/${encodeURIComponent(documentId)}`,
							body,
							{},
							i,
						);
						returnData.push({ json: updated as IDataObject, pairedItem: { item: i } });
					}
				} else if (operation === 'get') {
					const documentId = this.getNodeParameter('documentId', i) as string;
					const document = await frappeApiRequest.call(
						this,
						'GET',
						`${basePath}/${encodeURIComponent(documentId)}`,
						{},
						{},
						i,
					);
					returnData.push({ json: document as IDataObject, pairedItem: { item: i } });
				} else if (operation === 'delete') {
					const documentId = this.getNodeParameter('documentId', i) as string;
					await frappeApiRequest.call(
						this,
						'DELETE',
						`${basePath}/${encodeURIComponent(documentId)}`,
						{},
						{},
						i,
					);
					returnData.push({
						json: { success: true, doctype, name: documentId },
						pairedItem: { item: i },
					});
				} else if (operation === 'changeStatus') {
					// No custom endpoint for this one: `helpdesk/api/` exposes nothing of the sort,
					// and the status transition lives in HD Ticket's own `on_update`. A plain field
					// update therefore triggers the SLA recomputation and the feedback email.
					const documentId = this.getNodeParameter('documentId', i) as string;
					const status = this.getNodeParameter('status', i) as string;

					const updated = await frappeApiRequest.call(
						this,
						'PUT',
						`${basePath}/${encodeURIComponent(documentId)}`,
						{ status },
						{},
						i,
					);
					returnData.push({ json: updated as IDataObject, pairedItem: { item: i } });
				} else if (operation === 'assign') {
					const documentId = this.getNodeParameter('documentId', i) as string;
					const agent = this.getNodeParameter('agent', i) as string;
					const assignOptions = this.getNodeParameter('assignOptions', i, {}) as IDataObject;
					const path = `${basePath}/${encodeURIComponent(documentId)}`;

					// Frappe assignment is additive — `assign_to.add` appends to `_assign` and skips
					// duplicates silently. Emptying the list first is the only way to express
					// "this agent and no other", so it is opt-in rather than the default.
					if (assignOptions.replace === true) {
						for (const assignee of await fetchAssignees.call(this, doctype, documentId, i)) {
							if (assignee === agent) continue;
							await frappeMethodRequest.call(
								this,
								'frappe.desk.form.assign_to.remove',
								{ doctype, name: documentId, assign_to: assignee },
								i,
							);
						}
					}

					// `assign_agent` is a whitelisted controller method: it wraps
					// `frappe.desk.form.assign_to.add` and additionally raises the in-app
					// HD Notification the Helpdesk UI shows the agent. Going through the generic
					// CRUD would leave `_assign` untouched, since it is not a stored field.
					await frappeRunDocMethod.call(this, doctype, documentId, 'assign_agent', { agent }, i);

					// The method itself answers with an empty envelope, so the ticket is read back:
					// a workflow branching on the assignment wants the document. `_assign` has to
					// be fetched separately — see `fetchAssignees` — and is merged in so the output
					// actually shows who the ticket now belongs to. It is re-encoded as the JSON
					// string Frappe itself stores, so that `_assign` carries the same shape here as
					// in a Get Many asking for it.
					const assigned = (await frappeApiRequest.call(
						this,
						'GET',
						path,
						{},
						{},
						i,
					)) as IDataObject;
					const assignees = await fetchAssignees.call(this, doctype, documentId, i);
					assigned._assign = JSON.stringify(assignees);
					returnData.push({ json: assigned, pairedItem: { item: i } });
				} else if (operation === 'getAll') {
					const returnAll = this.getNodeParameter('returnAll', i) as boolean;
					const options = this.getNodeParameter('options', i, {}) as IDataObject;

					const qs: IDataObject = {};

					// Without `fields`, Frappe returns the `name` column only.
					qs.fields =
						typeof options.fields === 'string' && options.fields.trim() !== ''
							? parseFieldList(options.fields)
							: ['*'];

					const filters = parseJsonParameter(this, options.filters, 'Filters (JSON)', i);
					if (filters !== undefined) qs.filters = filters;

					const orFilters = parseJsonParameter(this, options.orFilters, 'Or Filters (JSON)', i);
					if (orFilters !== undefined) qs.or_filters = orFilters;

					if (typeof options.sortField === 'string' && options.sortField.trim() !== '') {
						const sortOrder = (options.sortOrder as string) ?? 'desc';
						qs.order_by = `${options.sortField.trim()} ${sortOrder}`;
					}

					let records: IDataObject[];
					if (returnAll) {
						records = await frappeApiRequestAllItems.call(this, basePath, qs, i);
					} else {
						qs.limit_page_length = this.getNodeParameter('limit', i) as number;
						qs.limit_start = (options.offset as number) ?? 0;
						records = await frappeApiRequest.call<
							IExecuteFunctions,
							Parameters<typeof frappeApiRequest>,
							Promise<IDataObject[]>
						>(this, 'GET', basePath, {}, qs, i);
					}

					for (const record of records) {
						returnData.push({ json: record, pairedItem: { item: i } });
					}
				} else {
					throw new NodeOperationError(
						this.getNode(),
						`The "${operation}" operation is not supported`,
						{ itemIndex: i },
					);
				}
			} catch (error) {
				// frappeApiRequest already throws a NodeApiError carrying the Frappe message;
				// only unexpected errors get wrapped here.
				const nodeError =
					error instanceof NodeApiError || error instanceof NodeOperationError
						? error
						: new NodeOperationError(this.getNode(), error as Error, { itemIndex: i });

				if (this.continueOnFail()) {
					returnData.push({
						json: { error: nodeError.message },
						pairedItem: { item: i },
					});
					continue;
				}
				throw nodeError;
			}
		}

		return [returnData];
	}
}
