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
		description: 'Lien vers un enregistrement du doctype Country, par ex. France.',
	},
	{
		displayName: 'Customer Name',
		name: 'customer_name',
		type: 'string',
		default: '',
		description:
			'Nom du client. Il sert de « name » au document : le modifier renomme l\'enregistrement et met à jour les tickets qui y sont liés.',
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
		description: 'Nature juridique du client',
	},
	{
		displayName: 'Domain',
		name: 'domain',
		type: 'string',
		placeholder: 'acme.io',
		default: '',
		description:
			'Domaine email du client. Frappe rattache automatiquement les tickets dont l\'expéditeur porte ce domaine.',
	},
	{
		displayName: 'Image',
		name: 'image',
		type: 'string',
		default: '',
		description: 'URL du logo, telle que stockée par Frappe, par ex. /files/acme.png.',
	},
	{
		displayName: 'Primary Contact',
		name: 'primary_contact',
		type: 'string',
		default: '',
		description:
			'Champ « name » d\'un Contact. Frappe en dérive l\'email et le téléphone du client.',
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
			'Nom du client. Le doctype se nomme d\'après ce champ, il est donc indispensable même si Frappe ne le marque pas « reqd ».',
	},
	documentIdField(
		'customer',
		'Champ « name » du client, qui vaut son nom commercial, par ex. Acme SAS.',
	),
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
