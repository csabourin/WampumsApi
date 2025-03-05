// index.js - Main application entry point
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { Pool } = require('pg');
const { determineOrganizationId } = require('./utils');
const logger = require('./config/logger');

// Import middleware
const { tokenMiddleware, handleError } = require('./config/middleware');

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
app.use(helmet());
app.use(cors());
app.use(extractOrganizationFromJWT);
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
    req.organizationId = organizationId;
    next();
  } catch (error) {
    logger.error('Error determining organization:', error);
    next();
  }
});

// Register routes
app.use('/', publicRoutes);

// Apply authentication middleware for protected routes
app.use('/api', tokenMiddleware);
app.use('/api', apiRoutes);

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
app.listen(port, () => {
  logger.info(`Server running on port ${port}`);
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