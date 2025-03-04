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
 * Error handling middleware
 */
const handleError = (err, req, res, next) => {
	logger.error(err.stack);
	res.status(500).json({ 
		success: false, 
		error: process.env.NODE_ENV === 'production' 
			? 'An internal server error occurred' 
			: err.message 
	});
};

/**
 * Token verification middleware
 */
const tokenMiddleware = async (req, res, next) => {
	// List of routes that don't require authentication
	const publicRoutes = [
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

	// Skip token verification for public routes
	const path = req.path.endsWith('/') ? req.path.slice(0, -1) : req.path;
	if (publicRoutes.includes(path)) {
		return next();
	}

	// Check for token
	const token = req.headers.authorization?.split(" ")[1];
	if (!token) {
		return res.status(401).json({
			success: false,
			message: "Missing token"
		});
	}

	try {
		// Verify token
		const decoded = jwt.verify(token, secretKey);

		// Basic token payload verification
		if (!decoded.id && !decoded.organizationId) {
			throw new Error("Invalid token payload: " + JSON.stringify(decoded));
		}

		// Add decoded user info to request
		req.user = decoded;

		next();
	} catch (error) {
		return res.status(403).json({
			success: false,
			message: "Invalid or expired token: " + error.message
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
				message: "Insufficient permissions"
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

module.exports = {
	handleError,
	tokenMiddleware,
	roleMiddleware,
	validateRequest
};