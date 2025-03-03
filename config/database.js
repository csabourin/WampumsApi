// config/database.js
const { Pool } = require('pg');
const logger = require('./logger');

// Load environment variables if not already loaded
if (!process.env.DB_URL) {
	require('dotenv').config();
}

/**
 * Database connection pool configuration
 * Uses connection string from environment variables with fallback for local development
 */
const pool = new Pool({
	connectionString: process.env.DB_URL,
	ssl: process.env.NODE_ENV === 'production' 
		? { rejectUnauthorized: false } // For production environments
		: false, // For development environment
	max: 20, // Maximum number of clients in the pool
	idleTimeoutMillis: 30000, // How long a client is allowed to remain idle before being closed
	connectionTimeoutMillis: 2000, // How long to wait for a connection to become available
});

// Listen for pool errors
pool.on('error', (err, client) => {
	logger.error(`Unexpected error on idle client: ${err.message}`);
	process.exit(-1); // Exit on severe database connection issues
});

// Test connection on initialization
(async () => {
	try {
		const client = await pool.connect();
		logger.info('Database connection established successfully');
		client.release();
	} catch (err) {
		logger.error(`Failed to connect to database: ${err.message}`);
	}
})();

/**
 * Get database connection from pool
 * @returns {Promise<PoolClient>} Database client connection
 */
const getClient = async () => {
	try {
		return await pool.connect();
	} catch (error) {
		logger.error(`Error getting database client: ${error.message}`);
		throw error;
	}
};

/**
 * Execute a database query with a managed connection
 * @param {string} text - SQL query text
 * @param {Array} params - Query parameters
 * @returns {Promise<QueryResult>} Query result
 */
const query = async (text, params) => {
	const client = await pool.connect();
	try {
		return await client.query(text, params);
	} finally {
		client.release();
	}
};

/**
 * Execute a transaction with multiple queries
 * @param {Function} callback - Callback function that receives a client and executes queries
 * @returns {Promise<any>} Result from the callback function
 */
const transaction = async (callback) => {
	const client = await pool.connect();
	try {
		await client.query('BEGIN');
		const result = await callback(client);
		await client.query('COMMIT');
		return result;
	} catch (error) {
		await client.query('ROLLBACK');
		throw error;
	} finally {
		client.release();
	}
};

module.exports = {
	pool,
	getClient,
	query,
	transaction
};