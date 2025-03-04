const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { Pool } = require('pg');
const sendgrid = require('@sendgrid/mail');
const winston = require('winston');
const { jsonResponse } = require('./utils/responseFormatter');

// Load environment variables
const DB_URL = process.env.DB_URL;
const JWT_SECRET = process.env.JWT_SECRET_KEY;
const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
const NODE_ENV = process.env.NODE_ENV || 'development';

// Initialize logger
const logger = winston.createLogger({
	level: NODE_ENV === 'production' ? 'info' : 'debug',
	format: winston.format.combine(
		winston.format.timestamp(),
		winston.format.json()
	),
	transports: [
		new winston.transports.File({ filename: 'error.log', level: 'error' }),
		new winston.transports.File({ filename: 'combined.log' })
	]
});

// Add console transport in non-production environments
if (NODE_ENV !== 'production') {
	logger.add(new winston.transports.Console({
		format: winston.format.combine(
			winston.format.colorize(),
			winston.format.simple()
		)
	}))
}

// Validate critical environment variables
if (!DB_URL) {
	console.error('Missing required environment variable: DB_URL');
}

if (!JWT_SECRET) {
	console.error('Missing required environment variable: JWT_SECRET_KEY');
}

// Configure database pool with proper error handling
const pool = new Pool({
	connectionString: DB_URL,
	ssl: NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Handle pool errors
pool.on('error', (err) => {
	console.error('Unexpected error on idle client', err);
	process.exit(-1);
});

// Set up translations (empty object by default, can be filled later)
let translations = {};

/**
 * Validate JWT Token
 * @param {string} jwtToken - The JWT token to validate
 * @returns {Promise<Object>} - The decoded user information
 */
async function validateJwtToken(jwtToken) {
	try {
		if (!jwtToken) {
			throw new Error('No JWT token provided');
		}

		const decodedToken = jwt.verify(jwtToken, JWT_SECRET);

		if (!decodedToken.id) {
			throw new Error('JWT token is missing user information');
		}

		return decodedToken;
	} catch (error) {
		throw new Error(`Invalid JWT token: ${error.message}`);
	}
}

/**
 * Translates a key to the current language
 * @param {string} key - The translation key
 * @returns {string} - The translated text or the key itself if not found
 */
function translate(key) {
	return translations[key] || key;
}

/**
 * Sets the current language for translations
 * @param {string} lang - The language code (e.g., 'fr', 'en')
 */
function setLanguage(lang = 'fr') {
	loadTranslations(lang);
}

/**
 * Checks if user has access to a participant
 * @param {string} userId - The user ID
 * @param {string} participantId - The participant ID
 * @returns {Promise<boolean>} - Whether the user has access
 */
async function userHasAccessToParticipant(userId, participantId) {
	const client = await pool.connect();
	try {
		// Check if the user is directly linked to the participant
		let result = await client.query(
			`SELECT 1 FROM user_participants WHERE user_id = $1 AND participant_id = $2`,
			[userId, participantId]
		);

		if (result.rowCount > 0) {
			return true;
		}

		// Check if the user has animation or admin role in the same organization
		result = await client.query(
			`SELECT 1 FROM user_organizations uo
			 JOIN participant_organizations po ON uo.organization_id = po.organization_id
			 WHERE uo.user_id = $1 AND po.participant_id = $2 AND uo.role IN ('animation', 'admin')`,
			[userId, participantId]
		);

		return result.rowCount > 0;
	} catch (error) {
		console.error('Error checking participant access:', error);
		return false;
	} finally {
		client.release();
	}
}

/**
 * Calculates age from date of birth
 * @param {string|Date} dateOfBirth - The date of birth
 * @returns {number} - The age in years
 */
function calculateAge(dateOfBirth) {
	const dob = new Date(dateOfBirth);
	const today = new Date();
	let age = today.getFullYear() - dob.getFullYear();
	const monthDiff = today.getMonth() - dob.getMonth();

	if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
		age--;
	}
	return age;
}

/**
 * Sanitize user input to prevent injection attacks
 * @param {string} input - The input to sanitize
 * @returns {string} - The sanitized input
 */
function sanitizeInput(input) {
	if (typeof input !== 'string') return input;
	return input
		.replace(/<[^>]*>/g, '')
		.trim();
}

/**
 * Send verification email to admin(s) when a new animator registers
 * @param {number} organizationId - The organization ID
 * @param {string} animatorName - The animator's name
 * @param {string} animatorEmail - The animator's email
 * @returns {Promise<void>}
 */
async function sendAdminVerificationEmail(organizationId, animatorName, animatorEmail) {
	const client = await pool.connect();
	try {
		// Fetch admin emails
		const result = await client.query(
			`SELECT u.email FROM users u
			 JOIN user_organizations uo ON u.id = uo.user_id
			 WHERE uo.organization_id = $1 AND uo.role = 'admin'`,
			[organizationId]
		);
		const adminEmails = result.rows.map(row => row.email);

		if (adminEmails.length === 0) {
			console.error(`No admin emails found for organization ID: ${organizationId}`);
			return;
		}

		// Fetch organization name
		const orgResult = await client.query(
			`SELECT setting_value->>'name' AS org_name
			 FROM organization_settings
			 WHERE organization_id = $1 AND setting_key = 'organization_info'`,
			[organizationId]
		);
		const orgName = orgResult.rows[0]?.org_name || 'Wampums.app';

		const subject = `New animator registration for ${orgName}`;
		const message = `A new animator has registered for ${orgName}.\n\nName: ${animatorName}\nEmail: ${animatorEmail}\n\nPlease log in to approve or reject this registration.`;

		// Send email to all admins
		if (SENDGRID_API_KEY) {
			sendgrid.setApiKey(SENDGRID_API_KEY);
			for (const adminEmail of adminEmails) {
				try {
					await sendgrid.send({
						to: adminEmail,
						from: 'noreply@wampums.app',
						subject,
						text: message
					});
					console.log(`Admin verification email sent to ${adminEmail}`);
				} catch (error) {
					console.error(`Failed to send email to ${adminEmail}:`, error);
				}
			}
		} else {
			console.log('SendGrid API key not set, skipping email sending');
			console.log(`Would send to: ${adminEmails.join(', ')}`);
			console.log(`Subject: ${subject}`);
			console.log(`Message: ${message}`);
		}
	} catch (error) {
		console.error('Error sending admin verification email:', error);
	} finally {
		client.release();
	}
}

/**
 * Load translations for a given language
 * @param {string} lang - The language code
 */
function loadTranslations(lang) {
	try {
		translations = require(`../lang/${lang}.json`);
	} catch (e) {
		console.warn(`Could not load translations for language ${lang}, falling back to default`);
		try {
			translations = require('../lang/fr.json');
		} catch (e) {
			console.error('Could not load default translations');
			translations = {};
		}
	}
}

/**
 * Determine the organization ID based on the hostname
 * @param {string} currentHost - The current hostname
 * @returns {Promise<number|null>} - The organization ID or null if not found
 */
async function determineOrganizationId(currentHost) {
	if (!currentHost) {
		console.error('No hostname provided to determineOrganizationId');
		return null;
	}

	const client = await pool.connect();
	try {
		const result = await client.query(
			`SELECT organization_id FROM organization_domains 
			 WHERE domain = $1 OR $2 LIKE REPLACE(domain, '*', '%') 
			 LIMIT 1`,
			[currentHost, currentHost]
		);

		return result.rows[0]?.organization_id || null;
	} catch (error) {
		console.error('Error determining organization ID:', error);
		return null;
	} finally {
		client.release();
	}
}

/**
 * Convert value to boolean format for database
 * @param {any} value - The value to convert
 * @returns {string} - 't' for true, 'f' for false
 */
function toBool(value) {
	if (typeof value === 'boolean') return value ? 't' : 'f';
	if (typeof value === 'string') {
		const lower = value.toLowerCase();
		return ['true', '1', 'yes', 'on'].includes(lower) ? 't' : 'f';
	}
	return Number(value) ? 't' : 'f';
}

exports.determineOrganizationId  = async (req, res) => {

		try {
			// Extract hostname from request
			const hostname = req.query.hostname || req.hostname;

			const client = await pool.connect();
			try {
				// Query the database for the organization ID based on hostname
				const result = await client.query(
					`SELECT organization_id FROM organization_domains 
					 WHERE domain = $1 OR $2 LIKE REPLACE(domain, '*', '%') 
					 LIMIT 1`,
					[hostname, hostname]
				);

				if (result.rows.length > 0) {
					const organizationId = result.rows[0].organization_id;
					return jsonResponse(res, true, { organizationId });
				} else {
					return jsonResponse(res, false, null, "No organization matches this domain");
				}
			} finally {
				client.release();
			}
		} catch (error) {
			logger.error(`Error fetching organization ID: ${error.message}`);
			return jsonResponse(res, false, null, "Error determining organization ID");
		}
	};
