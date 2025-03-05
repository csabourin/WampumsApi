/*
login: Handles user login and authentication
register: User registration (commented out in the original)
verify_email: Email verification process
request_reset: Password reset request
reset_password: Password reset implementation
check_permission: Checking user permissions
approve_user: Approving new users
update_user_role: Changing a user's role
*/

// controllers/authController.js
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const { pool } = require("../config/database");
const { jsonResponse } = require("../utils/responseFormatter");
const logger = require("../config/logger");
const { sendAdminVerificationEmail } = require("../services/emailService");

/**
 * Handle user login
 */
exports.login = async (req, res) => {
	const client = await pool.connect();
	try {
		const email = req.body.email ? req.body.email.toLowerCase() : "";
		const password = req.body.password || "";
		logger.info(`Login attempt for email: ${email}`);

		// Fetch user from the database and verify credentials
		const result = await client.query(
			`SELECT u.id, u.email, u.password, u.is_verified, u.full_name, uo.role
			 FROM users u
			 JOIN user_organizations uo ON u.id = uo.user_id
			 WHERE u.email = $1 AND uo.organization_id = $2`,
			[email, req.organizationId]
		);

		const user = result.rows[0];
		if (!user) {
			return jsonResponse(res, false, null, "Invalid email or password.");
		}

		// Handle hash compatibility between $2y$ and $2b$
		const hashedPassword = user.password.startsWith("$2y$")
			? user.password.replace("$2y$", "$2b$")
			: user.password;

		// Verify password
		if (!(await bcrypt.compare(password, hashedPassword))) {
			return jsonResponse(res, false, null, "Invalid email or password.");
		}

		// Check account verification
		if (!user.is_verified) {
			return jsonResponse(
				res,
				false,
				null,
				"Your account is not yet verified. Please wait for admin verification."
			);
		}

		// Generate JWT token
		const token = jwt.sign(
			{
				id: user.id,
				role: user.role,
				organizationId: req.organizationId,
			},
			process.env.JWT_SECRET_KEY,
			{ expiresIn: "24h" }
		);

		// Fetch unlinked guardian participants
		const guardianParticipantsResult = await client.query(
			`SELECT pg.id, p.id AS participant_id, p.first_name, p.last_name 
			 FROM parents_guardians pg
			 JOIN participant_guardians pgu ON pg.id = pgu.guardian_id
			 JOIN participants p ON pgu.participant_id = p.id
			 LEFT JOIN user_participants up ON up.participant_id = p.id AND up.user_id = $1
			 WHERE pg.courriel = $2 AND up.participant_id IS NULL`,
			[user.id, email]
		);

		const response = {
			success: true,
			message: "login_successful",
			token,
			id: user.id,
			user_role: user.role,
			user_full_name: user.full_name,
			is_verified: user.is_verified,
		};

		if (guardianParticipantsResult.rows.length > 0) {
			response.guardian_participants = guardianParticipantsResult.rows;
		}

		return jsonResponse(res, true, response);
	} catch (error) {
		logger.error(`Login error: ${error.message}`);
		return jsonResponse(
			res,
			false,
			null,
			`An error occurred during login: ${error.message}`
		);
	} finally {
		client.release();
	}
};

/**
 * Register a new user
 */
exports.register = async (req, res) => {
	const client = await pool.connect();
	try {
		const data = req.body;
		const email = data.email.toLowerCase().trim();
		const fullName = data.full_name.trim();
		const password = data.password;
		const accountCreationPassword = data.account_creation_password;
		const userType = data.user_type;
		const organizationId = req.organizationId;

		// Fetch the account creation password from the organization_settings table
		const accountPasswordResult = await client.query(
			`SELECT setting_value->>'account_creation_password' AS account_creation_password
			 FROM organization_settings
			 WHERE organization_id = $1 AND setting_key = 'organization_info'`,
			[organizationId]
		);
		const dbAccountCreationPassword = accountPasswordResult.rows[0]?.account_creation_password;

		if (!dbAccountCreationPassword || accountCreationPassword !== dbAccountCreationPassword) {
			return jsonResponse(res, false, null, "Invalid account creation password");
		}

		// Check if the email already exists
		const emailCheckResult = await client.query(
			`SELECT id FROM users WHERE email = $1`,
			[email]
		);

		if (emailCheckResult.rowCount > 0) {
			return jsonResponse(res, false, null, "Email already exists");
		}

		const hashedPassword = await bcrypt.hash(password, 10);
		const isVerified = userType === "parent";

		await client.query("BEGIN");

		// Insert the new user and return the generated UUID
		const userInsertResult = await client.query(
			`INSERT INTO users (email, password, is_verified, full_name)
			 VALUES ($1, $2, $3, $4)
			 RETURNING id`,
			[email, hashedPassword, isVerified, fullName]
		);
		const userId = userInsertResult.rows[0].id;

		// Now insert into the user_organizations table
		await client.query(
			`INSERT INTO user_organizations (user_id, organization_id, role)
			 VALUES ($1, $2, $3)`,
			[userId, organizationId, userType]
		);

		await client.query("COMMIT");

		// If the user type is 'animation', send an email to the admin(s)
		if (userType === "animation") {
			await sendAdminVerificationEmail(organizationId, fullName, email);
		}

		const message = isVerified
			? "Registration successful! You can now log in."
			: "Registration successful! Please wait for admin verification.";

		return jsonResponse(res, true, null, message);
	} catch (error) {
		await client.query("ROLLBACK");
		logger.error(`Registration error: ${error.message}`);
		return jsonResponse(res, false, null, "Error creating account");
	} finally {
		client.release();
	}
};

