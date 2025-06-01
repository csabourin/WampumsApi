	// config/middleware.js
	const jwt = require('jsonwebtoken');
	const logger = require('./logger');
	const { Pool } = require('pg');
	const { jsonResponse } = require('../utils/responseFormatter');
const { validationResult } = require('express-validator');

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
	 * Extract JWT token from request
	 */
	function extractToken(req) {
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
	}

	/**
	 * List of routes that don't require authentication
	 */
	const PUBLIC_ROUTES = [
		'/login',
		'/api/login',
		'/register',
		'/refresh-token',
		'/verify-email',
		'/request-reset',
		'/reset-password',
		'/get-organization-settings',
		'/get-news',
		'/get-organization-id',
		// Add any other public routes
	];

/**
 * Validate request middleware
 * Checks for validation errors from express-validator
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
	 * Check if a route is public (doesn't require authentication)
	 */
	function isPublicRoute(path) {
		// Standardize path by removing trailing slash
		const normalizedPath = path.endsWith('/') ? path.slice(0, -1) : path;

		// Check exact matches
		if (PUBLIC_ROUTES.some(route => {
			return typeof route === 'string' 
				? route === normalizedPath 
				: route.test(normalizedPath);
		})) {
			return true;
		}

		return false;
	}

	/**
	 * Verify a JWT token
	 */
	function verifyToken(token) {
		try {
			return jwt.verify(token, secretKey);
		} catch (error) {
			logger.error(`Token verification failed: ${error.message}`);
			return null;
		}
	}

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
			const decoded = verifyToken(token);

			if (!decoded) {
				return res.status(401).json({
					success: false,
					message: "Invalid or expired token"
				});
			}

			// Basic token payload verification
			if (!decoded.id || !decoded.organizationId) {
				throw new Error("Invalid token payload: " + JSON.stringify(decoded));
			}

			// Add decoded user info to request
			req.user = decoded;

			// Ensure organizationId is set
			req.organizationId = decoded.organizationId;

			next();
		} catch (error) {
			return res.status(403).json({
				success: false,
				message: "Invalid or expired token: " + error.message
			});
		}
	};

	/**
	 * Role-based access control middleware
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
					message: "Insufficient permissions"
				});
			}

			next();
		};
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
	 * Organization context middleware
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

	// Export the functions
	module.exports = {
		handleError,
		tokenMiddleware,
		roleMiddleware,
		requireOrganizationContext,
		isPublicRoute,
		extractToken,
		validateRequest
	};