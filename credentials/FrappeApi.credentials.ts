import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

/**
 * Frappe application paths mounted as single-page apps. Mirror of `SPA_MOUNT_PATHS` in
 * `nodes/FrappeHelpdesk/GenericFunctions.ts`, duplicated on purpose: this file has to stay
 * self-contained so it can be copied verbatim into the sibling Frappe packages.
 */
const SPA_MOUNT_PATHS = ['crm', 'helpdesk', 'lms', 'hr', 'insights', 'builder', 'app'];

/**
 * Site URL as the test request should use it: trailing slashes removed, and the SPA path
 * dropped when the user pasted the URL their browser displays (`https://site/helpdesk`).
 *
 * Dropping it is not cosmetic. `/api/...` only exists at the site root; under an SPA mount
 * the request is caught by the front-end router, which answers **200 with index.html**
 * instead of an error (verified on Frappe 16.29.0). The `Guest` rule below then finds no
 * `message` key to compare, so the credential would be reported as valid — even with
 * completely wrong keys. An *unknown* path is harmless by comparison: it 404s.
 */
const SITE_URL_EXPRESSION =
	'={{$credentials.siteUrl.trim().replace(new RegExp("/+$"), "")' +
	`.replace(new RegExp("/(${SPA_MOUNT_PATHS.join('|')})$", "i"), "")}}`;

/**
 * Generic Frappe credential.
 *
 * Deliberately free of any product-specific notion: it targets a Frappe *site*, not an
 * application. The Frappe Helpdesk, Frappe CRM, Frappe HRMS and Frappe LMS nodes all
 * declare `{ name: 'frappeApi', required: true }` and share the same credential instance.
 * See docs/CREDENTIALS.md.
 *
 * The internal name `frappeApi` and the field names are identical to the ones shipped by
 * the `n8n-nodes-frappe-crm` and `n8n-nodes-frappe-hrms` packages, on purpose: a user
 * running several of them sees a single « Frappe API » credential type and configures
 * their site once. Any change here has to be mirrored there.
 */
export class FrappeApi implements ICredentialType {
	name = 'frappeApi';

	displayName = 'Frappe API';

	icon = { light: 'file:../icons/frappe.svg', dark: 'file:../icons/frappe.dark.svg' } as const;

	documentationUrl = 'https://docs.frappe.io/framework/user/en/api/rest';

	properties: INodeProperties[] = [
		{
			displayName: 'Site URL',
			name: 'siteUrl',
			type: 'string',
			default: '',
			required: true,
			placeholder: 'https://mon-site.frappe.cloud',
			description:
				"URL racine du site Frappe. Le nœud y ajoute lui-même /api/resource ou /api/method. Coller l'URL affichée par le navigateur fonctionne aussi : un chemin d'application final (/helpdesk, /crm, /hr, /lms, /app…) et le slash final sont retirés.",
		},
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			default: '',
			required: true,
			description:
				'Clé générée depuis le profil utilisateur Frappe : Settings > API Access > Generate Keys',
			typeOptions: { password: true },
		},
		{
			displayName: 'API Secret',
			name: 'apiSecret',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description: 'Secret affiché une seule fois, au moment de la génération des clés',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=token {{$credentials.apiKey}}:{{$credentials.apiSecret}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: SITE_URL_EXPRESSION,
			url: '/api/method/frappe.auth.get_logged_user',
			method: 'GET',
		},
		rules: [
			{
				type: 'responseSuccessBody',
				properties: {
					key: 'message',
					value: 'Guest',
					message:
						"Connexion anonyme : le site a répondu mais n'a pas reconnu les clés. Vérifiez l'API Key et l'API Secret.",
				},
			},
		],
	};
}
