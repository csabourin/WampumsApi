require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");
const helmet = require("helmet");
const bcrypt = require("bcrypt");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const { check, validationResult } = require("express-validator");
const winston = require("winston");
const { sendAdminVerificationEmail, determineOrganizationId } = require("./utils");

const app = express();
app.set("trust proxy", "loopback" || "linklocal");
const port = process.env.PORT || 3000;
const secretKey = process.env.JWT_SECRET_KEY;

app.use(bodyParser.json());
app.use(helmet());
app.use(cors());
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }));

// Database Pool Setup Using Pooling URL
const pool = new Pool({
	connectionString: process.env.DB_URL,
	ssl: {
		rejectUnauthorized: false, // Necessary for secure connections
	},
});

const logger = winston.createLogger({
	level: "info",
	format: winston.format.json(),
	transports: [
		new winston.transports.File({ filename: "error.log", level: "error" }),
		new winston.transports.File({ filename: "combined.log" }),
	],
});

// Function to handle responses
function jsonResponse(res, success, data = null, message = "") {
	res.json({
		success,
		data,
		message,
	});
}

// Error handling middleware
function handleError(err, req, res, next) {
	logger.error(err.stack);
	res.status(500).json({ success: false, error: err.message });
}

// Token verification middleware
const tokenMiddleware = async (req, res, next) => {
	// List of routes that don't require authentication
	const publicRoutes = [
		"/authenticate",
		"/login",
		"/register",
		"/verify-email",
		"/request_reset",
		"/reset_password",
		"/get_organization_id",
		"/get_organization_settings",
		"/get_news",
	];

	// Skip token verification for public routes
	if (publicRoutes.includes(req.path)) {
		return next();
	}

	// Check for token
	const token = req.headers.authorization?.split(" ")[1];
	if (!token) {
		return res.status(401).json({
			success: false,
			message: "Missing token",
		});
	}

	try {
		// Verify token
		const decoded = jwt.verify(token, secretKey);

		// Basic token payload verification
		if (!decoded.id || !decoded.organizationId) {
			throw new Error("Invalid token payload: " + JSON.stringify(decoded));
		}

		// Add decoded user info to request
		req.user = decoded;

		// Optional: Add rate limiting per token
		// await enforceTokenRateLimit(decoded.id);

		next();
	} catch (error) {
		return res.status(403).json({
			success: false,
			message: "Invalid or expired token: " + error.message,
		});
	}
};

// Separate middleware for role verification
const roleMiddleware = (allowedRoles) => {
	return (req, res, next) => {
		if (!req.user || !req.user.role) {
			return res.status(403).json({
				success: false,
				message: "No role information found",
			});
		}

		if (!allowedRoles.includes(req.user.role)) {
			return res.status(403).json({
				success: false,
				message: "Insufficient permissions",
			});
		}

		next();
	};
};

app.get("/test-connection", async (req, res) => {
	try {
		const result = await pool.query("SELECT NOW()");
		res.json({ success: true, time: result.rows[0] });
	} catch (error) {
		res.status(500).json({ success: false, error: error.message });
	}
});

// Apply the tokenMiddleware
app.use(tokenMiddleware);

app.use((req, res, next) => {
	if (
		req.headers["x-forwarded-proto"] !== "https" &&
		process.env.NODE_ENV === "production"
	) {
		return res.redirect(`https://${req.headers.host}${req.url}`);
	}
	next();
});

// Authentication route (public)
app.post("/authenticate", async (req, res) => {
	const apiKey = req.body.apiKey;

	if (!apiKey) {
		return res.status(401).json({ success: false, message: "Missing API key" });
	}

	try {
		const client = await pool.connect();
		const result = await client.query(
			`SELECT id, name FROM organizations WHERE api_key = $1`,
			[apiKey],
		);
		client.release();

		if (result.rows.length === 0) {
			return res
				.status(403)
				.json({ success: false, message: "Invalid API key" });
		}

		const organizationId = result.rows[0].id;
		const organizationName = result.rows[0].name;

		// Include the organization name in the JWT payload
		const token = jwt.sign({ organizationId, organizationName }, secretKey, {
			expiresIn: "1h",
		});

		res.json({ success: true, token });
	} catch (error) {
		res.status(500).json({ success: false, error: error.message });
	}
});

app.use((err, req, res, next) => {
	handleError(err, req, res, next);
});

app.get("/initial-data", (req, res) => {
	const isLoggedIn = req.session.user_id !== undefined;
	const userRole = req.session.user_role || null;
	const lang = req.session.lang || "fr";

	const initialData = {
		isLoggedIn,
		userRole,
		lang,
	};

	res.json(initialData);
});

function verifyJWT(token) {
	try {
		return jwt.verify(token, secretKey);
	} catch (e) {
		return null;
	}
}

function comparePasswords(plainPassword, hashedPassword, callback) {
	// Modify the hash if it starts with $2y$
	const modifiedHashedPassword = hashedPassword.startsWith("$2y$")
		? hashedPassword.replace("$2y$", "$2b$")
		: hashedPassword;

	// Compare the password using bcrypt
	bcrypt.compare(plainPassword, modifiedHashedPassword, callback);
}

function getCurrentOrganizationId(req) {
	// Check if the organizationId is set in the request object from the middleware
	if (req && req.organizationId) {
		return req.organizationId;
	}
	throw new Error("Organization ID not found in the request");
}

