// index.js - Main application entry point
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { determineOrganizationId } = require('./utils');
const { addOrganizationToRequest } = require('./utils/organizationContext');
const logger = require('./config/logger');
const { errorHandler } = require('./config/middleware');

// Import middleware
const { extractOrganizationFromJWT, tokenMiddleware, handleError } = require('./config/middleware');

// Import routes
const publicRoutes = require('./routes/public');
const apiRoutes = require('./routes/api');

// Initialize Express app
const app = express();
const port = process.env.PORT || 3000;

// Set trust proxy for handling reverse proxies
app.set('trust proxy', 'loopback' || 'linklocal');

// Configure middleware
app.use(bodyParser.json());
// app.use(helmet());
app.use(addOrganizationToRequest);
// CORS setup with wildcards for allowed origins
const allowedOriginPatterns = [
  /^https:\/\/.*\.worf\.replit\.dev$/,  // All worf.replit.dev subdomains
  /^https:\/\/.*\.replit\.app$/,        // All replit.app subdomains
  /^https:\/\/wampums\.app$/,           // Exact match for wampums.app
  /^https:\/\/.*\.wampums\.app$/,       // All wampums.app subdomains
  /^https:\/\/meute6a\.app$/,           // Exact match for meute6a.app
  /^http:\/\/localhost:\d+$/            // localhost with any port number
];

// Enable pre-flight for all routes with OPTIONS
const corsOptions = {
  origin: function(origin, callback) {
    if (!origin) return callback(null, true);
    const isAllowed = allowedOriginPatterns.some(pattern => pattern.test(origin));
    if (isAllowed) {
      callback(null, true);
    } else {
      const msg = 'The CORS policy for this site does not allow access from the specified Origin.';
      console.log(`CORS blocked origin: ${origin}`);
      callback(new Error(msg), false);
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Organization-ID'],
  credentials: true
};
app.use(cors());
app.use(express.static('public'));
// app.use(cors(corsOptions));
// app.options('*', cors(corsOptions));

app.use(rateLimit({ 
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // 100 requests per windowMs
}));

const db = require('./config/database');
const pool = db.pool;

// Make the pool available to route handlers
app.locals.pool = pool;

// Test database connection on startup
pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    logger.error('Error connecting to database:', err);
  } else {
    logger.info('Connected to database:', res.rows[0].now);
  }
});

// Set up shared response format
app.use((req, res, next) => {
  res.jsonResponse = (success, data = null, message = "") => {
    res.json({
      success,
      data,
      message,
    });
  };
  next();
});

// Redirect HTTP to HTTPS in production
app.use((req, res, next) => {
  if (
    req.headers['x-forwarded-proto'] !== 'https' &&
    process.env.NODE_ENV === 'production'
  ) {
    return res.redirect(`https://${req.headers.host}${req.url}`);
  }
  next();
});

// Set up organization ID middleware
app.use(async (req, res, next) => {
	try {
		const organizationId = await determineOrganizationId(req);
		if (organizationId) {
			req.organizationId = organizationId;
			logger.debug(`Organization ID set to ${organizationId}`);
		}
		next();
	} catch (error) {
		logger.error('Error determining organization:', error);
		next(); // Continue anyway, other middleware might handle this
	}
});

// Register routes
app.use('/', publicRoutes);

// Apply authentication middleware for protected routes
app.use('/api', tokenMiddleware, apiRoutes);

// Global error handling
app.use(handleError);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ 
    success: false, 
    message: 'Endpoint not found' 
  });
});

// Start the server
app.listen(port, '0.0.0.0', () => {
  console.log(`Server running on port ${port}`);
  if (logger && logger.info) {
    logger.info(`Server running on port ${port}`);
  }
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  // In production, you might want to use a process manager like PM2 to restart the app
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

module.exports = app; // Export for testing