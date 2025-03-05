// controllers/guardianController.js
const { sanitizeInput } = require('../utils');
const logger = require('../config/logger');
const { getOrganizationId } = require('../utils/organizationContext');
const { pool } = require('../config/database');

/**
 * Get all guardians for a participant
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.getGuardians = async (req, res) => {
	const participantId = req.query.participant_id;
	if (!participantId) {
		return res.json({ success: false, message: "Missing participant_id parameter." });
	}

	const client = await pool.connect();
	try {
		const guardianInfoResult = await client.query(
			"SELECT guardian_id, lien FROM participant_guardians WHERE participant_id = $1",
			[participantId]
		);
		const guardianInfo = guardianInfoResult.rows;

		if (guardianInfo.length > 0) {
			const guardianIds = guardianInfo.map(row => row.guardian_id);
			const lienInfo = guardianInfo.reduce((acc, row) => {
				acc[row.guardian_id] = row.lien;
				return acc;
			}, {});

			const guardianDetailsResult = await client.query(
				`SELECT id, nom, prenom, courriel, telephone_residence, telephone_travail, 
								telephone_cellulaire, is_primary, is_emergency_contact
				 FROM parents_guardians
				 WHERE id = ANY($1::int[])`,
				[guardianIds]
			);
			const guardians = guardianDetailsResult.rows;

			const orgId = getOrganizationId(req);
			const customFormFormatResult = await client.query(
				"SELECT form_structure FROM organization_form_formats WHERE form_type = 'parent_guardian' AND organization_id = $1",
				[orgId]
			);
			const customFormFormat = customFormFormatResult.rows[0]?.form_structure;

			const mergedData = guardians.map(guardian => ({
				...guardian,
				lien: lienInfo[guardian.id],
				custom_form: customFormFormat ? JSON.parse(customFormFormat) : null
			}));

			res.json({ success: true, data: mergedData });
		} else {
			res.json({
				success: false,
				message: "No guardians found for this participant."
			});
		}
	} catch (error) {
		logger.error("Error retrieving guardians:", error);
		res.json({ success: false, message: `Error retrieving guardians: ${error.message}` });
	} finally {
		client.release();
	}
};

/**
 * Get guardian information by ID
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.getGuardianInfo = async (req, res) => {
	const { guardian_id } = req.query;
	if (!guardian_id) {
		return res.json({ success: false, message: "Missing guardian ID" });
	}

	const client = await pool.connect();
	try {
		const guardianResult = await client.query(
			`SELECT id, nom, prenom, lien, courriel, telephone_residence, 
							telephone_travail, telephone_cellulaire, is_primary, is_emergency_contact 
			 FROM parents_guardians 
			 WHERE id = $1`,
			[guardian_id]
		);

		if (guardianResult.rows.length === 0) {
			return res.json({ success: false, message: "Guardian not found" });
		}

		res.json({
			success: true,
			data: { guardian: guardianResult.rows[0] },
			message: "Guardian info retrieved successfully"
		});
	} catch (error) {
		logger.error("Error retrieving guardian info:", error);
		res.json({ success: false, message: `Database error: ${error.message}` });
	} finally {
		client.release();
	}
};

/**
 * Get guardians for a specific participant
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.getGuardiansForParticipant = async (req, res) => {
	const participantId = req.query.participant_id;
	if (!participantId) {
		return res.json({ success: false, message: "Invalid participant ID" });
	}

	const client = await pool.connect();
	try {
		const result = await client.query(
			`SELECT pg.id, pg.nom, pg.prenom, pg.courriel, pg.telephone_residence, pg.telephone_travail, pg.telephone_cellulaire
			 FROM parents_guardians pg
			 JOIN participant_guardians pgu ON pg.id = pgu.guardian_id
			 WHERE pgu.participant_id = $1`,
			[participantId]
		);

		res.json({ success: true, data: result.rows });
	} catch (error) {
		logger.error("Error retrieving guardians for participant:", error);
		res.json({ success: false, message: `Error: ${error.message}` });
	} finally {
		client.release();
	}
};

/**
 * Save parent/guardian information
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.saveParent = async (req, res) => {
	const { participant_id, ...parentData } = req.body;

	const client = await pool.connect();
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
				parentData.is_emergency_contact
			]
		);

		const parentId = result.rows[0].id;

		await client.query(
			`INSERT INTO participant_guardians (participant_id, guardian_id, lien)
			 VALUES ($1, $2, $3)
			 ON CONFLICT (participant_id, guardian_id) 
			 DO UPDATE SET lien = EXCLUDED.lien`,
			[participant_id, parentId, parentData.lien]
		);

		res.json({
			success: true,
			data: { parent_id: parentId },
			message: "Parent saved successfully"
		});
	} catch (error) {
		logger.error("Error saving parent:", error);
		res.json({ success: false, message: `Error saving parent: ${error.message}` });
	} finally {
		client.release();
	}
};

/**
 * Save guardian form submission
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.saveGuardianFormSubmission = async (req, res) => {
	const { participant_id, submission_data } = req.body;
	const token = req.headers.authorization?.split(" ")[1];
	const userId = token ? getUserIdFromToken(token) : null;

	if (!userId) {
		return res.json({ success: false, message: "Authentication required" });
	}

	const client = await pool.connect();
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
				submission_data.courriel
			]
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
					existingGuardian.rows[0].id
				]
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
					userId
				]
			);
			guardianId = newGuardian.rows[0].id;
		}

		// Link guardian to participant
		await client.query(
			`INSERT INTO participant_guardians (participant_id, guardian_id)
			 VALUES ($1, $2)
			 ON CONFLICT (participant_id, guardian_id) DO NOTHING`,
			[participant_id, guardianId]
		);

		res.json({ success: true, message: "Guardian saved successfully" });
	} catch (error) {
		logger.error("Error saving guardian:", error);
		res.json({ success: false, message: `Error saving guardian: ${error.message}` });
	} finally {
		client.release();
	}
};

/**
 * Link parent to participant
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.linkParentToParticipant = async (req, res) => {
	const { parent_id, participant_id } = req.body;

	if (!parent_id || !participant_id) {
		return res.json({ success: false, message: "Missing parent ID or participant ID" });
	}

	const client = await pool.connect();
	try {
		await client.query(
			`INSERT INTO participant_guardians (participant_id, guardian_id) 
			 VALUES ($1, $2)`,
			[participant_id, parent_id]
		);

		res.json({ success: true, message: "Parent linked to participant successfully" });
	} catch (error) {
		if (error.code === "23505") {
			// Unique violation
			res.json({ success: false, message: "This parent is already linked to the participant" });
		} else {
			logger.error("Error linking parent to participant:", error);
			res.json({ success: false, message: `Database error: ${error.message}` });
		}
	} finally {
		client.release();
	}
};

/**
 * Remove guardians from a participant
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.removeGuardians = async (req, res) => {
	const { participant_id, guardian_ids } = req.body;

	if (!participant_id || !guardian_ids?.length) {
		return res.json({ success: false, message: "Invalid data for removing guardians" });
	}

	const client = await pool.connect();
	try {
		await client.query("BEGIN");

		// Remove links between participant and guardians
		await client.query(
			`DELETE FROM participant_guardians 
			 WHERE participant_id = $1 
			 AND guardian_id = ANY($2)`,
			[participant_id, guardian_ids]
		);

		// Remove guardians if not linked to other participants
		await client.query(
			`DELETE FROM parents_guardians 
			 WHERE id = ANY($1)
			 AND NOT EXISTS (
					 SELECT 1 FROM participant_guardians 
					 WHERE guardian_id = parents_guardians.id
			 )`,
			[guardian_ids]
		);

		await client.query("COMMIT");
		res.json({ success: true, message: "Guardians removed successfully" });
	} catch (error) {
		await client.query("ROLLBACK");
		logger.error("Error removing guardians:", error);
		res.json({ success: false, message: `Error removing guardians: ${error.message}` });
	} finally {
		client.release();
	}
};

/**
 * Get parent users
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.getParentUsers = async (req, res) => {
	const organizationId = getOrganizationId(req);
	const client = await pool.connect();

	try {
		const result = await client.query(
			`SELECT u.id, u.full_name 
			 FROM users u
			 JOIN user_organizations uo ON u.id = uo.user_id
			 WHERE uo.organization_id = $1 
			 AND uo.role = 'parent'
			 ORDER BY u.full_name`,
			[organizationId]
		);

		res.json({ success: true, data: result.rows });
	} catch (error) {
		logger.error("Error fetching parent users:", error);
		res.json({ success: false, message: "Error fetching parent users" });
	} finally {
		client.release();
	}
};

/**
 * Get parent contact list
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.getParentContactList = async (req, res) => {
	const organizationId = getOrganizationId(req);
	const client = await pool.connect();

	try {
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
			[organizationId]
		);

		// Organize data by child
		const children = result.rows.reduce((acc, row) => {
			const childId = row.id;
			if (!acc[childId]) {
				acc[childId] = {
					name: `${row.first_name} ${row.last_name}`,
					groups: [],
					contacts: []
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
					is_emergency: row.is_emergency_contact
				};

				if (!acc[childId].contacts.some(c => 
					c.name === contactEntry.name && 
					c.phone_home === contactEntry.phone_home)
				) {
					acc[childId].contacts.push(contactEntry);
				}
			}

			return acc;
		}, {});

		res.json({ success: true, data: children });
	} catch (error) {
		logger.error("Error fetching parent contact list:", error);
		res.json({ success: false, message: `Error: ${error.message}` });
	} finally {
		client.release();
	}
};

/**
 * Get parent dashboard data
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.getParentDashboardData = async (req, res) => {
	const token = req.headers.authorization?.split(" ")[1];
	const userId = token ? getUserIdFromToken(token) : null;

	if (!userId) {
		return res.json({ success: false, message: "Invalid user" });
	}

	const organizationId = getOrganizationId(req);
	const client = await pool.connect();

	try {
		// Get the user's role
		const roleResult = await client.query(
			`SELECT role 
			 FROM user_organizations 
			 WHERE user_id = $1 
			 AND organization_id = $2`,
			[userId, organizationId]
		);
		const userRole = roleResult.rows[0]?.role;

		let query;
		let params = [organizationId];

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
			params.push(userId);
		}

		// Execute the query
		const participantsResult = await client.query(query, params);
		const participants = participantsResult.rows;

		// If no participants are found, log the total participants in the organization
		if (participants.length === 0 && (userRole === "animation" || userRole === "admin")) {
			const totalParticipantsResult = await client.query(
				`SELECT COUNT(*) 
				 FROM participants p 
				 JOIN participant_organizations po 
				 ON po.participant_id = p.id 
				 AND po.organization_id = $1`,
				[organizationId]
			);
			const totalParticipants = totalParticipantsResult.rows[0]?.count;
			logger.info(`No participants found for user ID ${userId}. Total participants in organization: ${totalParticipants}`);
		}

		res.json({ success: true, data: { participants } });
	} catch (error) {
		logger.error("Error fetching parent dashboard data:", error);
		res.json({ success: false, message: error.message });
	} finally {
		client.release();
	}
};

/**
 * Helper function to get user ID from JWT token
 * @param {string} token - JWT token
 * @returns {string|null} User ID or null if invalid
 */
function getUserIdFromToken(token) {
	try {
		const decoded = jwt.verify(token, process.env.JWT_SECRET_KEY);
		return decoded.id;
	} catch (e) {
		return null;
	}
}