const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const axios = require('axios');
const { Pool } = require('pg');
const session = require('express-session');
const sendgrid = require('@sendgrid/mail');

const pool = new Pool(); // Configure your pool connection
const apiKey = '71cdcaa0-c7c1-4947-90cc-a5316b0aa542'; // Your API key
let translations = {};

// Validate JWT Token
async function validateJwtToken(jwtToken) {
	try {
		const decodedToken = jwt.verify(jwtToken, process.env.JWT_SECRET); // Replace with your secret
		const userId = decodedToken.userId;
		const userRole = decodedToken.userRole;

		if (!userId || !userRole) {
			throw new Error('JWT token is missing user information');
		}

		const user = await getUserFromDatabase(userId); // Implement this to fetch the user from the DB
		if (!user || user.role !== userRole) {
			throw new Error('Invalid user or role mismatch');
		}

		return user;
	} catch (error) {
		throw new Error('Invalid JWT token');
	}
}

// Ensure Session Started
function ensureSessionStarted(req, res, next) {
	if (!req.session) {
		req.session = {};
	}
	next();
}

// Translate
function translate(key) {
	return translations[key] || key;
}

// Set Language
function setLanguage(req) {
	const lang = req.cookies.lang || 'fr';
	loadTranslations(lang);
}

// User Has Access to Participant
async function userHasAccessToParticipant(userId, participantId) {
	const client = await pool.connect();
	try {
		// Check if the user is a guardian
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
	} finally {
		client.release();
	}
}

// Calculate Age
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

// Sanitize Input
function sanitizeInput(input) {
	return input.replace(/<[^>]*>/g, '').trim();
}

// Check if User is Logged In
function isLoggedIn(req) {
	return !!req.session.user_id;
}

// Send Admin Verification Email
async function sendAdminVerificationEmail(organizationId, animatorName, animatorEmail) {
	const client = await pool.connect();
	try {
		// Fetch admin emails
		let result = await client.query(
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
		result = await client.query(
			`SELECT setting_value->>'name' AS org_name
			 FROM organization_settings
			 WHERE organization_id = $1 AND setting_key = 'organization_info'`,
			[organizationId]
		);
		const orgName = result.rows[0]?.org_name || 'Wampums.app';

		const subject = translate('new_animator_registration_subject').replace('{orgName}', orgName);
		const message = translate('new_animator_registration_body')
			.replace('{orgName}', orgName)
			.replace('{animatorName}', animatorName)
			.replace('{animatorEmail}', animatorEmail);

		for (const adminEmail of adminEmails) {
			const success = await sendEmail(adminEmail, subject, message);
			if (!success) {
				console.error(`Failed to send admin verification email to: ${adminEmail}`);
			}
		}
	} finally {
		client.release();
	}
}

// Send Email using SendGrid
async function sendEmail(to, subject, message) {
	sendgrid.setApiKey(process.env.SENDGRID_API_KEY);
	const email = {
		to,
		from: 'noreply@wampums.app',
		subject,
		text: message
	};

	try {
		const response = await sendgrid.send(email);
		return response[0].statusCode === 202;
	} catch (error) {
		console.error('Error sending email:', error);
		return false;
	}
}

// Load Translations
function loadTranslations(lang) {
	try {
		translations = require(`../lang/${lang}.json`);
	} catch (e) {
		// Fallback to French
		translations = require('../lang/fr.json');
	}
}

// Get JWT Payload
function getJWTPayload(req) {
	const authHeader = req.headers.authorization;
	if (authHeader) {
		const token = authHeader.split(' ')[1];
		try {
			const payload = jwt.decode(token);
			return payload;
		} catch (e) {
			console.error('Invalid JWT token');
		}
	}
	return null;
}

// Determine Organization ID
async function determineOrganizationId(currentHost) {
	const client = await pool.connect();
	try {
		const result = await client.query(
			`SELECT organization_id FROM organization_domains 
			 WHERE domain = $1 OR $2 LIKE REPLACE(domain, '*', '%') LIMIT 1`,
			[currentHost, currentHost]
		);
		return result.rows[0]?.organization_id;
	} finally {
		client.release();
	}
}

// Get Current Organization ID
async function getCurrentOrganizationId(req) {
	if (req.session.current_organization_id) {
		return req.session.current_organization_id;
	}

	const currentHost = req.hostname;
	const organizationId = await determineOrganizationId(currentHost);

	if (organizationId) {
		req.session.current_organization_id = organizationId;
		return organizationId;
	}

	throw new Error('No organization found for the current host');
}

// Helper: Authenticate and Get Token
async function authenticateAndGetToken(apiKey) {
	try {
		const response = await axios.post('https://wampums-api.replit.app/authenticate', { apiKey });
		if (response.data.success && response.data.token) {
			return response.data.token;
		}
		throw new Error('Failed to obtain JWT token');
	} catch (error) {
		console.error('Error fetching token:', error);
		throw error;
	}
}

// Initialize App
function initializeApp(req, res, next) {
	ensureSessionStarted(req, res, next);
	setLanguage(req);
	loadTranslations(req.cookies.lang || 'fr');
	res.set('Cache-Control', 'public, max-age=3600');
	next();
}

// To Boolean Conversion
function toBool(value) {
	if (typeof value === 'boolean') return value ? 't' : 'f';
	if (typeof value === 'string') {
		const lower = value.toLowerCase();
		return ['true', '1', 'yes', 'on'].includes(lower) ? 't' : 'f';
	}
	return Number(value) ? 't' : 'f';
}

module.exports = {
	validateJwtToken,
	ensureSessionStarted,
	translate,
	setLanguage,
	userHasAccessToParticipant,
	calculateAge,
	sanitizeInput,
	isLoggedIn,
	sendAdminVerificationEmail,
	sendEmail,
	loadTranslations,
	getJWTPayload,
	determineOrganizationId,
	getCurrentOrganizationId,
	authenticateAndGetToken,
	initializeApp,
	toBool
};
