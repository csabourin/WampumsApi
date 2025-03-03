// config/middleware.js
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { check, validationResult } = require('express-validator');
const morgan = require('morgan');
const jwt = require('jsonwebtoken');
const logger = require('./logger');

/**
 * Configure security and general purpose middleware
 * @param {express.Application} app - Express application instance
 */
const configureMiddleware = (app) => {
	// Trust proxies for secure connections behind load balancers
	app.set('trust proxy', 'loopback' || 'linklocal');

	// Basic middleware
	app.use(express.json());
	app.use(express.urlencoded({ extended: true }));

	// Security middleware
	app.use(helmet()); // Set security-related HTTP headers

	// CORS configuration
	app.use(cors({
		origin: process.env.CORS_ORIGIN || '*',
		methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
		allowedHeaders: ['Content-Type', 'Authorization']
	}));

	// Rate limiting
	const apiLimiter = rateLimit({
		windowMs: 15 * 60 * 1000, // 15 minutes
		max: process.env.RATE_LIMIT_MAX || 100, // Limit each IP to 100 requests per windowMs
		standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
		legacyHeaders: false, // Disable the `X-RateLimit-*` headers
		message: 'Too many requests, please try again later',
		skip: (req) => process.env.NODE_ENV === 'development' // Skip rate limiting in development
	});

	app.use('/api', apiLimiter); // Apply rate limiter to API routes

	// HTTP request logging
	const morganFormat = process.env.NODE_ENV === 'production' ? 'combined' : 'dev';
	app.use(morgan(morganFormat, { stream: logger.stream }));

	// HTTPS redirection in production
	if (process.env.NODE_ENV === 'production') {
		app.use((req, res, next) => {
			if (req.headers['x-forwarded-proto'] !== 'https') {
				return res.redirect(`https://${req.headers.host}${req.url}`);
			}
			next();
		});
	}
};

/**
 * Token verification middleware
 */
const tokenMiddleware = (secretKey) => {
	return async (req, res, next) => {
		// List of routes that don't require authentication
		const publicRoutes = [
			'/api/authenticate',
			'/api/login',
			'/api/register',
			'/api/verify-email',
			'/api/request-reset',
			'/api/reset-password',
			'/api/get-organization-id',
			'/api/get-organization-settings',
			'/api/get-news'
		];

		// Skip token verification for public routes
		if (publicRoutes.some(route => req.path.startsWith(route))) {
			return next();
		}

		// Check for token
		const token = req.headers.authorization?.split(' ')[1];
		if (!token) {
			return res.status(401).json({
				success: false,
				message: "Missing authentication token"
			});
		}

		try {
			// Verify token
			const decoded = jwt.verify(token, secretKey);

			// Basic token payload verification
			if (!decoded.id || !decoded.organizationId) {
				throw new Error("Invalid token payload");
			}

			// Add decoded user info to request
			req.user = decoded;
			next();
		} catch (error) {
			logger.error(`Token verification failed: ${error.message}`);
			return res.status(403).json({
				success: false,
				message: "Invalid or expired token"
			});
		}
	};
};

/**
 * Role verification middleware
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
 * Validator middleware that checks validation results
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
 * Error handling middleware
 */
const errorHandler = (err, req, res, next) => {
	// Log the error
	logger.error(err.stack);

	// Don't leak error details in production
	const message = process.env.NODE_ENV === 'production' 
		? 'An unexpected error occurred' 
		: err.message;

	res.status(err.status || 500).json({ 
		success: false, 
		error: message 
	});
};

/**
 * Not found middleware
 */
const notFoundHandler = (req, res) => {
	res.status(404).json({
		success: false,
		message: 'The requested resource was not found'
	});
};

module.exports = {
	configureMiddleware,
	tokenMiddleware,
	roleMiddleware,
	validateRequest,
	errorHandler,
	notFoundHandler
};