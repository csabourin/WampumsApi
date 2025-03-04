// config/logger.js
const winston = require('winston');

// Determine the environment
const environment = process.env.NODE_ENV || 'development';

// Configure the logger
const logger = winston.createLogger({
	level: environment === 'production' ? 'info' : 'debug',
	format: winston.format.combine(
		winston.format.timestamp({
			format: 'YYYY-MM-DD HH:mm:ss'
		}),
		winston.format.errors({ stack: true }),
		winston.format.splat(),
		winston.format.json()
	),
	defaultMeta: { service: 'wampums-api' },
	transports: [
		// Write all logs with level 'error' and below to error.log
		new winston.transports.File({ 
			filename: 'logs/error.log', 
			level: 'error',
			maxsize: 5242880, // 5MB
			maxFiles: 5,
		}),
		// Write all logs with level 'info' and below to combined.log
		new winston.transports.File({ 
			filename: 'logs/combined.log',
			maxsize: 5242880, // 5MB
			maxFiles: 5, 
		})
	]
});

// If we're not in production, log to the console as well
if (environment !== 'production') {
	logger.add(new winston.transports.Console({
		format: winston.format.combine(
			winston.format.colorize(),
			winston.format.simple()
		)
	}));
}

// Add a simple wrapper for common logging patterns
logger.logRequest = (req, status) => {
	const { method, originalUrl, ip } = req;
	logger.info(`${method} ${originalUrl} from ${ip} - ${status}`);
};

module.exports = logger;