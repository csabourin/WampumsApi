// controllers/participantController.js

const { pool } = require('../config/database');
const { jsonResponse } = require('../utils/responseFormatter');
const { determineOrganizationId } = require('../utils.js');
const { getOrganizationId } = require('../utils/organizationContext');
const logger = require('../config/logger');

/**
 * Get all participants for the current organization.
 */
exports.getParticipants = async (req, res) => {
	const client = await pool.connect();
	try {
		const organizationId = getOrganizationId(req);
		if (!organizationId) {
			logger.warn("Organization ID is missing or invalid.");
			return jsonResponse(res, false, null, "Invalid organization context");
		}
		const result = await client.query(
			`SELECT 
				p.id, 
				p.first_name, 
				p.last_name, 
				p.date_naissance,
				pg.group_id,
				g.name AS group_name,
				pg.is_leader,
				pg.is_second_leader
			 FROM participants p
			 JOIN participant_organizations po ON p.id = po.participant_id
			 LEFT JOIN participant_groups pg ON p.id = pg.participant_id AND pg.organization_id = $1
			 LEFT JOIN groups g ON pg.group_id = g.id AND g.organization_id = $1
			 WHERE po.organization_id = $1
			 ORDER BY g.name NULLS LAST, p.last_name, p.first_name`,
			[organizationId]
		);
		if (result.rows.length === 0) {
			logger.info(`No participants found for organization ID: ${organizationId}`);
			return jsonResponse(res, true, [], "No participants found");
		}
		return jsonResponse(res, true, result.rows);
	} catch (error) {
		logger.error(`Error fetching participants: ${error.message}`);
		return jsonResponse(res, false, null, "Error retrieving participants");
	} finally {
		client.release();
	}
};

/**
 * Get a single participant by ID.
 */
exports.getParticipant = async (req, res) => {
	const client = await pool.connect();
	try {
		const participantId = req.params.id;
		const organizationId = await determineOrganizationId(req);
		if (!organizationId) {
			logger.warn("Organization ID is missing or invalid.");
			return jsonResponse(res, false, null, "Invalid organization context");
		}
		if (!participantId) {
			logger.warn("Participant ID is missing.");
			return jsonResponse(res, false, null, "Participant ID is required");
		}
		const result = await client.query(
			`SELECT p.id, p.first_name, p.last_name, p.date_naissance
			 FROM participants p
			 JOIN participant_organizations po ON p.id = po.participant_id
			 WHERE p.id = $1 AND po.organization_id = $2`,
			[participantId, organizationId]
		);
		if (result.rows.length === 0) {
			logger.info(`Participant not found for ID: ${participantId} in organization ID: ${organizationId}`);
			return jsonResponse(res, false, null, "Participant not found");
		}
		return jsonResponse(res, true, result.rows[0]);
	} catch (error) {
		logger.error(`Error fetching participant: ${error.message}`);
		return jsonResponse(res, false, null, "Error retrieving participant");
	} finally {
		client.release();
	}
};

/**
 * Get detailed participant information.
 * This may include additional joined data as needed.
 */
exports.getParticipantDetails = async (req, res) => {
	const client = await pool.connect();
	try {
		const participantId = req.query.participant_id;
		const organizationId = await determineOrganizationId(req);
		if (!participantId) {
			return jsonResponse(res, false, null, "Participant ID is required");
		}
		// Example: Join with a health record table and organizations.
		const result = await client.query(
			`SELECT p.id, p.first_name, p.last_name, p.date_naissance, fs.submission_data AS health_record
			 FROM participants p
			 LEFT JOIN form_submissions fs ON p.id = fs.participant_id AND fs.form_type = 'fiche_sante'
			 JOIN participant_organizations po ON p.id = po.participant_id
			 WHERE p.id = $1 AND po.organization_id = $2`,
			[participantId, organizationId]
		);
		if (result.rows.length === 0) {
			return jsonResponse(res, false, null, "Participant details not found");
		}
		// Optionally parse JSON fields if necessary.
		const participant = result.rows[0];
		if (participant.health_record) {
			try {
				participant.health_record = JSON.parse(participant.health_record);
			} catch (e) {
				// leave as is if parsing fails
			}
		}
		return jsonResponse(res, true, participant);
	} catch (error) {
		logger.error(`Error fetching participant details: ${error.message}`);
		return jsonResponse(res, false, null, "Error retrieving participant details");
	} finally {
		client.release();
	}
};

