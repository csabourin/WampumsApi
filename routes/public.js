// routes/public.js
const express = require('express');
const { check, validationResult } = require('express-validator');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { Pool } = require('pg');
const { determineOrganizationId } = require('../utils');

const router = express.Router();

// Database Pool Setup
const pool = new Pool({
	connectionString: process.env.DB_URL,
	ssl: {
		rejectUnauthorized: false
	}
});

// Secret key for JWT
const secretKey = process.env.JWT_SECRET_KEY;

/**
 * Helper function to handle standardized JSON responses
 */
function jsonResponse(res, success, data = null, message = "") {
	res.json({
		success,
		data,
		message,
	});
}

/**
 * Test database connection
 * GET /test-connection
 */
router.get('/test-connection', async (req, res) => {
	try {
		const result = await pool.query('SELECT NOW()');
		res.json({ success: true, time: result.rows[0] });
	} catch (error) {
		res.status(500).json({ success: false, error: error.message });
	}
});

/**
 * Get the organization ID based on hostname
 * GET /get_organization_id
 */
router.get('/get_organization_id', async (req, res) => {
	const hostname = req.query.hostname || req.hostname;

	try {
		const organizationId = await determineOrganizationId(hostname);

		if (organizationId) {
			jsonResponse(res, true, { organizationId });
		} else {
			jsonResponse(res, false, null, "No organization matches this domain");
		}
	} catch (error) {
		console.error("Error fetching organization ID:", error);
		jsonResponse(res, false, null, "An error occurred while fetching the organization ID");
	}
});

/**
 * Get organization settings
 * GET /get_organization_settings
 */
router.get('/get_organization_settings', async (req, res) => {
	try {
		// Get organization ID from hostname
		const hostname = req.hostname;
		const organizationId = await determineOrganizationId(hostname);

		if (!organizationId) {
			return jsonResponse(res, false, null, "Organization not found");
		}

		const client = await pool.connect();
		try {
			const settingsResult = await client.query(
				`SELECT setting_key, setting_value 
				 FROM organization_settings 
				 WHERE organization_id = $1`,
				[organizationId]
			);

			const settings = settingsResult.rows.reduce((acc, setting) => {
				try {
					const decodedValue = JSON.parse(setting.setting_value);
					acc[setting.setting_key] = decodedValue !== null ? decodedValue : setting.setting_value;
				} catch (e) {
					acc[setting.setting_key] = setting.setting_value;
				}
				return acc;
			}, {});

			return jsonResponse(res, true, settings);
		} catch (error) {
			console.error("Error fetching organization settings:", error);
			return jsonResponse(res, false, null, "Error retrieving organization settings");
		} finally {
			client.release();
		}
	} catch (error) {
		console.error("Error in get_organization_settings:", error);
		return jsonResponse(res, false, null, "Server error");
	}
});

/**
 * Get news for the organization
 * GET /get_news
 */
router.get('/get_news', async (req, res) => {
	try {
		// Get organization ID from hostname
		const hostname = req.hostname;
		const organizationId = await determineOrganizationId(hostname);

		if (!organizationId) {
			return jsonResponse(res, false, null, "Organization not found");
		}

		const client = await pool.connect();
		try {
			const result = await client.query(
				`SELECT n.*, u.full_name as author_name
				 FROM news n
				 LEFT JOIN users u ON n.author_id = u.id
				 WHERE n.organization_id = $1
				 ORDER BY n.created_at DESC`,
				[organizationId]
			);

			return jsonResponse(res, true, { news: result.rows });
		} catch (error) {
			console.error("Error fetching news:", error);
			return jsonResponse(res, false, null, "Error retrieving news");
		} finally {
			client.release();
		}
	} catch (error) {
		console.error("Error in get_news:", error);
		return jsonResponse(res, false, null, "Server error");
	}
});

/**
 * User login
 * POST /login
 */