app.post(
	"/api",
	[check("action").isString().notEmpty()],
	async (req, res, next) => {
		const errors = validationResult(req);
		if (!errors.isEmpty()) {
			return res.status(400).json({ success: false, errors: errors.array() });
		}

		const action = req.body.action;
		const token = req.headers.authorization?.split(" ")[1];
		const decodedToken = verifyJWT(token);
		const userId = decodedToken?.id;
		console.log(decodedToken);

		// Skip token verification for public routes
		const publicRoutes = [
			"login",
			"verify_email",
			"request_reset",
			"reset_password",
			"get_organization_id",
		];
		if (!publicRoutes.includes(action) && !userId) {
			console.log(action, userId);
			return jsonResponse(res, false, null, "Invalid or expired token");
		}

		const client = await pool.connect();

		try {
			switch (action) {
				case "login": {
					const email = req.body.email ? req.body.email.toLowerCase() : "";
					const password = req.body.password || "";
					console.log(`Login attempt for email: ${email}`);

					try {
						// Fetch user from the database and verify credentials
						const result = await client.query(
							`SELECT u.id, u.email, u.password, u.is_verified, u.full_name, uo.role
																	FROM users u
																	JOIN user_organizations uo ON u.id = uo.user_id
																	WHERE u.email = $1 AND uo.organization_id = $2`,
							[email, req.organizationId],
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
										"Your account is not yet verified. Please wait for admin verification.",
									);
								}

								// Generate JWT token
								const token = jwt.sign(
									{
										id: user.id,
										role: user.role,
										organizationId: req.organizationId,
									},
									secretKey,
									{ expiresIn: "24h" },
								);

								// Fetch unlinked guardian participants
								const guardianParticipantsResult = await client.query(
									`SELECT pg.id, p.id AS participant_id, p.first_name, p.last_name 
																					FROM parents_guardians pg
																					JOIN participant_guardians pgu ON pg.id = pgu.guardian_id
																					JOIN participants p ON pgu.participant_id = p.id
																					LEFT JOIN user_participants up ON up.participant_id = p.id AND up.user_id = $1
																					WHERE pg.courriel = $2 AND up.participant_id IS NULL`,
									[user.id, email],
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
									response.guardian_participants =
										guardianParticipantsResult.rows;
								}

								return jsonResponse(res, true, response);
							}
						}

						return jsonResponse(res, false, null, "Invalid email or password.");
					} catch (error) {
						console.error(`Login error: ${error.message}`);
						return jsonResponse(
							res,
							false,
							null,
							`An error occurred during login: ${error.message}`,
						);
					}
				}

				// case "register": {
				// 	try {
				// 		const data = req.body;
				// 		const email = data.email.toLowerCase().trim(); // Assuming sanitizeInput trims and sanitizes
				// 		const fullName = data.full_name.trim();
				// 		const password = data.password;
				// 		const accountCreationPassword = data.account_creation_password;
				// 		const userType = data.user_type;
				// 		const organizationId = getCurrentOrganizationId(req); // Assuming you have a function to get this

				// 		// Fetch the account creation password from the organization_settings table
				// 		const accountPasswordResult = await pool.query(
				// 			`SELECT setting_value->>'account_creation_password' AS account_creation_password
				// 				 FROM organization_settings
				// 				 WHERE organization_id = $1 AND setting_key = 'organization_info'`,
				// 			[organizationId],
				// 		);
				// 		const dbAccountCreationPassword =
				// 			accountPasswordResult.rows[0]?.account_creation_password;

				// 		if (
				// 			!dbAccountCreationPassword ||
				// 			accountCreationPassword !== dbAccountCreationPassword
				// 		) {
				// 			return res.status(400).json({
				// 				success: false,
				// 				message: translate("invalid_account_creation_password"),
				// 			});
				// 		}

				// 		// Check if the email already exists
				// 		const emailCheckResult = await pool.query(
				// 			`SELECT id FROM users WHERE email = $1`,
				// 			[email],
				// 		);
				// 		if (emailCheckResult.rowCount > 0) {
				// 			return res.status(400).json({
				// 				success: false,
				// 				message: translate("email_already_exists"),
				// 			});
				// 		}

				// 		const hashedPassword = await bcrypt.hash(password, 10); // Using bcrypt for hashing
				// 		const isVerified = userType === "parent";

				// 		// Start transaction
				// 		const client = await pool.connect();
				// 		try {
				// 			await client.query("BEGIN");

				// 			// Insert the new user and return the generated UUID
				// 			const userInsertResult = await client.query(
				// 				`INSERT INTO users (email, password, is_verified, full_name)
				// 					 VALUES ($1, $2, $3, $4)
				// 					 RETURNING id`,
				// 				[email, hashedPassword, isVerified, fullName],
				// 			);
				// 			const userId = userInsertResult.rows[0].id;

				// 			// Now insert into the user_organizations table
				// 			await client.query(
				// 				`INSERT INTO user_organizations (user_id, organization_id, role)
				// 					 VALUES ($1, $2, $3)`,
				// 				[userId, organizationId, userType],
				// 			);

				// 			await client.query("COMMIT");

				// 			// If the user type is 'animation', send an email to the admin(s)
				// 			if (userType === "animation") {
				// 				await sendAdminVerificationEmail(
				// 					organizationId,
				// 					fullName,
				// 					email,
				// 				); // Ensure this function is asynchronous
				// 			}

				// 			const message = isVerified
				// 				? translate("registration_successful_parent")
				// 				: translate("registration_successful_await_verification");
				// 			return res.json({ success: true, message });
				// 		} catch (error) {
				// 			await client.query("ROLLBACK");
				// 			console.error("Error in register:", error);
				// 			return res.status(500).json({
				// 				success: false,
				// 				message: translate("error_creating_account"),
				// 			});
				// 		} finally {
				// 			client.release();
				// 		}
				// 	} catch (error) {
				// 		console.error("Error handling register action:", error);
				// 		return res.status(500).json({
				// 			success: false,
				// 			message: translate("error_creating_account"),
				// 		});
				// 	}
				// }

				case "update_calendar_paid": {
					const { participant_id, paid_status } = req.body;
					await client.query(
						`UPDATE calendars
									 SET paid = $1, updated_at = CURRENT_TIMESTAMP
									 WHERE participant_id = $2`,
						[paid_status, participant_id],
					);
					jsonResponse(
						res,
						true,
						null,
						"Calendar paid status updated successfully",
					);
					break;
				}

				case "save_badge_progress": {
					const {
						participant_id,
						territoire_chasse,
						objectif,
						description,
						fierte,
						raison,
						date_obtention,
					} = req.body;
					const organizationId = getCurrentOrganizationId(req);

					// Get current max stars
					const maxStarsResult = await client.query(
						`SELECT MAX(etoiles) as max_stars
									 FROM badge_progress
									 WHERE participant_id = $1 AND territoire_chasse = $2`,
						[participant_id, territoire_chasse],
					);

					let nextStar = maxStarsResult.rows[0].max_stars
						? maxStarsResult.rows[0].max_stars + 1
						: 1;

					if (nextStar > 3) {
						jsonResponse(
							res,
							false,
							null,
							"Maximum stars already reached for this badge.",
						);
						break;
					}

					const result = await client.query(
						`INSERT INTO badge_progress (
											participant_id, territoire_chasse, objectif, description, 
											fierte, raison, date_obtention, etoiles, status, organization_id
									) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
						[
							participant_id,
							territoire_chasse,
							objectif,
							description,
							fierte,
							raison,
							date_obtention,
							nextStar,
							"pending",
							organizationId,
						],
					);

					jsonResponse(
						res,
						true,
						{ etoiles: nextStar },
						"Badge progress saved successfully",
					);
					break;
				}

				case "save_fiche_sante": {
					const { participant_id, ...ficheSanteData } = req.body;

					try {
						await client.query("BEGIN");

						// Check if fiche sante exists
						const existingResult = await client.query(
							"SELECT id FROM fiche_sante WHERE participant_id = $1",
							[participant_id],
						);

						if (existingResult.rows.length > 0) {
							// Update existing
							await client.query(
								`UPDATE fiche_sante SET 
															nom_fille_mere = $1, medecin_famille = $2, nom_medecin = $3,
															probleme_sante = $4, allergie = $5, epipen = $6,
															medicament = $7, limitation = $8, vaccins_a_jour = $9,
															blessures_operations = $10, niveau_natation = $11,
															doit_porter_vfi = $12, regles = $13, renseignee = $14
													WHERE participant_id = $15`,
								[...Object.values(ficheSanteData), participant_id],
							);
						} else {
							// Insert new
							await client.query(
								`INSERT INTO fiche_sante (
															nom_fille_mere, medecin_famille, nom_medecin,
															probleme_sante, allergie, epipen, medicament,
															limitation, vaccins_a_jour, blessures_operations,
															niveau_natation, doit_porter_vfi, regles,
															renseignee, participant_id
													) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
								[...Object.values(ficheSanteData), participant_id],
							);
						}

						await client.query("COMMIT");
						jsonResponse(res, true, null, "Fiche sante saved successfully");
					} catch (error) {
						await client.query("ROLLBACK");
						jsonResponse(
							res,
							false,
							null,
							`Error saving fiche sante: ${error.message}`,
						);
					}
					break;
				}

				case "save_parent": {
					const { participant_id, ...parentData } = req.body;

					try {
						const result = await client.query(
							`INSERT INTO parents_guardians 
											 (nom, prenom, courriel, telephone_residence, telephone_travail, 
												telephone_cellulaire, is_primary, is_emergency_contact)
											 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
											 ON CONFLICT (courriel) 
											 DO UPDATE SET
													nom = EXCLUDED.nom, 
													prenom = EXCLUDED.prenom,
													telephone_residence = EXCLUDED.telephone_residence, 
													telephone_travail = EXCLUDED.telephone_travail,
													telephone_cellulaire = EXCLUDED.telephone_cellulaire, 
													is_primary = EXCLUDED.is_primary,
													is_emergency_contact = EXCLUDED.is_emergency_contact
											 RETURNING id`,
							[
								parentData.nom,
								parentData.prenom,
								parentData.courriel,
								parentData.telephone_residence,
								parentData.telephone_travail,
								parentData.telephone_cellulaire,
								parentData.is_primary,
								parentData.is_emergency_contact,
							],
						);

						const parentId = result.rows[0].id;

						await client.query(
							`INSERT INTO participant_guardians (participant_id, guardian_id, lien)
											 VALUES ($1, $2, $3)
											 ON CONFLICT (participant_id, guardian_id) 
											 DO UPDATE SET lien = EXCLUDED.lien`,
							[participant_id, parentId, parentData.lien],
						);

						jsonResponse(
							res,
							true,
							{ parent_id: parentId },
							"Parent saved successfully",
						);
					} catch (error) {
						jsonResponse(
							res,
							false,
							null,
							`Error saving parent: ${error.message}`,
						);
					}
					break;
				}

				case "save_reminder": {
					const { reminder_date, is_recurring, reminder_text } = req.body;
					await client.query(
						`INSERT INTO rappel_reunion (organization_id, reminder_date, is_recurring, reminder_text)
							 VALUES ($1, $2, $3, $4)`,
						[organizationId, reminder_date, is_recurring, reminder_text],
					);
					return jsonResponse(res, true, null, "Reminder saved successfully");
				}

				case "save_form_submission": {
					const { form_type, participant_id, submission_data } = req.body;
					const userId = getUserIdFromToken(token);
					const organizationId = getCurrentOrganizationId(req);

					try {
						const result = await client.query(
							`INSERT INTO form_submissions 
											 (organization_id, user_id, participant_id, form_type, submission_data)
											 VALUES ($1, $2, $3, $4, $5)
											 ON CONFLICT (participant_id, form_type, organization_id)
											 DO UPDATE SET 
													submission_data = EXCLUDED.submission_data, 
													updated_at = CURRENT_TIMESTAMP`,
							[
								organizationId,
								userId,
								participant_id,
								form_type,
								JSON.stringify(submission_data),
							],
						);

						jsonResponse(res, true, null, "Form submission saved successfully");
					} catch (error) {
						jsonResponse(
							res,
							false,
							null,
							`Error saving form submission: ${error.message}`,
						);
					}
					break;
				}

				case "save_guardian_form_submission": {
					const { participant_id, submission_data } = req.body;
					const userId = getUserIdFromToken(token);

					try {
						// Check for existing guardian
						const existingGuardian = await client.query(
							`SELECT * FROM parents_guardians 
											 WHERE participant_id = $1 
											 AND nom = $2 
											 AND prenom = $3
											 AND courriel = $4`,
							[
								participant_id,
								submission_data.nom,
								submission_data.prenom,
								submission_data.courriel,
							],
						);

						let guardianId;
						if (existingGuardian.rows.length > 0) {
							// Update existing guardian
							await client.query(
								`UPDATE parents_guardians
													 SET lien = $1, 
															 telephone_residence = $2, 
															 telephone_travail = $3, 
															 telephone_cellulaire = $4, 
															 is_primary = $5, 
															 is_emergency_contact = $6
													 WHERE id = $7`,
								[
									submission_data.lien,
									submission_data.telephone_residence,
									submission_data.telephone_travail,
									submission_data.telephone_cellulaire,
									submission_data.is_primary,
									submission_data.is_emergency_contact,
									existingGuardian.rows[0].id,
								],
							);
							guardianId = existingGuardian.rows[0].id;
						} else {
							// Insert new guardian
							const newGuardian = await client.query(
								`INSERT INTO parents_guardians 
													 (participant_id, nom, prenom, lien, courriel, 
														telephone_residence, telephone_travail, telephone_cellulaire, 
														is_primary, is_emergency_contact, user_id)
													 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
													 RETURNING id`,
								[
									participant_id,
									submission_data.nom,
									submission_data.prenom,
									submission_data.lien,
									submission_data.courriel,
									submission_data.telephone_residence,
									submission_data.telephone_travail,
									submission_data.telephone_cellulaire,
									submission_data.is_primary,
									submission_data.is_emergency_contact,
									userId,
								],
							);
							guardianId = newGuardian.rows[0].id;
						}

						// Link guardian to participant
						await client.query(
							`INSERT INTO participant_guardians (participant_id, guardian_id)
											 VALUES ($1, $2)
											 ON CONFLICT (participant_id, guardian_id) DO NOTHING`,
							[participant_id, guardianId],
						);

						jsonResponse(res, true, null, "Guardian saved successfully");
					} catch (error) {
						jsonResponse(
							res,
							false,
							null,
							`Error saving guardian: ${error.message}`,
						);
					}
					break;
				}

				case "save_participant": {
					const { first_name, last_name, date_naissance } = req.body;
					const organizationId = getCurrentOrganizationId(req);

					if (!first_name || !last_name || !date_naissance) {
						jsonResponse(
							res,
							false,
							null,
							"Missing required fields: first_name, last_name, or date_naissance",
						);
						break;
					}

					try {
						const result = await client.query(
							`INSERT INTO participants (first_name, last_name, date_naissance)
											 VALUES ($1, $2, $3)
											 RETURNING id`,
							[first_name, last_name, date_naissance],
						);

						const participantId = result.rows[0].id;
						jsonResponse(
							res,
							true,
							{ participant_id: participantId },
							"Participant inserted successfully",
						);
					} catch (error) {
						jsonResponse(
							res,
							false,
							null,
							`Error saving participant: ${error.message}`,
						);
					}
					break;
				}

				case "update_participant_group": {
					const { participant_id, group_id, is_leader, is_second_leader } =
						req.body;
					const organizationId = getCurrentOrganizationId(req);

					try {
						// Validate inputs
						if (!participant_id) {
							throw new Error("Participant ID is required");
						}

						const parsedGroupId =
							group_id && group_id !== "none" ? parseInt(group_id) : null;
						const isLeader = Boolean(is_leader);
						const isSecondLeader = Boolean(is_second_leader);

						await client.query("BEGIN");

						// Verify participant exists in organization
						const participantExists = await client.query(
							`SELECT 1 FROM participant_organizations 
											 WHERE participant_id = $1 AND organization_id = $2`,
							[participant_id, organizationId],
						);

						if (!participantExists.rows.length) {
							throw new Error("Participant not found in organization");
						}

						// If group_id provided, verify it exists
						if (parsedGroupId) {
							const groupExists = await client.query(
								`SELECT 1 FROM groups 
													 WHERE id = $1 AND organization_id = $2`,
								[parsedGroupId, organizationId],
							);

							if (!groupExists.rows.length) {
								throw new Error("Group not found in organization");
							}
						}

						// Remove existing group assignment
						await client.query(
							`DELETE FROM participant_groups 
											 WHERE participant_id = $1 AND organization_id = $2`,
							[participant_id, organizationId],
						);

						// Insert new group assignment if group_id provided
						if (parsedGroupId) {
							await client.query(
								`INSERT INTO participant_groups 
													 (participant_id, group_id, organization_id, is_leader, is_second_leader)
													 VALUES ($1, $2, $3, $4, $5)`,
								[
									participant_id,
									parsedGroupId,
									organizationId,
									isLeader,
									isSecondLeader,
								],
							);
						}

						await client.query("COMMIT");
						jsonResponse(
							res,
							true,
							{
								participant_id,
								group_id: parsedGroupId,
								is_leader: isLeader,
								is_second_leader: isSecondLeader,
							},
							"Group updated successfully",
						);
					} catch (error) {
						await client.query("ROLLBACK");
						jsonResponse(res, false, null, error.message);
					}
					break;
				}

				case "associate_user": {
					const { participant_id, user_id } = req.body;
					const organizationId = getCurrentOrganizationId(req);

					try {
						await client.query("BEGIN");

						// Verify participant belongs to organization
						const participantCheck = await client.query(
							`SELECT 1 FROM participant_organizations 
											 WHERE participant_id = $1 AND organization_id = $2`,
							[participant_id, organizationId],
						);

						if (!participantCheck.rows.length) {
							throw new Error(
								"Participant does not belong to the current organization",
							);
						}

						// Associate user with participant
						await client.query(
							`INSERT INTO user_participants (user_id, participant_id) 
											 VALUES ($1, $2) 
											 ON CONFLICT (user_id, participant_id) DO NOTHING`,
							[user_id, participant_id],
						);

						// Ensure user has role in organization
						await client.query(
							`INSERT INTO user_organizations (user_id, organization_id, role)
											 VALUES ($1, $2, 'parent')
											 ON CONFLICT (user_id, organization_id) 
											 DO UPDATE SET role = 'parent'`,
							[user_id, organizationId],
						);

						await client.query("COMMIT");
						jsonResponse(res, true, null, "User associated successfully");
					} catch (error) {
						await client.query("ROLLBACK");
						jsonResponse(res, false, null, error.message);
					}
					break;
				}

				case "link_user_participants": {
					const { participant_ids } = req.body;
					const userId = getUserIdFromToken(token);

					if (!participant_ids?.length) {
						jsonResponse(res, false, null, "No participants selected");
						break;
					}

					try {
						for (const participantId of participant_ids) {
							await client.query(
								`INSERT INTO user_participants (user_id, participant_id) 
													 VALUES ($1, $2)`,
								[userId, participantId],
							);
						}
						jsonResponse(res, true, null, "Participants linked successfully");
					} catch (error) {
						jsonResponse(
							res,
							false,
							null,
							`Error linking participants: ${error.message}`,
						);
					}
					break;
				}

				case "link_parent_to_participant": {
					const { parent_id, participant_id } = req.body;

					if (!parent_id || !participant_id) {
						jsonResponse(
							res,
							false,
							null,
							"Missing parent ID or participant ID",
						);
						break;
					}

					try {
						await client.query(
							`INSERT INTO participant_guardians (participant_id, guardian_id) 
											 VALUES ($1, $2)`,
							[participant_id, parent_id],
						);
						jsonResponse(
							res,
							true,
							null,
							"Parent linked to participant successfully",
						);
					} catch (error) {
						if (error.code === "23505") {
							// Unique violation
							jsonResponse(
								res,
								false,
								null,
								"This parent is already linked to the participant",
							);
						} else {
							jsonResponse(
								res,
								false,
								null,
								`Database error: ${error.message}`,
							);
						}
					}
					break;
				}

				case "remove_guardians": {
					const { participant_id, guardian_ids } = req.body;

					if (!participant_id || !guardian_ids?.length) {
						jsonResponse(
							res,
							false,
							null,
							"Invalid data for removing guardians",
						);
						break;
					}

					try {
						await client.query("BEGIN");

						// Remove links between participant and guardians
						await client.query(
							`DELETE FROM participant_guardians 
											 WHERE participant_id = $1 
											 AND guardian_id = ANY($2)`,
							[participant_id, guardian_ids],
						);

						// Remove guardians if not linked to other participants
						await client.query(
							`DELETE FROM parents_guardians 
											 WHERE id = ANY($1)
											 AND NOT EXISTS (
													 SELECT 1 FROM participant_guardians 
													 WHERE parent_guardian_id = parents_guardians.id
											 )`,
							[guardian_ids],
						);

						await client.query("COMMIT");
						jsonResponse(res, true, null, "Guardians removed successfully");
					} catch (error) {
						await client.query("ROLLBACK");
						jsonResponse(
							res,
							false,
							null,
							`Error removing guardians: ${error.message}`,
						);
					}
					break;
				}

				case "remove_group": {
					const { group_id } = req.body;

					try {
						await client.query("BEGIN");

						// Update all participants in this group to have no group
						await client.query(
							`UPDATE participants 
											 SET group_id = NULL 
											 WHERE group_id = $1`,
							[group_id],
						);

						// Delete the group
						await client.query(
							`DELETE FROM groups 
											 WHERE id = $1`,
							[group_id],
						);

						await client.query("COMMIT");
						jsonResponse(res, true, null, "Group removed successfully");
					} catch (error) {
						await client.query("ROLLBACK");
						jsonResponse(res, false, null, error.message);
					}
					break;
				}

				case "award_honor": {
					const honors = req.body;
					const organizationId = getCurrentOrganizationId(req);
					const awards = [];

					try {
						await client.query("BEGIN");

						for (const honor of honors) {
							const { participantId, date } = honor;

							const result = await client.query(
								`INSERT INTO honors (participant_id, date, organization_id)
													 VALUES ($1, $2, $3)
													 ON CONFLICT (participant_id, date, organization_id) DO NOTHING
													 RETURNING id`,
								[participantId, date, organizationId],
							);

							if (result.rows.length > 0) {
								await client.query(
									`INSERT INTO points (participant_id, value, created_at, organization_id)
															 VALUES ($1, 5, $2, $3)`,
									[participantId, date, organizationId],
								);
								awards.push({ participantId, awarded: true });
							} else {
								awards.push({
									participantId,
									awarded: false,
									message: "Honor already awarded for this date",
								});
							}
						}

						await client.query("COMMIT");
						jsonResponse(res, true, { awards });
					} catch (error) {
						await client.query("ROLLBACK");
						jsonResponse(res, false, null, error.message);
					}
					break;
				}

				case "switch_organization": {
					const { organization_id: newOrgId } = req.body;
					const userId = getUserIdFromToken(token);
					const client = await pool.connect();

					try {
						await client.query("BEGIN");

						// Verify user has access to the organization
						const userOrgsResult = await client.query(
							`SELECT organization_id 
							 FROM user_organizations 
							 WHERE user_id = $1`,
							[userId],
						);

						const orgIds = userOrgsResult.rows.map(
							(row) => row.organization_id,
						);

						if (!newOrgId || !orgIds.includes(newOrgId)) {
							throw new Error("Invalid organization ID");
						}

						// Update session with new organization
						req.session.current_organization_id = newOrgId;

						// Update user's last accessed organization
						await client.query(
							`UPDATE user_organizations 
							 SET last_accessed = CURRENT_TIMESTAMP 
							 WHERE user_id = $1 AND organization_id = $2`,
							[userId, newOrgId],
						);

						await client.query("COMMIT");
						return jsonResponse(
							res,
							true,
							null,
							"Organization switched successfully",
						);
					} catch (error) {
						await client.query("ROLLBACK");
						console.error("Error switching organization:", error);
						return jsonResponse(res, false, null, error.message);
					} finally {
						client.release();
					}
					break;
				}

				case "check_permission": {
					const { operation } = req.body;
					const token = req.headers.authorization?.split(" ")[1];

					if (!token || !operation) {
						jsonResponse(res, true, { hasPermission: false });
						break;
					}

					try {
						const decoded = jwt.verify(token, secretKey);
						const userId = decoded.id;

						const result = await client.query(
							`SELECT u.role, p.allowed 
											 FROM users u 
											 LEFT JOIN permissions p ON u.role = p.role 
											 WHERE u.id = $1 AND p.operation = $2`,
							[userId, operation],
						);

						jsonResponse(res, true, {
							hasPermission: Boolean(result.rows[0]?.allowed),
						});
					} catch (error) {
						jsonResponse(res, true, { hasPermission: false });
					}
					break;
				}

				case "link_participant_to_organization": {
					const { participant_id } = req.body;
					const result = await client.query(
						`INSERT INTO participant_organizations (participant_id, organization_id)
							 VALUES ($1, $2)
							 ON CONFLICT (participant_id, organization_id) DO UPDATE SET
							 organization_id = EXCLUDED.organization_id
							 RETURNING id`,
						[participant_id, organizationId],
					);
					if (result.rowCount === 0) {
						return jsonResponse(
							res,
							false,
							null,
							"Failed to link participant to organization",
						);
					}
					return jsonResponse(
						res,
						true,
						null,
						"Participant linked to organization successfully",
					);
				}

				case "remove_participant_from_organization": {
					const { participant_id } = req.body;
					await client.query("BEGIN");
					await client.query(
						`DELETE FROM participant_organizations 
							 WHERE participant_id = $1 AND organization_id = $2`,
						[participant_id, organizationId],
					);
					const validTables = {
						participant_groups: true,
						attendance: true,
						honors: true,
						points: true,
						form_submissions: true,
					};

					for (const table of tables) {
						if (!validTables[table]) continue;
						await client.query(
							"DELETE FROM $1::regclass WHERE participant_id = $2",
							[table, participant_id],
						);
					}
					await client.query("COMMIT");
					return jsonResponse(
						res,
						true,
						null,
						"Participant removed from organization successfully",
					);
				}

				case "update_group_name": {
					const { group_id, group_name } = req.body;
					if (!group_id || !group_name) {
						return jsonResponse(res, false, null, "Missing group ID or name");
					}
					const sanitizedGroupName = group_name.trim();
					const groupId = parseInt(group_id);
					if (isNaN(groupId)) {
						return jsonResponse(res, false, null, "Invalid group ID");
					}
					const updateResult = await client.query(
						"UPDATE groups SET name = $1 WHERE id = $2 RETURNING id, name",
						[sanitizedGroupName, groupId],
					);
					if (updateResult.rowCount === 0) {
						return jsonResponse(res, false, null, "Group not found");
					}
					return jsonResponse(
						res,
						true,
						{ group: updateResult.rows[0] },
						"Group name updated successfully",
					);
				}

				case "approve_user": {
					const { user_id } = req.body;
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
						[user_id, organizationId],
					);
					if (result.rowCount === 0) {
						return jsonResponse(res, false, null, "Failed to approve user");
					}
					return jsonResponse(res, true, null, "User approved successfully");
				}

				case "update_user_role": {
					const { user_id, new_role } = req.body;
					const result = await client.query(
						`UPDATE user_organizations 
							 SET role = $1 
							 WHERE user_id = $2 AND organization_id = $3
							 RETURNING id`,
						[new_role, user_id, organizationId],
					);
					if (result.rowCount === 0) {
						return jsonResponse(res, false, null, "Failed to update user role");
					}
					return jsonResponse(
						res,
						true,
						null,
						"User role updated successfully",
					);
				}

				case "update_attendance": {
					const { participant_id, status, date } = req.body;
					const organizationId = getCurrentOrganizationId(req);

					try {
						await client.query("BEGIN");

						// Ensure the participant is part of the organization
						const participantCheck = await client.query(
							`SELECT 1 FROM participant_organizations
								 WHERE participant_id = $1 AND organization_id = $2`,
							[participant_id, organizationId],
						);

						if (participantCheck.rows.length === 0) {
							throw new Error(
								"Participant not found in the current organization",
							);
						}

						// Update attendance
						await client.query(
							`INSERT INTO attendance (participant_id, date, status, organization_id)
								 VALUES ($1, $2, $3, $4)
								 ON CONFLICT (participant_id, date, organization_id)
								 DO UPDATE SET status = EXCLUDED.status`,
							[participant_id, date, status, organizationId],
						);

						await client.query("COMMIT");
						jsonResponse(res, true, null, "Attendance updated successfully");
					} catch (error) {
						await client.query("ROLLBACK");
						jsonResponse(res, false, null, error.message);
					}
					break;
				}

				case "verify_email": {
					const { verification_token } = req.body;

					if (!verification_token) {
						return jsonResponse(
							res,
							false,
							null,
							"Verification token is required",
						);
					}

					try {
						// Verify the token
						const decoded = jwt.verify(verification_token, secretKey);

						if (!decoded.email || !decoded.userId) {
							return jsonResponse(
								res,
								false,
								null,
								"Invalid verification token",
							);
						}

						try {
							await client.query("BEGIN");

							// Check user exists and isn't verified
							const userResult = await client.query(
								"SELECT id, email, is_verified FROM users WHERE id = $1",
								[decoded.userId],
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
								return jsonResponse(
									res,
									false,
									null,
									"Invalid verification token",
								);
							}

							// Update verification status
							await client.query(
								"UPDATE users SET is_verified = true, verified_at = CURRENT_TIMESTAMP WHERE id = $1",
								[decoded.userId],
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
								],
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
								{ expiresIn: "1h" },
							);

							return jsonResponse(
								res,
								true,
								{ token },
								"Email verified successfully",
							);
						} catch (error) {
							await client.query("ROLLBACK");
							throw error;
						}
					} catch (error) {
						if (error.name === "JsonWebTokenError") {
							return jsonResponse(
								res,
								false,
								null,
								"Invalid verification token",
							);
						}
						if (error.name === "TokenExpiredError") {
							return jsonResponse(
								res,
								false,
								null,
								"Verification token has expired",
							);
						}
						throw error;
					}
					break;
				}

				case "request_reset": {
					const { email } = req.body;

					if (!email) {
						return jsonResponse(res, false, null, "Email is required");
					}

					try {
						const userResult = await client.query(
							"SELECT id, email FROM users WHERE email = $1",
							[email.toLowerCase()],
						);

						if (userResult.rows.length === 0) {
							// For security, don't reveal if email exists
							return jsonResponse(
								res,
								true,
								null,
								"If an account exists with this email, a reset link will be sent.",
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
							{ expiresIn: "1h" },
						);

						// Store reset token
						await client.query(
							`INSERT INTO password_reset_tokens (user_id, token, expires_at)
																	VALUES ($1, $2, NOW() + INTERVAL '1 hour')`,
							[user.id, resetToken],
						);

						// In a real application, send email with reset link here
						// For now, return token in response
						return jsonResponse(
							res,
							true,
							{ reset_token: resetToken },
							"Password reset instructions have been sent.",
						);
					} catch (error) {
						console.error("Password reset request error:", error);
						return jsonResponse(
							res,
							false,
							null,
							"An error occurred processing your request.",
						);
					}
					break;
				}

				case "reset_password": {
					const { reset_token, new_password } = req.body;

					if (!reset_token || !new_password) {
						return jsonResponse(
							res,
							false,
							null,
							"Reset token and new password are required",
						);
					}

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
							[reset_token],
						);

						if (tokenResult.rows.length === 0) {
							await client.query("ROLLBACK");
							return jsonResponse(
								res,
								false,
								null,
								"Invalid or expired reset token",
							);
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
							[reset_token],
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
							],
						);

						await client.query("COMMIT");

						return jsonResponse(
							res,
							true,
							null,
							"Password has been reset successfully",
						);
					} catch (error) {
						await client.query("ROLLBACK");
						if (
							error.name === "JsonWebTokenError" ||
							error.name === "TokenExpiredError"
						) {
							return jsonResponse(
								res,
								false,
								null,
								"Invalid or expired reset token",
							);
						}
						throw error;
					}
					break;
				}

				case "get_organization_id": {
					const organizationId = determineOrganizationId(req);
					console.log("Organization ID", organizationId);
					return jsonResponse(res, true, { organizationId });
				}

				case "create_organization": {
					const { name } = req.body;
					const userId = getUserIdFromToken(token);

					try {
						await client.query("BEGIN");

						const newOrgResult = await client.query(
							`INSERT INTO organizations (name) VALUES ($1) RETURNING id`,
							[name],
						);
						const newOrganizationId = newOrgResult.rows[0].id;

						await client.query(
							`INSERT INTO organization_form_formats (organization_id, form_type, form_structure, display_type)
														SELECT $1, form_type, form_structure, 'public'
														FROM organization_form_formats
														WHERE organization_id = 0`,
							[newOrganizationId],
						);

						await client.query(
							`INSERT INTO organization_settings (organization_id, setting_key, setting_value)
														VALUES ($1, 'organization_info', $2)`,
							[newOrganizationId, JSON.stringify(req.body)],
						);

						await client.query(
							`INSERT INTO user_organizations (user_id, organization_id, role)
														VALUES ($1, $2, 'admin')`,
							[userId, newOrganizationId],
						);

						await client.query("COMMIT");
						jsonResponse(res, true, null, "Organization created successfully");
					} catch (error) {
						await client.query("ROLLBACK");
						handleError(res, error);
					}
					break;
				}

				case "update_points": {
					const updates = req.body;
					const organizationId = getCurrentOrganizationId(req);
					const responses = [];

					try {
						await client.query("BEGIN");

						for (const update of updates) {
							if (update.type === "group") {
								await client.query(
									`INSERT INTO points (participant_id, group_id, value, created_at, organization_id) 
																VALUES (NULL, $1, $2, $3, $4)`,
									[update.id, update.points, update.timestamp, organizationId],
								);

								const membersResult = await client.query(
									`SELECT p.id 
																FROM participants p
																JOIN participant_groups pg ON p.id = pg.participant_id
																WHERE pg.group_id = $1 AND pg.organization_id = $2`,
									[update.id, organizationId],
								);

								for (const member of membersResult.rows) {
									await client.query(
										`INSERT INTO points (participant_id, group_id, value, created_at, organization_id) 
																	VALUES ($1, NULL, $2, $3, $4)`,
										[
											member.id,
											update.points,
											update.timestamp,
											organizationId,
										],
									);
								}

								const groupTotalResult = await client.query(
									`SELECT COALESCE(SUM(value), 0) as total_points 
																FROM points 
																WHERE group_id = $1 AND participant_id IS NULL AND organization_id = $2`,
									[update.id, organizationId],
								);

								responses.push({
									type: "group",
									id: update.id,
									totalPoints: groupTotalResult.rows[0].total_points,
									memberIds: membersResult.rows.map((row) => row.id),
								});
							} else {
								await client.query(
									`INSERT INTO points (participant_id, group_id, value, created_at, organization_id) 
																VALUES ($1, NULL, $2, $3, $4)`,
									[update.id, update.points, update.timestamp, organizationId],
								);

								const individualTotalResult = await client.query(
									`SELECT COALESCE(SUM(value), 0) as total_points 
																FROM points 
																WHERE participant_id = $1 AND organization_id = $2`,
									[update.id, organizationId],
								);

								responses.push({
									type: "individual",
									id: update.id,
									totalPoints: individualTotalResult.rows[0].total_points,
								});
							}
						}

						await client.query("COMMIT");
						jsonResponse(res, true, responses);
					} catch (error) {
						await client.query("ROLLBACK");
						handleError(res, error);
					}
					break;
				}

				default: {
					return jsonResponse(res, false, null, "Invalid action");
				}
			}
		} catch (error) {
			console.error("API Error:", error);
			return jsonResponse(res, false, null, "An internal error occurred");
		} finally {
			client.release();
		}
	},
);

