// middleware/organizationContext.js
const logger = require('../config/logger');
const { jsonResponse } = require('../utils/responseFormatter');

/**
 * Middleware to ensure organization context exists
 * @param {boolean} required - Whether organization context is required
 */
function requireOrganization(required = true) {
	return (req, res, next) => {
		if (!required) {
			return next();
		}

		if (!req.organizationId) {
			logger.warn(`Missing organization context for ${req.method} ${req.path}`);
			return jsonResponse(res, false, null, "Organization context is required");
		}

		next();
	};
}

module.exports = { requireOrganization };