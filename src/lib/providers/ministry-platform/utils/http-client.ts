import { QueryParams, RequestBody } from "../types/provider.types";

/**
 * Encodes one query-string value, spending one byte on a space (`+`) rather than
 * three (`%20`). MP sits behind IIS, whose default `maxQueryString` is 2048; an
 * MP `$select`/`$filter` is mostly SQL, i.e. mostly spaces, and a request over
 * the limit is answered with an IIS HTML 404 that never reaches the API (C50).
 *
 * `+` is the form-urlencoded spelling of a space, which ASP.NET decodes in query
 * strings. A literal `+` in a value is still `%2B` (encodeURIComponent escapes
 * it), so no value changes meaning. Only the query string is affected; path
 * segments (`/procs/<name>`) are encoded by their callers and keep `%20`.
 */
export function encodeQueryValue(value: unknown): string {
    return encodeURIComponent(String(value)).replace(/%20/g, '+');
}

export class HttpClient {
    private baseUrl: string;
    private getToken: () => string;

    constructor(baseUrl: string, getToken: () => string) {
        this.baseUrl = baseUrl;
        this.getToken = getToken;
    }

    async get<T = unknown>(endpoint: string, queryParams?: QueryParams): Promise<T> {
        const url = this.buildUrl(endpoint, queryParams);
        
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${this.getToken()}`,
                'Accept': 'application/json'
            }
        });

        if (!response.ok) {
            const responseText = await response.text();
            console.error("GET Request failed:", {
                status: response.status,
                statusText: response.statusText,
                endpoint,
                url,
                responseBody: responseText
            });
            throw new Error(`GET ${endpoint} failed: ${response.status} ${response.statusText}`);
        }

        return await response.json() as T;
    }

    async post<T = unknown>(endpoint: string, body?: RequestBody, queryParams?: QueryParams): Promise<T> {
        const url = this.buildUrl(endpoint, queryParams);

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.getToken()}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: body ? JSON.stringify(body) : undefined
        });

        if (!response.ok) {
            const responseText = await response.text();
            console.error("POST Request failed:", {
                status: response.status,
                statusText: response.statusText,
                endpoint,
                responseBody: responseText
            });
            throw new Error(`POST ${endpoint} failed: ${response.status} ${response.statusText}`);
        }

        return await response.json() as T;
    }

    async postFormData<T = unknown>(endpoint: string, formData: FormData, queryParams?: QueryParams): Promise<T> {
        const url = this.buildUrl(endpoint, queryParams);
        
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.getToken()}`,
                'Accept': 'application/json'
                // Don't set Content-Type for FormData
            },
            body: formData
        });

        if (!response.ok) {
            throw new Error(`POST ${endpoint} failed: ${response.status} ${response.statusText}`);
        }

        return await response.json() as T;
    }

    async put<T = unknown>(endpoint: string, body: RequestBody, queryParams?: QueryParams): Promise<T> {
        const url = this.buildUrl(endpoint, queryParams);

        const response = await fetch(url, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${this.getToken()}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const responseText = await response.text();
            console.error("PUT Request failed:", {
                status: response.status,
                statusText: response.statusText,
                responseBody: responseText
            });
            throw new Error(`PUT ${endpoint} failed: ${response.status} ${response.statusText}`);
        }

        return await response.json() as T;
    }

    async putFormData<T = unknown>(endpoint: string, formData: FormData, queryParams?: QueryParams): Promise<T> {
        const url = this.buildUrl(endpoint, queryParams);
        
        const response = await fetch(url, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${this.getToken()}`,
                'Accept': 'application/json'
                // Don't set Content-Type for FormData
            },
            body: formData
        });

        if (!response.ok) {
            throw new Error(`PUT ${endpoint} failed: ${response.status} ${response.statusText}`);
        }

        return await response.json() as T;
    }

    async delete<T = unknown>(endpoint: string, queryParams?: QueryParams): Promise<T> {
        const url = this.buildUrl(endpoint, queryParams);
        
        const response = await fetch(url, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${this.getToken()}`,
                'Accept': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`DELETE ${endpoint} failed: ${response.status} ${response.statusText}`);
        }

        return await response.json() as T;
    }

    public buildUrl(endpoint: string, queryParams?: QueryParams): string {
        const url = `${this.baseUrl}${endpoint}`;
        if (!queryParams) return url;

        const queryString = this.buildQueryString(queryParams);
        return queryString ? `${url}?${queryString}` : url;
    }

    private buildQueryString(params: QueryParams): string {
        return Object.entries(params)
            .filter(([, value]) => value !== undefined && value !== null)
            .map(([key, value]) => {
                if (Array.isArray(value)) {
                    return value.map(v => `${key}=${encodeQueryValue(v)}`).join('&');
                }
                return `${key}=${encodeQueryValue(value)}`;
            })
            .join('&');
    }
}