app.get(
	"/api",
	[check("action").isString().notEmpty()],
	async (req, res, next) => {
		const errors = validationResult(req);
		if (!errors.isEmpty()) {
			return res.status(400).json({ success: false, errors: errors.array() });
		}

		const action = req.query.action;
		const token = req.headers.authorization?.split(" ")[1];
		console.log(token);
		const decodedToken = verifyJWT(token);
		console.log(decodedToken);
		const userId = decodedToken?.id;

		if (
			!userId &&
			![
				"login",
				"register",
				"request_reset",
				"reset_password",
				"get_organization_id",
				"get_organization_settings",
			].includes(action)
		) {
			return jsonResponse(res, false, null, "Invalid or expired token");
		}

		const client = await pool.connect();

		try {
			switch (action) {
				case "login": {
					try {
						const email = req.body.email ? req.body.email.toLowerCase() : "";
						const password = req.body.password || "";
						console.log(`Login attempt for email: ${email}`);

						// Step 2: Connect to the database
						const client = await pool.connect();
						try {
							// Step 3: Fetch user from the database and verify credentials
							const result = await client.query(
								`SELECT u.id, u.email, u.password, u.is_verified, u.full_name, uo.role
								 FROM users u
								 JOIN user_organizations uo ON u.id = uo.user_id
								 WHERE u.email = $1 AND uo.organization_id = $2`,
								[email, req.organizationId],
							);

							const user = result.rows[0];
							if (user) {
								// Step 3.1: Handle hash compatibility between $2y$ and $2b$
								const hashedPassword = user.password.startsWith("$2y$")
									? user.password.replace("$2y$", "$2b$")
									: user.password;

								// Step 3.2: Verify the password using bcrypt
								if (await bcrypt.compare(password, hashedPassword)) {
									// Step 4: Check if the account is verified
									if (!user.is_verified) {
										return res.json({
											success: false,
											message:
												"Your account is not yet verified. Please wait for admin verification.",
										});
									}

									// Step 5: Generate a JWT token for authentication
									const token = jwt.sign(
										{
											id: user.id,
											role: user.role,
											organizationId: req.organizationId,
										},
										secretKey,
										{ expiresIn: "1h" },
									);

									// Step 6: Fetch participants linked to the guardian's email but not already linked to the user
									const guardianParticipantsResult = await client.query(
										`SELECT pg.id, p.id AS participant_id, p.first_name, p.last_name 
										 FROM parents_guardians pg
										 JOIN participant_guardians pgu ON pg.id = pgu.guardian_id
										 JOIN participants p ON pgu.participant_id = p.id
										 LEFT JOIN user_participants up ON up.participant_id = p.id AND up.user_id = $1
										 WHERE pg.courriel = $2 AND up.participant_id IS NULL`,
										[user.id, email],
									);

									const guardianParticipants = guardianParticipantsResult.rows;

									// Step 7: Prepare the response data
									const response = {
										success: true,
										message: "login_successful",
										token,
										user_role: user.role,
										user_full_name: user.full_name,
									};

									// If there are any participants not linked yet, add them to the response
									if (guardianParticipants.length > 0) {
										response.guardian_participants = guardianParticipants;
									}

									// Log and return the response
									res.json(response);
								} else {
									// Step 8: Handle invalid email or password
									res.json({
										success: false,
										message: "Invalid email or password.",
									});
								}
							} else {
								// Handle case where user is not found
								res.json({
									success: false,
									message: "Invalid email or password.",
								});
							}
						} finally {
							// Step 9: Release the client back to the pool
							client.release();
						}
					} catch (error) {
						// Step 10: Catch any errors and return a failure response
						console.error(`Login error: ${error.message}`);
						res.status(500).json({
							success: false,
							message: `An error occurred during login: ${error.message}`,
						});
					}
					break;
				}

				case "get_organization_form_formats": {
					const result = await client.query(
						`SELECT form_type, form_structure 
							 FROM organization_form_formats 
							 WHERE organization_id = $1`,
						[organizationId],
					);
					const formFormats = result.rows.reduce((acc, form) => {
						acc[form.form_type] = JSON.parse(form.form_structure);
						return acc;
					}, {});
					return jsonResponse(res, true, { formFormats });
				}

				case "participant-age": {
					const result = await client.query(
						`SELECT p.id, p.first_name, p.last_name, p.date_naissance, 
											EXTRACT(YEAR FROM AGE(p.date_naissance)) AS age
							 FROM participants p
							 JOIN participant_organizations po ON p.id = po.participant_id
							 WHERE po.organization_id = $1
							 ORDER BY p.date_naissance ASC, p.last_name`,
						[organizationId],
					);
					return jsonResponse(res, true, { participants: result.rows });
				}

				case "get_activites_rencontre": {
					const result = await client.query(
						`SELECT * FROM activites_rencontre ORDER BY activity`,
					);
					return jsonResponse(res, true, { activites: result.rows });
				}

				case "get_animateurs": {
					const result = await client.query(
						`SELECT u.id, u.full_name 
							 FROM users u
							 JOIN user_organizations uo ON u.id = uo.user_id
							 WHERE uo.organization_id = $1 
							 AND uo.role IN ('animation')
							 ORDER BY u.full_name`,
						[organizationId],
					);
					return jsonResponse(res, true, { animateurs: result.rows });
				}

				case "get_recent_honors": {
					const result = await client.query(
						`SELECT p.id, p.first_name, p.last_name 
							 FROM participants p 
							 JOIN honors h ON p.id = h.participant_id 
							 WHERE h.date = (SELECT MAX(h2.date) FROM honors h2 WHERE h2.organization_id = $1) 
							 AND h.organization_id = $1
							 ORDER BY h.date DESC`,
						[organizationId],
					);
					return jsonResponse(res, true, { honors: result.rows });
				}

				case "get_reminder": {
					const result = await client.query(
						`SELECT * FROM rappel_reunion 
							 WHERE organization_id = $1 
							 ORDER BY creation_time DESC 
							 LIMIT 1`,
						[organizationId],
					);
					if (result.rows.length === 0)
						return jsonResponse(res, false, null, "No reminder found");
					return jsonResponse(res, true, { reminder: result.rows[0] });
				}

				case "get_pending_badges": {
					const result = await client.query(
						`SELECT bp.*, p.first_name, p.last_name 
							 FROM badge_progress bp 
							 JOIN participants p ON bp.participant_id = p.id 
							 WHERE bp.status = 'pending' 
							 AND EXISTS (
								 SELECT 1 FROM participant_organizations po 
								 WHERE po.organization_id = $1 
								 AND po.participant_id = p.id
							 )
							 ORDER BY bp.date_obtention`,
						[organizationId],
					);
					return jsonResponse(res, true, { pending_badges: result.rows });
				}

				case "get_health_contact_report": {
					const result = await client.query(
						`SELECT p.id AS participant_id, p.first_name, p.last_name, p.date_naissance, 
											g.name AS group_name, COALESCE(fs.submission_data->>'epipen', 'false')::boolean AS epipen,
											fs.submission_data->>'allergie' AS allergies, 
											fs.submission_data->>'probleme_sante' AS health_issues,
											fs.submission_data->>'niveau_natation' AS swimming_level,
											fs.submission_data->>'blessures_operations' AS injuries,
											fs2.submission_data->>'peut_partir_seul' AS leave_alone,
											fs2.submission_data->>'consentement_photos_videos' AS media_consent
							 FROM participants p
							 LEFT JOIN participant_groups pg ON p.id = pg.participant_id AND pg.organization_id = $1
							 LEFT JOIN groups g ON pg.group_id = g.id
							 LEFT JOIN form_submissions fs ON p.id = fs.participant_id 
										AND fs.form_type = 'fiche_sante' AND fs.organization_id = $1
							 LEFT JOIN form_submissions fs2 ON p.id = fs2.participant_id 
										AND fs2.form_type = 'participant_registration' AND fs2.organization_id = $1
							 WHERE EXISTS (
								 SELECT 1 FROM participant_organizations po 
								 WHERE po.organization_id = $1 AND po.participant_id = p.id
							 )
							 ORDER BY g.name, p.last_name, p.first_name`,
						[organizationId],
					);
					return jsonResponse(res, true, { health_report: result.rows });
				}

				case "get_mailing_list": {
					const organizationId = getCurrentOrganizationId(req);

					// Get emails and roles from user_organizations
					const usersEmailsResult = await client.query(
						`SELECT u.email, uo.role 
									 FROM user_organizations uo
									 JOIN users u ON u.id = uo.user_id
									 WHERE uo.organization_id = $1
									 AND u.email IS NOT NULL 
									 AND u.email != ''`,
						[organizationId],
					);

					// Organize emails by role
					const emailsByRole = usersEmailsResult.rows.reduce((acc, user) => {
						const role = user.role;
						const email = user.email.toLowerCase();
						if (!acc[role]) acc[role] = [];
						acc[role].push(email);
						return acc;
					}, {});

					// Get guardian emails with linked participants
					const parentEmailsResult = await client.query(
						`SELECT 
											LOWER(fs.submission_data->>'guardian_courriel_0') AS courriel, 
											string_agg(p.first_name || ' ' || p.last_name, ', ') AS participants
									 FROM form_submissions fs
									 JOIN participants p ON fs.participant_id = p.id
									 WHERE (fs.submission_data->>'guardian_courriel_0') IS NOT NULL 
									 AND (fs.submission_data->>'guardian_courriel_0') != ''
									 AND fs.organization_id = $1
									 GROUP BY fs.submission_data->>'guardian_courriel_0'
									 UNION
									 SELECT 
											LOWER(fs.submission_data->>'guardian_courriel_1') AS courriel, 
											string_agg(p.first_name || ' ' || p.last_name, ', ') AS participants
									 FROM form_submissions fs
									 JOIN participants p ON fs.participant_id = p.id
									 WHERE (fs.submission_data->>'guardian_courriel_1') IS NOT NULL 
									 AND (fs.submission_data->>'guardian_courriel_1') != ''
									 AND fs.organization_id = $1
									 GROUP BY fs.submission_data->>'guardian_courriel_1'`,
						[organizationId],
					);

					// Format parent emails with linked participants
					emailsByRole["parent"] = parentEmailsResult.rows.map((parent) => ({
						email: parent.courriel,
						participants: parent.participants,
					}));

					// Get participant emails
					const participantEmailsResult = await client.query(
						`SELECT LOWER(fs.submission_data->>'courriel') AS courriel
									 FROM form_submissions fs
									 WHERE (fs.submission_data->>'courriel') IS NOT NULL 
									 AND (fs.submission_data->>'courriel') != ''
									 AND fs.organization_id = $1`,
						[organizationId],
					);

					// Get all unique emails
					const allEmails = [
						...new Set([
							...Object.values(emailsByRole).flat(),
							...participantEmailsResult.rows.map((row) => row.courriel),
						]),
					];

					jsonResponse(res, true, {
						emails_by_role: emailsByRole,
						participant_emails: participantEmailsResult.rows.map(
							(row) => row.courriel,
						),
						unique_emails: allEmails,
					});
					break;
				}

				case "get_parent_contact_list": {
					const organizationId = getCurrentOrganizationId(req);

					const result = await client.query(
						`SELECT 
											p.id, 
											p.first_name, 
											p.last_name,
											COALESCE(g.name, 'no_group') AS group_name,
											pg.nom, 
											pg.prenom, 
											pg.telephone_residence, 
											pg.telephone_cellulaire, 
											pg.telephone_travail,
											pg.is_emergency_contact,
											pg.is_primary
									 FROM participants p
									 LEFT JOIN participant_groups pgroups ON p.id = pgroups.participant_id 
											AND pgroups.organization_id = $1
									 LEFT JOIN groups g ON pgroups.group_id = g.id
									 LEFT JOIN participant_guardians pgp ON p.id = pgp.participant_id
									 LEFT JOIN parents_guardians pg ON pgp.guardian_id = pg.id
									 WHERE pgroups.organization_id = $1
									 ORDER BY p.first_name, p.last_name, pg.is_primary DESC`,
						[organizationId],
					);

					// Organize data by child
					const children = result.rows.reduce((acc, row) => {
						const childId = row.id;
						if (!acc[childId]) {
							acc[childId] = {
								name: `${row.first_name} ${row.last_name}`,
								groups: [],
								contacts: [],
							};
						}

						// Add group if not already present
						if (!acc[childId].groups.includes(row.group_name)) {
							acc[childId].groups.push(row.group_name);
						}

						// Only add unique contact entries
						if (row.nom && row.prenom) {
							const contactEntry = {
								name: `${row.prenom} ${row.nom}`,
								phone_home: row.telephone_residence,
								phone_cell: row.telephone_cellulaire,
								phone_work: row.telephone_travail,
								is_emergency: row.is_emergency_contact,
							};

							if (
								!acc[childId].contacts.some(
									(c) =>
										c.name === contactEntry.name &&
										c.phone_home === contactEntry.phone_home,
								)
							) {
								acc[childId].contacts.push(contactEntry);
							}
						}

						return acc;
					}, {});

					jsonResponse(res, true, children);
					break;
				}

				case "get_pending_badges": {
					const organizationId = getCurrentOrganizationId(req);

					const result = await client.query(
						`SELECT bp.*, p.first_name, p.last_name 
									 FROM badge_progress bp 
									 JOIN participants p ON bp.participant_id = p.id 
									 WHERE bp.status = 'pending' 
									 AND EXISTS (
											 SELECT 1 FROM participant_organizations po 
											 WHERE po.organization_id = $1 
											 AND po.participant_id = p.id
									 )
									 ORDER BY bp.date_obtention`,
						[organizationId],
					);

					jsonResponse(res, true, result.rows);
					break;
				}

				case "get_participant_calendar": {
					const { participant_id } = req.query;
					const organizationId = getCurrentOrganizationId(req);

					const result = await client.query(
						`SELECT 
											p.id AS participant_id,
											p.first_name,
											p.last_name,
											COALESCE(c.amount, 0) AS calendar_amount,
											COALESCE(c.paid, FALSE) AS paid,
											c.updated_at
									 FROM participants p
									 LEFT JOIN calendars c ON p.id = c.participant_id
									 JOIN participant_organizations po ON po.participant_id = p.id
									 WHERE p.id = $1
									 AND po.organization_id = $2`,
						[participant_id, organizationId],
					);

					jsonResponse(res, true, { calendar: result.rows[0] });
					break;
				}

				case "get_reunion_preparation": {
					const date = req.query.date || new Date().toISOString().split("T")[0];
					const organizationId = getCurrentOrganizationId(req);

					const result = await client.query(
						`SELECT * FROM reunion_preparations
									 WHERE organization_id = $1 AND date = $2`,
						[organizationId, date],
					);

					if (result.rows.length > 0) {
						const preparation = result.rows[0];
						// Parse JSON fields
						preparation.louveteau_dhonneur = JSON.parse(
							preparation.louveteau_dhonneur,
						);
						preparation.activities = JSON.parse(preparation.activities);
						jsonResponse(res, true, preparation);
					} else {
						jsonResponse(
							res,
							false,
							null,
							"No reunion preparation found for this date",
						);
					}
					break;
				}

				case "get_form_submission": {
					const token = getBearerToken(req);
					if (!token || !verifyJWT(token)) {
						jsonResponse(res, false, null, "Invalid or missing token");
						break;
					}
					const userId = getUserIdFromToken(token);
					const { participant_id, form_type } = req.query;

					if (!participant_id || !form_type) {
						jsonResponse(
							res,
							false,
							null,
							"Invalid participant ID or form type",
						);
						break;
					}

					try {
						// Check user's permission to access participant data
						const hasAccess = await userHasAccessToParticipant(
							client,
							userId,
							participant_id,
						);
						if (!hasAccess) {
							jsonResponse(
								res,
								false,
								null,
								"You do not have permission to access this participant's data",
							);
							break;
						}

						const result = await client.query(
							`SELECT fs.submission_data
											 FROM form_submissions fs
											 WHERE fs.participant_id = $1 
											 AND fs.form_type = $2
											 ORDER BY fs.created_at DESC
											 LIMIT 1`,
							[participant_id, form_type],
						);

						if (result.rows.length > 0) {
							const formData = JSON.parse(result.rows[0].submission_data);
							jsonResponse(res, true, {
								form_data: formData,
								form_type: form_type,
								participant_id: participant_id,
							});
						} else {
							jsonResponse(res, false, null, "Form submission not found");
						}
					} catch (error) {
						console.error("Database error:", error);
						jsonResponse(
							res,
							false,
							null,
							"An error occurred while fetching the form submission",
						);
					}
					break;
				}

				case "get_acceptation_risque": {
					const { participant_id } = req.query;

					if (!participant_id) {
						jsonResponse(res, false, null, "Invalid participant ID");
						break;
					}

					try {
						const result = await client.query(
							"SELECT * FROM acceptation_risque WHERE participant_id = $1",
							[participant_id],
						);

						if (result.rows.length > 0) {
							jsonResponse(res, true, { acceptation_risque: result.rows[0] });
						} else {
							jsonResponse(res, false, null, "Acceptation risque not found");
						}
					} catch (error) {
						jsonResponse(res, false, null, "Error fetching acceptation risque");
					}
					break;
				}

				case "get_participants": {
					const organizationId = getCurrentOrganizationId(req);

					try {
						const result = await client.query(
							`SELECT 
													p.id, 
													p.first_name, 
													p.last_name, 
													COALESCE(SUM(CASE WHEN pt.group_id IS NULL THEN pt.value ELSE 0 END), 0) AS total_points,
													COALESCE(SUM(CASE WHEN pt.group_id IS NOT NULL THEN pt.value ELSE 0 END), 0) AS group_total_points,
													pg.group_id,
													g.name AS group_name,
													pg.is_leader,
													pg.is_second_leader
											 FROM participants p
											 JOIN participant_organizations po 
													ON p.id = po.participant_id 
													AND po.organization_id = $1
											 LEFT JOIN participant_groups pg 
													ON p.id = pg.participant_id 
													AND pg.organization_id = $1
											 LEFT JOIN groups g 
													ON pg.group_id = g.id 
													AND g.organization_id = $1
											 LEFT JOIN points pt 
													ON (p.id = pt.participant_id OR pg.group_id = pt.group_id)
													AND pt.organization_id = $1
											 GROUP BY p.id, pg.group_id, g.name, pg.is_leader, pg.is_second_leader
											 ORDER BY g.name, p.last_name, p.first_name`,
							[organizationId],
						);

						jsonResponse(res, true, { participants: result.rows });
					} catch (error) {
						jsonResponse(res, false, null, "Error fetching participants");
					}
					break;
				}

				case "get_fiche_sante": {
					const { participant_id } = req.query;

					if (!participant_id) {
						jsonResponse(res, false, null, "Invalid participant ID");
						break;
					}

					try {
						const result = await client.query(
							"SELECT * FROM fiche_sante WHERE participant_id = $1",
							[participant_id],
						);

						if (result.rows.length > 0) {
							jsonResponse(res, true, result.rows[0]);
						} else {
							jsonResponse(res, false, null, "Fiche sante not found");
						}
					} catch (error) {
						jsonResponse(res, false, null, "Error fetching fiche sante");
					}
					break;
				}

				case "get_parent_users": {
					const organizationId = getCurrentOrganizationId(req);

					try {
						const result = await client.query(
							`SELECT u.id, u.full_name 
											 FROM users u
											 JOIN user_organizations uo ON u.id = uo.user_id
											 WHERE uo.organization_id = $1 
											 AND uo.role = 'parent'
											 ORDER BY u.full_name`,
							[organizationId],
						);

						jsonResponse(res, true, result.rows);
					} catch (error) {
						jsonResponse(res, false, null, "Error fetching parent users");
					}
					break;
				}

				case "get_participants_with_users": {
					const organizationId = getCurrentOrganizationId(req);

					try {
						const result = await client.query(
							`SELECT 
													p.id, 
													p.first_name, 
													p.last_name, 
													string_agg(u.full_name, ', ') as associated_users
											 FROM participants p
											 JOIN participant_organizations po ON p.id = po.participant_id
											 LEFT JOIN user_participants up ON p.id = up.participant_id
											 LEFT JOIN users u ON up.user_id = u.id
											 WHERE po.organization_id = $1
											 GROUP BY p.id, p.first_name, p.last_name
											 ORDER BY p.last_name, p.first_name`,
							[organizationId],
						);

						jsonResponse(res, true, result.rows);
					} catch (error) {
						jsonResponse(
							res,
							false,
							null,
							"Error fetching participants with users",
						);
					}
					break;
				}

				case "get_participants_with_documents": {
					// Fetch participants with documents logic
					// ...
					return jsonResponse(res, true, { participants: result.rows });
				}

				case "get_guardian_info": {
					const { guardian_id } = req.query;
					if (!guardian_id) {
						return jsonResponse(res, false, null, "Missing guardian ID");
					}
					const guardianResult = await client.query(
						`SELECT id, nom, prenom, lien, courriel, telephone_residence, 
											telephone_travail, telephone_cellulaire, is_primary, is_emergency_contact 
							 FROM parents_guardians 
							 WHERE id = $1`,
						[guardian_id],
					);
					if (guardianResult.rows.length === 0) {
						return jsonResponse(res, false, null, "Guardian not found");
					}
					return jsonResponse(
						res,
						true,
						{ guardian: guardianResult.rows[0] },
						"Guardian info retrieved successfully",
					);
				}

				case "get_users": {
					const result = await client.query(
						`SELECT u.id, u.email, u.is_verified, uo.role, u.full_name, u.created_at
							 FROM users u
							 JOIN user_organizations uo ON u.id = uo.user_id
							 WHERE uo.organization_id = $1
							 ORDER BY uo.role DESC`,
						[organizationId],
					);
					return jsonResponse(res, true, result.rows);
				}

				case "get_subscribers": {
					const result = await client.query(
						`SELECT s.id, s.user_id, u.email 
							 FROM subscribers s 
							 LEFT JOIN users u ON s.user_id = u.id
							 JOIN user_organizations uo ON u.id = uo.user_id
							 WHERE uo.organization_id = $1`,
						[organizationId],
					);
					return jsonResponse(res, true, result.rows);
					break;
				}

				case "get_organization_id": {
					const organizationId = getCurrentOrganizationId(req);
					console.log("official Organization ID", organizationId);
					jsonResponse(res, true, { organizationId });
					break;
				}

				case "get_parent_dashboard_data": {
					const userId = getUserIdFromToken(req.headers.authorization);
					if (!userId) {
						return jsonResponse(res, false, null, "Invalid user");
					}

					const organizationId = getCurrentOrganizationId(req);
					console.log(`User ID: ${userId}, Organization ID: ${organizationId}`);

					try {
						// Get the user's role
						const roleResult = await client.query(
							`SELECT role 
								 FROM user_organizations 
								 WHERE user_id = $1 
								 AND organization_id = $2`,
							[userId, organizationId],
						);
						const userRole = roleResult.rows[0]?.role;
						console.log(`User Role: ${userRole}`);

						let query;
						let params = { organization_id: organizationId };

						if (userRole === "animation" || userRole === "admin") {
							// Query for users with animation or admin roles
							query = `
									SELECT p.*, 
												 CASE WHEN fs.id IS NOT NULL THEN 1 ELSE 0 END AS has_fiche_sante,
												 CASE WHEN ar.id IS NOT NULL THEN 1 ELSE 0 END AS has_acceptation_risque
									FROM participants p
									LEFT JOIN (
										SELECT DISTINCT participant_id, id 
										FROM form_submissions 
										WHERE form_type = 'fiche_sante' AND organization_id = $1
									) fs ON p.id = fs.participant_id
									LEFT JOIN (
										SELECT DISTINCT participant_id, id 
										FROM form_submissions 
										WHERE form_type = 'acceptation_risque' AND organization_id = $1
									) ar ON p.id = ar.participant_id
									JOIN participant_organizations po 
									ON po.participant_id = p.id AND po.organization_id = $1
								`;
						} else {
							// Query for non-admin/animation users (parents)
							query = `
									SELECT p.*, 
												 CASE WHEN fs.id IS NOT NULL THEN 1 ELSE 0 END AS has_fiche_sante,
												 CASE WHEN ar.id IS NOT NULL THEN 1 ELSE 0 END AS has_acceptation_risque
									FROM participants p
									LEFT JOIN user_participants up ON p.id = up.participant_id
									LEFT JOIN (
										SELECT DISTINCT participant_id, id 
										FROM form_submissions 
										WHERE form_type = 'fiche_sante' AND organization_id = $1
									) fs ON p.id = fs.participant_id
									LEFT JOIN (
										SELECT DISTINCT participant_id, id 
										FROM form_submissions 
										WHERE form_type = 'acceptation_risque' AND organization_id = $1
									) ar ON p.id = ar.participant_id
									JOIN participant_organizations po 
									ON po.participant_id = p.id AND po.organization_id = $1
									WHERE (up.user_id = $2 
												 OR EXISTS (
													 SELECT 1 
													 FROM form_submissions fs 
													 WHERE fs.participant_id = p.id 
													 AND fs.form_type = 'participant_registration'
													 AND fs.submission_data->>'courriel' = (
														 SELECT email FROM users WHERE id = $2
													 )
												 ))
								`;
							params = { ...params, user_id: userId };
						}

						console.log(`Query: ${query}`);
						console.log(`Params: ${JSON.stringify(params)}`);

						// Execute the query
						const participantsResult = await client.query(
							query,
							Object.values(params),
						);
						const participants = participantsResult.rows;
						console.log(`Participants count: ${participants.length}`);

						// If no participants are found, log the total participants in the organization
						if (participants.length === 0) {
							const totalParticipantsResult = await client.query(
								`SELECT COUNT(*) 
									 FROM participants p 
									 JOIN participant_organizations po 
									 ON po.participant_id = p.id 
									 AND po.organization_id = $1`,
								[organizationId],
							);
							const totalParticipants = totalParticipantsResult.rows[0]?.count;
							console.log(
								`Total participants in organization: ${totalParticipants}`,
							);
						}

						jsonResponse(res, true, { participants });
					} catch (error) {
						console.error(
							"Error fetching parent dashboard data:",
							error.message,
						);
						jsonResponse(res, false, null, error.message);
					}
					break;
				}

				// Organization settings endpoint (consolidated)
				case "get_organization_settings": {
					const organizationId = getCurrentOrganizationId(req);
					try {
						const settingsResult = await client.query(
							`SELECT setting_key, setting_value 
							 FROM organization_settings 
							 WHERE organization_id = $1`,
							[organizationId],
						);

						const settings = settingsResult.rows.reduce((acc, setting) => {
							try {
								const decodedValue = JSON.parse(setting.setting_value);
								acc[setting.setting_key] =
									decodedValue !== null ? decodedValue : setting.setting_value;
							} catch (e) {
								acc[setting.setting_key] = setting.setting_value;
							}
							return acc;
						}, {});

						return jsonResponse(res, true, settings);
					} catch (error) {
						console.error("Error fetching organization settings:", error);
						return jsonResponse(
							res,
							false,
							null,
							"Error retrieving organization settings",
						);
					}
				}

				// Get available dates endpoint (consolidated)
				case "getAvailableDates": {
					const organizationId = getCurrentOrganizationId(req);
					try {
						const result = await client.query(
							`SELECT DISTINCT date::date AS date 
							 FROM honors 
							 WHERE organization_id = $1 
							 ORDER BY date DESC`,
							[organizationId],
						);

						const dates = result.rows.map((row) => row.date);
						return jsonResponse(res, true, dates);
					} catch (error) {
						console.error("Error fetching available dates:", error);
						return jsonResponse(res, false, null, "Error retrieving dates");
					}
				}

				case "get_news": {
					const organizationId = getCurrentOrganizationId(req);
					try {
						const result = await client.query(
							`SELECT n.*, u.full_name as author_name
								 FROM news n
								 LEFT JOIN users u ON n.author_id = u.id
								 WHERE n.organization_id = $1
								 ORDER BY n.created_at DESC`,
							[organizationId],
						);

						return jsonResponse(res, true, { news: result.rows });
					} catch (error) {
						console.error("Error fetching news:", error);
						return jsonResponse(res, false, null, "Error retrieving news");
					}
				}

				case "get_current_stars": {
					const { participant_id, territoire } = req.query;
					if (!participant_id || !territoire) {
						return jsonResponse(res, false, null, "Invalid input data");
					}

					const currentStarsResult = await client.query(
						`SELECT MAX(etoiles) as current_stars, COUNT(*) as pending_count
							 FROM badge_progress
							 WHERE participant_id = $1 AND territoire_chasse = $2 AND status IN ('approved', 'pending')`,
						[participant_id, territoire],
					);

					const result = currentStarsResult.rows[0];
					jsonResponse(res, true, {
						current_stars: result?.current_stars || 0,
						has_pending: result?.pending_count > 0,
					});
					break;
				}

				case "save_guest": {
					const { name, email, attendance_date } = req.body;

					try {
						const insertResult = await client.query(
							`INSERT INTO guests (name, email, attendance_date) VALUES ($1, $2, $3)`,
							[name, email || null, attendance_date],
						);

						if (insertResult.rowCount > 0) {
							jsonResponse(res, true, null, "Guest added successfully");
						} else {
							throw new Error("Error adding guest");
						}
					} catch (error) {
						jsonResponse(res, false, null, error.message);
					}
					break;
				}

				case "get_participant": {
					const participantId = req.query.id;
					if (!participantId) {
						return jsonResponse(res, false, null, "Participant ID missing");
					}

					try {
						const participantResult = await client.query(
							`SELECT p.*, fs.submission_data
								 FROM participants p
								 LEFT JOIN form_submissions fs ON p.id = fs.participant_id AND fs.form_type = 'participant_registration'
								 WHERE p.id = $1`,
							[participantId],
						);

						let participant = participantResult.rows[0];
						if (participant) {
							participant = {
								...participant,
								...JSON.parse(participant.submission_data || "{}"),
							};
							delete participant.submission_data;
							jsonResponse(res, true, { participant });
						} else {
							jsonResponse(res, false, null, "Participant not found");
						}
					} catch (error) {
						jsonResponse(res, false, null, error.message);
					}
					break;
				}

				case "get_groups": {
					const organizationId = getCurrentOrganizationId(req);
					if (!organizationId) {
						return jsonResponse(res, false, null, "No organization selected");
					}

					try {
						const groupsResult = await client.query(
							`SELECT g.id, g.name, COALESCE(SUM(pt.value), 0) AS total_points
								 FROM groups g
								 LEFT JOIN points pt ON pt.group_id = g.id AND pt.organization_id = $1
								 WHERE g.organization_id = $1
								 GROUP BY g.id, g.name
								 ORDER BY g.name`,
							[organizationId],
						);
						jsonResponse(res, true, { groups: groupsResult.rows });
					} catch (error) {
						jsonResponse(res, false, null, error.message);
					}
					break;
				}

				case "get_participants": {
					const organizationId = getCurrentOrganizationId(req);
					const participantsResult = await client.query(
						`SELECT p.id, p.first_name, p.last_name, p.date_naissance, g.name AS group_name
							 FROM participants p
							 LEFT JOIN participant_groups pg ON p.id = pg.participant_id AND pg.organization_id = $1
							 LEFT JOIN groups g ON pg.group_id = g.id
							 JOIN participant_organizations po ON po.participant_id = p.id AND po.organization_id = $1
							 ORDER BY g.name, p.last_name, p.first_name`,
						[organizationId],
					);
					jsonResponse(res, true, participantsResult.rows);
					break;
				}

				case "get_participant_details": {
					const participantId = req.query.participant_id;
					if (!participantId) {
						return jsonResponse(res, false, null, "Participant ID is required");
					}

					const participantDetailsResult = await client.query(
						`SELECT p.id, p.first_name, p.last_name, p.date_naissance, g.name AS group_name, p.notes
							 FROM participants p
							 LEFT JOIN participant_groups pg ON p.id = pg.participant_id
							 LEFT JOIN groups g ON pg.group_id = g.id
							 WHERE p.id = $1`,
						[participantId],
					);

					if (participantDetailsResult.rows.length > 0) {
						jsonResponse(res, true, participantDetailsResult.rows[0]);
					} else {
						jsonResponse(res, false, null, "Participant not found");
					}
					break;
				}

				case "get_guardians_for_participant": {
					const participantId = req.query.participant_id;
					if (!participantId) {
						return jsonResponse(res, false, null, "Participant ID is required");
					}

					const guardiansResult = await client.query(
						`SELECT pg.id, pg.nom, pg.prenom, pg.courriel, pg.telephone_residence, pg.telephone_travail, pg.telephone_cellulaire
							 FROM parents_guardians pg
							 JOIN participant_guardians pgu ON pg.id = pgu.guardian_id
							 WHERE pgu.participant_id = $1`,
						[participantId],
					);

					jsonResponse(res, true, guardiansResult.rows);
					break;
				}

				case "get_participant_allergies": {
					const participantId = req.query.participant_id;
					if (!participantId) {
						return jsonResponse(res, false, null, "Participant ID is required");
					}

					const allergiesResult = await client.query(
						`SELECT fs.submission_data->>'allergie' AS allergies, fs.submission_data->>'epipen' AS epipen
							 FROM form_submissions fs
							 WHERE fs.participant_id = $1 AND fs.form_type = 'fiche_sante'`,
						[participantId],
					);

					if (allergiesResult.rows.length > 0) {
						jsonResponse(res, true, allergiesResult.rows[0]);
					} else {
						jsonResponse(res, false, null, "No allergy information found");
					}
					break;
				}

				case "get_next_meeting_info": {
					const organizationId = getCurrentOrganizationId(req);

					const nextMeetingResult = await client.query(
						`SELECT date, endroit, animateur_responsable, activities 
							 FROM reunion_preparations 
							 WHERE organization_id = $1 AND date >= CURRENT_DATE 
							 ORDER BY date ASC LIMIT 1`,
						[organizationId],
					);

					if (nextMeetingResult.rows.length > 0) {
						const meetingInfo = nextMeetingResult.rows[0];
						meetingInfo.activities = JSON.parse(meetingInfo.activities || "[]");
						jsonResponse(res, true, meetingInfo);
					} else {
						jsonResponse(res, false, null, "No upcoming meetings found");
					}
					break;
				}

				case "get_form_types": {
					const organizationId = getCurrentOrganizationId(req);
					const formTypesResult = await client.query(
						"SELECT DISTINCT form_type FROM organization_form_formats WHERE organization_id = $1 AND display_type = 'public'",
						[organizationId],
					);
					jsonResponse(
						res,
						true,
						formTypesResult.rows.map((row) => row.form_type),
					);
					break;
				}

				case "get_form_structure": {
					const formType = req.query.form_type;
					if (!formType) {
						jsonResponse(res, false, null, "Form type is required");
					} else {
						const formStructureResult = await client.query(
							"SELECT form_structure FROM organization_form_formats WHERE form_type = $1 AND organization_id = $2",
							[formType, getCurrentOrganizationId(req)],
						);
						if (formStructureResult.rows.length > 0) {
							jsonResponse(
								res,
								true,
								JSON.parse(formStructureResult.rows[0].form_structure),
							);
						} else {
							jsonResponse(res, false, null, "Form structure not found");
						}
					}
					break;
				}

				case "get_form_submissions": {
					const formType = req.query.form_type;
					const participantId = req.query.participant_id;
					if (!formType) {
						jsonResponse(res, false, null, "Form type is required");
					} else if (participantId) {
						const formSubmissionsResult = await client.query(
							"SELECT submission_data FROM form_submissions WHERE participant_id = $1 AND form_type = $2 AND organization_id = $3",
							[participantId, formType, getCurrentOrganizationId(req)],
						);
						if (formSubmissionsResult.rows.length > 0) {
							jsonResponse(
								res,
								true,
								JSON.parse(formSubmissionsResult.rows[0].submission_data),
							);
						} else {
							jsonResponse(res, false, null, "No submission data found");
						}
					} else {
						const allFormSubmissionsResult = await client.query(
							"SELECT fs.participant_id, fs.submission_data, p.first_name, p.last_name FROM form_submissions fs JOIN participant_organizations po ON fs.participant_id = po.participant_id JOIN participants p ON fs.participant_id = p.id WHERE po.organization_id = $1 AND fs.form_type = $2",
							[getCurrentOrganizationId(req), formType],
						);
						jsonResponse(
							res,
							true,
							allFormSubmissionsResult.rows.map((row) => ({
								participant_id: row.participant_id,
								first_name: row.first_name,
								last_name: row.last_name,
								submission_data: JSON.parse(row.submission_data),
							})),
						);
					}
					break;
				}

				case "get_reunion_dates": {
					const organizationId = getCurrentOrganizationId(req);
					const datesResult = await client.query(
						`SELECT DISTINCT date 
					 FROM reunion_preparations 
					 WHERE organization_id = $1 
					 ORDER BY date DESC`,
						[organizationId],
					);
					jsonResponse(
						res,
						true,
						datesResult.rows.map((row) => row.date),
					);
					break;
				}

				case "create_organization": {
					const { name } = req.body;
					const userId = getUserIdFromToken(token);

					try {
						await client.query("BEGIN");

						const newOrgResult = await client.query(
							`INSERT INTO organizations (name) VALUES ($1) RETURNING id`,
							[name],
						);
						const newOrganizationId = newOrgResult.rows[0].id;

						await client.query(
							`INSERT INTO organization_form_formats (organization_id, form_type, form_structure, display_type)
						 SELECT $1, form_type, form_structure, 'public'
						 FROM organization_form_formats
						 WHERE organization_id = 0`,
							[newOrganizationId],
						);

						await client.query(
							`INSERT INTO organization_settings (organization_id, setting_key, setting_value)
						 VALUES ($1, 'organization_info', $2)`,
							[newOrganizationId, JSON.stringify(req.body)],
						);

						await client.query(
							`INSERT INTO user_organizations (user_id, organization_id, role)
						 VALUES ($1, $2, 'admin')`,
							[userId, newOrganizationId],
						);

						await client.query("COMMIT");
						jsonResponse(res, true, null, "Organization created successfully");
					} catch (error) {
						await client.query("ROLLBACK");
						handleError(res, error);
					}
					break;
				}

				case "update_points": {
					const updates = req.body;
					const organizationId = getCurrentOrganizationId(req);
					const responses = [];

					try {
						await client.query("BEGIN");

						for (const update of updates) {
							if (update.type === "group") {
								await client.query(
									`INSERT INTO points (participant_id, group_id, value, created_at, organization_id) 
								 VALUES (NULL, $1, $2, $3, $4)`,
									[update.id, update.points, update.timestamp, organizationId],
								);

								const membersResult = await client.query(
									`SELECT p.id 
								 FROM participants p
								 JOIN participant_groups pg ON p.id = pg.participant_id
								 WHERE pg.group_id = $1 AND pg.organization_id = $2`,
									[update.id, organizationId],
								);

								for (const member of membersResult.rows) {
									await client.query(
										`INSERT INTO points (participant_id, group_id, value, created_at, organization_id) 
									 VALUES ($1, NULL, $2, $3, $4)`,
										[
											member.id,
											update.points,
											update.timestamp,
											organizationId,
										],
									);
								}

								const groupTotalResult = await client.query(
									`SELECT COALESCE(SUM(value), 0) as total_points 
								 FROM points 
								 WHERE group_id = $1 AND participant_id IS NULL AND organization_id = $2`,
									[update.id, organizationId],
								);

								responses.push({
									type: "group",
									id: update.id,
									totalPoints: groupTotalResult.rows[0].total_points,
									memberIds: membersResult.rows.map((row) => row.id),
								});
							} else {
								await client.query(
									`INSERT INTO points (participant_id, group_id, value, created_at, organization_id) 
								 VALUES ($1, NULL, $2, $3, $4)`,
									[update.id, update.points, update.timestamp, organizationId],
								);

								const individualTotalResult = await client.query(
									`SELECT COALESCE(SUM(value), 0) as total_points 
								 FROM points 
								 WHERE participant_id = $1 AND organization_id = $2`,
									[update.id, organizationId],
								);

								responses.push({
									type: "individual",
									id: update.id,
									totalPoints: individualTotalResult.rows[0].total_points,
								});
							}
						}

						await client.query("COMMIT");
						jsonResponse(res, true, responses);
					} catch (error) {
						await client.query("ROLLBACK");
						handleError(res, error);
					}
					break;
				}

				case "get_acceptation_risque": {
					const participantId = req.query.participant_id;
					if (participantId) {
						const acceptationRisqueResult = await client.query(
							`SELECT * FROM acceptation_risque WHERE participant_id = $1`,
							[participantId],
						);
						if (acceptationRisqueResult.rows.length > 0) {
							jsonResponse(res, true, acceptationRisqueResult.rows[0]);
						} else {
							jsonResponse(res, false, null, "Acceptation risque not found");
						}
					} else {
						jsonResponse(res, false, null, "Invalid participant ID");
					}
					break;
				}

				case "save_acceptation_risque": {
					const {
						participant_id,
						groupe_district,
						accepte_risques,
						accepte_covid19,
						participation_volontaire,
						declaration_sante,
						declaration_voyage,
						nom_parent_tuteur,
						date_signature,
					} = req.body;

					const saveAcceptationRisqueResult = await client.query(
						`INSERT INTO acceptation_risque 
					 (participant_id, groupe_district, accepte_risques, accepte_covid19, 
						participation_volontaire, declaration_sante, declaration_voyage, 
						nom_parent_tuteur, date_signature) 
					 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) 
					 ON CONFLICT (participant_id) DO UPDATE SET 
					 groupe_district = EXCLUDED.groupe_district, 
					 accepte_risques = EXCLUDED.accepte_risques, 
					 accepte_covid19 = EXCLUDED.accepte_covid19, 
					 participation_volontaire = EXCLUDED.participation_volontaire, 
					 declaration_sante = EXCLUDED.declaration_sante, 
					 declaration_voyage = EXCLUDED.declaration_voyage, 
					 nom_parent_tuteur = EXCLUDED.nom_parent_tuteur, 
					 date_signature = EXCLUDED.date_signature`,
						[
							participant_id,
							groupe_district,
							accepte_risques,
							accepte_covid19,
							participation_volontaire,
							declaration_sante,
							declaration_voyage,
							nom_parent_tuteur,
							date_signature,
						],
					);

					if (saveAcceptationRisqueResult.rowCount > 0) {
						jsonResponse(
							res,
							true,
							null,
							"Acceptation risque saved successfully",
						);
					} else {
						jsonResponse(res, false, null, "Failed to save acceptation risque");
					}
					break;
				}

				case "get_guardians": {
					const participantId = req.query.participant_id;
					if (participantId) {
						const guardianInfoResult = await client.query(
							"SELECT guardian_id, lien FROM participant_guardians WHERE participant_id = $1",
							[participantId],
						);
						const guardianInfo = guardianInfoResult.rows;

						if (guardianInfo.length > 0) {
							const guardianIds = guardianInfo.map((row) => row.guardian_id);
							const lienInfo = guardianInfo.reduce((acc, row) => {
								acc[row.guardian_id] = row.lien;
								return acc;
							}, {});

							const guardianDetailsResult = await client.query(
								`SELECT id, nom, prenom, courriel, telephone_residence, telephone_travail, 
											telephone_cellulaire, is_primary, is_emergency_contact
							 FROM parents_guardians
							 WHERE id = ANY($1::int[])`,
								[guardianIds],
							);
							const guardians = guardianDetailsResult.rows;

							const customFormFormatResult = await client.query(
								"SELECT form_structure FROM organization_form_formats WHERE form_type = 'parent_guardian' AND organization_id = $1",
								[getCurrentOrganizationId(req)],
							);
							const customFormFormat =
								customFormFormatResult.rows[0]?.form_structure;

							const mergedData = guardians.map((guardian) => ({
								...guardian,
								lien: lienInfo[guardian.id],
								custom_form: customFormFormat
									? JSON.parse(customFormFormat)
									: null,
							}));

							jsonResponse(res, true, mergedData);
						} else {
							jsonResponse(
								res,
								false,
								null,
								"No guardians found for this participant.",
							);
						}
					} else {
						jsonResponse(res, false, null, "Missing participant_id parameter.");
					}
					break;
				}

				case "participant-age": {
					const participantsResult = await client.query(
						`SELECT p.id, p.first_name, p.last_name, p.date_naissance, 
									EXTRACT(YEAR FROM AGE(p.date_naissance)) AS age
					 FROM participants p
					 JOIN participant_organizations po ON p.id = po.participant_id
					 WHERE po.organization_id = $1
					 ORDER BY p.date_naissance ASC, p.last_name`,
						[getCurrentOrganizationId(req)],
					);
					jsonResponse(res, true, participantsResult.rows);
					break;
				}

				case "get_health_report": {
					const healthReportResult = await client.query(
						`SELECT p.id as participant_id, p.first_name, p.last_name,
									fs.submission_data->>'epipen' AS epipen,
									fs.submission_data->>'allergie' AS allergies,
									fs.submission_data->>'probleme_sante' AS health_issues,
									fs.submission_data->>'niveau_natation' AS swimming_level,
									fs.submission_data->>'blessures_operations' AS injuries,
									fs2.submission_data->>'peut_partir_seul' AS leave_alone,
									fs2.submission_data->>'consentement_photos_videos' AS media_consent
					 FROM participants p
					 JOIN form_submissions fs ON fs.participant_id = p.id AND fs.form_type = 'fiche_sante'
					 JOIN form_submissions fs2 ON fs2.participant_id = p.id AND fs2.form_type = 'participant_registration'
					 JOIN participant_organizations po ON po.participant_id = p.id
					 WHERE po.organization_id = $1`,
						[getCurrentOrganizationId(req)],
					);
					jsonResponse(res, true, healthReportResult.rows);
					break;
				}

				case "get_mailing_list": {
					const usersEmailsResult = await client.query(
						`SELECT u.email, uo.role 
					 FROM user_organizations uo
					 JOIN users u ON u.id = uo.user_id
					 WHERE uo.organization_id = $1
					 AND u.email IS NOT NULL 
					 AND u.email != ''`,
						[getCurrentOrganizationId(req)],
					);
					const usersEmails = usersEmailsResult.rows;

					const emailsByRole = usersEmails.reduce((acc, user) => {
						const role = user.role;
						const email = user.email.toLowerCase();
						if (!acc[role]) {
							acc[role] = [];
						}
						acc[role].push(email);
						return acc;
					}, {});

					const parentEmailsResult = await client.query(
						`SELECT LOWER(fs.submission_data->>'guardian_courriel_0') AS courriel, 
									string_agg(p.first_name || ' ' || p.last_name, ', ') AS participants
					 FROM form_submissions fs
					 JOIN participants p ON fs.participant_id = p.id
					 WHERE (fs.submission_data->>'guardian_courriel_0') IS NOT NULL 
					 AND (fs.submission_data->>'guardian_courriel_0') != ''
					 AND fs.organization_id = $1
					 GROUP BY fs.submission_data->>'guardian_courriel_0'
					 UNION
					 SELECT LOWER(fs.submission_data->>'guardian_courriel_1') AS courriel, 
									string_agg(p.first_name || ' ' || p.last_name, ', ') AS participants
					 FROM form_submissions fs
					 JOIN participants p ON fs.participant_id = p.id
					 WHERE (fs.submission_data->>'guardian_courriel_1') IS NOT NULL 
					 AND (fs.submission_data->>'guardian_courriel_1') != ''
					 AND fs.organization_id = $1
					 GROUP BY fs.submission_data->>'guardian_courriel_1'`,
						[getCurrentOrganizationId(req)],
					);
					const parentEmails = parentEmailsResult.rows;

					emailsByRole["parent"] = parentEmails.map((parent) => ({
						email: parent.courriel,
						participants: parent.participants,
					}));

					const participantEmailsResult = await client.query(
						`SELECT LOWER(fs.submission_data->>'courriel') AS courriel
					 FROM form_submissions fs
					 WHERE (fs.submission_data->>'courriel') IS NOT NULL 
					 AND (fs.submission_data->>'courriel') != ''
					 AND fs.organization_id = $1`,
						[getCurrentOrganizationId(req)],
					);
					const participantEmails = participantEmailsResult.rows.map(
						(row) => row.courriel,
					);

					const allEmails = [
						...new Set([
							...Object.values(emailsByRole).flat(),
							...participantEmails,
						]),
					];

					jsonResponse(res, true, {
						emails_by_role: emailsByRole,
						participant_emails: participantEmails,
						unique_emails: allEmails,
					});
					break;
				}

				case "get_organization_form_formats": {
					const organizationId =
						req.query.organization_id || getCurrentOrganizationId(req);
					const formFormatsResult = await client.query(
						`SELECT form_type, form_structure 
					 FROM organization_form_formats 
					 WHERE organization_id = $1`,
						[organizationId],
					);
					const formFormats = formFormatsResult.rows.reduce((acc, form) => {
						acc[form.form_type] = JSON.parse(form.form_structure);
						return acc;
					}, {});
					jsonResponse(res, true, formFormats);
					break;
				}

				case "get_activites_rencontre": {
					const activitesResult = await client.query(
						"SELECT * FROM activites_rencontre ORDER BY activity",
					);
					jsonResponse(res, true, activitesResult.rows);
					break;
				}

				case "get_animateurs": {
					const animateursResult = await client.query(
						`SELECT u.id, u.full_name 
					 FROM users u
					 JOIN user_organizations uo ON u.id = uo.user_id
					 WHERE uo.organization_id = $1 
					 AND uo.role IN ('animation')
					 ORDER BY u.full_name`,
						[getCurrentOrganizationId(req)],
					);
					jsonResponse(res, true, animateursResult.rows);
					break;
				}

				case "get_recent_honors": {
					const recentHonorsResult = await client.query(
						`SELECT p.id, p.first_name, p.last_name 
					 FROM participants p 
					 JOIN honors h ON p.id = h.participant_id 
					 WHERE h.date = (SELECT MAX(h2.date) FROM honors h2 WHERE h2.organization_id = $1) 
					 AND h.organization_id = $1
					 ORDER BY h.date DESC`,
						[getCurrentOrganizationId(req)],
					);
					jsonResponse(res, true, recentHonorsResult.rows);
					break;
				}

				case "save_reminder": {
					const { reminder_date, is_recurring, reminder_text } = req.body;
					await client.query(
						`INSERT INTO rappel_reunion (organization_id, reminder_date, is_recurring, reminder_text) 
					 VALUES ($1, $2, $3, $4)`,
						[
							getCurrentOrganizationId(req),
							reminder_date,
							is_recurring,
							reminder_text,
						],
					);
					jsonResponse(res, true, null, "Reminder saved successfully");
					break;
				}

				case "get_reminder": {
					const reminderResult = await client.query(
						`SELECT * FROM rappel_reunion 
					 WHERE organization_id = $1 
					 ORDER BY creation_time DESC LIMIT 1`,
						[getCurrentOrganizationId(req)],
					);
					if (reminderResult.rows.length > 0) {
						jsonResponse(res, true, reminderResult.rows[0]);
					} else {
						jsonResponse(res, false, null, "No reminder found");
					}
					break;
				}

				case "save_reunion_preparation": {
					const {
						date,
						animateur_responsable,
						louveteau_dhonneur,
						endroit,
						activities,
						notes,
					} = req.body;
					await client.query(
						`INSERT INTO reunion_preparations (organization_id, date, animateur_responsable, louveteau_dhonneur, endroit, activities, notes)
					 VALUES ($1, $2, $3, $4, $5, $6, $7)
					 ON CONFLICT (organization_id, date) DO UPDATE SET
					 animateur_responsable = EXCLUDED.animateur_responsable,
					 louveteau_dhonneur = EXCLUDED.louveteau_dhonneur,
					 endroit = EXCLUDED.endroit,
					 activities = EXCLUDED.activities,
					 notes = EXCLUDED.notes,
					 updated_at = CURRENT_TIMESTAMP`,
						[
							getCurrentOrganizationId(req),
							date,
							animateur_responsable,
							JSON.stringify(louveteau_dhonneur),
							endroit,
							JSON.stringify(activities),
							notes,
						],
					);
					jsonResponse(
						res,
						true,
						null,
						"Reunion preparation saved successfully",
					);
					break;
				}

				case "get_reunion_preparation": {
					const reunionDate =
						req.query.date || new Date().toISOString().split("T")[0];
					const reunionPreparationResult = await client.query(
						`SELECT * FROM reunion_preparations
					 WHERE organization_id = $1 AND date = $2`,
						[getCurrentOrganizationId(req), reunionDate],
					);
					if (reunionPreparationResult.rows.length > 0) {
						const preparation = reunionPreparationResult.rows[0];
						preparation.louveteau_dhonneur = JSON.parse(
							preparation.louveteau_dhonneur,
						);
						preparation.activities = JSON.parse(preparation.activities);
						jsonResponse(res, true, preparation);
					} else {
						jsonResponse(
							res,
							false,
							null,
							"No reunion preparation found for this date",
						);
					}
					break;
				}

				case "register_for_organization": {
					const { registration_password, role, link_children } = req.body;
					const correctPasswordResult = await client.query(
						`SELECT setting_value 
					 FROM organization_settings 
					 WHERE setting_key = 'registration_password' 
					 AND organization_id = $1`,
						[getCurrentOrganizationId(req)],
					);
					const correctPassword = correctPasswordResult.rows[0]?.setting_value;

					if (registration_password !== correctPassword) {
						jsonResponse(res, false, null, "Invalid registration password");
					} else {
						await client.query(
							`INSERT INTO user_organizations (user_id, organization_id, role) 
						 VALUES ($1, $2, $3)`,
							[userId, getCurrentOrganizationId(req), role],
						);

						if (link_children && link_children.length > 0) {
							const linkChildrenQuery = `INSERT INTO participant_organizations (participant_id, organization_id) VALUES ${link_children.map(() => "(?, ?)").join(", ")}`;
							const linkChildrenValues = link_children.flatMap((childId) => [
								childId,
								getCurrentOrganizationId(req),
							]);
							await client.query(linkChildrenQuery, linkChildrenValues);
						}

						jsonResponse(
							res,
							true,
							null,
							"Successfully registered for organization",
						);
					}
					break;
				}

				case "get_user_children": {
					const userChildrenResult = await client.query(
						`SELECT p.id, p.first_name, p.last_name 
					 FROM participants p 
					 JOIN user_participants up ON p.id = up.participant_id 
					 WHERE up.user_id = $1`,
						[userId],
					);
					jsonResponse(res, true, userChildrenResult.rows);
					break;
				}

				case "get_calendars": {
					const calendarsResult = await client.query(
						`SELECT p.id AS participant_id, p.first_name, p.last_name, 
									COALESCE(c.amount, 0) AS calendar_amount, 
									COALESCE(c.amount_paid, 0) AS amount_paid, 
									COALESCE(c.paid, FALSE) AS paid, 
									c.updated_at
					 FROM participants p
					 LEFT JOIN calendars c ON p.id = c.participant_id AND c.organization_id = $1
					 LEFT JOIN participant_organizations po ON po.participant_id = p.id AND po.organization_id = $1
					 WHERE po.organization_id = $1
					 OR p.id IN (SELECT participant_id FROM calendars WHERE organization_id = $1)
					 ORDER BY p.last_name, p.first_name`,
						[getCurrentOrganizationId(req)],
					);
					jsonResponse(res, true, calendarsResult.rows);
					break;
				}

				case "update_calendar": {
					const { participant_id, amount, amount_paid } = req.body;
					await client.query(
						`INSERT INTO calendars (participant_id, amount, amount_paid, paid)
					 VALUES ($1, $2, $3, FALSE)
					 ON CONFLICT (participant_id) 
					 DO UPDATE SET amount = EXCLUDED.amount, amount_paid = EXCLUDED.amount_paid, updated_at = CURRENT_TIMESTAMP`,
						[participant_id, amount, amount_paid || 0],
					);
					jsonResponse(res, true, null, "Calendar updated successfully");
					break;
				}

				case "update_calendar_amount_paid": {
					const { participant_id, amount_paid } = req.body;
					await client.query(
						`UPDATE calendars
					 SET amount_paid = $1, updated_at = CURRENT_TIMESTAMP
					 WHERE participant_id = $2`,
						[amount_paid, participant_id],
					);
					jsonResponse(
						res,
						true,
						null,
						"Calendar amount paid updated successfully",
					);
					break;
				}

				case "save_guest": {
					const { name, email, attendance_date } = req.body;
					await client.query(
						`INSERT INTO guests (name, email, attendance_date)
					 VALUES ($1, $2, $3)`,
						[name, email, attendance_date],
					);
					jsonResponse(res, true, null, "Guest added successfully");
					break;
				}

				case "get_guests_by_date": {
					const date = req.query.date || new Date().toISOString().split("T")[0];
					const guestsResult = await client.query(
						`SELECT * FROM guests WHERE attendance_date = $1`,
						[date],
					);
					jsonResponse(res, true, guestsResult.rows);
					break;
				}

				case "get_attendance": {
					const date = req.query.date || new Date().toISOString().split("T")[0];
					const organizationId = getCurrentOrganizationId(req);
					const attendanceResult = await client.query(
						`SELECT a.participant_id, a.status
					 FROM attendance a
					 JOIN participants p ON a.participant_id = p.id
					 JOIN participant_organizations po ON po.participant_id = p.id
					 WHERE a.date = $1 AND po.organization_id = $2`,
						[date, organizationId],
					);
					jsonResponse(res, true, attendanceResult.rows);
					break;
				}

				case "get_attendance_dates": {
					const attendanceDatesResult = await client.query(
						`SELECT DISTINCT date 
					 FROM attendance 
					 WHERE date <= CURRENT_DATE 
					 ORDER BY date DESC`,
					);
					jsonResponse(
						res,
						true,
						attendanceDatesResult.rows.map((row) => row.date),
					);
					break;
				}

				case "remove_group": {
					const { group_id } = req.body;
					await client.query("BEGIN");
					await client.query(
						`UPDATE participants 
					 SET group_id = NULL 
					 WHERE group_id = $1`,
						[group_id],
					);
					await client.query(
						`DELETE FROM groups 
					 WHERE id = $1`,
						[group_id],
					);
					await client.query("COMMIT");
					jsonResponse(res, true, null, "Group removed successfully");
					break;
				}

				case "add_group": {
					const { group_name } = req.body;
					const organizationId = getCurrentOrganizationId(req);
					await client.query(
						`INSERT INTO groups (name, organization_id) 
					 VALUES ($1, $2)`,
						[group_name, organizationId],
					);
					jsonResponse(res, true, null, "Group added successfully");
					break;
				}

				case "get_health_contact_report": {
					const healthContactReportResult = await client.query(
						`SELECT 
						p.id AS participant_id,
						p.first_name,
						p.last_name,
						p.date_naissance,
						g.name AS group_name,
						fs.*
					FROM participants p
					LEFT JOIN groups g ON p.group_id = g.id
					LEFT JOIN fiche_sante fs ON p.id = fs.participant_id
					ORDER BY g.name, p.last_name, p.first_name`,
					);
					jsonResponse(res, true, healthContactReportResult.rows);
					break;
				}

				case "get_attendance_report": {
					const endDate =
						req.query.end_date || new Date().toISOString().split("T")[0];
					const startDate =
						req.query.start_date ||
						new Date(new Date().setDate(new Date().getDate() - 30))
							.toISOString()
							.split("T")[0];

					const totalDaysResult = await client.query(
						`SELECT COUNT(DISTINCT date) as total_days
					 FROM attendance
					 WHERE date BETWEEN $1 AND $2
					 AND organization_id = $3`,
						[startDate, endDate, getCurrentOrganizationId(req)],
					);
					const totalDays = totalDaysResult.rows[0].total_days;

					const attendanceDataResult = await client.query(
						`WITH attendance_days AS (
						SELECT DISTINCT date
						FROM attendance
						WHERE date BETWEEN $1 AND $2
						AND organization_id = $3
					),
					attendance_data AS (
						SELECT 
							p.id, 
							p.first_name, 
							p.last_name, 
							g.name AS group_name,
							a.date,
							a.status
						FROM participants p
						INNER JOIN participant_groups pg ON p.id = pg.participant_id AND pg.organization_id = $3
						INNER JOIN groups g ON pg.group_id = g.id AND g.organization_id = $3
						LEFT JOIN attendance a ON p.id = a.participant_id AND a.organization_id = $3
						WHERE a.date BETWEEN $1 AND $2
					)
					SELECT 
						p.id,
						p.first_name, 
						p.last_name, 
						g.name AS group_name,
						json_agg(json_build_object('date', a.date, 'status', a.status)) AS attendance
					FROM participants p
					INNER JOIN participant_groups pg ON p.id = pg.participant_id AND pg.organization_id = $3
					INNER JOIN groups g ON pg.group_id = g.id AND g.organization_id = $3
					LEFT JOIN attendance_data a ON p.id = a.id
					GROUP BY p.id, p.first_name, p.last_name, g.name
					ORDER BY g.name, p.last_name, p.first_name`,
						[startDate, endDate, getCurrentOrganizationId(req)],
					);

					jsonResponse(res, true, {
						start_date: startDate,
						end_date: endDate,
						total_days: totalDays,
						attendance_data: attendanceDataResult.rows,
					});
					break;
				}

				case "get_allergies_report": {
					const allergiesReportResult = await client.query(
						`SELECT 
						p.first_name || ' ' || p.last_name AS name,
						g.name AS group_name,
						fs.submission_data->>'allergie' AS allergies,
						(fs.submission_data->>'epipen')::boolean AS epipen
					FROM participants p
					LEFT JOIN participant_groups pg ON p.id = pg.participant_id AND pg.organization_id = $1
					LEFT JOIN groups g ON pg.group_id = g.id AND g.organization_id = $1
					LEFT JOIN form_submissions fs ON p.id = fs.participant_id AND fs.organization_id = $1
					JOIN participant_organizations po ON po.organization_id = $1 AND po.participant_id = p.id
					WHERE fs.form_type = 'fiche_sante'
					AND (fs.submission_data->>'allergie' IS NOT NULL AND fs.submission_data->>'allergie' != '')
					ORDER BY g.name, p.last_name, p.first_name`,
						[getCurrentOrganizationId(req)],
					);
					jsonResponse(res, true, allergiesReportResult.rows);
					break;
				}

				case "get_medication_report": {
					const medicationReportResult = await client.query(
						`SELECT 
						p.first_name || ' ' || p.last_name AS name,
						g.name AS group_name,
						fs.submission_data->>'medicament' AS medication
					FROM participants p
					LEFT JOIN participant_groups pg ON p.id = pg.participant_id AND pg.organization_id = $1
					LEFT JOIN groups g ON pg.group_id = g.id AND g.organization_id = $1
					LEFT JOIN form_submissions fs ON p.id = fs.participant_id AND fs.organization_id = $1 
					JOIN participant_organizations po ON po.organization_id = $1 AND po.participant_id = p.id
					WHERE fs.form_type = 'fiche_sante'
					AND (fs.submission_data->>'medicament' IS NOT NULL AND fs.submission_data->>'medicament' != '')
					ORDER BY g.name, p.last_name, p.first_name`,
						[getCurrentOrganizationId(req)],
					);
					jsonResponse(res, true, medicationReportResult.rows);
					break;
				}

				case "get_vaccine_report": {
					const vaccineReportResult = await client.query(
						`SELECT 
						p.first_name || ' ' || p.last_name AS name,
						g.name AS group_name,
						(fs.submission_data->>'vaccins_a_jour')::boolean AS vaccines_up_to_date
					FROM participants p
					LEFT JOIN participant_groups pg ON p.id = pg.participant_id AND pg.organization_id = $1
					LEFT JOIN groups g ON pg.group_id = g.id AND g.organization_id = $1
					LEFT JOIN form_submissions fs ON p.id = fs.participant_id AND fs.organization_id = $1
					JOIN participant_organizations po ON po.organization_id = $1 AND po.participant_id = p.id
					WHERE fs.form_type = 'fiche_sante'
					ORDER BY g.name, p.last_name, p.first_name`,
						[getCurrentOrganizationId(req)],
					);
					jsonResponse(res, true, vaccineReportResult.rows);
					break;
				}

				case "get_leave_alone_report": {
					const leaveAloneReportResult = await client.query(
						`SELECT 
						p.first_name || ' ' || p.last_name AS name,
						g.name AS group_name,
						(fs.submission_data->>'peut_partir_seul')::boolean AS can_leave_alone
					FROM participants p
					LEFT JOIN participant_groups pg ON p.id = pg.participant_id AND pg.organization_id = $1
					LEFT JOIN groups g ON pg.group_id = g.id AND g.organization_id = $1
					LEFT JOIN form_submissions fs ON p.id = fs.participant_id AND fs.organization_id = $1
					JOIN participant_organizations po ON po.organization_id = $1 AND po.participant_id = p.id
					WHERE fs.form_type = 'participant_registration'
					ORDER BY g.name, p.last_name, p.first_name`,
						[getCurrentOrganizationId(req)],
					);
					jsonResponse(res, true, leaveAloneReportResult.rows);
					break;
				}

				case "get_media_authorization_report": {
					const mediaAuthorizationReportResult = await client.query(
						`SELECT 
						p.first_name || ' ' || p.last_name AS name,
						g.name AS group_name,
						(fs.submission_data->>'consentement_photos_videos')::boolean AS media_authorized
					FROM participants p
					LEFT JOIN participant_groups pg ON p.id = pg.participant_id AND pg.organization_id = $1
					LEFT JOIN groups g ON pg.group_id = g.id AND g.organization_id = $1
					LEFT JOIN form_submissions fs ON p.id = fs.participant_id AND fs.organization_id = $1
					JOIN participant_organizations po ON po.organization_id = $1 AND po.participant_id = p.id
					WHERE fs.form_type = 'participant_registration'
					ORDER BY g.name, p.last_name, p.first_name`,
						[getCurrentOrganizationId(req)],
					);
					jsonResponse(res, true, mediaAuthorizationReportResult.rows);
					break;
				}

				case "get_missing_documents_report": {
					const missingDocumentsReportResult = await client.query(
						`SELECT 
						p.first_name || ' ' || p.last_name AS name,
						g.name AS group_name,
						CASE WHEN fs_fiche.id IS NULL THEN 'Fiche Santé' ELSE NULL END AS missing_fiche_sante,
						CASE WHEN fs_risque.id IS NULL THEN 'Acceptation Risque' ELSE NULL END AS missing_acceptation_risque
					FROM participants p
					LEFT JOIN participant_groups pg ON p.id = pg.participant_id AND pg.organization_id = $1
					LEFT JOIN groups g ON pg.group_id = g.id AND g.organization_id = $1
					LEFT JOIN form_submissions fs_fiche ON p.id = fs_fiche.participant_id AND fs_fiche.form_type = 'fiche_sante' AND fs_fiche.organization_id = $1
					LEFT JOIN form_submissions fs_risque ON p.id = fs_risque.participant_id AND fs_risque.form_type = 'acceptation_risque' AND fs_risque.organization_id = $1
					JOIN participant_organizations po ON po.organization_id = $1 AND po.participant_id = p.id
					AND (fs_fiche.id IS NULL OR fs_risque.id IS NULL)
					ORDER BY g.name, p.last_name, p.first_name`,
						[getCurrentOrganizationId(req)],
					);
					const missingDocuments = missingDocumentsReportResult.rows.map(
						(row) => ({
							...row,
							missing_documents: [
								row.missing_fiche_sante,
								row.missing_acceptation_risque,
							].filter(Boolean),
						}),
					);
					jsonResponse(res, true, missingDocuments);
					break;
				}

				case "get_honors_report": {
					const honorsReportResult = await client.query(
						`SELECT 
						p.first_name || ' ' || p.last_name AS name,
						g.name AS group_name,
						COUNT(h.id) AS honors_count
					FROM participants p
					LEFT JOIN participant_groups pg ON p.id = pg.participant_id AND pg.organization_id = $1
					LEFT JOIN groups g ON pg.group_id = g.id AND g.organization_id = $1
					LEFT JOIN honors h ON p.id = h.participant_id AND h.organization_id = $1
					JOIN participant_organizations po ON po.organization_id = $1 AND po.participant_id = p.id
					GROUP BY p.id, g.name
					ORDER BY g.name, p.last_name, p.first_name`,
						[getCurrentOrganizationId(req)],
					);
					jsonResponse(res, true, honorsReportResult.rows);
					break;
				}

				case "get_points_report": {
					const pointsReportResult = await client.query(
						`SELECT 
						g.name AS group_name,
						p.first_name || ' ' || p.last_name AS name,
						COALESCE(SUM(pt.value), 0) AS points
					FROM participants p
					LEFT JOIN participant_groups pg ON p.id = pg.participant_id AND pg.organization_id = $1
					LEFT JOIN groups g ON pg.group_id = g.id AND g.organization_id = $1
					LEFT JOIN points pt ON p.id = pt.participant_id AND pt.organization_id = $1
					JOIN participant_organizations po ON po.organization_id = $1 AND po.participant_id = p.id
					GROUP BY g.id, p.id
					ORDER BY g.name, p.last_name, p.first_name`,
						[getCurrentOrganizationId(req)],
					);
					const groupedPoints = pointsReportResult.rows.reduce((acc, row) => {
						if (!acc[row.group_name]) {
							acc[row.group_name] = [];
						}
						acc[row.group_name].push({ name: row.name, points: row.points });
						return acc;
					}, {});
					jsonResponse(res, true, groupedPoints);
					break;
				}

				case "logout": {
					// Unset all of the session variables
					req.session = null;
					jsonResponse(res, true, null, "Logged out successfully");
					break;
				}

				case "get_groups": {
					const organizationId = getCurrentOrganizationId(req);
					const groupsResult = await client.query(
						`SELECT 
						g.id,
						g.name,
						COALESCE(SUM(pt.value), 0) AS total_points
					 FROM groups g
					 LEFT JOIN points pt ON pt.group_id = g.id AND pt.organization_id = $1
					 WHERE g.organization_id = $1
					 GROUP BY g.id, g.name
					 ORDER BY g.name`,
						[organizationId],
					);
					jsonResponse(res, true, groupsResult.rows);
					break;
				}

				case "update_attendance": {
					const { participant_id, status, date } = req.body;
					const organizationId = getCurrentOrganizationId(req);
					const participantIds = Array.isArray(participant_id)
						? participant_id
						: [participant_id];

					try {
						await client.query("BEGIN");

						for (const participantId of participantIds) {
							const previousStatusResult = await client.query(
								`SELECT status 
							 FROM attendance 
							 WHERE participant_id = $1 AND date = $2 AND organization_id = $3`,
								[participantId, date, organizationId],
							);
							const previousStatus =
								previousStatusResult.rows[0]?.status || "none";

							await client.query(
								`INSERT INTO attendance (participant_id, date, status, organization_id)
							 VALUES ($1, $2, $3, $4)
							 ON CONFLICT (participant_id, date, organization_id) 
							 DO UPDATE SET status = EXCLUDED.status`,
								[participantId, date, status, organizationId],
							);

							const pointAdjustment = calculatePointAdjustment(
								previousStatus,
								status,
							);
							if (pointAdjustment !== 0) {
								await client.query(
									`INSERT INTO points (participant_id, value, created_at, organization_id)
								 VALUES ($1, NULL, $2, $3, $4)`,
									[participantId, pointAdjustment, organizationId],
								);
							}
						}

						await client.query("COMMIT");
						jsonResponse(res, true, null, "Attendance updated successfully");
					} catch (error) {
						await client.query("ROLLBACK");
						handleError(res, error);
					}
					break;
				}

				// Updated honors endpoint (consolidated)
				case "get_honors": {
					const organizationId = getCurrentOrganizationId(req);
					const date = req.query.date || new Date().toISOString().split("T")[0];
					const academicYearStart =
						new Date().getMonth() >= 8
							? `${new Date().getFullYear()}-09-01`
							: `${new Date().getFullYear() - 1}-09-01`;

					try {
						await client.query("BEGIN");

						// Get participants
						const participantsResult = await client.query(
							`SELECT 
								p.id AS participant_id, 
								p.first_name, 
								p.last_name, 
								pg.group_id, 
								COALESCE(g.name, 'no_group') AS group_name
							 FROM participants p
							 JOIN participant_organizations po ON p.id = po.participant_id
							 LEFT JOIN participant_groups pg ON p.id = pg.participant_id 
								 AND pg.organization_id = po.organization_id
							 LEFT JOIN groups g ON pg.group_id = g.id 
								 AND g.organization_id = po.organization_id
							 WHERE po.organization_id = $1
							 ORDER BY g.name, p.last_name, p.first_name`,
							[organizationId],
						);

						// Get honors
						const honorsResult = await client.query(
							`SELECT participant_id, date
							 FROM honors
							 WHERE date >= $1 AND date <= $2 
							 AND organization_id = $3`,
							[academicYearStart, date, organizationId],
						);

						// Get available dates
						const datesResult = await client.query(
							`SELECT DISTINCT date
							 FROM honors
							 WHERE organization_id = $1 
							 AND date >= $2 
							 AND date <= CURRENT_DATE
							 ORDER BY date DESC`,
							[organizationId, academicYearStart],
						);

						await client.query("COMMIT");

						return jsonResponse(res, true, {
							participants: participantsResult.rows,
							honors: honorsResult.rows,
							availableDates: datesResult.rows.map((row) => row.date),
						});
					} catch (error) {
						await client.query("ROLLBACK");
						console.error("Error fetching honors:", error);
						return jsonResponse(
							res,
							false,
							null,
							"Error retrieving honors data",
						);
					}
				}

				case "award_honor": {
					const honors = req.body;
					const organizationId = getCurrentOrganizationId(req);

					try {
						await client.query("BEGIN");

						const awards = [];
						for (const honor of honors) {
							const { participantId, date } = honor;

							const honorResult = await client.query(
								`INSERT INTO honors (participant_id, date, organization_id)
							 VALUES ($1, $2, $3)
							 ON CONFLICT (participant_id, date, organization_id) DO NOTHING
							 RETURNING id`,
								[participantId, date, organizationId],
							);

							if (honorResult.rows.length > 0) {
								await client.query(
									`INSERT INTO points (participant_id, value, created_at, organization_id)
								 VALUES ($1, 5, $2, $3)`,
									[participantId, date, organizationId],
								);
								awards.push({ participantId, awarded: true });
							} else {
								awards.push({
									participantId,
									awarded: false,
									message: "Honor already awarded for this date",
								});
							}
						}

						await client.query("COMMIT");
						jsonResponse(res, true, awards);
					} catch (error) {
						await client.query("ROLLBACK");
						handleError(res, error);
					}
					break;
				}

				case "get_badge_progress": {
					const participantId = req.query.participant_id;
					const organizationId = getCurrentOrganizationId(req);

					if (participantId) {
						const badgeProgressResult = await client.query(
							`SELECT * FROM badge_progress 
												 WHERE participant_id = $1 AND organization_id = $2 
												 ORDER BY created_at DESC`,
							[participantId, organizationId],
						);
						jsonResponse(res, true, badgeProgressResult.rows);
					} else {
						jsonResponse(res, false, null, "Invalid participant ID");
					}
					break;
				}
			}
		} catch (error) {
			jsonResponse(res, false, null, error.message);
		} finally {
			client.release();
		}
	},
);

