// config/middleware.js
const jwt = require('jsonwebtoken');
const logger = require('./logger');
const { Pool } = require('pg');

// Secret key for JWT verification
const secretKey = process.env.JWT_SECRET_KEY;

// Database connection pool
const pool = new Pool({
	connectionString: process.env.DB_URL,
	ssl: {
		rejectUnauthorized: false
	}
});

/**
 * Standard JSON response format
 */
const jsonResponse = (res, success, data = null, message = '') => {
	return res.json({
		success,
		data,
		message
	});
};

/**
 * Error handling middleware
 */
const handleError = (err, req, res, next) => {
	logger.error(`Error: ${err.message}\nStack: ${err.stack}`);

	const statusCode = err.statusCode || 500;

	return jsonResponse(
		res.status(statusCode), 
		false, 
		null, 
		process.env.NODE_ENV === 'production' 
			? 'An internal server error occurred' 
			: err.message
	);
};

/**
 * Check if route is public (doesn't require authentication)
 */
const isPublicRoute = (path) => {
	// List of routes that don't require authentication
	const publicPaths = [
		'/api/authenticate',
		'/api/login',
		'/api/register',
		'/api/verify-email',
		'/api/request_reset',
		'/api/reset_password',
		'/api/get_organization_settings',
		'/api/get_news',
		'/api/get_organization_id'
	];

	// Standardize path by removing trailing slash
	const normalizedPath = path.endsWith('/') ? path.slice(0, -1) : path;

	// Check exact matches
	if (publicPaths.includes(normalizedPath)) {
		return true;
	}

	// Check pattern matches (for dynamic routes)
	// Example: if you have dynamic routes like /api/product/:id
	// const dynamicPatterns = [/^\/api\/product\/\d+$/];
	// if (dynamicPatterns.some(pattern => pattern.test(normalizedPath))) {
	//   return true;
	// }

	return false;
};

/**
 * Extract JWT token from request
 */
const extractToken = (req) => {
	// Check Authorization header
	const authHeader = req.headers.authorization;
	if (authHeader && authHeader.startsWith('Bearer ')) {
		return authHeader.substring(7);
	}

	// Check query param
	if (req.query && req.query.token) {
		return req.query.token;
	}

	return null;
};

/**
 * Extract and validate organization ID from JWT
 */
const extractOrganizationFromJWT = (req, res, next) => {
	try {
		const token = extractToken(req);

		if (!token) {
			return next(); // No token, proceed to next middleware
		}

		try {
			const decoded = jwt.verify(token, secretKey);

			if (decoded && decoded.organizationId) {
				// Add organization ID to request object
				req.organizationId = decoded.organizationId;

				// If user info exists, add that too
				if (decoded.user_id) {
					req.user = {
						id: decoded.user_id,
						role: decoded.user_role,
						organizationId: decoded.organizationId
					};
				}
			}

			// Continue processing
			next();
		} catch (error) {
			logger.warn(`JWT verification failed in middleware: ${error.message}`);
			// Continue anyway - we'll fall back to hostname-based detection
			next();
		}
	} catch (error) {
		logger.error(`Error in JWT extraction middleware: ${error.message}`);
		next();
	}
};

/**
 * Token verification middleware
 */
const tokenMiddleware = async (req, res, next) => {
	// Skip token verification for public routes
	if (isPublicRoute(req.path)) {
		return next();
	}

	// Extract token
	const token = extractToken(req);

	if (!token) {
		return res.status(401).json({
			success: false,
			message: "Authentication required"
		});
	}

	try {
		// Verify token
		const decoded = jwt.verify(token, secretKey);

		// Check if organization context exists
		if (!decoded.organizationId) {
			throw new Error("Missing organization context in token");
		}

		// For routes requiring user authentication, check for user ID
		const requiresUserAuth = !isPublicRoute(req.path);

		if (requiresUserAuth && !decoded.user_id) {
			return res.status(403).json({
				success: false,
				message: "User authentication required for this resource"
			});
		}

		// Add decoded info to request
		req.organizationId = decoded.organizationId;

		if (decoded.user_id) {
			req.user = {
				id: decoded.user_id,
				role: decoded.user_role || 'user',
				organizationId: decoded.organizationId
			};
		}

		next();
	} catch (error) {
		logger.error(`Token verification failed: ${error.message}`);

		return res.status(403).json({
			success: false,
			message: "Invalid or expired token"
		});
	}
};

/**
 * Role-based permission middleware
 */
const roleMiddleware = (allowedRoles) => {
	return (req, res, next) => {
		if (!req.user || !req.user.role) {
			return res.status(403).json({
				success: false,
				message: "No role information found"
			});
		}

		if (!allowedRoles.includes(req.user.role)) {
			return res.status(403).json({
				success: false,
				message: `Insufficient permissions. Required roles: ${allowedRoles.join(', ')}`
			});
		}

		next();
	};
};

/**
 * Request validation middleware
 */
const validateRequest = (req, res, next) => {
	const errors = validationResult(req);

	if (!errors.isEmpty()) {
		return res.status(400).json({ 
			success: false, 
			errors: errors.array() 
		});
	}

	next();
};

/**
 * Organization context middleware
 * Ensures an organization ID is available, either from JWT or hostname
 */
const requireOrganizationContext = async (req, res, next) => {
	// If organization ID already set by JWT middleware, continue
	if (req.organizationId) {
		return next();
	}

	try {
		// Fall back to hostname lookup
		const hostname = req.query.hostname || req.hostname;
		const client = await pool.connect();

		try {
			const result = await client.query(
				`SELECT organization_id FROM organization_domains 
				 WHERE domain = $1 OR $2 LIKE REPLACE(domain, '*', '%') 
				 LIMIT 1`,
				[hostname, hostname]
			);

			if (result.rows.length > 0) {
				req.organizationId = result.rows[0].organization_id;
				next();
			} else {
				return jsonResponse(res.status(400), false, null, "Organization context required");
			}
		} finally {
			client.release();
		}
	} catch (error) {
		logger.error(`Error determining organization context: ${error.message}`);
		return jsonResponse(res.status(500), false, null, "Error determining organization context");
	}
};

module.exports = {
	handleError,
	tokenMiddleware,
	roleMiddleware,
	validateRequest,
	extractOrganizationFromJWT,
	requireOrganizationContext,
	jsonResponse,
	isPublicRoute
};