/**
 * Verify email with token
 */
exports.verifyEmail = async (req, res) => {
	const client = await pool.connect();
	try {
		const { verification_token } = req.body;

		if (!verification_token) {
			return jsonResponse(res, false, null, "Verification token is required");
		}

		// Verify the token
		const decoded = jwt.verify(verification_token, process.env.JWT_SECRET_KEY);

		if (!decoded.email || !decoded.userId) {
			return jsonResponse(res, false, null, "Invalid verification token");
		}

		await client.query("BEGIN");

		// Check user exists and isn't verified
		const userResult = await client.query(
			"SELECT id, email, is_verified FROM users WHERE id = $1",
			[decoded.userId]
		);

		if (userResult.rows.length === 0) {
			await client.query("ROLLBACK");
			return jsonResponse(res, false, null, "User not found");
		}

		const user = userResult.rows[0];

		if (user.is_verified) {
			await client.query("ROLLBACK");
			return jsonResponse(res, false, null, "Email already verified");
		}

		if (user.email !== decoded.email) {
			await client.query("ROLLBACK");
			return jsonResponse(res, false, null, "Invalid verification token");
		}

		// Update verification status
		await client.query(
			"UPDATE users SET is_verified = true, verified_at = CURRENT_TIMESTAMP WHERE id = $1",
			[decoded.userId]
		);

		// Log verification
		await client.query(
			`INSERT INTO audit_logs (user_id, action, details) 
			 VALUES ($1, 'email_verification', $2)`,
			[
				decoded.userId,
				JSON.stringify({
					email: decoded.email,
					verified_at: new Date(),
				}),
			]
		);

		await client.query("COMMIT");

		// Generate new JWT token
		const token = jwt.sign(
			{
				id: decoded.userId,
				email: decoded.email,
				verified: true,
			},
			process.env.JWT_SECRET_KEY,
			{ expiresIn: "1h" }
		);

		return jsonResponse(res, true, { token }, "Email verified successfully");
	} catch (error) {
		await client.query("ROLLBACK");

		if (error.name === "JsonWebTokenError") {
			return jsonResponse(res, false, null, "Invalid verification token");
		}

		if (error.name === "TokenExpiredError") {
			return jsonResponse(res, false, null, "Verification token has expired");
		}

		logger.error(`Email verification error: ${error.message}`);
		return jsonResponse(res, false, null, "Error during email verification");
	} finally {
		client.release();
	}
};

/**
 * Request password reset
 */
exports.requestReset = async (req, res) => {
	const client = await pool.connect();
	try {
		const { email } = req.body;

		if (!email) {
			return jsonResponse(res, false, null, "Email is required");
		}

		const userResult = await client.query(
			"SELECT id, email FROM users WHERE email = $1",
			[email.toLowerCase()]
		);

		if (userResult.rows.length === 0) {
			// For security, don't reveal if email exists
			return jsonResponse(
				res,
				true,
				null,
				"If an account exists with this email, a reset link will be sent."
			);
		}

		const user = userResult.rows[0];

		// Generate reset token
		const resetToken = jwt.sign(
			{
				userId: user.id,
				email: user.email,
				purpose: "password_reset",
			},
			process.env.JWT_SECRET_KEY,
			{ expiresIn: "1h" }
		);

		// Store reset token
		await client.query(
			`INSERT INTO password_reset_tokens (user_id, token, expires_at)
			 VALUES ($1, $2, NOW() + INTERVAL '1 hour')`,
			[user.id, resetToken]
		);

		// In a real application, send email with reset link here
		// For now, return token in response
		return jsonResponse(
			res,
			true,
			{ reset_token: resetToken },
			"Password reset instructions have been sent."
		);
	} catch (error) {
		logger.error(`Password reset request error: ${error.message}`);
		return jsonResponse(
			res,
			false,
			null,
			"An error occurred processing your request."
		);
	} finally {
		client.release();
	}
};

/**
 * Reset password with token
 */
