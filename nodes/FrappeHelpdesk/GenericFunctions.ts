import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError } from 'n8n-workflow';

/**
 * Transport layer shared by every Frappe node.
 *
 * Nothing here is Helpdesk-specific: it is the same file as in the Frappe CRM and Frappe
 * HRMS packages, kept identical apart from the `frappeRunDocMethod` helper added below.
 * These functions only know about the `frappeApi` credential and Frappe's generic REST API.
 */

const CREDENTIALS_NAME = 'frappeApi';

/** Records requested per page when auto-paginating. */
const AUTO_PAGE_SIZE = 100;

/** Safety net: beyond this, pagination is assumed not to converge. */
const MAX_AUTO_PAGES = 1000;

/**
 * Frappe application paths mounted as SPAs. They are not part of the API — `/api/...`
 * always lives at the site root. Stripping them lets a user paste the URL their browser
 * displays (e.g. https://site/helpdesk) instead of the bare site root.
 */
const SPA_MOUNT_PATHS = ['crm', 'helpdesk', 'lms', 'hr', 'insights', 'builder', 'app'];

/**
 * Normalizes the site URL entered in the credential: drops the trailing slash and, when
 * present, the SPA path.
 */
export function normalizeSiteUrl(siteUrl: string): string {
	let normalized = (siteUrl ?? '').trim().replace(/\/+$/, '');

	for (const mount of SPA_MOUNT_PATHS) {
		if (normalized.toLowerCase().endsWith(`/${mount}`)) {
			normalized = normalized.slice(0, -(mount.length + 1));
			break;
		}
	}

	return normalized.replace(/\/+$/, '');
}

