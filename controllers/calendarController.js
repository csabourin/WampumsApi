// controllers/calendarController.js
const { pool } = require('../config/database');
const { jsonResponse } = require('../utils/responseFormatter');
const { getOrganizationId } = require('../utils/organizationContext');
const logger = require('../config/logger');

/**
 * Get all calendars for an organization
 */
exports.getCalendars = async (req, res) => {
	const client = await pool.connect();
	try {
		const organizationId = getOrganizationId(req);

		const result = await client.query(
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
			[organizationId]
		);

		return jsonResponse(res, true, result.rows);
	} catch (error) {
		logger.error(`Error fetching calendars: ${error.message}`);
		return jsonResponse(res, false, null, error.message);
	} finally {
		client.release();
	}
};

/**
 * Get calendar for a specific participant
 */
exports.getParticipantCalendar = async (req, res) => {
	const client = await pool.connect();
	try {
		const { participant_id } = req.query;
		const organizationId = getOrganizationId(req);

		if (!participant_id) {
			return jsonResponse(res, false, null, "Participant ID is required");
		}

		const result = await client.query(
			`SELECT 
				 p.id AS participant_id,
				 p.first_name,
				 p.last_name,
				 COALESCE(c.amount, 0) AS calendar_amount,
				 COALESCE(c.amount_paid, 0) AS amount_paid,
				 COALESCE(c.paid, FALSE) AS paid,
				 c.updated_at
			 FROM participants p
			 LEFT JOIN calendars c ON p.id = c.participant_id
			 JOIN participant_organizations po ON po.participant_id = p.id
			 WHERE p.id = $1
			 AND po.organization_id = $2`,
			[participant_id, organizationId]
		);

		if (result.rows.length === 0) {
			return jsonResponse(res, false, null, "Participant not found or not in this organization");
		}

		return jsonResponse(res, true, { calendar: result.rows[0] });
	} catch (error) {
		logger.error(`Error fetching participant calendar: ${error.message}`);
		return jsonResponse(res, false, null, error.message);
	} finally {
		client.release();
	}
};

/**
 * Update a calendar entry
 */
exports.updateCalendar = async (req, res) => {
	const client = await pool.connect();
	try {
		const { participant_id, amount, amount_paid } = req.body;
		const organizationId = getOrganizationId(req);

		if (!participant_id || amount === undefined) {
			return jsonResponse(res, false, null, "Participant ID and amount are required");
		}

		// Check if participant exists in this organization
		const participantCheck = await client.query(
			`SELECT 1 FROM participant_organizations 
			 WHERE participant_id = $1 AND organization_id = $2`,
			[participant_id, organizationId]
		);

		if (participantCheck.rows.length === 0) {
			// Auto-link participant to organization if not already linked
			await client.query(
				`INSERT INTO participant_organizations (participant_id, organization_id)
				 VALUES ($1, $2)
				 ON CONFLICT DO NOTHING`,
				[participant_id, organizationId]
			);
		}

		// Calculate paid status
		const paid = amount_paid >= amount;

		await client.query(
			`INSERT INTO calendars (participant_id, organization_id, amount, amount_paid, paid)
			 VALUES ($1, $2, $3, $4, $5)
			 ON CONFLICT (participant_id, organization_id) 
			 DO UPDATE SET 
				 amount = EXCLUDED.amount, 
				 amount_paid = EXCLUDED.amount_paid, 
				 paid = EXCLUDED.paid,
				 updated_at = CURRENT_TIMESTAMP`,
			[participant_id, organizationId, amount, amount_paid || 0, paid]
		);

		logger.info(`Calendar updated for participant ${participant_id} in org ${organizationId}`);
		return jsonResponse(res, true, null, "Calendar updated successfully");
	} catch (error) {
		logger.error(`Error updating calendar: ${error.message}`);
		return jsonResponse(res, false, null, error.message);
	} finally {
		client.release();
	}
};

/**
 * Update calendar paid status
 */
exports.updateCalendarPaid = async (req, res) => {
	const client = await pool.connect();
	try {
		const { participant_id, paid_status } = req.body;
		const organizationId = getOrganizationId(req);

		if (!participant_id || paid_status === undefined) {
			return jsonResponse(res, false, null, "Participant ID and paid status are required");
		}

		await client.query(
			`UPDATE calendars
			 SET paid = $1, updated_at = CURRENT_TIMESTAMP
			 WHERE participant_id = $2 AND organization_id = $3`,
			[paid_status, participant_id, organizationId]
		);

		logger.info(`Calendar paid status updated for participant ${participant_id} in org ${organizationId}: ${paid_status}`);
		return jsonResponse(res, true, null, "Calendar paid status updated successfully");
	} catch (error) {
		logger.error(`Error updating calendar paid status: ${error.message}`);
		return jsonResponse(res, false, null, error.message);
	} finally {
		client.release();
	}
};

/**
 * Update calendar amount paid
 */
