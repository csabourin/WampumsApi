// utils/errors.js
/**
 * Base application error class
 */
class AppError extends Error {
	constructor(message, statusCode = 500, errorCode = 'INTERNAL_ERROR') {
		super(message);
		this.name = this.constructor.name;
		this.statusCode = statusCode;
		this.errorCode = errorCode;
		Error.captureStackTrace(this, this.constructor);
	}
}

/**
 * Authentication related errors
 */
class AuthError extends AppError {
	constructor(message = 'Authentication failed', statusCode = 401, errorCode = 'AUTH_ERROR') {
		super(message, statusCode, errorCode);
	}
}

/**
 * Access/permission related errors
 */
class AccessDeniedError extends AppError {
	constructor(message = 'Access denied', statusCode = 403, errorCode = 'ACCESS_DENIED') {
		super(message, statusCode, errorCode);
	}
}

/**
 * Resource not found errors
 */
class NotFoundError extends AppError {
	constructor(resource = 'Resource', statusCode = 404, errorCode = 'NOT_FOUND') {
		super(`${resource} not found`, statusCode, errorCode);
	}
}

/**
 * Validation errors
 */
class ValidationError extends AppError {
	constructor(message = 'Validation failed', errors = [], statusCode = 400, errorCode = 'VALIDATION_ERROR') {
		super(message, statusCode, errorCode);
		this.errors = errors;
	}
}

module.exports = {
	AppError,
	AuthError,
	AccessDeniedError,
	NotFoundError,
	ValidationError
};