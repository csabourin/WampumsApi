// controllers/badgeController.js
const { pool } = require('../config/database');
const { jsonResponse } = require('../utils/responseFormatter');
const logger = require('../config/logger');

/**
 * Save badge progress for a participant
 */
exports.saveBadgeProgress = async (req, res) => {
	const client = await pool.connect();
	try {
		const {
			participant_id,
			territoire_chasse,
			objectif,
			description,
			fierte,
			raison,
			date_obtention
		} = req.body;

		if (!participant_id || !territoire_chasse) {
			return jsonResponse(res, false, null, "Missing required fields");
		}

		const organizationId = req.user.organizationId;

		// Get current max stars
		const maxStarsResult = await client.query(
			`SELECT MAX(etoiles) as max_stars
			 FROM badge_progress
			 WHERE participant_id = $1 AND territoire_chasse = $2`,
			[participant_id, territoire_chasse]
		);

		let nextStar = maxStarsResult.rows[0].max_stars
			? maxStarsResult.rows[0].max_stars + 1
			: 1;

		if (nextStar > 3) {
			return jsonResponse(
				res,
				false,
				null,
				"Maximum stars already reached for this badge."
			);
		}

		const result = await client.query(
			`INSERT INTO badge_progress (
				 participant_id, territoire_chasse, objectif, description, 
				 fierte, raison, date_obtention, etoiles, status, organization_id
			 ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
			 RETURNING id`,
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
				organizationId
			]
		);

		return jsonResponse(
			res,
			true,
			{ etoiles: nextStar, id: result.rows[0].id },
			"Badge progress saved successfully"
		);
	} catch (error) {
		logger.error(`Error saving badge progress: ${error.message}`);
		return jsonResponse(res, false, null, error.message);
	} finally {
		client.release();
	}
};

/**
 * Get badge progress for a participant
 */
exports.getBadgeProgress = async (req, res) => {
	const client = await pool.connect();
	try {
		const { participant_id } = req.query;
		const organizationId = req.user.organizationId;

		if (!participant_id) {
			return jsonResponse(res, false, null, "Participant ID is required");
		}

		const badgeProgressResult = await client.query(
			`SELECT * FROM badge_progress 
			 WHERE participant_id = $1 AND organization_id = $2 
			 ORDER BY created_at DESC`,
			[participant_id, organizationId]
		);

		return jsonResponse(res, true, badgeProgressResult.rows);
	} catch (error) {
		logger.error(`Error fetching badge progress: ${error.message}`);
		return jsonResponse(res, false, null, error.message);
	} finally {
		client.release();
	}
};

/**
 * Get pending badge approvals
 */
exports.getPendingBadges = async (req, res) => {
	const client = await pool.connect();
	try {
		const organizationId = req.user.organizationId;

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
			[organizationId]
		);

		return jsonResponse(res, true, { pending_badges: result.rows });
	} catch (error) {
		logger.error(`Error fetching pending badges: ${error.message}`);
		return jsonResponse(res, false, null, error.message);
	} finally {
		client.release();
	}
};

/**
 * Get current stars for a badge
 */
exports.getCurrentStars = async (req, res) => {
	const client = await pool.connect();
	try {
		const { participant_id, territoire } = req.query;

		if (!participant_id || !territoire) {
			return jsonResponse(res, false, null, "Invalid input data");
		}

		const currentStarsResult = await client.query(
			`SELECT MAX(etoiles) as current_stars, COUNT(*) as pending_count
			 FROM badge_progress
			 WHERE participant_id = $1 AND territoire_chasse = $2 AND status IN ('approved', 'pending')`,
			[participant_id, territoire]
		);

		const result = currentStarsResult.rows[0];
		return jsonResponse(res, true, {
			current_stars: result?.current_stars || 0,
			has_pending: result?.pending_count > 0
		});
	} catch (error) {
		logger.error(`Error getting current stars: ${error.message}`);
		return jsonResponse(res, false, null, error.message);
	} finally {
		client.release();
	}
};

/**
 * Approve a pending badge
 */