router.post('/login', async (req, res) => {
	try {
		const email = req.body.email ? req.body.email.toLowerCase() : "";
		const password = req.body.password || "";
		const organizationId = req.body.organization_id;

		if (!organizationId) {
			return jsonResponse(res, false, null, "Organization ID is required");
		}

		console.log(`Login attempt for email: ${email}`);

		const client = await pool.connect();
		try {
			// Fetch user from the database and verify credentials
			const result = await client.query(
				`SELECT u.id, u.email, u.password, u.is_verified, u.full_name, uo.role
				 FROM users u
				 JOIN user_organizations uo ON u.id = uo.user_id
				 WHERE u.email = $1 AND uo.organization_id = $2`,
				[email, organizationId]
			);

			const user = result.rows[0];
			if (user) {
				// Handle hash compatibility between $2y$ and $2b$
				const hashedPassword = user.password.startsWith("$2y$")
					? user.password.replace("$2y$", "$2b$")
					: user.password;

				// Verify password
				if (await bcrypt.compare(password, hashedPassword)) {
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
							organizationId: organizationId
						},
						secretKey,
						{ expiresIn: "72h" }
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
				}
			}

			return jsonResponse(res, false, null, "Invalid email or password.");
		} finally {
			client.release();
		}
	} catch (error) {
		console.error(`Login error: ${error.message}`);
		return jsonResponse(
			res,
			false,
			null,
			`An error occurred during login: ${error.message}`
		);
	}
});

/**
 * Register new user
 * POST /register
 */
router.post('/register', [
	check('email').isEmail().normalizeEmail(),
	check('password').isLength({ min: 8 }),
	check('full_name').notEmpty(),
	check('account_creation_password').notEmpty(),
	check('user_type').isIn(['parent', 'animation', 'admin']),
], async (req, res) => {
	// Validate request
	const errors = validationResult(req);
	if (!errors.isEmpty()) {
		return res.status(400).json({ success: false, errors: errors.array() });
	}

	try {
		const data = req.body;
		const token = req.headers.authorization?.split(" ")[1];

		if (!token) {
			return res.status(401).json({ 
				success: false, 
				message: "Authorization token missing" 
			});
		}

		// Verify JWT token and extract organization_id
		let organizationId;
		try {
			const decoded = jwt.verify(token, secretKey);
			organizationId = decoded.organizationId;
		} catch (err) {
			return res.status(401).json({ 
				success: false, 
				message: "Invalid or expired token" 
			});
		}

		const email = data.email.toLowerCase().trim();
		const fullName = data.full_name.trim();
		const password = data.password;
		const accountCreationPassword = data.account_creation_password;
		const userType = data.user_type;

		const client = await pool.connect();
		try {
			// Fetch the account creation password from the organization_settings table
			const accountPasswordResult = await client.query(
				`SELECT setting_value->>'account_creation_password' AS account_creation_password
				 FROM organization_settings
				 WHERE organization_id = $1 AND setting_key = 'organization_info'`,
				[organizationId]
			);

			const dbAccountCreationPassword = accountPasswordResult.rows[0]?.account_creation_password;

			if (!dbAccountCreationPassword || accountCreationPassword !== dbAccountCreationPassword) {
				return res.status(400).json({
					success: false,
					message: "Invalid account creation password"
				});
			}

			// Check if the email already exists
			const emailCheckResult = await client.query(
				`SELECT id FROM users WHERE email = $1`,
				[email]
			);

			if (emailCheckResult.rowCount > 0) {
				return res.status(400).json({ 
					success: false, 
					message: "Email already exists" 
				});
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
				// Import this function only when needed
				const { sendAdminVerificationEmail } = require('../utils');
				await sendAdminVerificationEmail(organizationId, fullName, email);
			}

			const message = isVerified
				? "Registration successful. You can now log in."
				: "Registration successful. Please wait for administrator verification.";

			return res.json({ success: true, message });
		} catch (error) {
			await client.query("ROLLBACK");
			console.error("Error in register:", error);
			return res.status(500).json({ 
				success: false, 
				message: "Error creating account" 
			});
		} finally {
			client.release();
		}
	} catch (error) {
		console.error("Error handling register route:", error);
		return res.status(500).json({ 
			success: false, 
			message: "Error creating account" 
		});
	}
});

/**
 * Initial data for frontend
 * GET /initial-data
 */
router.get('/initial-data', (req, res) => {
	const isLoggedIn = req.session?.user_id !== undefined;
	const userRole = req.session?.user_role || null;
	const lang = req.session?.lang || "fr";

	const initialData = {
		isLoggedIn,
		userRole,
		lang,
	};

	res.json(initialData);
});

/**
 * Verify email
 * POST /verify-email
 */