exports.resetPassword = async (req, res) => {
	const client = await pool.connect();
	try {
		const { reset_token, new_password } = req.body;

		if (!reset_token || !new_password) {
			return jsonResponse(
				res,
				false,
				null,
				"Reset token and new password are required"
			);
		}

		// Verify token
		const decoded = jwt.verify(reset_token, process.env.JWT_SECRET_KEY);

		if (!decoded.userId || decoded.purpose !== "password_reset") {
			return jsonResponse(res, false, null, "Invalid reset token");
		}

		await client.query("BEGIN");

		// Check if token is valid and not used
		const tokenResult = await client.query(
			`SELECT * FROM password_reset_tokens 
			 WHERE token = $1 AND used = false AND expires_at > NOW()`,
			[reset_token]
		);

		if (tokenResult.rows.length === 0) {
			await client.query("ROLLBACK");
			return jsonResponse(res, false, null, "Invalid or expired reset token");
		}

		// Hash new password
		const hashedPassword = await bcrypt.hash(new_password, 10);

		// Update password
		await client.query("UPDATE users SET password = $1 WHERE id = $2", [
			hashedPassword,
			decoded.userId,
		]);

		// Mark token as used
		await client.query(
			"UPDATE password_reset_tokens SET used = true WHERE token = $1",
			[reset_token]
		);

		// Log password reset
		await client.query(
			`INSERT INTO audit_logs (user_id, action, details)
			 VALUES ($1, 'password_reset', $2)`,
			[
				decoded.userId,
				JSON.stringify({
					reset_at: new Date(),
				}),
			]
		);

		await client.query("COMMIT");

		return jsonResponse(
			res,
			true,
			null,
			"Password has been reset successfully"
		);
	} catch (error) {
		await client.query("ROLLBACK");

		if (error.name === "JsonWebTokenError" || error.name === "TokenExpiredError") {
			return jsonResponse(res, false, null, "Invalid or expired reset token");
		}

		logger.error(`Password reset error: ${error.message}`);
		return jsonResponse(res, false, null, "Error resetting password");
	} finally {
		client.release();
	}
};

/**
 * Check user permission for an operation
 */
exports.checkPermission = async (req, res) => {
	const client = await pool.connect();
	try {
		const { operation } = req.body;
		const token = req.headers.authorization?.split(" ")[1];

		if (!token || !operation) {
			return jsonResponse(res, true, { hasPermission: false });
		}

		try {
			const decoded = jwt.verify(token, process.env.JWT_SECRET_KEY);
			const userId = decoded.id;

			const result = await client.query(
				`SELECT u.role, p.allowed 
				 FROM users u 
				 LEFT JOIN permissions p ON u.role = p.role 
				 WHERE u.id = $1 AND p.operation = $2`,
				[userId, operation]
			);

			return jsonResponse(res, true, {
				hasPermission: Boolean(result.rows[0]?.allowed),
			});
		} catch (error) {
			return jsonResponse(res, true, { hasPermission: false });
		}
	} finally {
		client.release();
	}
};

/**
 * Approve a user (admin function)
 */
exports.approveUser = async (req, res) => {
	const client = await pool.connect();
	try {
		const { user_id } = req.body;
		const organizationId = getOrganizationId(req);

		const result = await client.query(
			`UPDATE users 
			 SET is_verified = TRUE 
			 WHERE id = $1 
			 AND EXISTS (
				 SELECT 1 
				 FROM user_organizations 
				 WHERE user_id = $1 AND organization_id = $2
			 )
			 RETURNING id`,
			[user_id, organizationId]
		);

		if (result.rowCount === 0) {
			return jsonResponse(res, false, null, "Failed to approve user");
		}

		return jsonResponse(res, true, null, "User approved successfully");
	} catch (error) {
		logger.error(`Error approving user: ${error.message}`);
		return jsonResponse(res, false, null, "Error approving user");
	} finally {
		client.release();
	}
};

/**
 * Update a user's role
 */
exports.updateUserRole = async (req, res) => {
	const client = await pool.connect();
	try {
		const { user_id, new_role } = req.body;
		const organizationId = getOrganizationId(req);

		const result = await client.query(
			`UPDATE user_organizations 
			 SET role = $1 
			 WHERE user_id = $2 AND organization_id = $3
			 RETURNING id`,
			[new_role, user_id, organizationId]
		);

		if (result.rowCount === 0) {
			return jsonResponse(res, false, null, "Failed to update user role");
		}

		return jsonResponse(res, true, null, "User role updated successfully");
	} catch (error) {
		logger.error(`Error updating user role: ${error.message}`);
		return jsonResponse(res, false, null, "Error updating user role");
	} finally {
		client.release();
	}
};

/**
 * Get all users for an organization
 */
exports.getUsers = async (req, res) => {
	const client = await pool.connect();
	try {
		const organizationId = getOrganizationId(req);

		const result = await client.query(
			`SELECT u.id, u.email, u.is_verified, uo.role, u.full_name, u.created_at
			 FROM users u
			 JOIN user_organizations uo ON u.id = uo.user_id
			 WHERE uo.organization_id = $1
			 ORDER BY uo.role DESC`,
			[organizationId]
		);

		return jsonResponse(res, true, result.rows);
	} catch (error) {
		logger.error(`Error fetching users: ${error.message}`);
		return jsonResponse(res, false, null, "Error fetching users");
	} finally {
		client.release();
	}
};

/**
 * Log the user out (clear session)
 */
exports.logout = async (req, res) => {
	try {
		// In a token-based authentication system, we don't need to do anything server-side
		// The client should discard the token
		return jsonResponse(res, true, null, "Logged out successfully");
	} catch (error) {
		logger.error(`Logout error: ${error.message}`);
		return jsonResponse(res, false, null, "Error during logout");
	}
};

module.exports = exports;