exports.approveBadge = async (req, res) => {
	const client = await pool.connect();
	try {
		const { badge_id } = req.body;

		if (!badge_id) {
			return jsonResponse(res, false, null, "Badge ID is required");
		}

		await client.query(
			`UPDATE badge_progress 
			 SET status = 'approved', approved_at = CURRENT_TIMESTAMP, approved_by = $1 
			 WHERE id = $2`,
			[req.user.id, badge_id]
		);

		return jsonResponse(res, true, null, "Badge approved successfully");
	} catch (error) {
		logger.error(`Error approving badge: ${error.message}`);
		return jsonResponse(res, false, null, error.message);
	} finally {
		client.release();
	}
};

/**
 * Reject a pending badge
 */
exports.rejectBadge = async (req, res) => {
	const client = await pool.connect();
	try {
		const { badge_id, rejection_reason } = req.body;

		if (!badge_id) {
			return jsonResponse(res, false, null, "Badge ID is required");
		}

		await client.query(
			`UPDATE badge_progress 
			 SET status = 'rejected', rejected_at = CURRENT_TIMESTAMP, 
			 rejected_by = $1, rejection_reason = $2 
			 WHERE id = $3`,
			[req.user.id, rejection_reason || null, badge_id]
		);

		return jsonResponse(res, true, null, "Badge rejected successfully");
	} catch (error) {
		logger.error(`Error rejecting badge: ${error.message}`);
		return jsonResponse(res, false, null, error.message);
	} finally {
		client.release();
	}
};

/**
 * Get badge summary for a participant
 */
exports.getBadgeSummary = async (req, res) => {
	const client = await pool.connect();
	try {
		const { participant_id } = req.query;
		const organizationId = req.user.organizationId;

		if (!participant_id) {
			return jsonResponse(res, false, null, "Participant ID is required");
		}

		// Get all territories
		const territoriesResult = await client.query(
			`SELECT DISTINCT territoire_chasse 
			 FROM badge_progress 
			 WHERE organization_id = $1`,
			[organizationId]
		);

		const territories = territoriesResult.rows.map(row => row.territoire_chasse);

		// Get progress for each territory
		const summary = {};

		for (const territoire of territories) {
			const progressResult = await client.query(
				`SELECT MAX(etoiles) as stars
				 FROM badge_progress
				 WHERE participant_id = $1 
				 AND territoire_chasse = $2 
				 AND status = 'approved'
				 AND organization_id = $3`,
				[participant_id, territoire, organizationId]
			);

			const pendingResult = await client.query(
				`SELECT COUNT(*) as count
				 FROM badge_progress
				 WHERE participant_id = $1 
				 AND territoire_chasse = $2 
				 AND status = 'pending'
				 AND organization_id = $3`,
				[participant_id, territoire, organizationId]
			);

			summary[territoire] = {
				stars: progressResult.rows[0]?.stars || 0,
				has_pending: parseInt(pendingResult.rows[0]?.count) > 0
			};
		}

		return jsonResponse(res, true, { summary });
	} catch (error) {
		logger.error(`Error getting badge summary: ${error.message}`);
		return jsonResponse(res, false, null, error.message);
	} finally {
		client.release();
	}
};

/**
 * Get badge history for a participant
 */
exports.getBadgeHistory = async (req, res) => {
	const client = await pool.connect();
	try {
		const { participant_id, territoire } = req.query;
		const organizationId = req.user.organizationId;

		if (!participant_id) {
			return jsonResponse(res, false, null, "Participant ID is required");
		}

		let query = `
			SELECT bp.*, u.full_name as approver_name
			FROM badge_progress bp
			LEFT JOIN users u ON bp.approved_by = u.id
			WHERE bp.participant_id = $1
			AND bp.organization_id = $2
		`;

		const queryParams = [participant_id, organizationId];

		if (territoire) {
			query += " AND bp.territoire_chasse = $3";
			queryParams.push(territoire);
		}

		query += " ORDER BY bp.date_obtention DESC, bp.created_at DESC";

		const result = await client.query(query, queryParams);

		return jsonResponse(res, true, result.rows);
	} catch (error) {
		logger.error(`Error getting badge history: ${error.message}`);
		return jsonResponse(res, false, null, error.message);
	} finally {
		client.release();
	}
};

module.exports = exports;