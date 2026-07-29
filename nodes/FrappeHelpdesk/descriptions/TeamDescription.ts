import type { INodeProperties } from 'n8n-workflow';

import { documentIdField, getManyFields, omitFields, operationsFor } from './CommonDescription';

/**
 * `HD Team` fields offered on create as well as update.
 *
 * `assignment_rule` is absent by design: the doctype declares it `read_only`, and Helpdesk
 * creates the underlying `Assignment Rule` document itself when the team is saved.
 *
 * `users` is a Table MultiSelect over `HD Team Member`, a child doctype whose only field is
 * a Link to `User`. Frappe expects it as an array of rows, so the node turns the selected
 * emails into `[{ "user": "agent@example.com" }, …]` before sending. The doctype marks the
 * table `reqd`, which is why the field sits at the top level on create rather than inside
 * « Additional Fields ».
 */
const teamFields: INodeProperties[] = [
	{
		displayName: 'Agent Names or IDs',
		name: 'users',
		type: 'multiOptions',
		typeOptions: { loadOptionsMethod: 'getAgents' },
		default: [],
		description:
			'Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
	},
	{
		displayName: 'Disabled',
		name: 'disabled',
		type: 'boolean',
		default: false,
		description: 'Whether the team is disabled and no longer receives ticket assignments',
	},
	{
		displayName: 'Ignore Restrictions',
		name: 'ignore_restrictions',
		type: 'boolean',
		default: false,
		description:
			'Whether members of this team may see every ticket, bypassing the usual team restrictions',
	},
	{
		displayName: 'Team Name',
		name: 'team_name',
		type: 'string',
		default: '',
		description:
			'Nom de l\'équipe. Il sert de « name » au document : le modifier renomme l\'enregistrement et met à jour les tickets qui y sont liés.',
	},
];

const REQUIRED_ON_CREATE = ['team_name', 'users'];

export const teamDescription: INodeProperties[] = [
	operationsFor('team', 'team'),
	{
		displayName: 'Team Name',
		name: 'team_name',
		type: 'string',
		default: '',
		required: true,
		displayOptions: { show: { resource: ['team'], operation: ['create'] } },
		description: 'Nom de l\'équipe, qui sert aussi de « name » au document',
	},
	{
		displayName: 'Agent Names or IDs',
		name: 'users',
		type: 'multiOptions',
		typeOptions: { loadOptionsMethod: 'getAgents' },
		default: [],
		required: true,
		displayOptions: { show: { resource: ['team'], operation: ['create'] } },
		description:
			'Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
	},
	documentIdField('team', 'Champ « name » de l\'équipe, qui vaut son nom, par ex. Billing.'),
	{
		displayName: 'Additional Fields',
		name: 'additionalFields',
		type: 'collection',
		placeholder: 'Add field',
		default: {},
		displayOptions: { show: { resource: ['team'], operation: ['create'] } },
		options: omitFields(teamFields, REQUIRED_ON_CREATE),
	},
	{
		displayName: 'Update Fields',
		name: 'updateFields',
		type: 'collection',
		placeholder: 'Add field',
		default: {},
		displayOptions: { show: { resource: ['team'], operation: ['update'] } },
		options: teamFields,
	},
	...getManyFields('team', 'name,team_name,disabled'),
];