app.post("/register", async (req, res) => {
	try {
		const data = req.body;
		const token = req.headers.authorization?.split(" ")[1];
		if (!token) {
			return res
				.status(401)
				.json({ success: false, message: "Authorization token missing" });
		}

		// Verify the JWT token and extract organization_id
		let organizationId;
		try {
			const decoded = jwt.verify(token, process.env.JWT_SECRET); // Use your JWT secret
			organizationId = decoded.organization_id;
		} catch (err) {
			return res
				.status(401)
				.json({ success: false, message: "Invalid or expired token" });
		}

		const email = data.email.toLowerCase().trim();
		const fullName = data.full_name.trim();
		const password = data.password;
		const accountCreationPassword = data.account_creation_password;
		const userType = data.user_type;

		// Fetch the account creation password from the organization_settings table
		const accountPasswordResult = await pool.query(
			`SELECT setting_value->>'account_creation_password' AS account_creation_password
			 FROM organization_settings
			 WHERE organization_id = $1 AND setting_key = 'organization_info'`,
			[organizationId],
		);
		const dbAccountCreationPassword =
			accountPasswordResult.rows[0]?.account_creation_password;

		if (
			!dbAccountCreationPassword ||
			accountCreationPassword !== dbAccountCreationPassword
		) {
			return res
				.status(400)
				.json({
					success: false,
					message: translate("invalid_account_creation_password"),
				});
		}

		// Check if the email already exists
		const emailCheckResult = await pool.query(
			`SELECT id FROM users WHERE email = $1`,
			[email],
		);
		if (emailCheckResult.rowCount > 0) {
			return res
				.status(400)
				.json({ success: false, message: translate("email_already_exists") });
		}

		const hashedPassword = await bcrypt.hash(password, 10); // Using bcrypt for hashing
		const isVerified = userType === "parent";

		// Start transaction
		const client = await pool.connect();
		try {
			await client.query("BEGIN");

			// Insert the new user and return the generated UUID
			const userInsertResult = await client.query(
				`INSERT INTO users (email, password, is_verified, full_name)
				 VALUES ($1, $2, $3, $4)
				 RETURNING id`,
				[email, hashedPassword, isVerified, fullName],
			);
			const userId = userInsertResult.rows[0].id;

			// Now insert into the user_organizations table
			await client.query(
				`INSERT INTO user_organizations (user_id, organization_id, role)
				 VALUES ($1, $2, $3)`,
				[userId, organizationId, userType],
			);

			await client.query("COMMIT");

			// If the user type is 'animation', send an email to the admin(s)
			if (userType === "animation") {
				await sendAdminVerificationEmail(organizationId, fullName, email);
			}

			const message = isVerified
				? translate("registration_successful_parent")
				: translate("registration_successful_await_verification");
			return res.json({ success: true, message });
		} catch (error) {
			await client.query("ROLLBACK");
			console.error("Error in register:", error);
			return res
				.status(500)
				.json({ success: false, message: translate("error_creating_account") });
		} finally {
			client.release();
		}
	} catch (error) {
		console.error("Error handling register route:", error);
		return res
			.status(500)
			.json({ success: false, message: translate("error_creating_account") });
	}
});

