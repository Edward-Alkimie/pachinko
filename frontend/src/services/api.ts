/**
 * Base URL of the Django API.
 *
 * Default: same origin as the page (`<base>api`), e.g. `/api` locally or
 * `/absproxy/5180/api` inside code-server. In development Vite proxies that
 * path to Django (see vite.config.ts), so the session + CSRF cookies are
 * first-party and no CORS setup is needed.
 *
 * Set VITE_API_URL only if the API is served from somewhere else.
 */
export const API_URL: string = import.meta.env.VITE_API_URL ?? `${import.meta.env.BASE_URL}api`
