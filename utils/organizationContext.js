// utils/organizationContext.js
const jwt = require("jsonwebtoken");
const { pool } = require("../config/database");
const logger = require("../config/logger");
const { determineOrganizationId } = require("../utils");

/**
 * Get organization ID from request (standardized method)
 * @param {Object} req - Express request object
 * @returns {number|null} Organization ID or null
 */
function getOrganizationId(req) {
	return req.organizationId || null;
}

module.exports = {
	getOrganizationId,
	
	// Middleware that adds organizationId to the request
	addOrganizationToRequest: async (req, res, next) => {
		try {
			const orgId = await determineOrganizationId(req);
			if (orgId) {
				req.organizationId = orgId;
			}
			next();
		} catch (error) {
			logger.error(`Organization middleware error: ${error.message}`);
			next();
		}
	},
};