router.post('/verify-email', [
	check('verification_token').notEmpty()
], async (req, res) => {
	const errors = validationResult(req);
	if (!errors.isEmpty()) {
		return res.status(400).json({ success: false, errors: errors.array() });
	}

	const { verification_token } = req.body;

	if (!verification_token) {
		return jsonResponse(res, false, null, "Verification token is required");
	}

	const client = await pool.connect();
	try {
		// Verify the token
		try {
			const decoded = jwt.verify(verification_token, secretKey);

			if (!decoded.email || !decoded.userId) {
				return jsonResponse(res, false, null, "Invalid verification token");
			}

			try {
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
					secretKey,
					{ expiresIn: "1h" }
				);

				return jsonResponse(res, true, { token }, "Email verified successfully");
			} catch (error) {
				await client.query("ROLLBACK");
				throw error;
			}
		} catch (error) {
			if (error.name === "JsonWebTokenError") {
				return jsonResponse(res, false, null, "Invalid verification token");
			}
			if (error.name === "TokenExpiredError") {
				return jsonResponse(res, false, null, "Verification token has expired");
			}
			throw error;
		}
	} catch (error) {
		console.error("Error verifying email:", error);
		return jsonResponse(res, false, null, "An error occurred during verification");
	} finally {
		client.release();
	}
});

/**
 * Request password reset
 * POST /request_reset
 */
router.post('/request_reset', [
	check('email').isEmail().normalizeEmail()
], async (req, res) => {
	const errors = validationResult(req);
	if (!errors.isEmpty()) {
		return res.status(400).json({ success: false, errors: errors.array() });
	}

	const { email } = req.body;

	if (!email) {
		return jsonResponse(res, false, null, "Email is required");
	}

	const client = await pool.connect();
	try {
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
			secretKey,
			{ expiresIn: "1h" }
		);

		// Store reset token
		await client.query(
			`INSERT INTO password_reset_tokens (user_id, token, expires_at)
			 VALUES ($1, $2, NOW() + INTERVAL '1 hour')`,
			[user.id, resetToken]
		);

		// In a real application, send email with reset link here
		// For now, return token in response for testing
		return jsonResponse(
			res,
			true,
			{ reset_token: resetToken },
			"Password reset instructions have been sent."
		);
	} catch (error) {
		console.error("Password reset request error:", error);
		return jsonResponse(
			res,
			false,
			null,
			"An error occurred processing your request."
		);
	} finally {
		client.release();
	}
});

/**
 * Reset password
 * POST /reset_password
 */
router.post('/reset_password', [
	check('reset_token').notEmpty(),
	check('new_password').isLength({ min: 8 })
], async (req, res) => {
	const errors = validationResult(req);
	if (!errors.isEmpty()) {
		return res.status(400).json({ success: false, errors: errors.array() });
	}

	const { reset_token, new_password } = req.body;

	if (!reset_token || !new_password) {
		return jsonResponse(
			res,
			false,
			null,
			"Reset token and new password are required"
		);
	}

	const client = await pool.connect();
	try {
		// Verify token
		const decoded = jwt.verify(reset_token, secretKey);

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

		return jsonResponse(res, true, null, "Password has been reset successfully");
	} catch (error) {
		await client.query("ROLLBACK");
		if (
			error.name === "JsonWebTokenError" ||
			error.name === "TokenExpiredError"
		) {
			return jsonResponse(res, false, null, "Invalid or expired reset token");
		}
		console.error("Password reset error:", error);
		return jsonResponse(res, false, null, "An error occurred during password reset");
	} finally {
		client.release();
	}
});

/**
 * Authenticate with API key
 * POST /authenticate
 */
router.post('/authenticate', async (req, res) => {
	const apiKey = req.body.apiKey;

	if (!apiKey) {
		return res.status(401).json({ success: false, message: "Missing API key" });
	}

	const client = await pool.connect();
	try {
		const result = await client.query(
			`SELECT id, name FROM organizations WHERE api_key = $1`,
			[apiKey]
		);

		if (result.rows.length === 0) {
			return res.status(403).json({ success: false, message: "Invalid API key" });
		}

		const organizationId = result.rows[0].id;
		const organizationName = result.rows[0].name;

		// Include the organization name in the JWT payload
		const token = jwt.sign(
			{ organizationId, organizationName }, 
			secretKey, 
			{ expiresIn: "1h" }
		);

		res.json({ success: true, token });
	} catch (error) {
		console.error("Authentication error:", error);
		res.status(500).json({ success: false, error: error.message });
	} finally {
		client.release();
	}
});

module.exports = router;