/**
 * Save (create) a new participant.
 * Expects first_name, last_name, and date_naissance in the request body.
 */
exports.saveParticipant = async (req, res) => {
	const client = await pool.connect();
	try {
		const { first_name, last_name, date_naissance } = req.body;
		const organizationId = await determineOrganizationId(req);
		if (!first_name || !last_name || !date_naissance) {
			return jsonResponse(res, false, null, "Missing required fields");
		}
		const result = await client.query(
			`INSERT INTO participants (first_name, last_name, date_naissance)
			 VALUES ($1, $2, $3)
			 RETURNING id`,
			[first_name.trim(), last_name.trim(), date_naissance]
		);
		const participantId = result.rows[0].id;
		// Link participant to organization.
		await client.query(
			`INSERT INTO participant_organizations (participant_id, organization_id)
			 VALUES ($1, $2)
			 ON CONFLICT DO NOTHING`,
			[participantId, organizationId]
		);
		return jsonResponse(res, true, { participant_id: participantId }, "Participant created successfully");
	} catch (error) {
		logger.error(`Error saving participant: ${error.message}`);
		return jsonResponse(res, false, null, "Error saving participant");
	} finally {
		client.release();
	}
};

/**
 * Get participant age report.
 * Returns a list of participants along with their calculated age.
 */
exports.getParticipantAgeReport = async (req, res) => {
	const client = await pool.connect();
	try {
		const organizationId = await determineOrganizationId(req);
		const result = await client.query(
			`SELECT p.id, p.first_name, p.last_name, p.date_naissance,
							EXTRACT(YEAR FROM AGE(p.date_naissance)) AS age
			 FROM participants p
			 JOIN participant_organizations po ON p.id = po.participant_id
			 WHERE po.organization_id = $1
			 ORDER BY p.date_naissance ASC, p.last_name`,
			[organizationId]
		);
		return jsonResponse(res, true, result.rows);
	} catch (error) {
		logger.error(`Error fetching participant age report: ${error.message}`);
		return jsonResponse(res, false, null, "Error retrieving participant age report");
	} finally {
		client.release();
	}
};

/**
 * Get participants along with associated users.
 */
exports.getParticipantsWithUsers = async (req, res) => {
	const client = await pool.connect();
	try {
		const organizationId = await determineOrganizationId(req);
		const result = await client.query(
			`SELECT p.id, p.first_name, p.last_name, 
							string_agg(u.full_name, ', ') AS associated_users
			 FROM participants p
			 JOIN participant_organizations po ON p.id = po.participant_id
			 LEFT JOIN user_participants up ON p.id = up.participant_id
			 LEFT JOIN users u ON up.user_id = u.id
			 WHERE po.organization_id = $1
			 GROUP BY p.id, p.first_name, p.last_name
			 ORDER BY p.last_name, p.first_name`,
			[organizationId]
		);
		return jsonResponse(res, true, result.rows);
	} catch (error) {
		logger.error(`Error fetching participants with users: ${error.message}`);
		return jsonResponse(res, false, null, "Error retrieving participants with users");
	} finally {
		client.release();
	}
};

/**
 * Link a participant to the current organization.
 * Expects participant_id in the request body.
 */
exports.linkParticipantToOrganization = async (req, res) => {
	const client = await pool.connect();
	try {
		const { participant_id } = req.body;
		const organizationId = await determineOrganizationId(req);
		if (!participant_id) {
			return jsonResponse(res, false, null, "Participant ID is required");
		}
		const result = await client.query(
			`INSERT INTO participant_organizations (participant_id, organization_id)
			 VALUES ($1, $2)
			 ON CONFLICT (participant_id, organization_id) DO NOTHING
			 RETURNING id`,
			[participant_id, organizationId]
		);
		if (result.rowCount === 0) {
			return jsonResponse(res, false, null, "Failed to link participant to organization");
		}
		return jsonResponse(res, true, null, "Participant linked to organization successfully");
	} catch (error) {
		logger.error(`Error linking participant to organization: ${error.message}`);
		return jsonResponse(res, false, null, error.message);
	} finally {
		client.release();
	}
};

