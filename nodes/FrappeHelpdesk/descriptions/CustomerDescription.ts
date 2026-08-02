import type { INodeProperties } from 'n8n-workflow';

import { documentIdField, getManyFields, omitFields, operationsFor } from './CommonDescription';

/**
 * `HD Customer` fields offered on create as well as update.
 *
 * `email_id` and `mobile_no` are absent by design: the doctype declares them `read_only`
 * with a `fetch_from` on `primary_contact`, so Frappe overwrites whatever is sent. Set the
 * primary contact instead and let Frappe fill them in. `erpnext_customer` is read-only too,
 * written by the ERPNext integration rather than by hand.
 *
 * The `contacts` child table (`HD Customer Member`) is not exposed: sending it would
 * replace the whole member list on every update, which is rarely what a workflow means.
 */
const customerFields: INodeProperties[] = [
	{
		displayName: 'Country',
		name: 'country',
		type: 'string',
		default: '',
		description: 'Link to a record of the Country doctype, e.g. France',
	},
	{
		displayName: 'Customer Name',
		name: 'customer_name',
		type: 'string',
		default: '',
		description:
			'Customer name. It doubles as the document "name": changing it renames the record and updates the tickets linked to it.',
	},
	{
		displayName: 'Customer Type',
		name: 'customer_type',
		type: 'options',
		options: [
			{ name: 'Company', value: 'Company' },
			{ name: 'Individual', value: 'Individual' },
			{ name: 'Partnership', value: 'Partnership' },
		],
		default: 'Company',
		description: 'Legal nature of the customer',
	},
	{
		displayName: 'Domain',
		name: 'domain',
		type: 'string',
		placeholder: 'acme.io',
		default: '',
		description:
			'Customer email domain. Frappe automatically attaches tickets whose sender carries this domain.',
	},
	{
		displayName: 'Image',
		name: 'image',
		type: 'string',
		default: '',
		description: 'Logo URL, as stored by Frappe, e.g. /files/acme.png',
	},
	{
		displayName: 'Primary Contact',
		name: 'primary_contact',
		type: 'string',
		default: '',
		description: 'The "name" of a Contact. Frappe derives the customer email and phone from it.',
	},
];

const REQUIRED_ON_CREATE = ['customer_name'];

export const customerDescription: INodeProperties[] = [
	operationsFor('customer', 'customer'),
	{
		displayName: 'Customer Name',
		name: 'customer_name',
		type: 'string',
		default: '',
		required: true,
		displayOptions: { show: { resource: ['customer'], operation: ['create'] } },
		description:
			'Customer name. The doctype names itself after this field, so it is indispensable even though Frappe does not mark it "reqd".',
	},
	documentIdField('customer', 'The customer\'s "name", which is its trading name, e.g. Acme SAS.'),
	{
		displayName: 'Additional Fields',
		name: 'additionalFields',
		type: 'collection',
		placeholder: 'Add field',
		default: {},
		displayOptions: { show: { resource: ['customer'], operation: ['create'] } },
		options: omitFields(customerFields, REQUIRED_ON_CREATE),
	},
	{
		displayName: 'Update Fields',
		name: 'updateFields',
		type: 'collection',
		placeholder: 'Add field',
		default: {},
		displayOptions: { show: { resource: ['customer'], operation: ['update'] } },
		options: customerFields,
	},
	...getManyFields('customer', 'name,customer_name,domain,customer_type'),
];