app.post("/login", async (req, res) => {
	try {
		const email = req.body.email ? req.body.email.toLowerCase() : "";
		const password = req.body.password || "";
		const organizationId =
			req.body.organization_id || getCurrentOrganizationId(req);
		console.log(`Login attempt for email: ${email}`);

		// Step 2: Connect to the database
		const client = await pool.connect();
		try {
			// Step 3: Fetch user from the database and verify credentials
			const result = await client.query(
				`SELECT u.id, u.email, u.password, u.is_verified, u.full_name, uo.role
				 FROM users u
				 JOIN user_organizations uo ON u.id = uo.user_id
				 WHERE u.email = $1 AND uo.organization_id = $2`,
				[email, organizationId],
			);

			const user = result.rows[0];
			if (user) {
				console.log(user);
				// Step 3.1: Handle hash compatibility between $2y$ and $2b$
				const hashedPassword = user.password.startsWith("$2y$")
					? user.password.replace("$2y$", "$2b$")
					: user.password;

				// Step 3.2: Verify the password using bcrypt
				if (await bcrypt.compare(password, hashedPassword)) {
					// Step 4: Check if the account is verified
					if (!user.is_verified) {
						return res.json({
							success: false,
							message:
								"Your account is not yet verified. Please wait for admin verification.",
						});
					}

					// Step 5: Generate a JWT token for authentication
					const token = jwt.sign(
						{
							id: user.id,
							role: user.role,
							organizationId: req.organizationId,
						},
						secretKey,
						{ expiresIn: "72h" },
					);

					// Step 6: Fetch participants linked to the guardian's email but not already linked to the user
					const guardianParticipantsResult = await client.query(
						`SELECT pg.id, p.id AS participant_id, p.first_name, p.last_name 
						 FROM parents_guardians pg
						 JOIN participant_guardians pgu ON pg.id = pgu.guardian_id
						 JOIN participants p ON pgu.participant_id = p.id
						 LEFT JOIN user_participants up ON up.participant_id = p.id AND up.user_id = $1
						 WHERE pg.courriel = $2 AND up.participant_id IS NULL`,
						[user.id, email],
					);

					const guardianParticipants = guardianParticipantsResult.rows;

					// Step 7: Prepare the response data
					const response = {
						success: true,
						message: "login_successful",
						token,
						id: user.id,
						user_role: user.role,
						user_full_name: user.full_name,
					};

					// If there are any participants not linked yet, add them to the response
					if (guardianParticipants.length > 0) {
						response.guardian_participants = guardianParticipants;
					}

					// Log and return the response
					res.json(response);
				} else {
					// Step 8: Handle invalid email or password
					res.json({
						success: false,
						message: "Invalid email or password.",
					});
				}
			} else {
				// Handle case where user is not found
				res.json({
					success: false,
					message: "Invalid email or password.",
				});
			}
		} finally {
			// Step 9: Release the client back to the pool
			client.release();
		}
	} catch (error) {
		// Step 10: Catch any errors and return a failure response
		console.error(`Login error: ${error.message}`);
		res.status(500).json({
			success: false,
			message: `An error occurred during login: ${error.message}`,
		});
	}
});

