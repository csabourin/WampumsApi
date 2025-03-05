// utils/organizationContext.js

const logger = require('../config/logger');

/**
 * Get the current organization ID from the request
 * First check from the JWT token in req.user, then fall back to req.organizationId
 * 
 * @param {Object} req - Express request object
 * @returns {number|null} - The organization ID or null if not found
 * @throws {Error} - If organization ID is required but not found
 */
function getOrganizationId(req, required = true) {
		// First try to get from user context (set by JWT)
		if (req.user && req.user.organizationId) {
				return req.user.organizationId;
		}

		// Then from request object directly (might be set by middleware)
		if (req.organizationId) {
				return req.organizationId;
		}

		// If organization ID is required but not found, throw an error
		if (required) {
				const err = new Error('Organization ID not found in request');
				logger.error(err);
				throw err;
		}

		// Otherwise just return null
		logger.warn('No organization ID found in request');
		return null;
}

/**
 * Middleware to ensure organization context exists
 * Will extract organization ID from JWT or set it from hostname
 * 
 * @param {boolean} required - If true, will return 400 error if organization ID not found
 * @returns {Function} - Express middleware
 */
function requireOrganizationContext(required = true) {
		return (req, res, next) => {
				try {
						const organizationId = getOrganizationId(req, required);
						if (required && !organizationId) {
								return res.status(400).json({
										success: false,
										message: 'Organization ID is required'
								});
						}
						next();
				} catch (error) {
						return res.status(400).json({
								success: false,
								message: error.message
						});
				}
		};
}

module.exports = {
		getOrganizationId,
		requireOrganizationContext
};