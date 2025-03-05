// controllers/attendanceController.js

const { pool } = require('../config/database');
const { jsonResponse } = require('../utils/responseFormatter');
const { getOrganizationId } = require('../utils/organizationContext');
const logger = require('../config/logger');

/**
 * Get attendance records for a specific date.
 * If no date is provided via query, defaults to today's date.
 */
exports.getAttendance = async (req, res) => {
	const client = await pool.connect();
	try {
		const organizationId = getOrganizationId(req);
		// Use provided date or default to today's date (YYYY-MM-DD)
		const date = req.query.date || new Date().toISOString().split("T")[0];

		const result = await client.query(
			`SELECT a.participant_id, a.status, a.date 
			 FROM attendance a
			 JOIN participant_organizations po ON a.participant_id = po.participant_id
			 WHERE a.date = $1 AND po.organization_id = $2`,
			[date, organizationId]
		);

		return jsonResponse(res, true, result.rows);
	} catch (error) {
		logger.error(`Error fetching attendance: ${error.message}`);
		return jsonResponse(res, false, null, "Error retrieving attendance records");
	} finally {
		client.release();
	}
};

/**
 * Update or insert an attendance record for a participant on a specific date.
 * Expects participant_id, status, and date in the request body.
 */
exports.updateAttendance = async (req, res) => {
	const client = await pool.connect();
	try {
		const organizationId = getOrganizationId(req);
		const { participant_id, status, date } = req.body;

		// Begin transaction
		await client.query("BEGIN");

		// Verify that the participant belongs to this organization
		const participantCheck = await client.query(
			`SELECT 1 FROM participant_organizations 
			 WHERE participant_id = $1 AND organization_id = $2`,
			[participant_id, organizationId]
		);
		if (participantCheck.rowCount === 0) {
			throw new Error("Participant not found in the organization");
		}

		// Insert or update the attendance record
		await client.query(
			`INSERT INTO attendance (participant_id, date, status, organization_id)
			 VALUES ($1, $2, $3, $4)
			 ON CONFLICT (participant_id, date, organization_id)
			 DO UPDATE SET status = EXCLUDED.status`,
			[participant_id, date, status, organizationId]
		);

		await client.query("COMMIT");
		return jsonResponse(res, true, null, "Attendance updated successfully");
	} catch (error) {
		await client.query("ROLLBACK");
		logger.error(`Error updating attendance: ${error.message}`);
		return jsonResponse(res, false, null, error.message);
	} finally {
		client.release();
	}
};

/**
 * Get distinct attendance dates (up to the current date).
 */
exports.getAttendanceDates = async (req, res) => {
	const client = await pool.connect();
	try {
		const result = await client.query(
			`SELECT DISTINCT date 
			 FROM attendance 
			 WHERE date <= CURRENT_DATE 
			 ORDER BY date DESC`
		);
		const dates = result.rows.map(row => row.date);
		return jsonResponse(res, true, dates);
	} catch (error) {
		logger.error(`Error fetching attendance dates: ${error.message}`);
		return jsonResponse(res, false, null, "Error retrieving attendance dates");
	} finally {
		client.release();
	}
};

/**
 * Get an attendance report for participants over a specified period.
 * Query parameters: start_date and end_date (in ISO8601 format).
 * Defaults to the past 30 days if not provided.
 */
exports.getAttendanceReport = async (req, res) => {
	const client = await pool.connect();
	try {
		const organizationId = getOrganizationId(req);
		const end_date = req.query.end_date || new Date().toISOString().split("T")[0];
		// Default start_date is 30 days before end_date
		const defaultStartDate = new Date(new Date(end_date).setDate(new Date(end_date).getDate() - 30))
															.toISOString().split("T")[0];
		const start_date = req.query.start_date || defaultStartDate;

		// Count distinct attendance days in the period
		const totalDaysResult = await client.query(
			`SELECT COUNT(DISTINCT date) as total_days
			 FROM attendance
			 WHERE date BETWEEN $1 AND $2
				 AND organization_id = $3`,
			[start_date, end_date, organizationId]
		);
		const totalDays = totalDaysResult.rows[0].total_days;

		// Aggregate attendance by participant
		const reportResult = await client.query(
			`SELECT participant_id,
							SUM(CASE WHEN status = 'present' THEN 1 ELSE 0 END) AS present_count,
							SUM(CASE WHEN status = 'absent' THEN 1 ELSE 0 END) AS absent_count,
							SUM(CASE WHEN status = 'excused' THEN 1 ELSE 0 END) AS excused_count,
							SUM(CASE WHEN status = 'late' THEN 1 ELSE 0 END) AS late_count,
							SUM(CASE WHEN status = 'non-motivated' THEN 1 ELSE 0 END) AS non_motivated_count
			 FROM attendance
			 WHERE date BETWEEN $1 AND $2
				 AND organization_id = $3
			 GROUP BY participant_id`,
			[start_date, end_date, organizationId]
		);

		return jsonResponse(res, true, {
			totalDays,
			attendance: reportResult.rows
		});
	} catch (error) {
		logger.error(`Error generating attendance report: ${error.message}`);
		return jsonResponse(res, false, null, "Error retrieving attendance report");
	} finally {
		client.release();
	}
};

/**
 * Save a guest record.
 * Expects name, (optional) email, and attendance_date in the request body.
 */
exports.saveGuest = async (req, res) => {
	const client = await pool.connect();
	try {
		const { name, email, attendance_date } = req.body;
		if (!name || !attendance_date) {
			return jsonResponse(res, false, null, "Name and attendance date are required");
		}
		await client.query(
			`INSERT INTO guests (name, email, attendance_date)
			 VALUES ($1, $2, $3)`,
			[name.trim(), email || null, attendance_date]
		);
		return jsonResponse(res, true, null, "Guest added successfully");
	} catch (error) {
		logger.error(`Error saving guest: ${error.message}`);
		return jsonResponse(res, false, null, "Error adding guest");
	} finally {
		client.release();
	}
};

/**
 * Get guests by attendance date.
 * If no date is provided via query, defaults to today's date.
 */
exports.getGuestsByDate = async (req, res) => {
	const client = await pool.connect();
	try {
		const date = req.query.date || new Date().toISOString().split("T")[0];
		const result = await client.query(
			`SELECT * FROM guests WHERE attendance_date = $1`,
			[date]
		);
		return jsonResponse(res, true, result.rows);
	} catch (error) {
		logger.error(`Error fetching guests by date: ${error.message}`);
		return jsonResponse(res, false, null, "Error retrieving guests");
	} finally {
		client.release();
	}
};