/**
 * Remove a participant from the current organization.
 * Expects participant_id in the request body.
 */
exports.removeParticipantFromOrganization = async (req, res) => {
	const client = await pool.connect();
	try {
		const { participant_id } = req.body;
		const organizationId = await determineOrganizationId(req);
		if (!participant_id) {
			return jsonResponse(res, false, null, "Participant ID is required");
		}
		await client.query("BEGIN");
		await client.query(
			`DELETE FROM participant_organizations 
			 WHERE participant_id = $1 AND organization_id = $2`,
			[participant_id, organizationId]
		);
		// Optionally, remove participant's associations from other tables if needed.
		await client.query("COMMIT");
		return jsonResponse(res, true, null, "Participant removed from organization successfully");
	} catch (error) {
		await client.query("ROLLBACK");
		logger.error(`Error removing participant from organization: ${error.message}`);
		return jsonResponse(res, false, null, error.message);
	} finally {
		client.release();
	}
};

/**
 * Associate a user with a participant.
 * Expects participant_id and user_id in the request body.
 */
exports.associateUser = async (req, res) => {
	const client = await pool.connect();
	try {
		const { participant_id, user_id } = req.body;
		const organizationId = await determineOrganizationId(req);
		if (!participant_id || !user_id) {
			return jsonResponse(res, false, null, "Participant ID and User ID are required");
		}
		await client.query(
			`INSERT INTO user_participants (user_id, participant_id)
			 VALUES ($1, $2)
			 ON CONFLICT DO NOTHING`,
			[user_id, participant_id]
		);
		// Ensure the user is also associated with the organization.
		await client.query(
			`INSERT INTO user_organizations (user_id, organization_id, role)
			 VALUES ($1, $2, 'parent')
			 ON CONFLICT (user_id, organization_id) DO UPDATE SET role = 'parent'`,
			[user_id, organizationId]
		);
		return jsonResponse(res, true, null, "User associated with participant successfully");
	} catch (error) {
		logger.error(`Error associating user with participant: ${error.message}`);
		return jsonResponse(res, false, null, error.message);
	} finally {
		client.release();
	}
};

/**
 * Link a user to multiple participants.
 * Expects an array of participant_ids in the request body.
 */
exports.linkUserParticipants = async (req, res) => {
	const client = await pool.connect();
	try {
		const { participant_ids } = req.body;
		const userId = req.user.id;
		if (!participant_ids || !Array.isArray(participant_ids) || participant_ids.length === 0) {
			return jsonResponse(res, false, null, "No participants provided");
		}
		for (const participantId of participant_ids) {
			await client.query(
				`INSERT INTO user_participants (user_id, participant_id)
				 VALUES ($1, $2)
				 ON CONFLICT DO NOTHING`,
				[userId, participantId]
			);
		}
		return jsonResponse(res, true, null, "Participants linked to user successfully");
	} catch (error) {
		logger.error(`Error linking user to participants: ${error.message}`);
		return jsonResponse(res, false, null, error.message);
	} finally {
		client.release();
	}
};

/**
 * Get children associated with the current user.
 * Returns participants linked via user_participants.
 */
exports.getUserChildren = async (req, res) => {
	const client = await pool.connect();
	try {
		const userId = req.user.id;
		const organizationId = await determineOrganizationId(req);
		const result = await client.query(
			`SELECT p.id, p.first_name, p.last_name, p.date_naissance
			 FROM participants p
			 JOIN user_participants up ON p.id = up.participant_id
			 JOIN participant_organizations po ON p.id = po.participant_id
			 WHERE up.user_id = $1 AND po.organization_id = $2
			 ORDER BY p.last_name, p.first_name`,
			[userId, organizationId]
		);
		return jsonResponse(res, true, result.rows);
	} catch (error) {
		logger.error(`Error fetching user children: ${error.message}`);
		return jsonResponse(res, false, null, "Error retrieving children for user");
	} finally {
		client.release();
	}
};