async function linkUserToGuardian(client, userId, guardianData) {
	const guardianResult = await client.query(
		`SELECT id FROM parents_guardians WHERE courriel = $1`,
		[guardianData.courriel],
	);
	let guardianId;
	if (guardianResult.rows.length > 0) {
		guardianId = guardianResult.rows[0].id;
	} else {
		const newGuardianResult = await client.query(
			`INSERT INTO parents_guardians (nom, prenom, courriel, telephone_residence, telephone_travail, telephone_cellulaire, is_primary, is_emergency_contact)
						 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
						 RETURNING id`,
			[
				guardianData.nom,
				guardianData.prenom,
				guardianData.courriel,
				guardianData.telephone_residence,
				guardianData.telephone_travail,
				guardianData.telephone_cellulaire,
				guardianData.is_primary,
				guardianData.is_emergency_contact,
			],
		);
		guardianId = newGuardianResult.rows[0].id;
	}
	await client.query(
		`INSERT INTO user_guardians (user_id, guardian_id)
				 VALUES ($1, $2)
				 ON CONFLICT DO NOTHING`,
		[userId, guardianId],
	);
	return guardianId;
}

async function getAllParticipantsFormSubmissions(
	client,
	organizationId,
	formType,
) {
	const result = await client.query(
		`SELECT p.id, p.first_name, p.last_name, fs.submission_data 
				 FROM participants p
				 JOIN participant_organizations po ON p.id = po.participant_id
				 LEFT JOIN form_submissions fs ON p.id = fs.participant_id AND fs.form_type = $1
				 WHERE po.organization_id = $2`,
		[formType, organizationId],
	);
	return result.rows;
}