/** Strips HTML tags and decodes the most common entities. */
function stripHtml(value: string): string {
	return value
		.replace(/<br\s*\/?>/gi, '\n')
		.replace(/<\/(p|div|li|h\d)>/gi, '\n')
		.replace(/<[^>]*>/g, '')
		.replace(/&nbsp;/gi, ' ')
		.replace(/&amp;/gi, '&')
		.replace(/&lt;/gi, '<')
		.replace(/&gt;/gi, '>')
		.replace(/&quot;/gi, '"')
		.replace(/&#39;/gi, "'")
		.replace(/[ \t]+/g, ' ')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

/**
 * Extracts the messages from `_server_messages`, which Frappe encodes as JSON **inside**
 * JSON: a string holding an array of strings, each of which is itself a JSON object
 * `{"message": "...", "title": "..."}`.
 */
function parseServerMessages(raw: unknown): string[] {
	if (typeof raw !== 'string' || raw.length === 0) return [];

	let entries: unknown;
	try {
		entries = JSON.parse(raw);
	} catch {
		return [stripHtml(raw)];
	}

	if (!Array.isArray(entries)) return [];

	const messages: string[] = [];
	for (const entry of entries) {
		if (typeof entry !== 'string') continue;

		let message = entry;
		try {
			const parsed = JSON.parse(entry) as unknown;
			if (typeof parsed === 'string') {
				message = parsed;
			} else if (parsed !== null && typeof parsed === 'object') {
				const candidate = (parsed as IDataObject).message;
				if (typeof candidate === 'string') message = candidate;
			}
		} catch {
			// The entry was not nested JSON: keep it as-is.
		}

		const cleaned = stripHtml(message);
		if (cleaned.length > 0) messages.push(cleaned);
	}

	return messages;
}

/**
 * Strips the Python exception class prefix:
 * `frappe.exceptions.ValidationError: Status required` -> `Status required`.
 */
function cleanException(exception: string): string {
	const match = /^([A-Za-z_][\w.]*Error|[A-Za-z_][\w.]*Exception):\s*([\s\S]+)$/.exec(
		exception.trim(),
	);
	return stripHtml(match ? match[2] : exception);
}

/**
 * Builds a readable message from the error body Frappe returns, rather than settling for
 * the bare HTTP status code.
 */
export function parseFrappeError(body: unknown, statusCode: number): string {
	if (typeof body === 'string') {
		const cleaned = stripHtml(body);
		// A full HTML error page teaches the user nothing useful.
		if (cleaned.length > 0 && cleaned.length < 500) return cleaned;
		return `The Frappe request failed (HTTP ${statusCode})`;
	}

	if (body !== null && typeof body === 'object') {
		const payload = body as IDataObject;

		const serverMessages = parseServerMessages(payload._server_messages);
		if (serverMessages.length > 0) return serverMessages.join(' | ');

		if (typeof payload.exception === 'string' && payload.exception.length > 0) {
			return cleanException(payload.exception);
		}

		if (typeof payload.message === 'string' && payload.message.length > 0) {
			return stripHtml(payload.message);
		}

		if (typeof payload.exc_type === 'string' && payload.exc_type.length > 0) {
			return payload.exc_type;
		}
	}

	return `The Frappe request failed (HTTP ${statusCode})`;
}

/** Serializes the structured values (filters, fields, or_filters) Frappe expects as JSON. */
export function serializeQuery(qs: IDataObject): IDataObject {
	const serialized: IDataObject = {};

	for (const [key, value] of Object.entries(qs)) {
		if (value === undefined || value === null || value === '') continue;
		serialized[key] =
			typeof value === 'object' ? JSON.stringify(value) : (value as IDataObject[string]);
	}

	return serialized;
}

/**
 * Performs an authenticated request against the Frappe REST API and returns the contents
 * of the `{ "data": ... }` envelope.
 */
export async function frappeApiRequest<T = IDataObject>(
	this: IExecuteFunctions | ILoadOptionsFunctions,
	method: IHttpRequestMethods,
	endpoint: string,
	body: IDataObject = {},
	qs: IDataObject = {},
	itemIndex = 0,
): Promise<T> {
	const credentials = await this.getCredentials(CREDENTIALS_NAME);
	const baseURL = normalizeSiteUrl(credentials.siteUrl as string);

	const options: IHttpRequestOptions = {
		method,
		baseURL,
		url: endpoint,
		headers: { Accept: 'application/json' },
		json: true,
		// We inspect the body ourselves to build the Frappe error message.
		returnFullResponse: true,
		ignoreHttpStatusErrors: true,
	};

	const serializedQs = serializeQuery(qs);
	if (Object.keys(serializedQs).length > 0) options.qs = serializedQs;
	if (Object.keys(body).length > 0) options.body = body;

	const response = (await this.helpers.httpRequestWithAuthentication.call(
		this,
		CREDENTIALS_NAME,
		options,
	)) as { statusCode: number; body: unknown };

	const statusCode = response.statusCode;

	if (statusCode >= 400) {
		const message = parseFrappeError(response.body, statusCode);
		const errorBody =
			response.body !== null && typeof response.body === 'object'
				? (response.body as JsonObject)
				: ({ body: response.body } as JsonObject);

		throw new NodeApiError(this.getNode(), errorBody, {
			message,
			httpCode: String(statusCode),
			itemIndex,
			description:
				statusCode === 401 || statusCode === 403
					? "Check the credential's API Key/Secret and the permissions its role has on this doctype."
					: undefined,
		});
	}

	const payload = response.body;
	if (payload !== null && typeof payload === 'object' && 'data' in (payload as IDataObject)) {
		return (payload as IDataObject).data as T;
	}

	return payload as T;
}

/**
 * Calls a whitelisted Frappe method under `/api/method/` and unwraps the `{ "message": ... }`
 * envelope those endpoints use — `/api/resource/` answers with `{ "data": ... }` instead.
 *
 * Kept in sync with the CRM and HRMS packages, which use it for `frappe.client.submit`.
 */
export async function frappeMethodRequest<T = IDataObject>(
	this: IExecuteFunctions,
	method: string,
	body: IDataObject = {},
	itemIndex = 0,
): Promise<T> {
	const response = await frappeApiRequest.call(
		this,
		'POST',
		`/api/method/${method}`,
		body,
		{},
		itemIndex,
	);

	if (response !== null && typeof response === 'object' && 'message' in response) {
		return (response as IDataObject).message as T;
	}

	return response as T;
}

/**
 * Runs a whitelisted *controller* method on an existing document.
 *
 * Frappe mounts this on the REST v1 resource route itself — `frappe/api/v1.py` declares
 * `Rule("/resource/<doctype>/<path:name>/", methods=["POST", "QUERY"], endpoint=execute_doc_method)`.
 * The handler reads the method name from `form_dict`, pops it, then spreads whatever is
 * left as keyword arguments:
 *
 * ```python
 * method = method or frappe.form_dict.pop("run_method")
 * ...
 * return doc.run_method(method, **frappe.form_dict)
 * ```
 *
 * `run_method` therefore has to travel **in the JSON body**, next to the method arguments —
 * not in the query string. Frappe rebuilds `form_dict` from the request body when there is
 * one, and the query-string parameters are lost in the process. Verified against Frappe
 * 15.116: `?run_method=…` alone works, but as soon as a JSON body accompanies it the site
 * answers `KeyError: 'run_method'`. Since every interesting method takes arguments, the
 * query-string form is broken in practice.
 *
 * Consequence for callers: `args` must carry the method's parameters and nothing else. Any
 * stray key becomes an unexpected keyword argument, and Frappe answers 417.
 *
 * `POST /api/method/run_doc_method` with `{ dt, dn, method, args }` is a genuine
 * alternative, contrary to what this comment claimed until now. It carries no
 * `@frappe.whitelist()` decorator, which makes it look unreachable, but `frappe/handler.py`
 * exempts it by name:
 *
 * ```python
 * if method != run_doc_method:
 * 	is_whitelisted(method)
 * 	is_valid_http_method(method)
 * ```
 *
 * Present on the `version-15`, `version-16` and `develop` branches. It differs from the
 * route used here on two points: it loads the document with `check_permission=True`, so it
 * only needs **read** access where this one calls `doc.check_permission("write")`, and it
 * parses `args` as JSON instead of flattening it into `form_dict`, so numbers stay numbers.
 *
 * The resource route is kept here on purpose: the Helpdesk methods it drives are writes
 * anyway, so the stricter permission costs nothing, and this form is the one already
 * verified against a live site. The Frappe Insights package takes the other route, because
 * running a query is a read. See `n8n-nodes-frappe-insights` if you need that behaviour.
 */
export async function frappeRunDocMethod<T = IDataObject>(
	this: IExecuteFunctions,
	doctype: string,
	documentName: string,
	method: string,
	args: IDataObject = {},
	itemIndex = 0,
): Promise<T> {
	return await frappeApiRequest.call<
		IExecuteFunctions,
		[IHttpRequestMethods, string, IDataObject, IDataObject, number],
		Promise<T>
	>(
		this,
		'POST',
		`/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(documentName)}`,
		{ run_method: method, ...args },
		{},
		itemIndex,
	);
}

/**
 * Walks every page of a doctype through `limit_start` / `limit_page_length` and returns
 * all the records.
 */
export async function frappeApiRequestAllItems(
	this: IExecuteFunctions,
	endpoint: string,
	qs: IDataObject = {},
	itemIndex = 0,
): Promise<IDataObject[]> {
	const returnData: IDataObject[] = [];
	let start = Number(qs.limit_start ?? 0);

	for (let page = 0; page < MAX_AUTO_PAGES; page++) {
		const batch = await frappeApiRequest.call<
			IExecuteFunctions,
			[IHttpRequestMethods, string, IDataObject, IDataObject, number],
			Promise<IDataObject[]>
		>(
			this,
			'GET',
			endpoint,
			{},
			{ ...qs, limit_start: start, limit_page_length: AUTO_PAGE_SIZE },
			itemIndex,
		);

		if (!Array.isArray(batch) || batch.length === 0) break;

		returnData.push(...batch);

		// A short page means this was the last one.
		if (batch.length < AUTO_PAGE_SIZE) break;

		start += AUTO_PAGE_SIZE;
	}

	return returnData;
}
