// utils/organizationContext.js
const jwt = require('jsonwebtoken');
const { pool } = require('../config/database');
const logger = require('../config/logger');
const determineOrganizationId = require('../utils')

/**
 * Determine organization ID from multiple sources with consistent priority
 * @param {Object} req - Express request object
 * @returns {Promise<number|null>} Organization ID or null
 */
// async function determineOrganizationId(req) {
// 	try {
// 		// 1. First check explicit header (highest priority)
// 		if (req.headers['X-Organization-ID']) {
// 			const orgId = parseInt(req.headers['X-Organization-ID'], 10);
// 			if (!isNaN(orgId)) {
// 				logger.debug(`Organization ID from header: ${orgId}`);
// 				return orgId;
// 			}
// 		}

// 		// 2. Check JWT token in Authorization header
// 		const authHeader = req.headers.authorization;
// 		if (authHeader && authHeader.startsWith('Bearer ')) {
// 			try {
// 				const token = authHeader.substring(7);
// 				const decoded = jwt.verify(token, process.env.JWT_SECRET_KEY);

// 				if (decoded && decoded.organizationId) {
// 					logger.debug(`Organization ID from JWT: ${decoded.organizationId}`);
// 					return decoded.organizationId;
// 				}
// 			} catch (tokenError) {
// 				// JWT verification failed, continue to next method
// 				logger.debug(`JWT verification failed: ${tokenError.message}`);
// 			}
// 		}

// 		// 3. Fallback to hostname lookup
// 		const hostname = req.query.hostname || req.hostname;
// 		if (hostname) {
// 			const client = await pool.connect();
// 			try {
// 				const result = await client.query(
// 					`SELECT organization_id FROM organization_domains 
// 					 WHERE domain = $1 OR $2 LIKE REPLACE(domain, '*', '%') 
// 					 LIMIT 1`,
// 					[hostname, hostname]
// 				);

// 				if (result.rows.length > 0) {
// 					const orgId = result.rows[0].organization_id;
// 					logger.debug(`Organization ID from hostname: ${orgId}`);
// 					return orgId;
// 				}
// 			} finally {
// 				client.release();
// 			}
// 		}

// 		logger.debug('No organization ID could be determined');
// 		return null;
// 	} catch (error) {
// 		logger.error(`Error determining organization ID: ${error.message}`);
// 		return null;
// 	}
// }

// Export both the function and a middleware
module.exports = {
	determineOrganizationId,

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
	}
};