async function getFormStructure(client, formType) {
	const result = await client.query(
		`SELECT form_structure 
				 FROM organization_form_formats 
				 WHERE form_type = $1 AND organization_id = $2`,
		[formType, getCurrentOrganizationId(req)],
	);
	return result.rows[0] ? JSON.parse(result.rows[0].form_structure) : null;
}

async function getFormSubmissions(client, participantId, formType) {
	const result = await client.query(
		`SELECT submission_data 
				 FROM form_submissions 
				 WHERE participant_id = $1 AND form_type = $2 AND organization_id = $3`,
		[participantId, formType, getCurrentOrganizationId(req)],
	);
	return result.rows[0] ? JSON.parse(result.rows[0].submission_data) : null;
}

async function linkGuardianToParticipant(client, participantId, guardianId) {
	await client.query(
		`INSERT INTO participant_guardians (participant_id, guardian_id)
				 VALUES ($1, $2)
				 ON CONFLICT (participant_id, guardian_id) DO NOTHING`,
		[participantId, guardianId],
	);
}

async function fetchGuardiansForUser(client, userId) {
	const result = await client.query(
		`SELECT g.* 
				 FROM parents_guardians g
				 INNER JOIN user_guardians ug ON g.id = ug.guardian_id
				 WHERE ug.user_id = $1`,
		[userId],
	);
	return result.rows;
}

