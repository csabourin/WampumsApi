/*
get_honors: Getting honor records
award_honor: Awarding honors to participants
get_recent_honors: Getting recent honors
*/

// controllers/honorController.js
const { pool } = require('../config/database');
const { jsonResponse } = require('../utils/responseFormatter');
const logger = require('../config/logger');

/**
 * Get all honors for an organization, optionally filtered by date
 */
exports.getHonors = async (req, res) => {
	const client = await pool.connect();
	try {
		const organizationId = req.user.organizationId;
		const date = req.query.date || new Date().toISOString().split("T")[0];
		const academicYearStart = 
			new Date().getMonth() >= 8
				? `${new Date().getFullYear()}-09-01`
				: `${new Date().getFullYear() - 1}-09-01`;

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
			[organizationId]
		);

		// Get honors
		const honorsResult = await client.query(
			`SELECT participant_id, date
			 FROM honors
			 WHERE date >= $1 AND date <= $2 
			 AND organization_id = $3`,
			[academicYearStart, date, organizationId]
		);

		// Get available dates
		const datesResult = await client.query(
			`SELECT DISTINCT date
			 FROM honors
			 WHERE organization_id = $1 
			 AND date >= $2 
			 AND date <= CURRENT_DATE
			 ORDER BY date DESC`,
			[organizationId, academicYearStart]
		);

		return jsonResponse(res, true, {
			participants: participantsResult.rows,
			honors: honorsResult.rows,
			availableDates: datesResult.rows.map((row) => row.date)
		});
	} catch (error) {
		logger.error(`Error fetching honors: ${error.message}`);
		return jsonResponse(res, false, null, "Error retrieving honors data");
	} finally {
		client.release();
	}
};

/**
 * Get the most recent honors for display
 */
exports.getRecentHonors = async (req, res) => {
	const client = await pool.connect();
	try {
		const organizationId = req.user.organizationId;

		const result = await client.query(
			`SELECT p.id, p.first_name, p.last_name 
			 FROM participants p 
			 JOIN honors h ON p.id = h.participant_id 
			 WHERE h.date = (SELECT MAX(h2.date) FROM honors h2 WHERE h2.organization_id = $1) 
			 AND h.organization_id = $1
			 ORDER BY h.date DESC`,
			[organizationId]
		);

		return jsonResponse(res, true, { honors: result.rows });
	} catch (error) {
		logger.error(`Error fetching recent honors: ${error.message}`);
		return jsonResponse(res, false, null, "Error retrieving recent honors");
	} finally {
		client.release();
	}
};

/**
 * Award honors to one or more participants
 */
exports.awardHonor = async (req, res) => {
	const client = await pool.connect();
	try {
		const honors = req.body;
		const organizationId = req.user.organizationId;
		const awards = [];

		await client.query("BEGIN");

		for (const honor of honors) {
			const { participantId, date } = honor;

			const result = await client.query(
				`INSERT INTO honors (participant_id, date, organization_id)
				 VALUES ($1, $2, $3)
				 ON CONFLICT (participant_id, date, organization_id) DO NOTHING
				 RETURNING id`,
				[participantId, date, organizationId]
			);

			if (result.rows.length > 0) {
				// Award points for the honor
				await client.query(
					`INSERT INTO points (participant_id, value, created_at, organization_id)
					 VALUES ($1, 5, $2, $3)`,
					[participantId, date, organizationId]
				);
				awards.push({ participantId, awarded: true });
			} else {
				awards.push({
					participantId,
					awarded: false,
					message: "Honor already awarded for this date"
				});
			}
		}

		await client.query("COMMIT");
		return jsonResponse(res, true, { awards });
	} catch (error) {
		await client.query("ROLLBACK");
		logger.error(`Error awarding honors: ${error.message}`);
		return jsonResponse(res, false, null, `Error awarding honors: ${error.message}`);
	} finally {
		client.release();
	}
};

/**
 * Get honors report by participant
 */
exports.getHonorsReport = async (req, res) => {
	const client = await pool.connect();
	try {
		const organizationId = req.user.organizationId;

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
			[organizationId]
		);

		return jsonResponse(res, true, honorsReportResult.rows);
	} catch (error) {
		logger.error(`Error generating honors report: ${error.message}`);
		return jsonResponse(res, false, null, "Error generating honors report");
	} finally {
		client.release();
	}
};

/**
 * Get available honor dates
 */
exports.getAvailableDates = async (req, res) => {
	const client = await pool.connect();
	try {
		const organizationId = req.user.organizationId;

		const result = await client.query(
			`SELECT DISTINCT date::date AS date 
			 FROM honors 
			 WHERE organization_id = $1 
			 ORDER BY date DESC`,
			[organizationId]
		);

		const dates = result.rows.map((row) => row.date);
		return jsonResponse(res, true, dates);
	} catch (error) {
		logger.error(`Error fetching available dates: ${error.message}`);
		return jsonResponse(res, false, null, "Error retrieving dates");
	} finally {
		client.release();
	}
};

module.exports = exports;