// middleware/organizationContext.js
const logger = require("../config/logger");
const { jsonResponse } = require("../utils/responseFormatter");

/**
 * Legacy middleware - organization context now handled globally
 * @deprecated Use global organization middleware in index.js instead
 * @param {boolean} required - Whether organization context is required
 */
function requireOrganization(required = true) {
	return (req, res, next) => {
		// Organization context is now handled globally in index.js
		// This middleware is deprecated but kept for backward compatibility
		next();
	};
}

module.exports = { requireOrganization };