// Helper function to handle JSON responses
function jsonResponse(res, success, data = null, message = "") {
	res.json({
		success,
		data,
		message,
	});
}

// Error handling middleware
function handleError(err, req, res, next) {
	logger.error(err.stack);
	res.status(500).json({ success: false, error: err.message });
}

// JWT token verification
function verifyJWT(token) {
	try {
		return jwt.verify(token, secretKey);
	} catch (e) {
		return null;
	}
}

// Extract bearer token from request
function getBearerToken(req) {
	const authHeader = req.headers.authorization;
	if (authHeader && authHeader.startsWith("Bearer ")) {
		return authHeader.substring(7);
	}
	return null;
}

// Get user ID from JWT token
function getUserIdFromToken(token) {
	try {
		const decoded = jwt.verify(token, secretKey);
		return decoded.id;
	} catch (e) {
		return null;
	}
}

// Compare passwords with bcrypt
async function comparePasswords(plainPassword, hashedPassword) {
	// Modify the hash if it starts with $2y$
	const modifiedHashedPassword = hashedPassword.startsWith("$2y$")
		? hashedPassword.replace("$2y$", "$2b$")
		: hashedPassword;

	return await bcrypt.compare(plainPassword, modifiedHashedPassword);
}

// Authentication middleware
async function requireAuth(req) {
	const token = getBearerToken(req);
	if (!token) {
		throw new Error("Authentication required");
	}

	const decoded = verifyJWT(token);
	if (!decoded) {
		throw new Error("Invalid token");
	}

	return decoded;
}

// Check if user has access to participant
async function userHasAccessToParticipant(client, userId, participantId) {
	const result = await client.query(
		`SELECT 1 FROM user_participants 
				 WHERE user_id = $1 AND participant_id = $2
				 UNION
				 SELECT 1 FROM user_organizations uo
				 JOIN participant_organizations po ON uo.organization_id = po.organization_id
				 WHERE uo.user_id = $1 AND po.participant_id = $2 AND uo.role IN ('admin', 'animation')`,
		[userId, participantId],
	);
	return result.rows.length > 0;
}

// Convert boolean values
function toBool(value) {
	if (typeof value === "boolean") return value;
	if (typeof value === "string") {
		return value.toLowerCase() === "true" || value === "1";
	}
	if (typeof value === "number") {
		return value === 1;
	}
	return false;
}

// Sanitize input
function sanitizeInput(input) {
	if (typeof input !== "string") return input;
	return input
		.trim()
		.replace(/[<>]/g, "") // Remove < and >
		.replace(/&/g, "&amp;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#x27;")
		.replace(/\//g, "&#x2F;");
}

// Debug logging
function logDebug(message) {
	logger.debug(`[${new Date().toISOString()}] ${message}`);
}

// Calculate point adjustment
function calculatePointAdjustment(oldStatus, newStatus) {
	if (oldStatus === newStatus) return 0;
	if (oldStatus === "non-motivated" && newStatus !== "non-motivated") {
		return 1; // Give back the point
	} else if (oldStatus !== "non-motivated" && newStatus === "non-motivated") {
		return -1; // Take away a point
	}
	return 0;
}

// Fetch previous attendance status
async function fetchPreviousStatus(
	client,
	participantId,
	date,
	organizationId,
) {
	const result = await client.query(
		`SELECT status 
				 FROM attendance 
				 WHERE participant_id = $1 
				 AND date = $2 
				 AND organization_id = $3`,
		[participantId, date, organizationId],
	);
	return result.rows[0]?.status || "none";
}

// Ensure participant belongs to organization
async function ensureParticipantInOrganization(
	client,
	participantId,
	organizationId,
) {
	const result = await client.query(
		`SELECT 1 FROM participants p
				 JOIN participant_organizations po ON p.id = po.participant_id
				 WHERE p.id = $1 AND po.organization_id = $2`,
		[participantId, organizationId],
	);

	if (result.rows.length === 0) {
		throw new Error(
			`Participant ${participantId} not found in the current organization`,
		);
	}
}

// Update attendance
async function updateAttendance(
	client,
	participantId,
	date,
	newStatus,
	organizationId,
) {
	const result = await client.query(
		`INSERT INTO attendance (participant_id, date, status, organization_id)
				 VALUES ($1, $2, $3, $4)
				 ON CONFLICT (participant_id, date, organization_id) 
				 DO UPDATE SET status = EXCLUDED.status`,
		[participantId, date, newStatus, organizationId],
	);
	return result.rowCount;
}

// Handle point adjustment
async function handlePointAdjustment(
	client,
	participantId,
	previousStatus,
	newStatus,
	date,
	organizationId,
) {
	const pointAdjustment = calculatePointAdjustment(previousStatus, newStatus);
	if (pointAdjustment !== 0) {
		await client.query(
			`INSERT INTO points (participant_id, value, created_at, organization_id)
						 VALUES ($1, $2, CURRENT_TIMESTAMP, $3)`,
			[participantId, pointAdjustment, organizationId],
		);

		await client.query(
			`UPDATE attendance 
						 SET point_adjustment = $1
						 WHERE participant_id = $2 
						 AND date = $3
						 AND organization_id = $4`,
			[pointAdjustment, participantId, date, organizationId],
		);
	}
	return pointAdjustment;
}

// Get user organizations
async function getUserOrganizations(client, userId) {
	const result = await client.query(
		`SELECT organization_id, role 
				 FROM user_organizations 
				 WHERE user_id = $1`,
		[userId],
	);
	return result.rows;
}

// Start the server
app.listen(port, () => {
	console.log(`Server is running on port ${port}`);
});
