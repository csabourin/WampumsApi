// services/authService.js
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { pool } = require('../config/database');
const logger = require('../config/logger');

// Secret keys from environment
const JWT_SECRET = process.env.JWT_SECRET_KEY;
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET_KEY || `${JWT_SECRET}_refresh`;

// Token expiration times
const ACCESS_TOKEN_EXPIRY = '1h';  // 1 hour
const REFRESH_TOKEN_EXPIRY = '7d'; // 7 days

/**
 * Generate authentication tokens for a user
 * @param {Object} user - User object with id, role, etc.
 * @param {number} organizationId - Organization ID
 * @returns {Object} Object containing access and refresh tokens
 */
function generateTokens(user, organizationId) {
	// Payload for access token (minimal)
	const accessPayload = {
		id: user.id,
		role: user.role,
		organizationId: organizationId,
		type: 'access'
	};

	// Payload for refresh token (more specific)
	const refreshPayload = {
		id: user.id,
		role: user.role,
		organizationId: organizationId,
		email: user.email,
		type: 'refresh',
		tokenVersion: user.token_version || 0
	};

	// Generate tokens
	const accessToken = jwt.sign(accessPayload, JWT_SECRET, { 
		expiresIn: ACCESS_TOKEN_EXPIRY 
	});

	const refreshToken = jwt.sign(refreshPayload, JWT_REFRESH_SECRET, { 
		expiresIn: REFRESH_TOKEN_EXPIRY 
	});

	return {
		accessToken,
		refreshToken
	};
}

/**
 * Authenticate a user by email and password
 * @param {string} email - User email
 * @param {string} password - User password
 * @param {number} organizationId - Organization ID
 * @returns {Promise<Object>} Authentication result with tokens and user info
 */
async function authenticateUser(email, password, organizationId) {
	const client = await pool.connect();
	try {
		// Fetch user with role for the specified organization
		const result = await client.query(
			`SELECT u.id, u.email, u.password, u.is_verified, u.full_name, 
							u.token_version, uo.role
			 FROM users u
			 JOIN user_organizations uo ON u.id = uo.user_id
			 WHERE LOWER(u.email) = LOWER($1) AND uo.organization_id = $2`,
			[email, organizationId]
		);

		const user = result.rows[0];

		// User not found
		if (!user) {
			logger.debug(`Authentication failed: User ${email} not found`);
			return {
				success: false,
				message: "Invalid email or password"
			};
		}

		// Check password
		const hashedPassword = user.password.startsWith("$2y$")
			? user.password.replace("$2y$", "$2b$")
			: user.password;

		const isPasswordValid = await bcrypt.compare(password, hashedPassword);

		if (!isPasswordValid) {
			logger.debug(`Authentication failed: Invalid password for ${email}`);
			return {
				success: false,
				message: "Invalid email or password"
			};
		}

		// Check if account is verified
		if (!user.is_verified) {
			return {
				success: false,
				message: "Your account is not verified. Please wait for admin verification."
			};
		}

		// Generate tokens
		const tokens = generateTokens(user, organizationId);

		// Fetch guardian participants (participants linked to this user's email)
		const guardianParticipantsResult = await client.query(
			`SELECT pg.id, p.id AS participant_id, p.first_name, p.last_name 
			 FROM parents_guardians pg
			 JOIN participant_guardians pgu ON pg.id = pgu.guardian_id
			 JOIN participants p ON pgu.participant_id = p.id
			 LEFT JOIN user_participants up ON up.participant_id = p.id AND up.user_id = $1
			 WHERE pg.courriel = $2 AND up.participant_id IS NULL`,
			[user.id, email]
		);

		return {
			success: true,
			user: {
				id: user.id,
				email: user.email,
				fullName: user.full_name,
				role: user.role
			},
			tokens,
			guardianParticipants: guardianParticipantsResult.rows,
			message: "Authentication successful"
		};
	} catch (error) {
		logger.error(`Authentication error: ${error.message}`);
		throw error;
	} finally {
		client.release();
	}
}

/**
 * Verify and decode an access token
 * @param {string} token - JWT access token
 * @returns {Object|null} Decoded token payload or null if invalid
 */
function verifyAccessToken(token) {
	try {
		const decoded = jwt.verify(token, JWT_SECRET);
		if (decoded.type !== 'access') {
			logger.warn('Token type mismatch: expected access token');
			return null;
		}
		return decoded;
	} catch (error) {
		logger.debug(`Token verification failed: ${error.message}`);
		return null;
	}
}

/**
 * Verify and decode a refresh token
 * @param {string} token - JWT refresh token
 * @returns {Object|null} Decoded token payload or null if invalid
 */
function verifyRefreshToken(token) {
	try {
		const decoded = jwt.verify(token, JWT_REFRESH_SECRET);
		if (decoded.type !== 'refresh') {
			logger.warn('Token type mismatch: expected refresh token');
			return null;
		}
		return decoded;
	} catch (error) {
		logger.debug(`Refresh token verification failed: ${error.message}`);
		return null;
	}
}

/**
 * Refresh an access token using a refresh token
 * @param {string} refreshToken - JWT refresh token
 * @returns {Promise<Object>} New tokens or error
 */
async function refreshAccessToken(refreshToken) {
	// Verify the refresh token
	const decoded = verifyRefreshToken(refreshToken);

	if (!decoded) {
		return { 
			success: false, 
			message: "Invalid refresh token" 
		};
	}

	const client = await pool.connect();
	try {
		// Verify the user and token version
		const result = await client.query(
			`SELECT u.id, u.email, u.full_name, u.token_version, uo.role
			 FROM users u
			 JOIN user_organizations uo ON u.id = uo.user_id
			 WHERE u.id = $1 AND uo.organization_id = $2`,
			[decoded.id, decoded.organizationId]
		);

		if (result.rows.length === 0) {
			return { 
				success: false, 
				message: "User not found" 
			};
		}

		const user = result.rows[0];

		// Validate token version to prevent use of revoked tokens
		if (user.token_version !== decoded.tokenVersion) {
			return { 
				success: false, 
				message: "Token has been revoked" 
			};
		}

		// Generate new tokens
		const tokens = generateTokens(user, decoded.organizationId);

		return {
			success: true,
			tokens,
			user: {
				id: user.id,
				email: user.email,
				fullName: user.full_name,
				role: user.role
			}
		};
	} catch (error) {
		logger.error(`Token refresh error: ${error.message}`);
		throw error;
	} finally {
		client.release();
	}
}

/**
 * Revoke all refresh tokens for a user by incrementing token version
 * @param {string} userId - User ID
 * @returns {Promise<boolean>} Success status
 */
async function revokeUserTokens(userId) {
	const client = await pool.connect();
	try {
		await client.query(
			`UPDATE users 
			 SET token_version = COALESCE(token_version, 0) + 1
			 WHERE id = $1`,
			[userId]
		);
		return true;
	} catch (error) {
		logger.error(`Token revocation error: ${error.message}`);
		return false;
	} finally {
		client.release();
	}
}

module.exports = {
	authenticateUser,
	generateTokens,
	verifyAccessToken,
	verifyRefreshToken,
	refreshAccessToken,
	revokeUserTokens
};