exports.updateCalendarAmountPaid = async (req, res) => {
	const client = await pool.connect();
	try {
		const { participant_id, amount_paid } = req.body;
		const organizationId = getOrganizationId(req);

		if (!participant_id || amount_paid === undefined) {
			return jsonResponse(res, false, null, "Participant ID and amount paid are required");
		}

		// Get current amount
		const currentAmountResult = await client.query(
			`SELECT amount FROM calendars 
			 WHERE participant_id = $1 AND organization_id = $2`,
			[participant_id, organizationId]
		);

		if (currentAmountResult.rows.length === 0) {
			return jsonResponse(res, false, null, "Calendar entry not found for this participant");
		}

		const currentAmount = currentAmountResult.rows[0].amount;
		const paid = amount_paid >= currentAmount;

		await client.query(
			`UPDATE calendars
			 SET amount_paid = $1, paid = $2, updated_at = CURRENT_TIMESTAMP
			 WHERE participant_id = $3 AND organization_id = $4`,
			[amount_paid, paid, participant_id, organizationId]
		);

		logger.info(`Calendar amount paid updated for participant ${participant_id} in org ${organizationId}: ${amount_paid}`);
		return jsonResponse(res, true, null, "Calendar amount paid updated successfully");
	} catch (error) {
		logger.error(`Error updating calendar amount paid: ${error.message}`);
		return jsonResponse(res, false, null, error.message);
	} finally {
		client.release();
	}
};

/**
 * Get calendar payment summary (total, paid, outstanding)
 */
exports.getCalendarSummary = async (req, res) => {
	const client = await pool.connect();
	try {
		const organizationId = getOrganizationId(req);

		const result = await client.query(
			`SELECT 
				 SUM(amount) AS total_amount,
				 SUM(amount_paid) AS total_paid,
				 SUM(amount) - SUM(amount_paid) AS outstanding,
				 COUNT(*) AS total_calendars,
				 SUM(CASE WHEN paid = true THEN 1 ELSE 0 END) AS fully_paid_count
			 FROM calendars
			 WHERE organization_id = $1`,
			[organizationId]
		);

		return jsonResponse(res, true, result.rows[0]);
	} catch (error) {
		logger.error(`Error getting calendar summary: ${error.message}`);
		return jsonResponse(res, false, null, error.message);
	} finally {
		client.release();
	}
};

/**
 * Generate payment report grouped by status
 */
exports.getPaymentReport = async (req, res) => {
	const client = await pool.connect();
	try {
		const organizationId = getOrganizationId(req);

		// Fully paid calendars
		const paidResult = await client.query(
			`SELECT p.id, p.first_name, p.last_name, c.amount, c.amount_paid, c.updated_at
			 FROM calendars c
			 JOIN participants p ON c.participant_id = p.id
			 WHERE c.organization_id = $1 AND c.paid = true
			 ORDER BY p.last_name, p.first_name`,
			[organizationId]
		);

		// Partially paid calendars
		const partialResult = await client.query(
			`SELECT p.id, p.first_name, p.last_name, c.amount, c.amount_paid, 
							c.amount - c.amount_paid AS remaining, c.updated_at
			 FROM calendars c
			 JOIN participants p ON c.participant_id = p.id
			 WHERE c.organization_id = $1 AND c.paid = false AND c.amount_paid > 0
			 ORDER BY p.last_name, p.first_name`,
			[organizationId]
		);

		// Unpaid calendars
		const unpaidResult = await client.query(
			`SELECT p.id, p.first_name, p.last_name, c.amount, c.updated_at
			 FROM calendars c
			 JOIN participants p ON c.participant_id = p.id
			 WHERE c.organization_id = $1 AND c.amount_paid = 0
			 ORDER BY p.last_name, p.first_name`,
			[organizationId]
		);

		// Summary statistics
		const summaryResult = await client.query(
			`SELECT 
				 SUM(amount) AS total_amount,
				 SUM(amount_paid) AS total_paid,
				 SUM(amount) - SUM(amount_paid) AS outstanding,
				 COUNT(*) AS total_calendars,
				 SUM(CASE WHEN paid = true THEN 1 ELSE 0 END) AS fully_paid_count,
				 SUM(CASE WHEN paid = false AND amount_paid > 0 THEN 1 ELSE 0 END) AS partial_paid_count,
				 SUM(CASE WHEN amount_paid = 0 THEN 1 ELSE 0 END) AS unpaid_count
			 FROM calendars
			 WHERE organization_id = $1`,
			[organizationId]
		);

		return jsonResponse(res, true, {
			fully_paid: paidResult.rows,
			partially_paid: partialResult.rows,
			unpaid: unpaidResult.rows,
			summary: summaryResult.rows[0]
		});
	} catch (error) {
		logger.error(`Error generating payment report: ${error.message}`);
		return jsonResponse(res, false, null, error.message);
	} finally {
		client.release();
	}
};

module.exports = exports;