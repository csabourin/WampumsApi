// utils/routeConfig.js
/**
 * Routes that don't require authentication
 * These routes are in the /api namespace but don't need auth
 */
const PUBLIC_API_ROUTES = [
	'/api/login',
	'/api/register',
	'/api/verify-email',
	'/api/request-reset',
	'/api/reset-password',
	'/api/get-organization-id',
	'/api/get-organization-settings',
	'/api/get-news'
];

/**
 * Check if a route needs authentication
 * @param {string} path - Route path
 * @returns {boolean} - True if authentication is required
 */
function requiresAuth(path) {
	// All non-API routes don't require auth (handled by public.js)
	if (!path.startsWith('/api/')) {
		return false;
	}

	// Check if it's in the list of public API routes
	return !PUBLIC_API_ROUTES.some(route => {
		// Handle exact match or pattern match
		return typeof route === 'string' 
			? path === route || path === route + '/' 
			: route.test(path);
	});
}

module.exports = {
	PUBLIC_API_ROUTES,
	requiresAuth
};