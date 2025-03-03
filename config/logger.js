// config/logger.js
const winston = require('winston');
const path = require('path');
const fs = require('fs');

// Create logs directory if it doesn't exist
const logDir = 'logs';
if (!fs.existsSync(logDir)) {
	fs.mkdirSync(logDir);
}

// Define log format
const logFormat = winston.format.combine(
	winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
	winston.format.errors({ stack: true }),
	winston.format.splat(),
	winston.format.json()
);

// Custom format for console output
const consoleFormat = winston.format.combine(
	winston.format.colorize(),
	winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
	winston.format.printf(
		info => `${info.timestamp} ${info.level}: ${info.message}${info.stack ? '\n' + info.stack : ''}`
	)
);

// Create the logger
const logger = winston.createLogger({
	level: process.env.LOG_LEVEL || 'info',
	format: logFormat,
	defaultMeta: { service: 'api-service' },
	transports: [
		// Write all logs with level 'error' and below to error.log
		new winston.transports.File({ 
			filename: path.join(logDir, 'error.log'), 
			level: 'error',
			maxsize: 5242880, // 5MB
			maxFiles: 5,
		}),

		// Write all logs with level 'info' and below to combined.log
		new winston.transports.File({ 
			filename: path.join(logDir, 'combined.log'),
			maxsize: 5242880, // 5MB
			maxFiles: 5,
		}),

		// Console output for development
		new winston.transports.Console({
			format: consoleFormat,
			level: process.env.NODE_ENV === 'production' ? 'error' : 'debug',
		}),
	],
	// Prevent winston from exiting on uncaught exceptions
	exitOnError: false
});

// Create a stream object for Morgan integration (HTTP request logging)
logger.stream = {
	write: (message) => {
		// Remove trailing newline
		logger.info(message.trim());
	},
};

// Log unhandled exceptions and rejections
process.on('uncaughtException', (error) => {
	logger.error(`Uncaught Exception: ${error.message}`, { 
		stack: error.stack,
		timestamp: new Date().toISOString()
	});
});

process.on('unhandledRejection', (reason, promise) => {
	logger.error(`Unhandled Rejection at: ${promise}, reason: ${reason}`, { 
		stack: reason.stack,
		timestamp: new Date().toISOString()
	});
});

module.exports = logger;